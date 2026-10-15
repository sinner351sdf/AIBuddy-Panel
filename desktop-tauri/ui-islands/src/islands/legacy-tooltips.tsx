/** 让已有 HTML/SVG data-tip 锚点使用组件定位与浮层，原节点不重建。 */
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Popover, PopoverContent, Tooltip, TooltipContent, TooltipProvider } from '@ui'

interface LegacyTooltipSnapshot {
  readonly anchor: Element | null
  readonly text: string
  readonly pinned: boolean
  readonly bubbleId: string
}
interface LegacyTooltipBridge {
  getSnapshot(): LegacyTooltipSnapshot
  subscribe(listener: () => void): () => void
  close(): void
}

declare global {
  interface Window {
    wbLegacyTooltips?: { mount(host: HTMLElement, bridge: LegacyTooltipBridge): void }
  }
}

function LegacyTooltips({ bridge }: { bridge: LegacyTooltipBridge }) {
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot)
  if (!snapshot.anchor) return null
  // 分支切换会卸载旧浮层，避免 hover → pin 时出现两个相同的描述 ID。
  if (snapshot.pinned) {
    return <Popover open modal={false} onOpenChange={(open, details) => {
      // 无 React Trigger 的外部锚点必须让原 click-pin 控制器处理二次点击。
      if (!open && details.reason === 'outside-press' && details.event.target instanceof Node && snapshot.anchor?.contains(details.event.target)) {
        details.cancel()
        return
      }
      if (!open) bridge.close()
    }}>
      <PopoverContent id={snapshot.bubbleId} role="tooltip" anchor={snapshot.anchor} side="bottom" align="center" sideOffset={8} collisionPadding={8} variant="tooltip" layer="tooltip" initialFocus={false} finalFocus={false} className="pointer-events-none max-w-[min(288px,calc(100vw-16px))]">
        {snapshot.text}
      </PopoverContent>
    </Popover>
  }
  return <TooltipProvider><Tooltip open disableHoverablePopup onOpenChange={(open) => { if (!open) bridge.close() }}>
    <TooltipContent id={snapshot.bubbleId} anchor={snapshot.anchor} side="bottom" align="center" sideOffset={8} collisionPadding={8} className="pointer-events-none max-w-[min(288px,calc(100vw-16px))]">
      {snapshot.text}
    </TooltipContent>
  </Tooltip></TooltipProvider>
}

const mountedHosts = new WeakSet<HTMLElement>()
window.wbLegacyTooltips = {
  mount(host, bridge) {
    if (mountedHosts.has(host)) return
    mountedHosts.add(host)
    createRoot(host).render(<LegacyTooltips bridge={bridge} />)
  },
}
document.dispatchEvent(new Event('wb:legacy-tooltips-ready'))
