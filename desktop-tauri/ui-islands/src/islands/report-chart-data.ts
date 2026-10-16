import { SLICE_COLORS, dayLabel, hourText, formatInt, formatTokens, formatPercent, rankRows, type StatsGroup, type StatsHour, type StatsDay, type StatsSlice } from './report-charts'
import { t } from '../i18n'

/** Chart coordinates belong to Recharts; these adapters retain the report's data rules. */
export function chartNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

type AccountIdentity = { provider?: string; providerLabel?: string; edition?: string; editionLabel?: string }
/** Saved report identity wins; live metadata and generated IDs support older backends. */
export function reportAccountProvider(accountId: string, account?: AccountIdentity, snapshot?: AccountIdentity) {
  if (snapshot?.provider?.trim()) return snapshot
  if (account?.provider?.trim()) return account
  // Mirrors AccountStore::add_accio_account: accio-{intl|cn}-{SHA-256 hex}.
  // Do not guess from editable names or accept arbitrary prefix lookalikes.
  const match = /^accio-(intl|cn)-[a-f0-9]{64}$/.exec(accountId)
  if (!match) return null
  return { provider: match[1] === 'intl' ? 'accio' : 'accio-cn', edition: match[1] }
}

export function rankChartData(list: StatsGroup[]) {
  // Keep the established identity, descending order and full-list percentage denominator.
  const source = list.map(item => ({ ...item, totalTokens: chartNumber(item.totalTokens ?? item.tokens) }))
  const total = source.reduce((sum, item) => sum + Math.max(0, item.totalTokens), 0)
  const values = source.filter(item => item.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens)
  return (rankRows(source) || []).map((row, index) => ({
    ...row, tokens: values[index].totalTokens, share: values[index].totalTokens / total * 100,
    provider: values[index].provider, providerLabel: values[index].providerLabel,
    edition: values[index].edition, editionLabel: values[index].editionLabel,
  }))
}

export function donutChartData(list: StatsGroup[], unknownLabel: string) {
  const rows = list.map(item => ({
    name: String(item?.label ?? item?.model ?? item?.id ?? '').trim() || unknownLabel,
    tokens: chartNumber(item?.totalTokens ?? item?.tokens), requests: chartNumber(item?.requests),
  })).filter(item => item.tokens > 0)
  const total = rows.reduce((sum, item) => sum + item.tokens, 0)
  return rows.map((row, index) => ({
    ...row, key: `slice${index}`, percent: row.tokens / total,
    fill: SLICE_COLORS[index % SLICE_COLORS.length],
    tokensText: formatTokens(row.tokens), percentText: formatPercent(row.tokens / total),
    tip: t('{name} · {tokens} tokens · {n} 次请求 · {pct}', {
      name: row.name, tokens: formatTokens(row.tokens), n: formatInt(row.requests), pct: formatPercent(row.tokens / total),
    }),
  }))
}

export function cacheChartData(series: StatsHour[]) {
  return series.map((item, index) => ({
    key: `hour${index}`, hour: String(item.hour || ''), rate: chartNumber(item.rate),
    totalTokens: chartNumber(item.totalTokens), hitTokens: chartNumber(item.hitTokens), inputTokens: chartNumber(item.inputTokens),
    tip: t('{date} {time} · 命中率 {rate} · 总 {tokens} tokens（命中 {hit} / 输入 {input}）', {
      date: dayLabel(String(item.hour).slice(0, 10)), time: hourText(item.hour), rate: formatPercent(item.rate),
      tokens: formatTokens(item.totalTokens), hit: formatTokens(item.hitTokens), input: formatTokens(item.inputTokens),
    }) + modelBreakdown(item.models),
  }))
}

export function dailyChartData(series: StatsDay[]) {
  return series.map((item, index) => ({
    key: `day${index}`, date: String(item.date || ''), tokens: chartNumber(item.tokens), requests: chartNumber(item.requests),
    tip: t('{date} · {tokens} tokens · {n} 次请求', {
      date: dayLabel(item.date), tokens: formatTokens(item.tokens), n: formatInt(item.requests),
    }) + modelBreakdown(item.models),
  }))
}

/** Thin direct labels on dense charts while keeping peaks. Every point keeps its full tooltip. */
export function chartLabelIndices(values: number[], width: number): Set<number> {
  const available = Math.max(1, Math.floor((width - 120) / 72))
  if (values.length <= available) return new Set(values.map((_, index) => index))
  const selected: number[] = []
  const distance = Math.max(1, Math.ceil(values.length / available))
  values.map((value, index) => ({ value, index })).filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value).forEach(item => {
      if (selected.length < available && selected.every(index => Math.abs(index - item.index) >= distance)) selected.push(item.index)
    })
  return new Set(selected)
}

function modelBreakdown(models: StatsSlice[] | undefined): string {
  if (!models?.length) return ''
  return '\n' + [...models].sort((a, b) => chartNumber(b.tokens) - chartNumber(a.tokens))
    .map(model => `${model.label || model.model || t('未知模型')} · ${formatTokens(model.tokens)} tokens`).join('\n')
}
