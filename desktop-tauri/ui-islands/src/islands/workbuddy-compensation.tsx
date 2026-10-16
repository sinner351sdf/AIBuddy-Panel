import * as React from 'react'
import { Alert, AlertDescription, Badge, Button, Spinner, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@ui'
import { t } from '../i18n'
import { accountGrowthClient as api, type AccountCompensation, type CompensationStatus } from './workbuddy-tasks-api'
import { errorMessage, shared } from './accounts-shared'

type Account = { id: string; name?: string; provider?: string; edition?: string }
type Row = { account: Account; data?: AccountCompensation; error?: string; notice?: string }

/** Task rows query on mount/refresh; claims always require an explicit click. */
export function WorkBuddyCompensation({ accounts, disabled = false, layout = 'panel', refreshKey = 0, onStatusChange }: {
  accounts: Account[]; disabled?: boolean; layout?: 'panel' | 'task-row'; refreshKey?: number
  onStatusChange?: (status: CompensationStatus | null) => void
}) {
  const [rows, setRows] = React.useState<Row[]>([])
  const [querying, setQuerying] = React.useState(false)
  const [claiming, setClaiming] = React.useState('')
  const alive = React.useRef(true)
  const inFlight = React.useRef(false)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const eligible = accounts.filter(account => account.provider === 'workbuddy' && account.edition !== 'intl')
  const blocked = disabled || querying || claiming !== ''
  const claimable = rows.filter(row => row.data?.status.claimable && !row.error)
  const update = (id: string, patch: Partial<Row>) => {
    if (alive.current) {
      setRows(old => old.map(row => row.account.id === id ? { ...row, ...patch } : row))
      if ('data' in patch) onStatusChange?.(patch.data?.status ?? null)
    }
  }
  // The task dialog shares its existing refresh action with this row.
  const queryRef = React.useRef<() => Promise<void>>(async () => {})
  queryRef.current = query
  React.useEffect(() => { if (layout === 'task-row' && !disabled) void queryRef.current() }, [layout, refreshKey, disabled])
  async function read(account: Account): Promise<AccountCompensation> {
    const data = await api.compensation(account.id)
    if (data.accountId !== account.id || typeof data.status?.active !== 'boolean' || typeof data.status.claimed !== 'boolean'
      || data.status.claimable !== (data.status.active && !data.status.claimed)) throw new Error(t('补偿状态响应异常'))
    return data
  }
  async function query() {
    if (inFlight.current || disabled || !eligible.length) return
    inFlight.current = true; setQuerying(true)
    setRows(eligible.map(account => ({ account })))
    // Bound concurrency for large account lists; one failure does not hide other accounts.
    let cursor = 0
    try {
      await Promise.all(Array.from({ length: Math.min(3, eligible.length) }, async () => {
        while (alive.current && cursor < eligible.length) {
          const account = eligible[cursor++]
          try { update(account.id, { data: await read(account), error: '' }) }
          catch (cause) { update(account.id, { error: errorMessage(cause) }) }
        }
      }))
    } finally {
      inFlight.current = false
      if (alive.current) setQuerying(false)
    }
  }
  async function claim(targets: Row[]) {
    if (inFlight.current || disabled || !targets.length) return
    inFlight.current = true
    try {
      for (const row of targets) {
        if (!alive.current) break
        const id = row.account.id
        setClaiming(id); update(id, { error: '', notice: '' })
        try {
          const result = await api.claimCompensation(id)
          if (!result.claimed && !result.already) throw new Error(result.message || t('补偿领取未确认成功'))
          // code=0 is authoritative even if a subsequent read is delayed or fails.
          update(id, { data: { ...row.data!, queriedAt: Date.now(), status: { ...row.data!.status, claimed: true, claimable: false } }, notice: result.message })
          void shared().wbApp?.refresh?.()
          try {
            const latest = await read(row.account)
            update(id, { data: { ...latest, status: { ...latest.status, claimed: true, claimable: false } } })
          } catch { update(id, { notice: t('领取已成功，最新状态暂时无法查询，请稍后刷新') }) }
        } catch (cause) {
          // Lost responses are reconciled by a read, never by repeating the write.
          try {
            const data = await read(row.account)
            update(id, { data, error: data.status.claimed ? '' : errorMessage(cause),
              notice: data.status.claimed ? t('补偿状态已更新为已领取') : '' })
            if (data.status.claimed) void shared().wbApp?.refresh?.()
          } catch { update(id, { data: undefined, error: errorMessage(cause) }) }
        }
      }
    } finally {
      inFlight.current = false
      if (alive.current) setClaiming('')
    }
  }
  if (layout === 'task-row') {
    const row = rows[0], status = row?.data?.status
    return <tr>
      <td><div className='growth-task-name'>{t('补偿积分')}</div>
        {status?.endTime ? <div className='growth-task-code'>{t('领取截止时间')}：{status.endTime}</div> : null}
        {row?.error ? <p role='alert' className='mt-1 text-xs text-destructive'>{row.error}</p> : null}
        {row?.notice ? <p role='status' className='mt-1 text-xs text-subtle'>{row.notice}</p> : null}
      </td>
      <td className='growth-task-number'>{status?.claimed ? '1 / 1' : status?.claimable ? '0 / 1' : '—'}</td>
      <td className='growth-task-number'>{status?.creditNum != null ? t('+{n} 积分', { n: status.creditNum }) : '—'}</td>
      <td><Badge variant={row?.error ? 'destructive' : status?.claimed ? 'success' : status?.claimable ? 'brand' : 'outline'}>
        {row?.error ? t('查询或领取失败') : status?.claimed ? t('已领取') : status?.claimable ? t('可领取') : status ? t('暂无补偿活动') : t('查询中…')}
      </Badge></td>
      <td>{row?.error ? <Button size='xs' variant='outline' disabled={blocked} onClick={() => void query()}>{t('重新查询')}</Button>
        : status?.claimable ? <Button size='xs' variant='outline' disabled={blocked} onClick={() => void claim([row!])}>
          {claiming ? <Spinner data-icon='inline-start' aria-hidden='true' /> : null}{claiming ? t('领取中…') : t('领取')}</Button>
        : <span className='muted'>—</span>}</td>
    </tr>
  }
  return <section aria-label={t('补偿积分')} aria-busy={querying || claiming !== ''} className='my-4 rounded-lg border border-border'>
    <div className='flex flex-wrap items-center justify-between gap-3 px-3 py-3'>
      <div className='flex min-w-0 flex-col gap-1'>
        <h3 className='text-sm font-semibold'>{t('补偿积分')}</h3>
        <p className='text-xs text-subtle'>{t('查询官方补偿活动、积分数量和领取状态；仅支持国内版账号。')}</p>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {claimable.length > 1 ? <Button size='sm' disabled={blocked} onClick={() => void claim(claimable)}>{t('一键领取 {n} 个账号', { n: claimable.length })}</Button> : null}
        <Button size='sm' variant='outline' disabled={blocked || !eligible.length} onClick={() => void query()}>
          {querying ? <Spinner data-icon='inline-start' aria-hidden='true' /> : null}{querying ? t('查询中…') : t('查询补偿状态')}
        </Button>
      </div>
    </div>
    {!rows.length ? <p className='px-3 pb-3 text-xs text-subtle'>{eligible.length ? t('点击查询补偿状态，查看所选账号是否有可领取积分。') : t('当前范围没有可查询的国内版账号。')}</p> :
      <div className='overflow-x-auto border-t border-border'><Table>
        <TableHeader><TableRow><TableHead>{t('账号')}</TableHead><TableHead>{t('积分')}</TableHead><TableHead>{t('领取截止时间')}</TableHead><TableHead>{t('状态')}</TableHead><TableHead className='text-right'>{t('操作')}</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(row => {
          const status = row.data?.status
          return <TableRow key={row.account.id}>
            <TableCell className='min-w-36 max-w-72 whitespace-normal break-words'>
              <span className='font-medium'>{row.account.name || row.account.id}</span>
              {row.error ? <Alert variant='destructive' className='mt-2'><AlertDescription>{row.error}</AlertDescription></Alert> : null}
              {row.notice ? <p role='status' className='mt-1 text-xs text-subtle'>{row.notice}</p> : null}
            </TableCell>
            <TableCell className='tabular-nums'>{status?.creditNum ?? '—'}</TableCell>
            <TableCell className='whitespace-nowrap text-xs'>{status?.endTime || '—'}</TableCell>
            <TableCell><Badge variant={row.error ? 'destructive' : status?.claimed ? 'success' : status?.claimable ? 'brand' : 'outline'}>
              {row.error ? t('查询或领取失败') : status?.claimed ? t('已领取') : status?.claimable ? t('可领取') : status ? t('暂无补偿活动') : t('查询中…')}
            </Badge></TableCell>
            <TableCell className='text-right'><Button size='xs' variant='outline' disabled={blocked || !status?.claimable || !!row.error}
              onClick={() => void claim([row])}>{claiming === row.account.id ? <Spinner data-icon='inline-start' aria-hidden='true' /> : null}{claiming === row.account.id ? t('领取中…') : t('一键领取')}</Button></TableCell>
          </TableRow>
        })}</TableBody>
      </Table></div>}
  </section>
}
