import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Badge, BadgeDot,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ui'
import { cn } from '@ui/lib/cn'

type StatusItem = {
  text: string
  tone?: string
  dot?: boolean
  optional?: boolean
  description?: string
}

let snapshot: StatusItem[] = []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSnapshot = () => snapshot

function variantFor(tone?: string) {
  if (tone === 'ok') return 'success'
  if (tone === 'warn') return 'warning'
  if (tone === 'bad') return 'destructive'
  if (tone === 'brand') return 'brand'
  return 'outline'
}

function ShellStatus() {
  const items = React.useSyncExternalStore(subscribe, getSnapshot)
  return (
    <TooltipProvider>
      {items.map((item, index) => {
        const badge = (
          <Badge
            variant={variantFor(item.tone)}
            className={cn({ optional: item.optional })}
            data-tone={item.tone ?? ''}
          >
            {item.dot ? <BadgeDot /> : null}
            {item.text}
          </Badge>
        )
        return item.description ? (
          <Tooltip key={index}>
            <TooltipTrigger render={<span />} tabIndex={0} aria-label={item.text}>
              {badge}
            </TooltipTrigger>
            <TooltipContent side='bottom'>{item.description}</TooltipContent>
          </Tooltip>
        ) : <React.Fragment key={index}>{badge}</React.Fragment>
      })}
    </TooltipProvider>
  )
}

declare global {
  interface Window {
    wbTopbarStatus?: { render(items: StatusItem[]): void }
  }
}

// app.js continues to own the data and page-specific meaning; React owns the UI.
window.wbTopbarStatus = {
  render(items) {
    snapshot = items
    listeners.forEach(listener => listener())
  },
}

function mount() {
  const host = document.getElementById('topbar-status')
  if (host && !host.hidden) createRoot(host).render(<ShellStatus />)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
