import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './chart'

/** A responsive daily usage plot shared by compact application surfaces. */
export function UsageChart({ data, label, valueFormatter }: {
  data: Array<{ date: string; value: number }>
  label: string
  valueFormatter: (value: number) => string
}) {
  return (
    <ChartContainer config={{ value: { label, color: 'var(--chart-1)' } }} height={208} className='w-full aspect-auto' aria-label={label}>
      <BarChart accessibilityLayer data={data} margin={{ top: 12, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey='date' tickLine={false} axisLine={false} tickMargin={12} minTickGap={36} tickFormatter={date => String(date).slice(5).replace('-', '/')} />
        <YAxis tickLine={false} axisLine={false} width={60} tickFormatter={value => valueFormatter(value).replace(/\s+/g, '')} tickCount={4} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent formatter={value => <span className='font-medium tabular-nums'>{valueFormatter(Number(value))}</span>} />} />
        <Bar dataKey='value' fill='var(--color-value)' radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}
