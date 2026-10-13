/** 余额列的纯展示模型。比例只来自上游读数，不用余额推测总额度。 */
export type BalancePool = { text: string; valueText?: string; percent: number | null }
export type BalanceDisplayRow = { key: 'balance' | 'cycle' | 'subscription'; text: string; percent: number | null }

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function balanceDisplayRows(entry: unknown, pool: BalancePool | null): BalanceDisplayRow[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
  const data = entry as Record<string, unknown>
  const percentage = data.unit === '%'
  const totalLeft = numeric(data.totalLeft)
  const available = numeric(data.available)
  const percent = pool?.percent ?? (percentage ? available : null)
  // 有套餐的绝对余量时只显示它；周期比例保留在原始摘要的悬停提示里。
  if (percentage && data.subscription && typeof data.subscription === 'object') {
    const subscription = data.subscription as Record<string, unknown>
    const remaining = numeric(subscription.remainQuota)
    const total = numeric(subscription.totalQuota)
    if (remaining !== null) return [{
      key: 'subscription',
      text: total !== null ? `${remaining} / ${total}` : String(remaining),
      percent: total !== null && total > 0 ? Math.max(0, Math.min(100, remaining / total * 100)) : null,
    }]
  }
  if (data.unlimited === true) return [{ key: 'balance', text: '∞', percent: null }]
  if (totalLeft !== null) return [{ key: 'balance', text: String(totalLeft), percent: null }]
  if (!percentage && available !== null) return [{ key: 'balance', text: String(available), percent: null }]
  // 数量和比例不混用：只有百分比时才画进度条，不为缺失总额的余额画占位条。
  const percentageOnly = percentage || Boolean(pool?.valueText?.endsWith('%'))
  const text = percentageOnly && percent !== null ? `${Math.round(percent)}%` : pool?.valueText || '—'
  return [{ key: percentageOnly ? 'cycle' : 'balance', text, percent }]
}
