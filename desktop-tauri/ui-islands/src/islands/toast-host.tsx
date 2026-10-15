/**
 * 全局提示岛。业务仍调 wbApp.toast(message, kind)，app.js 负责在岛就绪后转发；
 * 没有 bundle / 没有挂载时继续走原 #toast。采用官方 Toaster 的全局 manager，
 * 通知宣读、F6 焦点入口、暂停计时和手势关闭都交给 Base UI。
 */
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Toaster, toast as toastManager } from '@ui'

const LEGACY_TOAST_ID = 'wb-app-toast'

declare global {
  interface Window {
    /** true 表示已交给 ToastProvider；未就绪时 app.js 使用原生 fallback。 */
    wbToast?: { show(message: string, kind?: string): boolean }
  }
}

function show(message: string, kind = 'ok'): boolean {
  const type = kind === 'err' ? 'error' : kind === 'warn' ? 'warning' : kind === 'ok' ? 'success' : kind
  // 固定 id 保留旧接口「下一条替换当前条」的行为；add 会重置 3500ms 计时。
  toastManager.add({
    id: LEGACY_TOAST_ID,
    title: String(message ?? ''),
    type,
    timeout: 3500,
    priority: kind === 'err' ? 'high' : 'low',
  })
  return true
}

function mount(): void {
  const fallback = document.getElementById('toast')
  // 登录页也加载同一 bundle，只有主面板具备旧提示节点。
  if (!fallback || window.wbToast) return
  const host = document.createElement('div')
  host.id = 'toast-host'
  document.body.append(host)
  // Provider 的订阅必须先完成，随后经典脚本发来的消息才不会丢失。
  flushSync(() => createRoot(host).render(<Toaster timeout={3500} limit={1} />))
  window.wbToast = { show }

  // 若岛挂载前已经显示了提示，接管同一文案，避免同时留下两份通知。
  if (fallback.style.display === 'block' && fallback.textContent) {
    show(fallback.textContent, fallback.className || 'ok')
    fallback.style.display = 'none'
  }
}

mount()
