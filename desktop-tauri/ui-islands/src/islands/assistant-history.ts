/** Durable conversation state; only metadata for the last selection lives in the browser. */
import * as React from 'react'
import type { UIMessage } from 'ai'
import { callJson } from './assistant-state'
import { errorText } from './assistant-tools'
import type { useAssistantChat } from './assistant-chat'
export type Conversation = { id: string; title: string; revision: number; createdAt: number; updatedAt: number; messages?: UIMessage[] }
const PATH = '/api/assistant/conversations'
const ACTIVE = 'aibuddy.assistant.active-conversation'
const activeId = () => { try { return window.localStorage.getItem(ACTIVE) } catch { return null } }
const remember = (id: string | null) => { try { if (id) window.localStorage.setItem(ACTIVE, id); else window.localStorage.removeItem(ACTIVE) } catch { /* history itself stays in SQLite */ } }
export function useAssistantHistory(chat: ReturnType<typeof useAssistantChat>) {
  const [items, setItems] = React.useState<Conversation[]>([])
  const [current, setCurrent] = React.useState<Conversation | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [working, setWorking] = React.useState(false)
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const selected = React.useRef<Conversation | null>(null)
  const latest = React.useRef(chat.messages); latest.current = chat.messages
  const saved = React.useRef('[]')
  const chain = React.useRef<Promise<unknown>>(Promise.resolve())
  const alive = React.useRef(true)
  const selectionGeneration = React.useRef(0)
  const update = (row: Conversation) => {
    if (!alive.current) return
    setItems(rows => [row, ...rows.filter(item => item.id !== row.id)].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)))
    if (selected.current?.id === row.id) { selected.current = row; setCurrent(row) }
  }
  const adopt = (row: Conversation | null) => {
    selected.current = row; setCurrent(row); saved.current = JSON.stringify(row?.messages || [])
    latest.current = row?.messages || []; chat.restore(latest.current); remember(row?.id || null)
  }
  const flush = (): Promise<void> => {
    const id = selected.current?.id
    if (!id) return Promise.resolve()
    // Snapshot on invocation, execute serially; revisions come from the previous response.
    const messages = latest.current; const serialized = JSON.stringify(messages)
    const request = chain.current.catch(() => {}).then(async () => {
      if (selected.current?.id !== id || serialized === saved.current) return
      setSaving(true)
      try {
        const { conversation } = await callJson<{ conversation: Conversation }>('PUT', `${PATH}/${id}`, { revision: selected.current.revision, messages })
        if (selected.current?.id === id) { saved.current = serialized; update(conversation); setError('') }
      } catch (failure) { if (alive.current) setError(errorText(failure)); throw failure }
      finally { if (alive.current) setSaving(false) }
    })
    chain.current = request
    return request
  }
  const flushRef = React.useRef(flush); flushRef.current = flush
  React.useEffect(() => {
    alive.current = true
    const generation = ++selectionGeneration.current
    void (async () => {
      try {
        const data = await callJson<{ items: Conversation[] }>('GET', PATH)
        if (!alive.current || generation !== selectionGeneration.current) return
        setItems(data.items)
        const id = activeId()
        if (id && data.items.some(row => row.id === id)) {
          const { conversation } = await callJson<{ conversation: Conversation }>('GET', `${PATH}/${id}`)
          if (alive.current && generation === selectionGeneration.current) adopt(conversation)
        } else remember(null)
      } catch (failure) { if (alive.current) setError(errorText(failure)) }
      finally { if (alive.current) setLoading(false) }
    })()
    const timer = window.setInterval(() => { void flushRef.current().catch(() => {}) }, 1000)
    // Persist incrementally during a long stream, and when the tab is backgrounded.
    const hidden = () => { if (document.visibilityState === 'hidden') void flushRef.current().catch(() => {}) }
    document.addEventListener('visibilitychange', hidden)
    return () => { alive.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', hidden) }
  }, [])
  // Flush each settled response (including errors/stop/tool confirmation); no trailing debounce loss.
  React.useEffect(() => { if (!loading && (!chat.busy || chat.messages.at(-1)?.role === 'user')) void flush().catch(() => {}) }, [chat.messages, chat.busy, loading])
  const reload = async () => {
    try { const data = await callJson<{ items: Conversation[] }>('GET', PATH); setItems(data.items); setError('') }
    catch (failure) { setError(errorText(failure)) }
  }
  const action = async (fn: () => Promise<void>) => {
    if (working || loading || chat.busy || chat.awaiting) return false
    setWorking(true)
    try { await flush(); await fn(); setError(''); return true }
    catch (failure) { setError(errorText(failure)); return false }
    finally { setWorking(false) }
  }
  const select = (id: string) => action(async () => {
    const { conversation } = await callJson<{ conversation: Conversation }>('GET', `${PATH}/${id}`)
    adopt(conversation)
  })
  const newChat = () => action(async () => { adopt(null) })
  const ensure = async (text: string, filename?: string) => {
    if (selected.current) return
    const { conversation } = await callJson<{ conversation: Conversation }>('POST', PATH)
    const name = Array.from(text.trim().replace(/\s+/g, ' ') || filename || '新对话').slice(0, 60).join('')
    // Install immediately so failed title writes never create another empty chat on retry.
    selected.current = conversation; setCurrent(conversation); update(conversation); remember(conversation.id); saved.current = '[]'
    const { conversation: named } = await callJson<{ conversation: Conversation }>('PATCH', `${PATH}/${conversation.id}`, { title: name, revision: conversation.revision })
    update(named)
  }
  const rename = (id: string, title: string) => action(async () => {
    const { conversation: row } = await callJson<{ conversation: Conversation }>('GET', `${PATH}/${id}`)
    const { conversation } = await callJson<{ conversation: Conversation }>('PATCH', `${PATH}/${id}`, { title, revision: row.revision })
    update(conversation)
  })
  const remove = (id: string) => action(async () => {
    await callJson('DELETE', `${PATH}/${id}`)
    if (selected.current?.id === id) adopt(null)
    setItems(rows => rows.filter(row => row.id !== id))
  })
  const removeAll = (ids: string[]) => action(async () => {
    if (!ids.length) return
    await callJson('DELETE', PATH, { ids })
    if (selected.current && ids.includes(selected.current.id)) adopt(null)
    setItems(rows => rows.filter(row => !ids.includes(row.id)))
  })
  return { items, current, loading, working, saving, error, select, newChat, ensure, rename, remove, removeAll, flush, reload }
}
