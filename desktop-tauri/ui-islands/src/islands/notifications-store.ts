import { useSyncExternalStore } from 'react'

export interface NotificationItem {
  readonly id: number
  readonly ts: number
  readonly level: 'info' | 'warn' | 'error' | 'debug'
  readonly category: string
  readonly message: string
}

export interface NotificationsSnapshot {
  readonly open: boolean
  readonly loading: boolean
  readonly unread: number
  readonly items: readonly NotificationItem[]
}

/** 唯一状态源是 notify-center.js；此适配器不复制计数、不轮询、不另建请求。 */
export interface NotificationsBridge {
  refresh(): void
  open(): void
  close(): void
  markRead(): void
  setOpen(open: boolean): void
  viewAll(): void
  unread(): number
  getSnapshot(): NotificationsSnapshot
  subscribe(listener: () => void): () => void
}

export const NOTIFICATIONS_READY_EVENT = 'wb:notify-center-ready'

type NotificationsWindow = Window & { wbNotifyCenter?: NotificationsBridge }

export function notificationCenter(): NotificationsBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as NotificationsWindow).wbNotifyCenter
}

function getSnapshot(): NotificationsSnapshot | null {
  return notificationCenter()?.getSnapshot() ?? null
}

function subscribe(listener: () => void): () => void {
  let center: NotificationsBridge | undefined
  let unsubscribe: (() => void) | undefined
  const connect = () => {
    const next = notificationCenter()
    if (next === center) return
    unsubscribe?.()
    center = next
    unsubscribe = center?.subscribe(listener)
    listener()
  }
  // 设置岛在经典脚本之前挂载：ready 后补订阅，不能把首次缺失永久缓存成「—」。
  document.addEventListener(NOTIFICATIONS_READY_EVENT, connect)
  connect()
  return () => {
    document.removeEventListener(NOTIFICATIONS_READY_EVENT, connect)
    unsubscribe?.()
  }
}

export function useNotificationsSnapshot(): NotificationsSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
