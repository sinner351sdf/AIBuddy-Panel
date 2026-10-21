import type { ReactElement, ReactNode } from 'react'
/** 顶栏通知岛：业务与轮询仍由 notify-center.js 持有。 */
import { createRoot } from 'react-dom/client'
import {
  Badge,
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  ScrollArea,
  Separator,
  Spinner,
} from '@ui'

import { useNotificationsSnapshot, type NotificationItem, type NotificationsBridge } from './notifications-store'

declare global {
  interface Window {
    wbShellNotifications?: { mount(host: HTMLElement, bridge: NotificationsBridge): void }
  }
}

function BellIcon() {
  return <svg data-icon="inline-start" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
}

function RefreshIcon() {
  return <svg data-icon="inline-start" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5" /></svg>
}

function timeOf(ts: number): string {
  if (!ts) return '--:--:--'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')
}

function dateTimeOf(ts: number): string | undefined {
  const date = new Date(ts)
  return ts && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined
}

function NotificationRows({ items }: { items: readonly NotificationItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label="最近网关运行事件">
      {items.map((item, index) => (
        <li key={`${item.id}:${item.ts}:${index}`}>
          <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={item.level === 'error' ? 'destructive' : item.level === 'warn' ? 'warning' : item.level === 'info' ? 'info' : 'secondary'} shape="tag" className="max-w-[60%]">
                <span className="truncate">{item.category || '通用'}</span>
              </Badge>
              <time className="ml-auto shrink-0 font-mono text-xs text-muted-foreground" dateTime={dateTimeOf(item.ts)}>
                {timeOf(item.ts)}
              </time>
            </div>
            <p className="m-0 line-clamp-2 break-all text-xs leading-relaxed text-subtle" title={item.message || undefined}>
              {item.message || '（无内容）'}
            </p>
          </div>
          {index < items.length - 1 && <Separator />}
        </li>
      ))}
    </ul>
  )
}

export function ShellNotifications({ bridge, trigger }: { bridge: NotificationsBridge; trigger?: ReactElement<{children?:ReactNode}> }) {
  const snapshot = useNotificationsSnapshot()
  if (!snapshot) return null
  const label = snapshot.unread > 0 ? `通知中心（${snapshot.unread} 条未读告警）` : '通知中心'
  if (trigger) return <Sheet open={snapshot.open} onOpenChange={bridge.setOpen}>
    <SheetTrigger render={trigger}>{trigger.props.children}</SheetTrigger>
    <SheetContent side='bottom' className='mobile-notifications-sheet flex max-h-[85dvh] flex-col gap-0 p-0'>
      <SheetHeader className='border-b border-border p-4 pr-14'><SheetTitle>最近事件</SheetTitle><SheetDescription>当前网关最近的运行记录</SheetDescription></SheetHeader>
      <SheetBody className='min-h-0 overflow-y-auto p-0' style={{maxHeight:'55dvh'}}>
        {snapshot.items.length ? <NotificationRows items={snapshot.items}/> : <Empty variant='compact'><EmptyHeader><EmptyDescription>{snapshot.loading ? '正在读取最近事件…' : '暂无事件'}</EmptyDescription></EmptyHeader></Empty>}
      </SheetBody>
      <SheetFooter className='grid grid-cols-2 gap-2 border-t border-border p-4'>
        <Button variant='outline' disabled={snapshot.loading} onClick={bridge.refresh}>刷新事件</Button><Button onClick={bridge.viewAll}>查看全部</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
  return (
    <Popover open={snapshot.open} onOpenChange={bridge.setOpen}>
      <PopoverTrigger render={<Button id="nc-btn-bell" variant="ghost" size="icon-sm" className="relative max-md:size-11" aria-label={label} title={label} />}>
        <BellIcon />
        {snapshot.unread > 0 && <Badge variant="destructive" shape="tag" className="pointer-events-none absolute -right-1 -top-1" aria-hidden="true">{snapshot.unread > 99 ? '99+' : snapshot.unread}</Badge>}
      </PopoverTrigger>
      <PopoverContent id="nc-pop" align="end" sideOffset={8} className="w-[min(340px,calc(100vw-24px))]" aria-label="通知中心">
        <PopoverHeader>
          <PopoverTitle>最近事件</PopoverTitle>
          <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={bridge.refresh} disabled={snapshot.loading} title="刷新" aria-label="刷新事件">
            {snapshot.loading ? <Spinner data-icon="inline-start" /> : <RefreshIcon />}
          </Button>
        </PopoverHeader>
        <ScrollArea className="min-h-0 max-h-[50vh] shrink" style={{ height: Math.min(352, Math.max(100, snapshot.items.length * 76)) }} aria-busy={snapshot.loading}>
          {snapshot.items.length > 0 ? <NotificationRows items={snapshot.items} /> : (
            <Empty variant="compact" className="h-full">
              <EmptyHeader>
                <EmptyDescription>{snapshot.loading ? '正在读取最近事件…' : '暂无事件'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </ScrollArea>
        <Separator />
        <div className="p-1.5">
          <Button variant="ghost" size="sm" className="w-full" onClick={bridge.viewAll}>查看全部</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const mountedHosts = new WeakSet<HTMLElement>()
window.wbShellNotifications = {
  mount(host, bridge) {
    if (mountedHosts.has(host)) return
    mountedHosts.add(host)
    createRoot(host).render(<ShellNotifications bridge={bridge} />)
  },
}
document.dispatchEvent(new window.Event('wb:shell-notifications-ready'))
