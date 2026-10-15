import * as React from 'react'
import { Spinner } from '@ui'

type LoginButtonState = { text?: string; busy: boolean }
const idle: LoginButtonState = { busy: false }
const states = new Map<string, LoginButtonState>()
const listeners = new Map<string, Set<() => void>>()

/** The classic login engine publishes state; React retains ownership of button children. */
export function WebLoginButtonContent({ buttonId, children }: {
  buttonId: string
  children: React.ReactNode
}) {
  const subscribe = React.useCallback((listener: () => void) => {
    const entries = listeners.get(buttonId) ?? new Set<() => void>()
    entries.add(listener)
    listeners.set(buttonId, entries)
    return () => {
      entries.delete(listener)
      if (!entries.size) listeners.delete(buttonId)
    }
  }, [buttonId])
  const snapshot = React.useCallback(() => states.get(buttonId) ?? idle, [buttonId])
  const state = React.useSyncExternalStore(subscribe, snapshot)
  return (
    <>
      {state.busy ? <Spinner data-icon='inline-start' /> : null}
      {state.text ?? children}
    </>
  )
}

declare global {
  interface Window {
    wbWebLoginButton?: { render(buttonId: string, state: LoginButtonState): void }
  }
}

window.wbWebLoginButton = {
  render(buttonId, state) {
    const previous = states.get(buttonId)
    if (previous?.text === state.text && previous?.busy === state.busy) return
    states.set(buttonId, state)
    listeners.get(buttonId)?.forEach(listener => listener())
  },
}
