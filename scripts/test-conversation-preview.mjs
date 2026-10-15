import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source = fs.readFileSync(new URL('../desktop-tauri/ui/conversation-preview.js', import.meta.url), 'utf8')
const window = { wbI18n: { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) } }
vm.runInNewContext(source, { window, Map, JSON })
const { parse, render } = window.wbConversationPreview
const request = JSON.stringify({ system: 'Follow instructions', messages: [
  { role: 'user', content: [{ type: 'text', text: '<script>user</script>' }, { type: 'image_url', image_url: { url: 'https://example.test/a.png' } }, { type: 'image_url', image_url: { url: 'javascript:alert(1)' } }] },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'reason one' }, { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: 'value' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'result' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }] },
  { role: 'tool', tool_call_id: 'tool-2', content: 'raw tool result' },
] })
const history = parse(request, JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'answer', reasoning_content: 'final reason', tool_calls: [{ function: { name: 'done', arguments: '{"ok":true}' } }] } }] }))
assert.equal(history.messages.length, 6)
assert.equal(history.messages[1].text, '<script>user</script>')
assert.equal(history.messages[1].images.length, 1)
assert.equal(history.messages[2].thinking, 'reason one')
assert.equal(history.messages[3].results[0].text, 'result')
assert.equal(history.messages[3].results[0].images[0], 'data:image/png;base64,AAAA')
assert.equal(history.messages[4].toolCallId, 'tool-2')
assert.equal(history.messages[5].thinking, 'final reason')
assert.equal(JSON.parse(history.messages[5].calls[0].args).ok, true)
assert.equal(history.raw[0].source, request)
const sse = [
 { choices: [{ delta: { reasoning_content: 'thinking', tool_calls: [{ index: 0, function: { name: 'lookup', arguments: '{"q":' } }] } }] },
 { choices: [{ delta: { content: 'hello ', tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }] },
 { choices: [{ delta: { content: 'world' } }] },
].map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
const streamed = parse('', sse).messages[0]
assert.equal(streamed.text, 'hello world')
assert.equal(streamed.thinking, 'thinking')
assert.equal(JSON.parse(streamed.calls[0].args).q, 'x')
assert.equal(parse('', 'data: {"choices":[{"delta":{"reasoning_content":"only thought"}}]}\n\n').messages[0].thinking, 'only thought')
const anthropic = [
 { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'why ' } },
 { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'now' } },
 { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'a', name: 'weather', input: {} } },
 { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' } },
 { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Sunny' } },
].map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')
const a = parse('', anthropic).messages[0]
assert.equal(a.text, 'Sunny')
assert.equal(a.thinking, 'why now')
assert.equal(JSON.parse(a.calls[0].args).city, 'Paris')
assert.equal(parse('', JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: 'json thought' }] })).messages[0].thinking, 'json thought')
const bad = parse('raw not json', 'event: keepalive\ndata: not-json\n\n')
assert.equal(bad.notices.length, 2)
assert.equal(bad.raw[0].source, 'raw not json')
assert.equal(parse('', JSON.stringify({ error: { message: 'quota exhausted' } })).messages[0].errorText, 'quota exhausted')
assert.equal(parse('', '').messages.length, 0)
assert.equal(render('', ''), '')
assert.ok(render('<img src=x onerror=alert(1)>', '').includes('&lt;img'))
window.wbConversationPreviewUi = { render: data => `react:${data.raw.length}` }
assert.equal(render(request, ''), 'react:1')
console.log('conversation-preview: history, tools, images, OpenAI/Anthropic SSE/JSON, reasoning-only, raw fallback, escaping, legacy bridge passed')
