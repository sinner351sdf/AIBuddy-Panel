// Both clients execute the desktop's pure domain functions; never maintain a second limiter policy.
import {
  balanceBlockedOf,
  tokenBlockedOf,
  isRateLimited,
  isLimitedNow,
  isEnabled,
} from '../../../ui-islands/src/islands/accounts-domain'
import type {
  AccountRecord,
  TokenReading,
} from '../../../ui-islands/src/islands/accounts-shared'
import type { Account } from '../api/gateway'

export type BalanceSnapshot = {
  at?: number
  results?: Array<{
    id?: string
    at?: number
    usage?: Record<string, unknown>
    error?: unknown
  }>
  tokenAt?: number
  tokenUsage?: Record<string, TokenReading[]>
}
export function accountLimitState(
  account: Account,
  snapshot: BalanceSnapshot | null | undefined,
) {
  const record = account as AccountRecord
  const row = snapshot?.results?.find((row) => row.id === account.id)
  const usage = row?.error ? undefined : row?.usage
  const readings = snapshot?.tokenUsage?.[account.id]
  const rate = isRateLimited(record)
  const balance = balanceBlockedOf(record, usage)
  const token = tokenBlockedOf(record, readings)
  return {
    rate,
    balance,
    token,
    limited: isEnabled(record) && isLimitedNow(record, usage, readings),
  }
}

export function activeRateLimits(account: Account | null) {
  return account?.rateLimits
    ? Object.entries(account.rateLimits).filter(
        ([, info]) => Number(info?.resetAt) > Date.now(),
      )
    : []
}
