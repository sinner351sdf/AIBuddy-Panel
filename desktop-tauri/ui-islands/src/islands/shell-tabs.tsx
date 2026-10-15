/** 页签栏组件岛。经典脚本持有状态；真实页面 DOM 作为 TabsContent 的内容保留。 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ScrollArea,
  Separator,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@ui'
import { EllipsisIcon } from '@ui/navigation-icons'

interface ShellTab {
  readonly page: string
  readonly label: string
  readonly iconSvg: string
}
interface ShellTabsSnapshot {
  readonly home: string
  readonly current: string
  readonly pages: readonly string[]
  readonly contentMax: boolean
  readonly tags: readonly ShellTab[]
}
interface ShellTabsBridge {
  open(page: string): void
  close(page: string): void
  closeAll(): void
  closeOthers(page: string): void
  refresh(page: string): void
  toggleContentMax(): void
  getSnapshot(): ShellTabsSnapshot
  subscribe(listener: () => void): () => void
  setViewport(viewport: HTMLDivElement | null): void
  revealCurrent(): void
}

declare global {
  interface Window {
    wbShellTabs?: { mount(host: HTMLElement, bridge: ShellTabsBridge): void }
  }
}

/** 将现有页面交给真正的 Panel，保留原节点、表单值、React 岛与事件监听。
 * portal 保持 Tabs 上下文；display:contents 保留 .page 原本的 flex 布局。 */
function PagePanel({ page, value }: { page: HTMLElement; value: string }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    // 原位置可能位于 footer 前，不能把所有页面挪到内容区末尾。
    if (page.parentNode) page.parentNode.insertBefore(panel, page)
    panel.append(page)
    return () => {
      // 岛卸载时把原页面放回内容区，不随 Panel 一起删除。
      if (panel.parentNode) panel.parentNode.insertBefore(page, panel)
    }
  }, [page])
  return <TabsContent ref={panelRef} value={value} variant="shell" keepMounted />
}

function CloseIcon() {
  return <svg data-icon="inline-start" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
}

function ShellTabs({ bridge, pages, content }: {
  bridge: ShellTabsBridge
  pages: ReadonlyArray<{ value: string; element: HTMLElement }>
  content: HTMLElement
}) {
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  const skipMenuRestore = useRef(false)
  useLayoutEffect(() => {
    bridge.revealCurrent()
    if (!pendingFocus.current) return
    pendingFocus.current = false
    tabsListRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
  }, [bridge, snapshot])
  useLayoutEffect(() => {
    const viewport = tabsListRef.current?.closest('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    // 响应窗口/侧栏变化；当前页未变化时也要让选中页签重新进入可视区。
    const observer = new ResizeObserver(() => bridge.revealCurrent())
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [bridge])
  useLayoutEffect(() => () => bridge.setViewport(null), [bridge])

  function closeAndFocus(action: () => void, fromMenu = false) {
    // 关闭会改变当前页或移除按钮，等新快照及 Tab DOM 提交后再移焦。
    pendingFocus.current = true
    if (fromMenu) skipMenuRestore.current = true
    action()
  }

  function restoreMenuFocus() {
    // Menu 的退出动画可能晚于快照提交，避免它再把焦点还给已移除的触发器。
    if (!skipMenuRestore.current) return true
    skipMenuRestore.current = false
    return false
  }

  return (
    <Tabs value={snapshot.current} onValueChange={(value) => { if (typeof value === 'string') bridge.open(value) }} className="w-full min-w-0 flex-row items-center gap-2 data-horizontal:flex-row">
      <ScrollArea orientation="horizontal" viewportRef={bridge.setViewport} className="tags-scroll min-w-0 flex-1">
        <TabsList ref={tabsListRef} aria-label="已打开的页面" variant="workspace" className="w-max justify-start">
          {snapshot.tags.map((tab) => (
            <ContextMenu key={tab.page} onOpenChange={(open) => { if (open) skipMenuRestore.current = false }}>
              <ContextMenuTrigger className="tag relative inline-flex h-full flex-none items-center" data-page={tab.page} title={tab.page === snapshot.home ? `${tab.label}（固定不可关闭）` : tab.label}>
                <TabsTrigger value={tab.page} className={cn('h-full flex-none px-3', tab.page !== snapshot.home && 'pr-9')}>
                  {tab.iconSvg && <span className="tag-ico inline-flex shrink-0" aria-hidden="true" dangerouslySetInnerHTML={{ __html: tab.iconSvg }} />}
                  <span className="tag-label max-w-40 truncate">{tab.label}</span>
                </TabsTrigger>
                {tab.page !== snapshot.home && (
                  <Button className="tag-close absolute right-1 top-1/2 -translate-y-1/2" variant="ghost" size="icon-xs" title="关闭页签" aria-label={`关闭「${tab.label}」页签`} onClick={(event) => { event.stopPropagation(); closeAndFocus(() => bridge.close(tab.page)) }}>
                    <CloseIcon />
                  </Button>
                )}
              </ContextMenuTrigger>
              <ContextMenuContent finalFocus={restoreMenuFocus}>
                <ContextMenuGroup>
                  {tab.page === snapshot.current && <ContextMenuItem onClick={() => bridge.refresh(tab.page)}>刷新</ContextMenuItem>}
                  <ContextMenuItem onClick={bridge.toggleContentMax}>{snapshot.contentMax ? '退出内容全屏' : '当前页全屏'}</ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  {tab.page !== snapshot.home && <ContextMenuItem onClick={() => closeAndFocus(() => bridge.close(tab.page), true)}>关闭当前</ContextMenuItem>}
                  {tab.page !== snapshot.home && <ContextMenuItem onClick={() => closeAndFocus(() => bridge.closeOthers(tab.page), true)}>关闭其它</ContextMenuItem>}
                  <ContextMenuItem variant="destructive" onClick={() => closeAndFocus(bridge.closeAll, true)}>全部关闭</ContextMenuItem>
                </ContextMenuGroup>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </TabsList>
      </ScrollArea>
      <Separator orientation="vertical" className="h-5 shrink-0" />
      <DropdownMenu onOpenChange={(open) => { if (open) skipMenuRestore.current = false }}>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="shrink-0" title="页签操作" aria-label="页签操作" />}>
          <EllipsisIcon data-icon="inline-start" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40" finalFocus={restoreMenuFocus}>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => bridge.refresh(snapshot.current)}>刷新当前页</DropdownMenuItem>
            <DropdownMenuItem onClick={bridge.toggleContentMax}>{snapshot.contentMax ? '退出内容全屏' : '当前页全屏'}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {snapshot.current !== snapshot.home && <DropdownMenuItem onClick={() => closeAndFocus(() => bridge.close(snapshot.current), true)}>关闭当前</DropdownMenuItem>}
            {snapshot.current !== snapshot.home && <DropdownMenuItem onClick={() => closeAndFocus(() => bridge.closeOthers(snapshot.current), true)}>关闭其它</DropdownMenuItem>}
            <DropdownMenuItem variant="destructive" onClick={() => closeAndFocus(bridge.closeAll, true)}>全部关闭</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {pages.map(({ value, element }) => createPortal(<PagePanel value={value} page={element} />, content, value))}
    </Tabs>
  )
}

const mountedHosts = new WeakSet<HTMLElement>()
window.wbShellTabs = {
  mount(host, bridge) {
    if (mountedHosts.has(host)) return
    const content = document.querySelector<HTMLElement>('.content-inner')
    if (!content) return
    const pages = bridge.getSnapshot().pages.flatMap((value) => {
      const element = content.querySelector<HTMLElement>(`.page[data-page="${value}"]`)
      return element ? [{ value, element }] : []
    })
    mountedHosts.add(host)
    // 初始 Panel 完成接线后再接收经典 showPage 调用。
    flushSync(() => createRoot(host).render(<ShellTabs bridge={bridge} pages={pages} content={content} />))
  },
}
document.dispatchEvent(new Event('wb:shell-tabs-ready'))
