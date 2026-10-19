import { openManagement } from './ManagementPage'
import { Surface } from '../components/primitives'
import { accountLimitState, activeRateLimits, type BalanceSnapshot } from '../lib/accountLimits'
import { confirmAction } from '../components/confirm'
import { MobileButton } from '../components/primitives'
import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle } from '@ui'
import { Icon } from '../components/Icon'
import { ProviderLogo } from '../components/ProviderLogo'
import { Badge } from '../components/ui'
import { store, useStore } from '../state/store'
import { deleteAccount, refreshAccount, setAccountEnabled, type Account } from '../api/gateway'
import { accountName, formatExpiry, formatRelative, formatStamp } from '../lib/format'
import { expiryOf, hasExpiry } from '../lib/providerFacts'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'

/** Compact mobile view; complete editors open within the mobile navigation shell. */
export function AccountSheet({
  account,
  onClose,
  onChanged,
}: {
  account: Account | null
  onClose: () => void
  onChanged: () => void
}) {
  const {balancesSnapshot} = useStore()
  const [busy, setBusy] = useState('')
  const open = Boolean(account)

  const run = async (kind: string, task: () => Promise<unknown>, success: string) => {
    setBusy(kind)
    try {
      await task()
      store.toast(success)
      onChanged()
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'err')
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!account) return
    const name = accountName(account)
    // 删除不可恢复：手机上用两次确认（第一次进二次确认态）
    if (!(await confirmAction(t('确定删除账号「{name}」？这个操作不可恢复。', { name })))) return
    await run('delete', () => deleteAccount(account.id), t('已删除账号'))
    onClose()
  }

  const limits = activeRateLimits(account)
  const expiresAt = account ? expiryOf(account) : 0

  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent side='bottom' className='max-h-[85dvh]'>
        <SheetHeader>
          <SheetTitle>{t('账号详情')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {account ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ProviderLogo id={account.provider} size='lg' />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {accountName(account)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--m-text-3)', marginTop: 3 }}>
                    {providerLabel(account.provider, account.editionLabel)}
                    {account.priority !== undefined ? ` · #${account.priority}` : ''}
                  </div>
                </div>
                <Badge tone={statusTone(account, balancesSnapshot)} dot>
                  {statusText(account, balancesSnapshot)}
                </Badge>
              </div>

              <div className='m-kv'>
                {hasExpiry(account.provider) ? (
                  <Surface className='m-kv-cell'>
                    <div className='k'>{t('有效期')}</div>
                    <div className='v'>{formatExpiry(expiresAt)}</div>
                  </Surface>
                ) : null}
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('凭证')}</div>
                  <div className='v'>{account.hasCredentials === false ? t('缺失') : t('完整')}</div>
                </Surface>
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('限流模型')}</div>
                  <div className='v'>{limits.length}</div>
                </Surface>
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('最近更新')}</div>
                  <div className='v m-mono' style={{ fontSize: 12 }}>
                    {formatStamp(account.updatedAt as number)}
                  </div>
                </Surface>
              </div>

              <Surface className='m-rows'>
                <div className='m-row'>
                  <span className='m-k'>{t('账号 ID')}</span>
                  <span className='m-v m-mono' style={{ fontSize: 11 }}>
                    {account.id}
                  </span>
                </div>
                {account.email ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('邮箱')}</span>
                    <span className='m-v'>{account.email}</span>
                  </div>
                ) : null}
                <div className='m-row'>
                  <span className='m-k'>{t('启用')}</span>
                  <span className='m-v'>{account.enabled ? t('是') : t('否')}</span>
                </div>
                {account.needsRelogin ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('需要重新登录')}</span>
                    <span className='m-v' style={{ color: 'var(--m-danger)' }}>
                      {account.needsReloginReason || t('凭证已被上游注销')}
                    </span>
                  </div>
                ) : null}
              </Surface>

              {limits.length ? (
                <Surface className='m-rows'>
                  {limits.map(([model, info]) => (
                    <div key={model} className='m-row'>
                      <span className='m-k m-mono' style={{ fontSize: 11 }}>
                        {model}
                      </span>
                      <span className='m-v'>
                        {info?.resetAt ? t('{time} 恢复', { time: formatRelative(info.resetAt) }) : t('限流中')}
                      </span>
                    </div>
                  ))}
                </Surface>
              ) : null}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter className="flex-wrap">
          <MobileButton className="m-btn m-ghost" disabled={!account || Boolean(busy)} onClick={() => {
            if (!account) return
            const id = account.id
            onClose()
            openManagement('accounts', t('编辑账号'), 'edit', id)
          }}><Icon name="edit" />{t('编辑账号')}</MobileButton>
          <MobileButton
            type='button'
            className='m-btn'
            disabled={busy === 'refresh' || !account}
            onClick={() => account && void run('refresh', () => refreshAccount(account.id), t('凭证已刷新'))}
          >
            <Icon name='refresh' />
            {busy === 'refresh' ? t('刷新中…') : t('刷新凭证')}
          </MobileButton>
          <div className='m-btn-row'>
            <MobileButton
              type='button'
              className='m-btn m-ghost'
              style={{ flex: 1 }}
              disabled={busy === 'toggle' || !account}
              onClick={() =>
                account &&
                void run(
                  'toggle',
                  () => setAccountEnabled(account.id, !account.enabled),
                  account.enabled ? t('已禁用') : t('已启用'),
                )
              }
            >
              <Icon name={account?.enabled ? 'pause' : 'play'} />
              {account?.enabled ? t('禁用') : t('启用')}
            </MobileButton>
            <MobileButton
              type='button'
              className='m-btn m-danger'
              style={{ flex: 1 }}
              disabled={busy === 'delete' || !account}
              onClick={() => void remove()}
            >
              <Icon name='trash' />
              {busy === 'delete' ? t('删除中…') : t('删除')}
            </MobileButton>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function statusTone(account: Account, snapshot: BalanceSnapshot | null): 'ok' | 'warn' | 'bad' | 'mute' {
  if (account.enabled === false) return 'mute'
  if (account.needsRelogin) return 'bad'
  if (accountLimitState(account, snapshot).limited) return 'warn'
  const expiresAt = expiryOf(account)
  if (expiresAt > 0 && expiresAt <= Date.now()) return 'bad'
  return 'ok'
}

function statusText(account: Account, snapshot: BalanceSnapshot | null): string {
  if (account.enabled === false) return t('已禁用')
  if (account.needsRelogin) return t('需重登')
  if (accountLimitState(account, snapshot).limited) return accountLimitState(account, snapshot).balance ? t('余额不足') : accountLimitState(account, snapshot).token ? t('Token 限额') : t('限流中')
  const expiresAt = expiryOf(account)
  if (expiresAt > 0 && expiresAt <= Date.now()) return t('已过期')
  return t('正常')
}
