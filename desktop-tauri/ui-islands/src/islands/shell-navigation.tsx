import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { Activity, Blocks, CalendarCheck, ChevronRight, FileText, Globe, KeyRound, LayoutGrid, List, Server, Settings, Users, Workflow, X, Sparkles } from '@ui/navigation-icons'
import { cn, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Separator, Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarProvider, SidebarRail, SidebarTrigger, ToggleGroup, ToggleGroupItem, TooltipProvider, useSidebar } from '@ui'
import { t } from '../i18n'

type BadgeState = { text: string; title: string; visible: boolean; running: boolean }
type GroupId = 'intelligence' | 'pool' | 'forward' | 'ops'
const groups = [
  { id: 'intelligence' as const, label: '智能', icon: Sparkles, pages: [{ id: 'assistant', label: 'AI 助手', icon: Sparkles }] },
  { id: 'pool' as const, label: '账号与用量', icon: LayoutGrid, pages: [
    { id: 'overview', label: '用量', icon: LayoutGrid }, { id: 'accounts', label: '账号池', icon: Users },
    { id: 'credits', label: '积分构成', icon: Blocks }, { id: 'checkin', label: '任务中心', icon: CalendarCheck },
  ] },
  { id: 'forward' as const, label: '模型与接入', icon: Workflow, pages: [
    { id: 'gateway', label: '模型与档位', icon: Workflow }, { id: 'proxies', label: '网络代理', icon: Globe },
    { id: 'keys', label: '网关 Key', icon: KeyRound }, { id: 'docs', label: '接入文档', icon: FileText }, { id: 'agent', label: 'Agent', icon: Workflow },
  ] },
  { id: 'ops' as const, label: '运维', icon: Server, pages: [
    { id: 'requests', label: '运行日志', icon: List }, { id: 'logs', label: '系统日志', icon: FileText },
    { id: 'tasks', label: '系统维护', icon: Activity }, { id: 'settings', label: '配置', icon: Settings },
  ] },
]
function stored(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function persist(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* storage unavailable */ } }
const listeners = new Set<() => void>()
let snapshot = {
  page: document.querySelector<HTMLElement>('.page.active')?.dataset.page || 'overview',
  open: stored('aibuddy-sidebar-collapsed') !== '1',
  groups: Object.fromEntries(groups.map(group => [group.id, stored('nav-group-' + group.id) !== 'closed'])) as Record<GroupId, boolean>,
  badges: {} as Record<string, BadgeState>,
}
function emit() { listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function setGroup(id: GroupId, open: boolean) {
  if (snapshot.groups[id] === open) return
  persist('nav-group-' + id, open ? 'open' : 'closed')
  snapshot = { ...snapshot, groups: { ...snapshot.groups, [id]: open } }; emit()
}
function patchBadge(id: string, patch: Partial<BadgeState>) {
  const current = snapshot.badges[id] || { text: '0', title: '', visible: false, running: false }
  if (Object.entries(patch).every(([key, value]) => current[key as keyof BadgeState] === value)) return
  snapshot = { ...snapshot, badges: { ...snapshot.badges, [id]: { ...current, ...patch } } }; emit()
}
const badgeHandles = new Map<string, object>()
function badgeHandle(id: string) {
  if (!badgeHandles.has(id)) badgeHandles.set(id, {
    get textContent() { return snapshot.badges[id]?.text || '' },
    set textContent(text: string) { patchBadge(id, { text: String(text) }) },
    get title() { return snapshot.badges[id]?.title || '' },
    set title(title: string) { patchBadge(id, { title }) },
    style: { get display() { return snapshot.badges[id]?.visible ? '' : 'none' }, set display(value: string) { patchBadge(id, { visible: value !== 'none' }) } },
    classList: { add(name: string) { if (name === 'is-running') patchBadge(id, { running: true }) }, remove(name: string) { if (name === 'is-running') patchBadge(id, { running: false }) } },
  })
  return badgeHandles.get(id)
}
let toggleSidebar = () => {}
let closeMobile = () => {}
function syncPage() {
  const page = document.querySelector<HTMLElement>('.page.active')?.dataset.page || snapshot.page
  const group = groups.find(group => group.pages.some(item => item.id === page))
  if (page !== snapshot.page) { snapshot = { ...snapshot, page }; emit() }
  if (group) setGroup(group.id, true)
  closeMobile()
}
;(window as unknown as { wbShell: object }).wbShell = { syncPage, toggleSidebar: () => toggleSidebar(), badgeHandle }

/** Keep separately mounted status/account roots alive when Sidebar changes between desktop and Sheet. */
function RetainedHost({ id, className }: { id: string; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const node = document.getElementById(id)
    const parking = document.getElementById('shell-sidebar-assets')
    if (!node || !ref.current) return
    ref.current.append(node)
    return () => { parking?.append(node) }
  }, [id])
  return <div className={className} ref={ref} />
}
function ThemeSwitch() {
  const [mode, setMode] = React.useState(stored('workbuddy-desktop-theme') || 'system')
  React.useEffect(() => {
    const sync = () => setMode(stored('workbuddy-desktop-theme') || 'system')
    window.addEventListener('wb:theme', sync)
    return () => window.removeEventListener('wb:theme', sync)
  }, [])
  return <ToggleGroup id='theme-switch' aria-label={t('主题')} value={[mode]} onValueChange={value => {
    if (!value[0]) return
    const app = (window as unknown as { wbApp?: { applyTheme?: (mode: string) => void } }).wbApp
    app?.applyTheme?.(value[0]); setMode(value[0])
  }} size='sm' variant='outline' spacing={0} className='w-full group-data-[collapsible=icon]:hidden'>
    {(['system', 'light', 'dark'] as const).map((value, i) => <ToggleGroupItem key={value} value={value} data-mode={value} className='min-w-0 flex-1 px-1 text-xs'>{t(['跟随系统', '浅色', '深色'][i])}</ToggleGroupItem>)}
  </ToggleGroup>
}
function Navigation() {
  const state = React.useSyncExternalStore(subscribe, () => snapshot)
  const sidebar = useSidebar()
  const rail = sidebar.state === 'collapsed' && !sidebar.isMobile
  const triggerHost = document.getElementById('shell-sidebar-trigger-host')
  React.useLayoutEffect(() => {
    toggleSidebar = sidebar.toggleSidebar
    closeMobile = () => sidebar.setOpenMobile(false)
    document.body.classList.toggle('shell-collapsed', !state.open)
    document.body.classList.toggle('pref-mobile-open', sidebar.isMobile && sidebar.openMobile)
    return () => { toggleSidebar = () => {}; closeMobile = () => {} }
  }, [sidebar.toggleSidebar, sidebar.setOpenMobile, sidebar.isMobile, sidebar.openMobile, state.open])
  React.useEffect(() => { sidebar.setOpenMobile(false) }, [sidebar.isMobile])
  const triggerLabel = t(sidebar.isMobile ? (sidebar.openMobile ? '关闭导航' : '打开导航') : (state.open ? '收起侧边栏' : '展开侧边栏'))
  return <>
    {triggerHost && createPortal(<><SidebarTrigger className='max-md:size-11' id='shell-sidebar-trigger' aria-controls='shell-sidebar' aria-expanded={sidebar.isMobile ? sidebar.openMobile : state.open} aria-label={triggerLabel} title={triggerLabel} aria-keyshortcuts='Control+b Meta+b' /><Separator orientation='vertical' className='h-4' /></>, triggerHost)}
    <Sidebar id='shell-sidebar' collapsible='icon'>
      <SidebarHeader className='relative gap-0'>
        <RetainedHost id='shell-brand' />
        {sidebar.isMobile && <Button id='shell-sidebar-close' variant='ghost' size='icon-sm' className='absolute right-2 top-2 size-11' aria-label={t('关闭导航')} onClick={() => sidebar.setOpenMobile(false)}><X /></Button>}
      </SidebarHeader>
      <SidebarContent className='group-data-[collapsible=icon]:overflow-y-auto'>
        <nav id='nav' aria-label={t('页面导航')}>
          <SidebarGroup className='py-0'><SidebarGroupLabel className='nav-section-label'>{t('工作区')}</SidebarGroupLabel>
            <SidebarMenu className='gap-2'>
              {groups.map(group => <SidebarMenuItem key={group.id} className='nav-group' data-group={group.id}>
                <Collapsible open={rail || state.groups[group.id]} onOpenChange={open => { if (!rail) setGroup(group.id, open) }}>
                  <CollapsibleTrigger id={'nav-group-toggle-' + group.id} aria-controls={'nav-group-' + group.id} render={<SidebarMenuButton className='nav-group-toggle group-data-[collapsible=icon]:hidden' data-group={group.id} />}>
                    <group.icon /><span className='nav-group-title flex-1'>{t(group.label)}</span><ChevronRight className={cn(state.groups[group.id] && 'rotate-90')} />
                  </CollapsibleTrigger>
                  <CollapsibleContent id={'nav-group-' + group.id} aria-labelledby={'nav-group-toggle-' + group.id}>
                    <SidebarMenuSub className='nav-group-content mt-1 gap-1 group-data-[collapsible=icon]:m-0 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:translate-x-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0'>
                      {group.pages.map(item => {
                        const badgeId = item.id === 'requests' ? 'nav-count-requests' : item.id === 'logs' ? 'nav-count-logs' : item.id === 'settings' ? 'nav-count-update' : ''
                        const badge = state.badges[badgeId]
                        return <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton className={cn('nav-item', state.page === item.id && 'active')} isActive={state.page === item.id} data-page={item.id} data-group={group.id} aria-label={t(item.label)} aria-current={state.page === item.id ? 'page' : undefined} tooltip={t(item.label)} onClick={() => (window as unknown as { wbApp?: { showPage?: (page: string) => void } }).wbApp?.showPage?.(item.id)}>
                            <item.icon /><span className='label group-data-[collapsible=icon]:hidden'>{t(item.label)}</span>
                          </SidebarMenuButton>
                          {badgeId && badge?.visible && <SidebarMenuBadge id={badgeId} title={badge.title} aria-label={badge.title} tone={badge.running ? 'success' : 'destructive'}>{badge.text}</SidebarMenuBadge>}
                        </SidebarMenuItem>
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <RetainedHost id='sidebar-status' className='min-w-0' />
        <ThemeSwitch />
        <RetainedHost id='sidebar-user' className='min-w-0' />
      </SidebarFooter>
      <SidebarRail id='shell-sidebar-rail' />
    </Sidebar>
  </>
}
function ShellNavigation() {
  const state = React.useSyncExternalStore(subscribe, () => snapshot)
  return <TooltipProvider><SidebarProvider className='contents' open={state.open} onOpenChange={open => {
    persist('aibuddy-sidebar-collapsed', open ? '0' : '1')
    snapshot = { ...snapshot, open }; emit()
  }}><Navigation /></SidebarProvider></TooltipProvider>
}
function mount() {
  const host = document.getElementById('shell-sidebar-root')
  if (host) { syncPage(); createRoot(host).render(<ShellNavigation />) }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
