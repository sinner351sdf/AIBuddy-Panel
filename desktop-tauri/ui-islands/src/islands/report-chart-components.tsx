import * as React from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, LabelList, Line, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, Popover, PopoverContent, PopoverTrigger, type ChartConfig } from '@ui'
import { axisMax, axisText, formatTokens, hourText, type StatsDay, type StatsGroup, type StatsHour } from './report-charts'
import { cacheChartData, chartLabelIndices, chartNumber, dailyChartData, donutChartData, rankChartData } from './report-chart-data'
import { t } from '../i18n'

function useChartWidth() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(680)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Shared official tooltip surface; each chart's original full reading remains available. */
function ReportChartTooltip({ compact = false, suppressed = false }: { compact?: boolean; suppressed?: boolean }) {
  // On narrow plots the axis margin can be wider than the available tooltip space.
  // Anchor to the chart's left edge so the entire reading remains inside the card.
  return <ChartTooltip active={suppressed ? false : undefined} cursor={false} position={compact ? { x: 0 } : undefined} wrapperStyle={{ maxWidth: '100%' }} content={<ChartTooltipContent hideLabel className='max-w-[min(320px,calc(100vw-32px))]'
    formatter={(_value, _name, item, index) => index === 0
      ? <span className='whitespace-normal break-words leading-relaxed'>{String(item.payload.tip || '')}</span> : null} />} />
}

type ReadingRow = { key: string; tip: string }
type PickReading = (row: ReadingRow, event: { target: EventTarget | null }) => void

/** Preserve the original click-to-pin reading, with component-owned dismissal and positioning. */
function ChartReading({ children, data }: { children: (pick: PickReading, suppressed: boolean) => React.ReactNode; data: ReadingRow[] }) {
  const root = React.useRef<HTMLDivElement>(null)
  const [reading, setReading] = React.useState<{ key: string; anchor: Element } | null>(null)
  const [dismissed, setDismissed] = React.useState(false)
  const text = data.find(row => row.key === reading?.key)?.tip || ''
  React.useEffect(() => { if (reading && !text) setReading(null) }, [reading, text])
  const pick: PickReading = (row, event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    // Recharts can replace sector paths while highlighting or refreshing data.
    // The chart host stays mounted, so pinned readings keep a valid anchor.
    const anchor = target.closest('[data-slot="chart"]') || target
    setReading(previous => previous?.key === row.key ? null : { key: row.key, anchor })
    setDismissed(true)
  }
  return <Popover open={!!reading && !!text} onOpenChange={(open, details) => {
    if (open) return
    const target = details.reason === 'focus-out' && 'relatedTarget' in details.event
      ? details.event.relatedTarget : details.event.target
    // A chart is the external trigger: let its own click handler toggle/switch
    // readings, including clicks that move focus between SVG elements.
    if (details.reason !== 'escape-key' && target instanceof Node && root.current?.contains(target)) {
      details.cancel()
      return
    }
    setReading(null)
    setDismissed(true)
  }}>
    <PopoverTrigger nativeButton={false} render={<div ref={root} role='group' tabIndex={-1} />} className='contents'
      onPointerMove={() => { if (!reading) setDismissed(false) }} onFocusCapture={() => setDismissed(false)}
      onClickCapture={event => {
        // Name/legend data-tip anchors keep their existing shared tooltip bridge.
        if (!(event.target instanceof Element)) return
        if (event.target.closest('[data-tip]')) { setReading(null); return }
        // Recharts 3 exposes the item index on its SVG marks. Capture the hit
        // before hover/active-sector updates can replace the delegated handler.
        const item = event.target.closest('[data-recharts-item-index]')
        const row = item ? data[Number(item.getAttribute('data-recharts-item-index'))] : undefined
        if (row) { pick(row, event); event.stopPropagation() }
      }}>
      {children(pick, !!reading || dismissed)}
    </PopoverTrigger>
    <PopoverContent anchor={reading?.anchor} variant='tooltip' layer='tooltip' side='top' align='center' role='tooltip'
      initialFocus={false} finalFocus={false} className='max-w-[min(320px,calc(100vw-32px))]'>{text}</PopoverContent>
  </Popover>
}

const rankConfig = { share: { label: 'Token', color: 'var(--chart-1)' } } satisfies ChartConfig

/** Keep Recharts item nodes stable across hover changes and unchanged polling results. */
function useStableChartRows<T>(rows: T[]): T[] {
  const signature = JSON.stringify(rows)
  const snapshot = React.useRef({ signature, rows })
  if (snapshot.current.signature !== signature) snapshot.current = { signature, rows }
  return snapshot.current.rows
}

export function UsageRankChart({ list, ariaLabel, renderName }: {
  list: StatsGroup[]; ariaLabel: string
  renderName: (row: ReturnType<typeof rankChartData>[number]) => React.ReactNode
}) {
  const rows = useStableChartRows(rankChartData(list))
  const [ref, width] = useChartWidth()
  const nameWidth = Math.min(240, Math.max(88, width * 0.35))
  return <div ref={ref} className='max-h-[260px] min-w-0 overflow-auto' data-report-chart='rank'>
    <ChartReading data={rows}>{(pick, suppressed) =>
    <ChartContainer config={rankConfig} className='w-full aspect-auto' height={Math.max(88, rows.length * 34 + 8)} role='region' aria-label={ariaLabel}>
      <BarChart accessibilityLayer data={rows} layout='vertical' margin={{ left: 0, right: 116, top: 4, bottom: 4 }} barSize={10}
        onClick={(state, event) => { const row = state.activeTooltipIndex == null ? undefined : rows[Number(state.activeTooltipIndex)]; if (row) pick(row, event) }}>
        <XAxis type='number' domain={[0, 100]} hide />
        <YAxis type='category' dataKey='key' width={nameWidth} tickLine={false} axisLine={false} interval={0}
          tick={({ x, y, payload }) => {
            const row = rows.find(item => item.key === payload.value)
            return row ? <foreignObject x={Math.max(0, chartNumber(x) - nameWidth)} y={chartNumber(y) - 12} width={nameWidth - 10} height={24}>
              <div className='flex h-full min-w-0 items-center gap-1 truncate text-foreground' title={row.full} data-tip={row.tip}>{renderName(row)}</div>
            </foreignObject> : <g />
          }} />
        <ReportChartTooltip compact={width < 520} suppressed={suppressed} />
        <Bar dataKey='share' fill='var(--color-share)' radius={4} isAnimationActive={false}>
          <LabelList dataKey='tokensText' content={({ x, y, width: barWidth, height, index }) => {
            const row = rows[Number(index)]
            return row ? <text x={chartNumber(x) + chartNumber(barWidth) + 8} y={chartNumber(y) + chartNumber(height) / 2}
              dominantBaseline='central' fill='var(--foreground)' fontSize={11}><title>{row.tip}</title>{row.tokensText} · {row.percentText}</text> : null
          }} />
        </Bar>
      </BarChart>
    </ChartContainer>
    }</ChartReading>
  </div>
}

export function UsageDonutChart({ list, unknownLabel, ariaLabel }: { list: StatsGroup[]; unknownLabel: string; ariaLabel: string }) {
  const rows = useStableChartRows(donutChartData(list, unknownLabel))
  const [active, setActive] = React.useState<number | null>(null)
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  const config: ChartConfig = Object.fromEntries(rows.map(row => [row.key, { label: row.name, color: row.fill }]))
  return <div className='donut-layout' data-report-chart='donut'>
    <ChartReading data={rows}>{(pick, suppressed) =>
    <ChartContainer config={config} className='size-[220px] shrink-0 aspect-square max-[720px]:self-center' height={220} role='region' aria-label={ariaLabel}>
      <PieChart accessibilityLayer>
        <ReportChartTooltip compact suppressed={suppressed} />
        <Pie data={rows} dataKey='tokens' nameKey='name' innerRadius={66} outerRadius={94} paddingAngle={0} stroke='var(--background)' strokeWidth={2}
          isAnimationActive={false} onMouseEnter={(_row, index) => setActive(index)} onMouseLeave={() => setActive(null)}
          onClick={(_row, index, event) => pick(rows[index], event)}
          labelLine={false} label={({ cx, cy, midAngle, percent }) => {
            if (!percent || percent < 0.03 || midAngle == null) return null
            const angle = -midAngle * Math.PI / 180
            return <text x={Number(cx) + 81 * Math.cos(angle)} y={Number(cy) + 81 * Math.sin(angle)} textAnchor='middle' dominantBaseline='central'
              pointerEvents='none' fill='var(--chart-label-foreground)' fontSize={11}>{Math.round(percent * 100)}%</text>
          }}>
          {rows.map((row, index) => <Cell key={row.key} fill={row.fill} fillOpacity={active === null || active === index ? 1 : 0.4} />)}
          <Label content={({ viewBox }) => viewBox && 'cx' in viewBox && 'cy' in viewBox
            ? <text x={viewBox.cx} y={viewBox.cy} textAnchor='middle' dominantBaseline='middle' fill='var(--foreground)'>
              <tspan x={viewBox.cx} dy={-4} fontSize={20} fontWeight={600}>{formatTokens(total)}</tspan>
              <tspan x={viewBox.cx} dy={23} fontSize={11} fill='var(--muted-foreground)'>{t('总 Token')}</tspan>
            </text> : null} />
        </Pie>
      </PieChart>
    </ChartContainer>
    }</ChartReading>
    <div className='donut-legend max-w-full max-[720px]:w-full max-[720px]:flex-none'>
      {rows.map((row, index) => <div className='donut-legend-row' data-tip={row.tip} key={row.key}
        onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
        <span className='donut-dot' style={{ background: row.fill }} />
        <span className='donut-legend-name' title={row.name}>{row.name}</span>
        <span className='donut-legend-tokens'>{row.tokensText}</span>
        <span className='donut-legend-percent'>{row.percentText}</span>
      </div>)}
    </div>
  </div>
}

const cacheConfig = {
  hitTokens: { label: '缓存命中 Token', color: 'var(--chart-1)' },
  totalTokens: { label: '总 Token', color: 'var(--chart-2)' },
} satisfies ChartConfig

const ticks = (max: number) => Array.from({ length: 5 }, (_, index) => max * index / 4)

export function CacheHistoryChart({ series }: { series: StatsHour[] }) {
  const [ref, width] = useChartWidth()
  const rows = useStableChartRows(cacheChartData(series))
  const tokenMax = axisMax(Math.max(0, ...rows.flatMap(row => [row.totalTokens, row.hitTokens])))
  const hasTokens = rows.some(row => row.totalTokens > 0)
  const tokenLabels = chartLabelIndices(rows.map(row => row.totalTokens), width)
  const hitLabels = chartLabelIndices(rows.map(row => row.hitTokens), width)
  const data = rows.map((row, index) => ({ ...row,
    tokenLabel: tokenLabels.has(index) && row.totalTokens > 0 ? formatTokens(row.totalTokens) : '',
    hitLabel: hitLabels.has(index) && row.hitTokens > 0 ? formatTokens(row.hitTokens) : '',
  }))
  return <div ref={ref} data-report-chart='cache'>
    <ChartReading data={data}>{(pick, suppressed) =>
    <ChartContainer config={cacheConfig} className='w-full aspect-auto' height={260} role='region' aria-label={t('近 24 小时缓存命中与总 Token 用量趋势')}>
      <ComposedChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 22, bottom: 0 }}
        onClick={(state, event) => { const row = state.activeTooltipIndex == null ? undefined : data[Number(state.activeTooltipIndex)]; if (row) pick(row, event) }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey='hour' tickFormatter={hourText} padding={{ left: 24, right: 24 }} tickLine={false} axisLine={false} minTickGap={28} interval='preserveStartEnd' />
        <YAxis yAxisId='tokens' domain={[0, tokenMax]} ticks={ticks(tokenMax)} tickFormatter={value => axisText(value, tokenMax)} tickLine={false} axisLine={false} width={60} />
        <ReportChartTooltip compact={width < 400} suppressed={suppressed} />
        <ChartLegend content={<ChartLegendContent className='flex-wrap gap-x-4 gap-y-1' />} />
        {hasTokens ? <Area yAxisId='tokens' dataKey='totalTokens' type='linear' stroke='var(--color-totalTokens)' fill='var(--color-totalTokens)' fillOpacity={0.12}
          isAnimationActive={false} dot={{ r: data.length === 1 ? 4 : 2 }} activeDot={{ r: 4 }}>
          <LabelList dataKey='tokenLabel' position='top' offset={9} fill='var(--color-totalTokens)' fontSize={11} />
        </Area> : null}
        <Line yAxisId='tokens' dataKey='hitTokens' type='linear' stroke='var(--color-hitTokens)' strokeWidth={2} dot={{ r: data.length === 1 ? 4 : 2 }} activeDot={{ r: 4 }} isAnimationActive={false}>
          <LabelList dataKey='hitLabel' position='bottom' offset={9} fill='var(--color-hitTokens)' fontSize={11} />
        </Line>
      </ComposedChart>
    </ChartContainer>
    }</ChartReading>
  </div>
}

const dailyConfig = { tokens: { label: 'Token', color: 'var(--chart-1)' } } satisfies ChartConfig

export function DailyTokensChart({ series }: { series: StatsDay[] }) {
  const [ref, width] = useChartWidth()
  const rows = useStableChartRows(dailyChartData(series))
  const max = axisMax(Math.max(0, ...rows.map(row => row.tokens)))
  const labels = chartLabelIndices(rows.map(row => row.tokens), width)
  const data = rows.map((row, index) => ({ ...row, valueLabel: labels.has(index) && row.tokens > 0 ? formatTokens(row.tokens) : '' }))
  return <div ref={ref} data-report-chart='daily'>
    {!rows.some(row => row.tokens > 0) ? <p className='text-center text-muted-foreground'>{t('所选范围内暂无 Token 用量')}</p> : null}
    <ChartReading data={data}>{(pick, suppressed) =>
    <ChartContainer config={dailyConfig} className='w-full aspect-auto' height={260} role='region' aria-label={t('按天 Token 趋势')}>
      <BarChart accessibilityLayer data={data} maxBarSize={28} margin={{ left: 0, right: 12, top: 24, bottom: 0 }}
        onClick={(state, event) => { const row = state.activeTooltipIndex == null ? undefined : data[Number(state.activeTooltipIndex)]; if (row) pick(row, event) }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey='date' tickFormatter={value => String(value).slice(5).replace('-', '/')} tickLine={false} axisLine={false} minTickGap={32} interval='preserveStartEnd' />
        <YAxis domain={[0, max]} ticks={ticks(max)} tickFormatter={value => axisText(value, max)} tickLine={false} axisLine={false} width={60} />
        <ReportChartTooltip compact={width < 400} suppressed={suppressed} />
        <Bar dataKey='tokens' fill='var(--color-tokens)' radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey='valueLabel' position='top' offset={10} fill='var(--foreground)' fontSize={11} />
        </Bar>
      </BarChart>
    </ChartContainer>
    }</ChartReading>
  </div>
}
