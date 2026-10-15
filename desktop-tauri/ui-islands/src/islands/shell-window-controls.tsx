import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Button, cn, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ui'
import { t } from '../i18n'

type WindowBridge = {
  platform?: string
  windowMinimize?(): Promise<unknown>
  windowToggleMaximize?(): Promise<unknown>
  windowClose?(): Promise<unknown>
  windowIsMaximized?(): Promise<boolean>
  onWindowResize?(listener: () => void): void | (() => void) | Promise<() => void>
}
type ShellWindow = {
  workbuddyDesktop?: WindowBridge
  wbToast?: { show?(message: string): unknown }
  wbApp?: { toast?(message: string): void }
}
const shell = () => window as unknown as ShellWindow

function WindowIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg data-icon='inline-start' viewBox='0 0 24 24' fill='none' stroke='currentColor'
      strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
      {children}
    </svg>
  )
}

/** Window actions exist only on Windows/Linux; the macOS titlebar keeps native controls. */
function TitlebarControls({ bridge }: { bridge: WindowBridge }) {
  const [maximized, setMaximized] = React.useState(false)
  const syncMaximized = React.useCallback(async () => {
    if (!bridge.windowIsMaximized) return
    try { setMaximized(Boolean(await bridge.windowIsMaximized())) } catch { /* Keep the last known state. */ }
  }, [bridge])
  React.useEffect(() => {
    void syncMaximized()
    const subscription = bridge.onWindowResize?.(() => { void syncMaximized() })
    return () => {
      if (typeof subscription === 'function') subscription()
      else if (subscription) void subscription.then(unlisten => unlisten()).catch(() => {})
    }
  }, [bridge, syncMaximized])
  const maximizeLabel = maximized ? t('还原') : t('最大化')
  const actions = [
    {
      key: 'min', label: t('最小化'), icon: <path d='M5 12h14' />,
      invoke: () => { void bridge.windowMinimize?.().catch(() => {}) },
    },
    {
      key: 'max', label: maximizeLabel,
      icon: maximized
        ? <><path d='M8.5 6V4.5h11v11H18' /><rect x='4.5' y='8.5' width='11' height='11' rx='1.5' /></>
        : <rect x='5.5' y='5.5' width='13' height='13' rx='1.5' />,
      invoke: async () => {
        try { await bridge.windowToggleMaximize?.(); await syncMaximized() }
        catch (error) { console.warn('切换窗口大小失败:', error) }
      },
    },
    {
      key: 'close', label: t('关闭'), icon: <path d='m6 6 12 12M18 6 6 18' />,
      invoke: () => { void bridge.windowClose?.().catch(() => {}) },
    },
  ]
  return (
    <TooltipProvider>
      {actions.map(action => (
        <Tooltip key={action.key}>
          <TooltipTrigger render={
            <Button type='button' variant={action.key === 'close' ? 'remove' : 'ghost'} size='window'
              className={cn({ 'is-maximized': action.key === 'max' && maximized })}
              aria-label={action.label} onClick={action.invoke} />
          }>
            <WindowIcon>{action.icon}</WindowIcon>
          </TooltipTrigger>
          <TooltipContent side='bottom'>{action.label}</TooltipContent>
        </Tooltip>
      ))}
    </TooltipProvider>
  )
}

function FullscreenControl() {
  const [fullscreen, setFullscreen] = React.useState(Boolean(document.fullscreenElement))
  React.useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const label = fullscreen ? t('退出全屏') : t('全屏')
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      const message = t('当前环境不支持全屏')
      if (!shell().wbToast?.show?.(message)) shell().wbApp?.toast?.(message)
    }
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={
          <Button id='shell-btn-fullscreen' type='button' variant='ghost' size='icon'
            aria-label={label} aria-pressed={fullscreen} onClick={() => { void toggle() }} />
        }>
          <WindowIcon>
            {fullscreen
              ? <path d='M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' />
              : <path d='M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' />}
          </WindowIcon>
        </TooltipTrigger>
        <TooltipContent side='bottom'>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

declare global {
  interface Window {
    wbWindowControls?: { mountTitlebar(host: HTMLElement): void }
  }
}

const titlebarHosts = new WeakSet<HTMLElement>()
window.wbWindowControls = {
  mountTitlebar(host) {
    const bridge = shell().workbuddyDesktop
    if (!bridge?.platform || bridge.platform === 'web' || bridge.platform === 'macos') return
    if (!bridge.windowMinimize || !bridge.windowToggleMaximize || !bridge.windowClose || titlebarHosts.has(host)) return
    titlebarHosts.add(host)
    createRoot(host).render(<TitlebarControls bridge={bridge} />)
  },
}

function mount() {
  const host = document.getElementById('shell-window-controls')
  if (host) createRoot(host).render(<FullscreenControl />)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
