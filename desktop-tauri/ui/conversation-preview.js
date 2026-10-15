/* Agent2API · 请求 / 响应原文的纯解析桥，界面由 React Message/Bubble/Trace 组合。 */
/* global wbI18n */
(() => {
  const t = (text, vars) => window.wbI18n?.t?.(text, vars) || text;
  const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
  const newParts = () => ({ text: '', images: [], calls: [], results: [], thinking: '' });
  const append = (left, right) => left && right ? `${left}\n${right}` : left || right || '';
  const safeImgSrc = url => /^(data:image\/|https?:\/\/)/i.test(String(url ?? '').trim()) ? String(url).trim() : '';
  function prettyJson(value) {
    if (typeof value !== 'string') return JSON.stringify(value ?? {}, null, 2);
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  function collectContent(content, out = newParts()) {
    if (typeof content === 'string') { out.text = append(out.text, content); return out; }
    if (!Array.isArray(content)) return out;
    for (const part of content) {
      if (typeof part === 'string') { out.text = append(out.text, part); continue; }
      if (!isPlainObject(part)) continue;
      if (['text', 'input_text', 'output_text'].includes(part.type) && typeof part.text === 'string') out.text = append(out.text, part.text);
      else if (part.type === 'image_url' || part.type === 'input_image') {
        const src = safeImgSrc(part.image_url?.url ?? part.image_url ?? part.url);
        if (src) out.images.push(src);
      } else if (part.type === 'image') {
        const source = part.source;
        const src = source?.type === 'base64' && /^image\//.test(String(source.media_type || '')) && source.data
          ? safeImgSrc(`data:${source.media_type};base64,${source.data}`) : safeImgSrc(source?.url);
        if (src) out.images.push(src);
      } else if (part.type === 'tool_use') {
        out.calls.push({ name: String(part.name || 'tool'), args: prettyJson(part.input), id: String(part.id || '') });
      } else if (part.type === 'tool_result') {
        const result = collectContent(part.content);
        out.results.push({ label: part.tool_use_id ? t('工具结果 · {id}', { id: String(part.tool_use_id) }) : t('工具结果'), ...result });
      } else if (part.type === 'thinking' && typeof part.thinking === 'string') out.thinking = append(out.thinking, part.thinking);
    }
    return out;
  }
  const hasParts = p => !!(p.text || p.thinking || p.images.length || p.calls.length || p.results.length);
  function parseMessage(message) {
    if (!isPlainObject(message)) return null;
    const parts = collectContent(message.content);
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const fn = isPlainObject(call?.function) ? call.function : {};
      parts.calls.push({ name: String(fn.name || call?.name || call?.type || 'tool'), args: prettyJson(fn.arguments ?? call?.arguments ?? ''), id: String(call?.id || '') });
    }
    parts.thinking = append(parts.thinking, typeof message.reasoning_content === 'string' ? message.reasoning_content : typeof message.reasoning === 'string' ? message.reasoning : '');
    if (!hasParts(parts)) return null;
    const role = String(message.role || 'user');
    return { role: ['system', 'developer', 'assistant', 'tool'].includes(role) ? role : 'user', ...parts, toolCallId: String(message.tool_call_id || '') };
  }
  function parseRequest(source) {
    let body;
    try { body = JSON.parse(source); } catch { return null; }
    if (!isPlainObject(body) || !Array.isArray(body.messages)) return null;
    const messages = [];
    if (body.system) { const system = parseMessage({ role: 'system', content: body.system }); if (system) messages.push(system); }
    for (const message of body.messages) { const parsed = parseMessage(message); if (parsed) messages.push(parsed); }
    return messages.length ? messages : null;
  }
  function sseFrames(raw) {
    return raw.split(/\r?\n\r?\n+/).map(block => block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')).filter(Boolean);
  }
  function parseSseResponse(source) {
    const parts = newParts(); const calls = new Map(); let errorText = '';
    for (const frame of sseFrames(source)) {
      if (frame.trim() === '[DONE]') continue;
      let parsed; try { parsed = JSON.parse(frame); } catch { continue; }
      if (!isPlainObject(parsed)) continue;
      const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
      const delta = isPlainObject(choice?.delta) ? choice.delta : null;
      if (delta) {
        if (typeof delta.content === 'string') parts.text += delta.content;
        if (typeof delta.reasoning_content === 'string') parts.thinking += delta.reasoning_content;
        if (typeof delta.reasoning === 'string') parts.thinking += delta.reasoning;
        for (const piece of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
          if (!isPlainObject(piece)) continue;
          const index = Number.isFinite(piece.index) ? piece.index : calls.size;
          const call = calls.get(index) || { name: '', args: '', id: '' };
          if (piece.id) call.id = String(piece.id);
          if (typeof piece.function?.name === 'string') call.name += piece.function.name;
          if (typeof piece.function?.arguments === 'string') call.args += piece.function.arguments;
          calls.set(index, call);
        }
      }
      // Anthropic messages SSE uses event lines plus the same data frame format.
      if (parsed.type === 'message_start' && isPlainObject(parsed.message)) collectContent(parsed.message.content, parts);
      if (parsed.type === 'content_block_start' && isPlainObject(parsed.content_block)) {
        const block = parsed.content_block;
        if (block.type === 'tool_use') calls.set(`anthropic:${parsed.index}`, { name: String(block.name || 'tool'), args: '', id: String(block.id || ''), input: block.input });
        else collectContent([block], parts);
      }
      if (parsed.type === 'content_block_delta') {
        if (typeof parsed.delta?.text === 'string') parts.text += parsed.delta.text;
        if (typeof parsed.delta?.thinking === 'string') parts.thinking += parsed.delta.thinking;
        if (typeof parsed.delta?.partial_json === 'string') {
          const index = `anthropic:${parsed.index}`; const call = calls.get(index) || { name: 'tool', args: '', id: '' };
          call.args += parsed.delta.partial_json; calls.set(index, call);
        }
      }
      if (parsed.error && !errorText) errorText = String(isPlainObject(parsed.error) ? parsed.error.message || t('上游返回错误') : parsed.error);
    }
    parts.calls.push(...[...calls.values()].map(call => ({ name: call.name || 'tool', args: prettyJson(call.args || call.input || ''), id: call.id })));
    return hasParts(parts) || errorText ? { role: 'assistant', ...parts, errorText } : null;
  }
  function parseJsonResponse(source) {
    let body; try { body = JSON.parse(source); } catch { return null; }
    if (!isPlainObject(body)) return null;
    const errorText = body.error ? String(isPlainObject(body.error) ? body.error.message || t('上游返回错误') : body.error) : '';
    const message = body.type === 'message' ? body : Array.isArray(body.choices) ? body.choices[0]?.message : null;
    const parsed = parseMessage(message);
    return parsed || errorText ? { role: 'assistant', ...newParts(), ...parsed, errorText } : null;
  }
  function parse(requestBody, responseBody) {
    const request = String(requestBody ?? ''); const response = String(responseBody ?? '');
    const messages = []; const notices = []; const raw = [];
    if (request.trim()) {
      const parsed = parseRequest(request);
      if (parsed) messages.push(...parsed); else notices.push({ kind: 'request', text: t('无法解析请求体（不是含 messages 数组的 JSON）') });
      raw.push({ kind: 'request', label: t('请求原文'), source: request });
    } else if (response.trim()) notices.push({ kind: 'request', text: t('无请求原文') });
    if (response.trim()) {
      const parsed = /^\s*(?:event:|data:)/.test(response) ? parseSseResponse(response) : parseJsonResponse(response);
      if (parsed) messages.push(parsed); else notices.push({ kind: 'response', text: t('无法解析响应内容') });
      raw.push({ kind: 'response', label: t('响应原文'), source: response });
    } else if (request.trim()) notices.push({ kind: 'response', text: t('无响应原文') });
    return { messages, notices, raw };
  }
  // Preserve the old synchronous HTML interface. Its normal implementation delegates
  // to the same React components; the escaped original is only a bundle-missing fallback.
  function render(requestBody, responseBody) {
    const data = parse(requestBody, responseBody);
    if (!data.raw.length) return '';
    if (window.wbConversationPreviewUi?.render) return window.wbConversationPreviewUi.render(data);
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    return data.raw.map(item => `<pre>${escape(item.source)}</pre>`).join('');
  }
  window.wbConversationPreview = { parse, render };
})();
