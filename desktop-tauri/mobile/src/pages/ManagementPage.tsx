import { useEffect, useRef, useState } from 'react'
import { Button, Alert, AlertTitle, AlertDescription, Skeleton } from '@ui'
import { store, useStore } from '../state/store'
import { loadFeatures, type MobileFeatureOptions } from '../lib/features'
import { t } from '../i18n'
export const MANAGEMENT_PAGES = ['accounts', 'gateway', 'keys', 'agent', 'proxies', 'checkin', 'settings', 'assistant', 'overview', 'requests', 'logs', 'tasks', 'docs', 'credits', 'plugins'] as const
export type ManagementPageId = typeof MANAGEMENT_PAGES[number]
export function openManagement(page: ManagementPageId, title: string, action = '', id = '') { store.push('management', { page, title, action, id }) }
export function ManagementButton({ page, children }: { page: ManagementPageId; children: React.ReactNode }) {
  return <Button variant='outline' className='min-h-11 w-full' onClick={() => openManagement(page, String(children))}>{children}</Button>
}
/** Explicit mobile mounts: shared business components render in this document. */
export function FeatureSurface({ page, action = '', id = '' }: { page: string; action?: string; id?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let disposed = false, unmount: (() => void) | undefined, observer: MutationObserver | undefined
    const timeout = window.setTimeout(() => { if (!disposed) setError(t('页面加载时间过长，请重试')) }, 15000)
    setReady(false); setError('')
    void loadFeatures().then(api => {
      if (disposed || !host.current) return
      const options: MobileFeatureOptions = { page, action, id, close: () => store.back(), navigate: (next, nextAction = '', nextId = '') => next === 'device-settings' ? store.push('device-settings') : openManagement(next as ManagementPageId, t(nextAction === 'add' ? '添加账号' : nextAction === 'edit' ? '账号设置' : '管理'), nextAction, nextId) }
      const target = host.current
      target.removeAttribute('data-page-ready')
      const committed = () => {
        if (disposed) return
        const state = target.getAttribute('data-page-ready')
        if (state === 'true' || (state === null && target.childElementCount > 0)) {
          setReady(true); window.clearTimeout(timeout); observer?.disconnect()
        }
      }
      observer = new MutationObserver(committed)
      observer.observe(target, {childList:true,attributes:true,attributeFilter:['data-page-ready']})
      unmount = api.mount(target, options)
      committed()
    }).catch(err => { window.clearTimeout(timeout); if (!disposed) setError(err instanceof Error ? err.message : String(err)) })
    return () => { disposed = true; window.clearTimeout(timeout); observer?.disconnect(); unmount?.(); void store.refresh(true) }
  }, [page, action, id, attempt])
  return <div className='m-feature-surface'>
    {error ? <Alert variant='destructive'><AlertTitle>{t('无法加载')}</AlertTitle><AlertDescription>{error}<Button variant='outline' onClick={() => setAttempt(value => value + 1)}>{t('重试')}</Button></AlertDescription></Alert> : !ready ? <div className='flex flex-col gap-4 p-4' role='status' aria-label={t('加载中…')}><Skeleton className='h-8 w-32'/><Skeleton className='h-48 w-full rounded-xl'/><Skeleton className='h-48 w-full rounded-xl'/></div> : null}
    <div ref={host} className='mobile-feature-host' data-page={page} hidden={!ready} aria-busy={!ready}/>
  </div>
}
export function ManagementPage() {
  const { route } = useStore(), params = route.params || {}
  const page = MANAGEMENT_PAGES.includes(params.page as ManagementPageId) ? params.page : route.screen === 'credits' ? 'credits' : route.screen === 'plugins' ? 'plugins' : 'accounts'
  return <FeatureSurface key={[page,params.action,params.id].join(':')} page={page} action={params.action} id={params.id}/>
}
