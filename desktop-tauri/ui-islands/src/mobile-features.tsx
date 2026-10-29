import './islands/port-panel'
/** Mobile feature surfaces share the validated business components, never an HTML panel/frame. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Checkbox, Input, Alert, AlertDescription, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, Field, FieldLabel } from '@ui'
import { AddAccountModal } from './islands/add-account-modal'
import { AccountSettingsDialog, AccountsDialogs } from './islands/accounts-dialogs'
import { AssistantPage } from './islands/assistant-page'
import { SettingsPage } from './islands/settings-page'
import { KeysPage } from './islands/keys-page'
import { ModelsPage } from './islands/models-page'
import { ProxiesPage } from './islands/proxies-page'
import { CheckinPage } from './islands/checkin-page'
import { ReportPage } from './islands/report-page'
import { RequestsPage } from './islands/requests-page'
import { LogsPanel } from './islands/logs-panel'
import { TasksPanel } from './islands/tasks-panel'
import { DocsPage } from './islands/docs-page'
import { CreditsPage } from './islands/credits-page'
import { HiddenAccountsNotice } from './islands/accounts-hidden-notice'
import { PluginsPage } from './islands/plugins-page'
import { AgentPage } from './islands/agent-page'
import { allAccounts, hiddenAccounts, subscribe, getStore, openBatchDialog, closeDialog, reorderQueue, clearLimits, setAccountEnabled } from './islands/accounts-data'
import { ActionsCell, UsageCell } from './islands/accounts-panels'
import { displayNameOf } from './islands/accounts-domain'
import { t } from './i18n'
import { esc } from './islands/accounts-shared'


// Login callback / compatibility-key prompts use phone controls as well.
function MobileBridgePrompt({title, description, placeholder, secret, confirm, finish}: {title:string; description:string; placeholder?:string; secret:boolean; confirm:string; finish:(value:string|boolean)=>void}) {
  const [value, setValue] = React.useState('')
  return <Dialog open onOpenChange={open => { if (!open) finish(false) }}><DialogContent className='mobile-bridge-prompt'>
    <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    <DialogBody><p className='whitespace-pre-wrap text-sm text-muted-foreground'>{description}</p>{placeholder !== undefined ? <Field><FieldLabel htmlFor='mobile-bridge-value'>{title}</FieldLabel><Input id='mobile-bridge-value' type={secret ? 'password' : 'text'} autoComplete='off' placeholder={placeholder} value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if(event.key==='Enter')finish(value) }}/></Field> : null}</DialogBody>
    <DialogFooter><Button variant='outline' onClick={() => finish(false)}>{t('取消')}</Button><Button onClick={() => finish(placeholder === undefined ? true : value)}>{confirm}</Button></DialogFooter>
  </DialogContent></Dialog>
}
if (document.documentElement.dataset.mobileUi === 'true') {
  let promptRoot: ReturnType<typeof createRoot> | undefined, dismiss: (() => void) | undefined
  window.wbMobilePrompt = (title, html, confirm) => new Promise(resolve => {
    dismiss?.()
    const template = document.createElement('template'); template.innerHTML = html
    const field = template.content.querySelector('input'), placeholder = field ? field.getAttribute('placeholder') || '' : undefined
    field?.remove()
    const description = [...template.content.childNodes].map(node => node.textContent || '').join('\n')
    if (!promptRoot) { const host = document.createElement('div'); document.body.append(host); promptRoot = createRoot(host) }
    const finish = (value: string | boolean) => {
      if (dismiss !== cancel) return
      dismiss = undefined; promptRoot?.render(null)
      if (value === false) { const api = window as unknown as {workbuddyDesktop?: {cancelLogin?: () => Promise<unknown>}}; void api.workbuddyDesktop?.cancelLogin?.() }
      resolve(value)
    }
    const cancel = () => finish(false); dismiss = cancel
    promptRoot.render(<MobileBridgePrompt key={Date.now()} title={title} description={description} placeholder={placeholder} secret={field?.getAttribute('type') === 'password'} confirm={confirm} finish={finish}/>)
  })
}

function MobileAccountManager({ edit, add }: { edit: (id: string) => void; add: () => void }) {
  React.useSyncExternalStore(subscribe, getStore)
  React.useEffect(() => () => closeDialog(), [])
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>([])
  const [pending, setPending] = React.useState(false)
  const all = allAccounts()
  const hidden = hiddenAccounts()
  const visible = all.filter(a => `${displayNameOf(a)} ${a.provider}`.toLowerCase().includes(query.toLowerCase()))
  const move = async (id: string, delta: number) => {
    const ids = all.map(a => a.id), at = ids.indexOf(id), to = at + delta
    if (to < 0 || to >= ids.length || pending) return
    ;[ids[at], ids[to]] = [ids[to], ids[at]]
    setPending(true)
    try { await reorderQueue(ids) } finally { setPending(false) }
  }
  return <div className='mobile-account-manager'>
    {hidden.total > 0 ? <HiddenAccountsNotice hidden={hidden} compact /> : null}
    <Button onClick={add}>{t('添加账号')}</Button>
    <Input aria-label={t('搜索账号')} placeholder={t('搜索账号')} value={query} onChange={e => setQuery(e.target.value)} />
    <div className='mobile-actions'><Button variant='outline' onClick={() => setSelected(visible.map(a => a.id))}>{t('全选')}</Button><Button variant='ghost' onClick={() => setSelected([])}>{t('取消选择')}</Button><Button disabled={!selected.length} onClick={() => openBatchDialog(selected)}>{t('批量操作')} ({selected.length})</Button></div>
    {visible.map(a => <article className='mobile-account-card' key={a.id}>
      <div className='mobile-card-title'><Checkbox checked={selected.includes(a.id)} aria-label={t('选择账号') + ' ' + displayNameOf(a)} onCheckedChange={on => setSelected(list => on ? [...list, a.id] : list.filter(id => id !== a.id))}/><strong>{displayNameOf(a)}</strong><span>{a.provider}</span></div>
      <div className='mobile-actions'><Button variant='outline' onClick={() => edit(a.id)}>{t('账号详情')}</Button><Button variant='outline' onClick={() => void setAccountEnabled(a.id, a.enabled === false)}>{a.enabled === false ? t('启用') : t('停用')}</Button><Button variant='outline' onClick={() => void clearLimits(a.id)}>{t('清除限流')}</Button></div>
      <div className='mobile-account-usage'><UsageCell account={a}/></div><ActionsCell account={a} atFront={all[0]?.id === a.id}/>
      <div className='mobile-actions'><Button variant='ghost' disabled={pending || all[0]?.id === a.id} onClick={() => void move(a.id, -1)}>{t('上移')}</Button><Button variant='ghost' disabled={pending || all.at(-1)?.id === a.id} onClick={() => void move(a.id, 1)}>{t('下移')}</Button><span>#{all.findIndex(item => item.id === a.id) + 1}</span></div>
    </article>)}
    <AccountsDialogs />
  </div>
}

let mobileAccountActionPending = false
function installMobileAccountActions() {
  const api = window as unknown as {
    wbApp?: { runAccountAction?: (action: string, id: string) => void; refresh?: () => Promise<unknown>; toast?: (text: string, tone?: string) => void },
    workbuddyDesktop?: { switchAccount(id: string): Promise<unknown>; refreshAccountToken(id: string): Promise<unknown>; removeAccount(id: string): Promise<unknown> },
    wbConfirm?: { ask(options: { title: string; html: string; okText: string; okClass: string }): Promise<boolean> }
  }
  if (!api.wbApp) return
  api.wbApp.runAccountAction = (action, id) => { void (async () => {
    if (mobileAccountActionPending) return
    mobileAccountActionPending = true
    try {
      if (!api.workbuddyDesktop) throw new Error(t('后端桥不可用'))
      if (action === 'switch') await api.workbuddyDesktop?.switchAccount(id)
      else if (action === 'refresh') await api.workbuddyDesktop?.refreshAccountToken(id)
      else if (action === 'remove') {
        if (!await api.wbConfirm?.ask({title:t('删除账号'),html:t('确定删除账号「{name}」？此操作不可恢复。', {name:esc(displayNameOf(allAccounts().find(account => account.id === id)) || id)}),okText:t('删除'),okClass:'danger'})) return
        await api.workbuddyDesktop?.removeAccount(id)
      } else return
      await api.wbApp?.refresh?.()
      api.wbApp?.toast?.(t('操作成功'))
    } catch (error) { api.wbApp?.toast?.(error instanceof Error ? error.message : String(error),'err') }
    finally { mobileAccountActionPending = false }
  })() }
}

const pages: Record<string, React.ComponentType> = {plugins: PluginsPage, gateway: ModelsPage, keys: KeysPage, agent: AgentPage, proxies: ProxiesPage, checkin: CheckinPage, overview: ReportPage, requests: RequestsPage, logs: LogsPanel, tasks: TasksPanel, docs: DocsPage, credits: CreditsPage}
class FeatureError extends React.Component<{ children: React.ReactNode }, {error: string}> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <Alert variant='destructive' data-feature-error='true'><AlertDescription>{this.state.error}</AlertDescription></Alert> : this.props.children }
}
function FeatureContent({ children, page }: { children: React.ReactNode; page: string }) {
  React.useEffect(() => {
    if (page === 'agent') void import('./islands/agent-state').then(module => module.loadPanel())
    if (page === 'docs') window.wbPortPanel?.render?.()
    if (page === 'proxies') void window.wbProxiesPanel?.load?.()
  }, [page])
  return <>{children}</>
}
type FeatureOptions = { page: string; action?: string; id?: string; close: () => void; navigate: (page: string, action?: string, id?: string) => void }
window.wbMobileFeatures = {
  mount(host: HTMLElement, options: FeatureOptions) {
    installMobileAccountActions()
    const root = createRoot(host), { page, action, id, close, navigate } = options
    const Page = pages[page]
    root.render(<FeatureError><FeatureContent page={page}>{page === 'accounts'
      ? action === 'add' ? <AddAccountModal mobile presentation='page' onClose={close} onReady={() => {}} />
        : action === 'edit' && id ? <AccountSettingsDialog mobile id={id} onClose={close}/>
        : <MobileAccountManager add={() => navigate('accounts','add')} edit={id => navigate('accounts','edit',id)}/>
      : page === 'assistant' ? <AssistantPage mobile/>
      : page === 'settings' ? <SettingsPage mobile initialCategory={action} onDevicePreferences={() => navigate('device-settings')}/>
      : Page ? <Page/> : <Alert><AlertDescription>{t('无法加载')}</AlertDescription></Alert>}
    </FeatureContent></FeatureError>)
    return () => root.unmount()
  },
}
declare global { interface Window { wbMobilePrompt?: (title: string, html: string, confirm: string) => Promise<string | boolean>; wbMobileFeatures?: { mount(host: HTMLElement, options: FeatureOptions): () => void } } }
