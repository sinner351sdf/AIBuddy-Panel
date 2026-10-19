import { useEffect, useState } from 'react'
import { Button, Alert, AlertTitle, AlertDescription } from '@ui'
import { store, useStore } from '../state/store'
import { t } from '../i18n'

// Full editors run in a same-origin document so their existing API, validation,
// file pickers, previews and confirmations remain intact. The mobile shell owns
// navigation; the editor document never renders desktop navigation.
export const MANAGEMENT_PAGES = ['accounts', 'gateway', 'keys', 'agent', 'proxies', 'checkin', 'settings', 'assistant', 'overview', 'requests', 'logs', 'tasks', 'docs', 'credits'] as const
export type ManagementPageId = typeof MANAGEMENT_PAGES[number]
export function openManagement(page: ManagementPageId, title: string, action = '', id = '') {
  store.push('management', { page, title, action, id })
}
export function ManagementButton({ page, children }: { page: ManagementPageId; children: React.ReactNode }) {
  return <Button variant="outline" className="min-h-11 w-full" onClick={() => openManagement(page, String(children))}>{children}</Button>
}
export function ManagementPage() {
  const { route } = useStore()
  const params = route.params || {}
  const page = MANAGEMENT_PAGES.includes(params.page as ManagementPageId) ? params.page : route.screen === 'credits' ? 'credits' : 'accounts'
  const query = new URLSearchParams({ 'mobile-panel': page })
  if (['add', 'edit'].includes(params.action)) query.set('mobile-action', params.action)
  if (params.id) query.set('account', params.id)
  const src = '/?' + query
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => () => { void store.refresh(true) }, [])
  return <div className="m-management">
    {failed ? <Alert variant="destructive"><AlertTitle>{t('无法加载')}</AlertTitle><AlertDescription>{t('检查网关连接后重试')}<Button variant="outline" onClick={() => {setFailed(false);setAttempt(value => value + 1)}}>{t('重试')}</Button></AlertDescription></Alert> : null}
    <iframe key={src + attempt} title={params.title || t('管理')} src={src}
      className="m-management-frame" onError={() => setFailed(true)}
      allow="clipboard-write" />
  </div>
}
