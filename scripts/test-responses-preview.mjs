import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const window = { wbI18n: { t: (s, vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`) } }
vm.runInNewContext(fs.readFileSync(new URL('../desktop-tauri/ui/conversation-preview.js', import.meta.url), 'utf8'), { window, Map, JSON })
const parse = (request, response) => window.wbConversationPreview.parse(typeof request === 'string' ? request : JSON.stringify(request), typeof response === 'string' ? response : JSON.stringify(response))
const output = [
  { type: 'reasoning', summary: [{ type: 'summary_text', text: 'reason one' }, { type: 'summary_text', text: 'reason two' }], encrypted_content: 'must-not-display' },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
  { type: 'function_call', call_id: 'f-1', name: 'lookup', arguments: '{"q":"test"}' },
  { type: 'custom_tool_call', call_id: 'c-1', name: 'shell', input: 'echo hello' },
]
const simple = parse({ instructions: 'system', input: 'question' }, { output, output_text: 'answer' })
assert.equal(simple.notices.length, 0)
assert.deepEqual(Array.from(simple.messages, m => m.role), ['system', 'user', 'assistant'])
assert.equal(simple.messages[0].text, 'system')
assert.equal(simple.messages[1].text, 'question')
const answer = simple.messages[2]
assert.equal(answer.text, 'answer')
assert.equal(answer.thinking, 'reason one\nreason two')
assert.equal(answer.calls.length, 2)
assert.equal(JSON.parse(answer.calls[0].args).q, 'test')
assert.equal(answer.calls[0].id, 'f-1')
assert.equal(answer.calls[1].args, 'echo hello')
assert.ok(!JSON.stringify(simple.messages).includes('must-not-display'))
const history = parse({ instructions: 'history system', input: [
  { role: 'developer', content: 'developer rule' },
  { role: 'user', content: [{ type: 'input_text', text: '<script>question</script>' }, { type: 'input_image', image_url: 'https://example.test/image.png' }, { type: 'input_image', image_url: 'javascript:bad' }] },
  output[0], output[2],
  { type: 'function_call_output', call_id: 'f-1', output: [{ type: 'input_text', text: 'tool result' }] },
  output[3], { type: 'custom_tool_call_output', call_id: 'c-1', output: 'custom result' },
  { type: 'function_call_output', call_id: 'obj', output: { ok: true } },
  null, { type: 'item_reference', id: 'unknown' },
] }, { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }] }] })
assert.deepEqual(Array.from(history.messages, m => m.role), ['system', 'developer', 'user', 'assistant', 'assistant', 'tool', 'assistant', 'tool', 'tool', 'assistant'])
assert.equal(history.messages[2].images.length, 1)
assert.equal(history.messages[5].text, 'tool result')
assert.equal(history.messages[5].toolCallId, 'f-1')
assert.equal(history.messages[7].text, 'custom result')
assert.equal(JSON.parse(history.messages[8].text).ok, true)
assert.equal(history.messages[9].text, 'refused')
assert.equal(parse({ input: '' }, { output_text: 'text-only envelope' }).messages[0].text, 'text-only envelope')
assert.equal(parse({ input: 'x' }, { output: [output[2]] }).messages[1].calls[0].name, 'lookup')
assert.equal(parse({ input: 'x' }, { output: [output[0]] }).messages[1].thinking, 'reason one\nreason two')
const event = (type, fields) => ({ type, ...fields })
const frames = [
  event('response.output_item.added', { output_index: 0, item: { type: 'reasoning', id: 'r', summary: [] } }),
  event('response.reasoning_summary_text.delta', { output_index: 0, summary_index: 0, delta: 'reason ' }),
  event('response.reasoning_summary_text.delta', { output_index: 0, summary_index: 0, delta: 'one' }),
  event('response.reasoning_summary_text.done', { output_index: 0, summary_index: 0, text: 'reason one' }),
  event('response.output_item.added', { output_index: 1, item: { type: 'message', id: 'm', role: 'assistant', content: [] } }),
  event('response.output_text.delta', { output_index: 1, content_index: 0, delta: 'ans' }),
  event('response.output_text.delta', { output_index: 1, content_index: 0, delta: 'wer' }),
  event('response.output_text.done', { output_index: 1, content_index: 0, text: 'answer' }),
  event('response.output_item.added', { output_index: 2, item: { type: 'function_call', id: 'f', call_id: 'f-1', name: 'lookup', arguments: '' } }),
  event('response.function_call_arguments.delta', { item_id: 'f', delta: '{"q":' }),
  event('response.function_call_arguments.delta', { output_index: 2, delta: '"test"}' }),
  event('response.function_call_arguments.done', { output_index: 2, arguments: '{"q":"test"}' }),
  event('response.output_item.added', { output_index: 3, item: { type: 'custom_tool_call', name: 'shell', input: '', call_id: 'c-1' } }),
  event('response.custom_tool_call_input.delta', { output_index: 3, delta: 'echo ' }),
  event('response.custom_tool_call_input.done', { output_index: 3, input: 'echo hello' }),
]
const sse = frames => frames.map(frame => `event: ${frame.type}\r\ndata: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
for (const ending of [[], [event('response.completed', { response: { output } })], [event('response.output_item.done', { output_index: 1, item: output[1] })]]) {
  const streamed = parse('', sse([...frames, ...ending])).messages[0]
  assert.equal(streamed.text, 'answer', 'done/completed snapshots must not duplicate text')
  assert.equal(streamed.calls.length, 2)
  assert.equal(JSON.parse(streamed.calls[0].args).q, 'test')
  assert.equal(streamed.calls[1].args, 'echo hello')
  assert.equal(streamed.thinking, ending[0]?.type === 'response.completed' ? 'reason one\nreason two' : 'reason one')
}
const partial = parse('', sse([...frames, event('response.failed', { response: { error: { message: 'stream interrupted' } } })])).messages[0]
assert.equal(partial.text, 'answer'); assert.equal(partial.errorText, 'stream interrupted')
assert.equal(parse('', sse([event('error', { message: 'stream error' })])).messages[0].errorText, 'stream error')
assert.equal(parse('', sse([event('response.completed', { response: { output } })])).messages[0].calls.length, 2)
assert.equal(parse('', sse([event('response.content_part.done', { output_index: 0, content_index: 0, part: { type: 'output_text', text: 'snapshot' } })])).messages[0].text, 'snapshot')
assert.equal(parse('', sse([event('response.refusal.delta', { delta: 'not allowed' })])).messages[0].text, 'not allowed')
assert.equal(parse('', sse([event('response.output_text.delta', { content_index: '__proto__', delta: 'safe' })])).messages[0].text, 'safe')
const invalid = parse({ input: { broken: true } }, 'data: not json\n\n')
assert.equal(invalid.notices.length, 2); assert.equal(invalid.raw.length, 2)
const rawRequest = JSON.stringify({ input: 'raw stays exact' })
assert.equal(parse(rawRequest, '').raw[0].source, rawRequest)
assert.ok(window.wbConversationPreview.render(JSON.stringify({ input: '<img onerror=bad>' }), '').includes('&lt;img'))
console.log('PASS: Responses input/instructions, ordered history, images, reasoning, function/custom tools/results, JSON/refusal, SSE deltas/final snapshots/no duplication, interrupted streams and safe fallback')
