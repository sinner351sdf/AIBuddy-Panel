/** AI SDK owns chat messages, stream parsing and automatic tool continuation.
 * This adapter only supplies local authentication and our application tool policy. */
import * as React from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage, type FileUIPart } from 'ai'
import { assistantHeaders, gatewayBase, loadAssistantConfig } from './assistant-state'
import { toolById, toolsPayload, errorText, type ToolPlan, type ToolResult } from './assistant-tools'
import { attachmentContent } from './assistant-files'

export type ToolView = {
  call: { id: string; name: string; arguments: string }
  state: 'running' | 'confirm' | 'done' | 'failed' | 'cancelled'
  plan?: ToolPlan
  summary?: string
  detail?: string
  error?: string
}

/** Keep step boundaries when AI SDK appends successive model/tool steps to one UI message. */
export function toWireMessages(messages: UIMessage[]): Record<string, unknown>[] {
  const wire: Record<string, unknown>[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') {
      const content = message.parts.flatMap(part => part.type === 'text' ? [{ type: 'text', text: part.text }] : part.type === 'file' ? [attachmentContent(part)] : [])
      wire.push({ role: message.role, content: message.parts.some(p => p.type === 'file') ? content : content.map(p => p.text).join('') })
      continue
    }
    let text = ''
    let calls: Record<string, unknown>[] = []
    let outputs: Record<string, unknown>[] = []
    const flush = () => {
      if (text || calls.length) wire.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) })
      wire.push(...outputs)
      text = ''; calls = []; outputs = []
    }
    for (const part of message.parts) {
      if (part.type === 'step-start') { flush(); continue }
      if (part.type === 'text') text += part.text
      if (isToolUIPart(part)) {
        // Incomplete input from an aborted stream is never sent back as an executable call.
        if (part.state === 'input-streaming') continue
        calls.push({ id: part.toolCallId, type: 'function', function: { name: getToolName(part), arguments: JSON.stringify(part.input ?? {}) } })
        const result = part.state === 'output-available' ? part.output : { error: part.state === 'output-error' ? part.errorText : 'Operation cancelled; not executed' }
        outputs.push({ role: 'tool', tool_call_id: part.toolCallId, content: typeof result === 'string' ? result : JSON.stringify(result) })
      }
    }
    flush()
  }
  return wire
}

/** Interrupted confirmations remain non-executable when a saved conversation is reopened. */
export function restoreMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(message => ({ ...message, parts: message.parts.map(part =>
    part.type === 'reasoning' ? { ...part, state: 'done' as const } : isToolUIPart(part) && !['output-available', 'output-error', 'output-denied'].includes(part.state)
      ? { type: 'dynamic-tool' as const, toolName: getToolName(part), toolCallId: part.toolCallId, input: part.input ?? {}, state: 'output-error' as const, errorText: '历史操作已中断，未执行；需要时请重新发起。' } : part) }))
}

type Run = { controller: AbortController; rounds: number }
export function useAssistantChat() {
  const run = React.useRef<Run>({ controller: new AbortController(), rounds: 0 })
  const [cards, setCards] = React.useState<Record<string, ToolView>>({})
  const cardsRef = React.useRef(cards)
  const [notice, setNotice] = React.useState('')
  const [runningTools, setRunningTools] = React.useState(0)
  const claimed = React.useRef(new Set<string>())
  const apiRef = React.useRef<ReturnType<typeof useChat> | null>(null)
  const writeCard = (id: string, view: ToolView) => {
    cardsRef.current = { ...cardsRef.current, [id]: view }
    setCards(cardsRef.current)
  }
  const valid = (current: Run) => current === run.current && !current.controller.signal.aborted
  const output = (current: Run, call: ToolView['call'], result?: ToolResult, error?: string) => {
    if (!valid(current)) return
    if (error) void apiRef.current?.addToolOutput({ tool: call.name, toolCallId: call.id, state: 'output-error', errorText: error })
    else void apiRef.current?.addToolOutput({ tool: call.name, toolCallId: call.id, output: result?.text || '' })
  }
  const execute = async (call: ToolView['call'], input: Record<string, unknown>, confirmed: boolean, current = run.current) => {
    if (!valid(current)) return
    const tool = toolById(call.name)
    const authorize = async () => {
      current.controller.signal.throwIfAborted()
      const latest = await loadAssistantConfig()
      current.controller.signal.throwIfAborted()
      if (!valid(current) || !tool || latest.tools[call.name] !== true) throw new Error('此工具已关闭，未执行')
    }
    try {
      await authorize()
      if (!valid(current) || !tool) return
      if (tool.kind !== 'read' && !confirmed) {
        writeCard(call.id, { call, state: 'confirm', plan: tool.plan?.(input) })
        return
      }
      writeCard(call.id, { call, state: 'running' })
      setRunningTools(n => n + 1)
      try {
        const result = await tool.run(input, { signal: current.controller.signal, beforeAction: authorize })
        if (!valid(current)) return
        writeCard(call.id, { call, state: 'done', summary: result.summary, detail: result.text })
        output(current, call, result)
      } finally {
        if (valid(current)) setRunningTools(n => Math.max(0, n - 1))
      }
    } catch (error) {
      if (!valid(current)) return
      writeCard(call.id, { call, state: 'failed', error: errorText(error) })
      output(current, call, undefined, errorText(error))
    }
  }

  const transport = React.useMemo(() => new DefaultChatTransport({
    api: '/api/assistant/chat',
    credentials: 'same-origin',
    prepareSendMessagesRequest: async ({ messages }) => {
      const current = run.current
      if (!valid(current)) throw new DOMException('Cancelled', 'AbortError')
      if (current.rounds >= 12) throw new Error('这一轮已达 12 次上限，请拆成几步后重试')
      const config = await loadAssistantConfig()
      const headers = await assistantHeaders()
      const base = await gatewayBase()
      current.controller.signal.throwIfAborted()
      if (!valid(current)) throw new DOMException('Cancelled', 'AbortError')
      current.rounds += 1
      const body = { messages: toWireMessages(messages), tools: toolsPayload(config.tools), uiStream: true }
      if (new TextEncoder().encode(JSON.stringify(body)).length > 24 * 1024 * 1024) throw new Error('对话与附件总量过大，请新建对话后重试')
      return { api: base + '/api/assistant/chat', headers, body }
    },
  }), [])
  const chat = useChat({
    transport,
    onToolCall: ({ toolCall }) => {
      const current = run.current
      if (!valid(current) || claimed.current.has(toolCall.toolCallId)) return
      claimed.current.add(toolCall.toolCallId)
      const input = toolCall.input as Record<string, unknown>
      const call = { id: toolCall.toolCallId, name: toolCall.toolName, arguments: JSON.stringify(input) }
      // Do not await addToolOutput inside the SDK's tool callback.
      void execute(call, input, false, current)
    },
    sendAutomaticallyWhen: ({ messages }) => valid(run.current) && lastAssistantMessageIsCompleteWithToolCalls({ messages }),
    onFinish: ({ isAbort, isError, isDisconnect }) => {
      if (isAbort || isError || isDisconnect) cancelTools()
    },
  })
  apiRef.current = chat
  function cancelTools() {
    run.current.controller.abort()
    setRunningTools(0)
    for (const [id, card] of Object.entries(cardsRef.current)) {
      if (card.state === 'running' || card.state === 'confirm') writeCard(id, { ...card, state: 'cancelled' })
    }
  }
  const stop = () => { cancelTools(); void chat.stop(); setNotice('已停止这次回答。') }
  React.useEffect(() => () => { run.current.controller.abort(); void apiRef.current?.stop() }, [])
  const send = async (text: string, files: FileUIPart[] = []) => {
    // Resolve old pending tools locally before allowing a fresh user turn.
    const cleaned = chat.messages.map(message => ({ ...message, parts: message.parts.map(part =>
      isToolUIPart(part) && !['output-available', 'output-error', 'output-denied'].includes(part.state)
        ? { type: 'dynamic-tool' as const, toolName: getToolName(part), toolCallId: part.toolCallId, input: part.input ?? {}, state: 'output-error' as const, errorText: 'Operation cancelled; not executed' } : part) }))
    chat.setMessages(cleaned)
    run.current.controller.abort()
    run.current = { controller: new AbortController(), rounds: 0 }
    claimed.current.clear()
    setNotice('')
    chat.clearError()
    await chat.sendMessage({ text, files })
  }
  const retry = async (messageId?: string) => {
    if (chat.status === 'submitted' || chat.status === 'streaming' || runningTools || Object.values(cardsRef.current).some(card => card.state === 'confirm')) return
    cancelTools()
    run.current = { controller: new AbortController(), rounds: 0 }
    claimed.current.clear(); cardsRef.current = {}; setCards({}); setNotice(''); chat.clearError()
    await chat.regenerate({ messageId })
  }
  const clear = () => { cancelTools(); void chat.stop(); chat.setMessages([]); chat.clearError(); claimed.current.clear(); cardsRef.current = {}; setCards({}); setNotice('') }
  const restore = (messages: UIMessage[]) => { clear(); chat.setMessages(restoreMessages(messages)) }
  const confirm = (id: string, approved: boolean) => {
    const card = cardsRef.current[id]
    if (!card || card.state !== 'confirm' || !valid(run.current)) return
    // Synchronously consume the card to prevent double click / duplicate confirmation.
    writeCard(id, { ...card, state: approved ? 'running' : 'cancelled' })
    if (approved) void execute(card.call, JSON.parse(card.call.arguments), true)
    else output(run.current, card.call, undefined, '用户取消了这次操作，没有做任何改动。')
  }
  const awaiting = Object.values(cards).some(c => c.state === 'confirm')
  const busy = chat.status === 'submitted' || chat.status === 'streaming' || runningTools > 0
  return { ...chat, cards, notice, busy, awaiting, send, retry, stop, clear, restore, confirm }
}
