import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, AlertDescription, AlertTitle, Button, Card, CardHeader, CardTitle,
  CardDescription, CardContent, CardFooter, Empty, EmptyHeader, EmptyMedia,
  EmptyTitle, EmptyDescription, Progress, SegmentedControl, Skeleton,
  Tabs, TabsList, TabsTrigger, TabsContent, cn,
} from '@ui'
import { UsageChart } from '@ui/usage-chart'
import { PageHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { ProviderLogo } from '../components/ProviderLogo'
import { useStore } from '../state/store'
import { fetchStatsSummary, type StatsRange, type StatsSummary, type StatsDimension } from '../api/gateway'
import { formatCompact, formatInt, formatPercent, formatTokens } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'

const RANGES: Array<{ value: StatsRange; label: string }> = [
  { value: 'today', label: t('今天') },
  { value: '7', label: t('7 天') },
  { value: '30', label: t('30 天') },
  { value: 'month', label: t('本月') },
  { value: 'all', label: t('全部') },
]
const DIMENSIONS = [
  { value: 'models', label: t('模型') },
  { value: 'providers', label: t('提供商') },
  { value: 'accounts', label: t('账号') },
] as const
const numeric = (value: unknown) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0)

/** Each range owns its request. Canceled or superseded responses cannot replace the current report. */
function useReport(range: StatsRange) {
  const [result, setResult] = useState<{ range: StatsRange; data: StatsSummary } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const sequence = useRef(0)
  const refresh = useCallback(() => setReload(value => value + 1), [])
  useEffect(() => {
    let controller: AbortController | undefined
    let disposed = false
    let busy = false
    async function load() {
      if (busy) return
      busy = true
      controller = new AbortController()
      const request = ++sequence.current
      setLoading(true)
      setError('')
      try {
        const next = await fetchStatsSummary(range, controller.signal)
        if (!disposed && request === sequence.current) setResult({ range, data: next })
      } catch (failure) {
        if (!disposed && request === sequence.current) setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        busy = false
        if (!disposed && request === sequence.current) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 60_000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [range, reload])
  return { data: result?.range === range ? result.data : null, error, loading, refresh }
}

export function ReportPage() {
  const { session } = useStore()
  const [range, setRange] = useState<StatsRange>('today')
  const [metric, setMetric] = useState<'tokens' | 'requests'>('tokens')
  const { data, error, loading, refresh } = useReport(range)
  const overview = data?.overview
  const requests = numeric(overview?.requests)
  const successful = numeric(overview?.successful)
  const tokens = numeric(overview?.tokens)
  // Cache ratios are independent of the selected date range. Do not substitute another window.
  const cacheRate = data?.cacheRates?.last24h
  const validCacheRate = typeof cacheRate === 'number' && Number.isFinite(cacheRate) ? cacheRate : null
  const trend = (data?.dailyTrend || []).map(item => ({ date: item.date || '', value: numeric(item[metric]) }))
  const hasTrend = trend.some(item => item.value > 0)
  const dateLabel = data?.startDate && data?.endDate
    ? data.startDate === data.endDate ? data.startDate : `${data.startDate} — ${data.endDate}`
    : t('查看请求与 Token 用量')

  return (
    <div className='m-page m-report'>
      <PageHead title={t('报表')} subtitle={dateLabel} actions={
        <Button variant='ghost' size='icon-lg' className='report-refresh' aria-label={t('刷新报表')} disabled={loading} onClick={refresh}>
          <Icon name='refresh' className={cn(loading && 'animate-spin')} />
        </Button>
      } />
      <div className='report-body'>
        <SegmentedControl className='report-ranges grid w-full grid-cols-5 gap-0.5 rounded-xl p-1' aria-label={t('统计时间范围')} options={RANGES} value={range} onValueChange={setRange} />
        {error ? <Alert variant='destructive'>
          <Icon name='alert' />
          <AlertTitle>{data ? t('刷新失败，正在显示上次结果') : t('报表加载失败')}</AlertTitle>
          <AlertDescription>{error}<Button variant='outline' size='sm' onClick={refresh}>{t('重试')}</Button></AlertDescription>
        </Alert> : null}
        {!data && !error ? <div className='report-loading' role='status' aria-label={t('正在加载报表')}>
          <Skeleton className='h-56 w-full rounded-xl' /><Skeleton className='h-64 w-full rounded-xl' /><Skeleton className='h-48 w-full rounded-xl' />
        </div> : null}
        {data ? <>
          <Card className='report-summary gap-5 pt-6' aria-label={t('用量概览')}>
            <CardHeader className='px-5'>
              <CardDescription>{t('累计 Token 用量')}</CardDescription>
              <CardTitle className='report-total flex items-baseline gap-2.5 text-[40px] font-semibold leading-tight tracking-[-.04em]'>{formatTokens(tokens)}<span>Tokens</span></CardTitle>
              <p className='report-summary-caption'>{t('输入与输出合计 · 所选时间范围')}</p>
            </CardHeader>
            <CardContent className='px-5'>
              <dl className='report-metrics'>
                <Metric label={t('总请求数')} value={formatInt(requests)} detail={t('区间内累计')} />
                <Metric label={t('成功率')} value={requests ? formatPercent(successful / requests) : '—'} detail={t('失败 {n} 次', { n: formatInt(Math.max(0, requests - successful)) })} />
                <Metric label={t('缓存命中率')} value={validCacheRate === null ? '—' : formatPercent(validCacheRate)} detail={t('近 24 小时')} />
              </dl>
            </CardContent>
            <CardFooter className='report-activity justify-between px-5 py-3 text-xs text-muted-foreground'>
              <span><Icon name='checkin' />{t('活跃 {n} 天', { n: formatInt(numeric(overview?.activeDays)) })}</span>
              <span>{t('连续 {n} 天', { n: formatInt(numeric(overview?.streak)) })}</span>
            </CardFooter>
          </Card>
          <div className='report-detail-grid'>
            <Card className='report-trend pt-5'>
              <CardHeader className='report-card-heading flex items-center justify-between gap-3'>
                <div><CardTitle>{t('用量趋势')}</CardTitle><CardDescription>{metric === 'tokens' ? t('每日 Token 用量') : t('每日请求次数')}</CardDescription></div>
                <SegmentedControl aria-label={t('趋势指标')} options={[{ value: 'tokens', label: 'Token' }, { value: 'requests', label: t('请求') }]} value={metric} onValueChange={setMetric} className='report-metric-switch' />
              </CardHeader>
              <CardContent>
                {hasTrend ? <UsageChart data={trend} label={metric === 'tokens' ? t('Token 用量') : t('请求次数')} valueFormatter={metric === 'tokens' ? formatCompact : formatInt} />
                  : <ReportEmpty title={metric === 'tokens' ? t('这段时间还没有 Token 用量') : t('这段时间还没有请求')} description={t('试试其他时间范围，查看历史记录。')} />}
              </CardContent>
            </Card>
            <Card className='report-ranking pt-5'>
              <CardHeader><CardTitle>{t('用量排行')}</CardTitle><CardDescription>{t('按 Token 用量排序 · 显示前 5 项')}</CardDescription></CardHeader>
              <CardContent>
                <Tabs defaultValue='models' className='report-rank-tabs'>
                  <TabsList aria-label={t('用量分类')} className='report-rank-tablist w-full group-data-horizontal/tabs:h-11'>{DIMENSIONS.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList>
                  {DIMENSIONS.map(dimension => <TabsContent key={dimension.value} value={dimension.value}>
                    <Ranking items={data[dimension.value] || []} dimension={dimension.value} total={tokens} />
                  </TabsContent>)}
                </Tabs>
              </CardContent>
            </Card>
          </div>
          {(overview?.topModel?.model || session?.lastRequestModel) ? <div className='report-context'>
            {overview?.topModel?.model ? <p><span>{t('最常用模型')}</span><strong>{overview.topModel.model}</strong></p> : null}
            {session?.lastRequestModel ? <p><span>{t('最近使用')}</span><strong>{session.lastRequestModel}</strong></p> : null}
          </div> : null}
        </> : null}
      </div>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd><p>{detail}</p></div>
}

function ReportEmpty({ title, description }: { title: string; description: string }) {
  return <Empty className='report-empty px-2 py-6'><EmptyHeader><EmptyMedia variant='icon'><Icon name='chart' /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>
}

function Ranking({ items, dimension, total }: { items: StatsDimension[]; dimension: 'models' | 'providers' | 'accounts'; total: number }) {
  // Use the entire dimension (or the overview), never the truncated top five, as the denominator.
  const denominator = total || items.reduce((sum, item) => sum + numeric(item.totalTokens ?? item.tokens), 0)
  const ranked = [...items].sort((a, b) => numeric(b.totalTokens ?? b.tokens) - numeric(a.totalTokens ?? a.tokens)).slice(0, 5)
  if (!ranked.length) return <ReportEmpty title={t('暂无用量记录')} description={t('所选时间内的用量会显示在这里。')} />
  return <ol className='report-ranking-list'>{ranked.map((item, index) => {
    const amount = numeric(item.totalTokens ?? item.tokens)
    const share = denominator ? amount / denominator * 100 : 0
    const label = dimension === 'providers' ? providerLabel(item.id, item.label) : item.label || item.id || t('未知账号')
    return <li key={item.id || index}>
      <div className='report-rank-line'>
        <span className='report-rank-index'>{index + 1}</span>
        {dimension === 'providers' ? <ProviderLogo id={item.id} label={item.label} /> : null}
        <div className='report-rank-name'><strong title={label}>{label}</strong><span>{t('{n} 次请求', { n: formatInt(numeric(item.requests)) })}</span></div>
        <div className='report-rank-value'><strong>{formatCompact(amount)}</strong><span>{share.toFixed(1)}%</span></div>
      </div>
      <Progress value={Math.min(100, share)} aria-label={t('{name} 用量占比', { name: label })} aria-valuetext={`${share.toFixed(1)}%`} />
    </li>
  })}</ol>
}
