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
  const text = pool?.valueText
    ?? (data.unlimited === true ? '∞'
      : totalLeft !== null ? String(totalLeft)
      : available !== null ? `${available}${percentage ? '%' : ''}`
      : percent !== null ? `${Math.round(percent)}%` : '—')
  const rows: BalanceDisplayRow[] = [{ key: percentage ? 'cycle' : 'balance', text, percent }]
  // 套餐余量与周期窗口是独立口径。只在百分比 provider 的订阅里补这一行，
  // 不重复其他家的积分汇总，也不把未知总额补成 0。
  if (percentage && data.subscription && typeof data.subscription === 'object') {
    const subscription = data.subscription as Record<string, unknown>
    const remaining = numeric(subscription.remainQuota)
    const total = numeric(subscription.totalQuota)
    if (remaining !== null) rows.push({
      key: 'subscription',
      text: total !== null ? `${remaining} / ${total}` : String(remaining),
      percent: total !== null && total > 0 ? Math.max(0, Math.min(100, remaining / total * 100)) : null,
    })
  }
  return rows
}
