import type { FileUIPart, UIMessage } from 'ai'
import { toWireMessages } from './assistant-chat'
import { DEFAULT_SYSTEM_PROMPT, type AssistantConfig } from './assistant-state'
import { toolsPayload } from './assistant-tools'

/** Local budget estimate, not billed usage. No tokenizer is universal across routes.
 * Count Latin text at ~4 chars/token and other scripts at ~1 char/token.
 * Count the actual wire JSON including roles/tool results; exclude image bytes. */
export function estimateContextTokens(text: string): number {
  let latin = 0, other = 0
  for (const char of text) {
    if (char.codePointAt(0)! <= 0xff) latin++
    else other++
  }
  return Math.ceil(latin / 4 + other)
}

export function assistantContextUsage(config: AssistantConfig | null, messages: UIMessage[], draft = '', files: FileUIPart[] = []) {
  let images = 0, incomplete = false
  const countMessages = (items: UIMessage[]) => items.reduce((sum, message) => {
    const parts = message.parts.filter(part => {
      if (part.type === 'file' && part.mediaType.startsWith('image/')) { images++; return false }
      return true
    })
    try { return sum + estimateContextTokens(JSON.stringify(toWireMessages([{ ...message, parts }]))) }
    catch { incomplete = true; return sum + estimateContextTokens(JSON.stringify(parts.filter(part => part.type === 'text'))) }
  }, 0)
  const tools = config ? toolsPayload(config.tools) : []
  const prompt = config?.systemPromptEnabled !== false && tools.length ? config?.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT : ''
  const system = prompt ? estimateContextTokens(JSON.stringify({ role: 'system', content: prompt })) : 0
  const definitions = tools.length ? estimateContextTokens(JSON.stringify(tools)) : 0
  const conversation = countMessages(messages)
  const pending = draft.trim() || files.length
    ? countMessages([{ id: 'context-draft', role: 'user', parts: [...(draft.trim() ? [{ type: 'text' as const, text: draft.trim() }] : []), ...files] }]) : 0
  return { system, definitions, conversation, pending, total: system + definitions + conversation + pending, images, incomplete }
}
