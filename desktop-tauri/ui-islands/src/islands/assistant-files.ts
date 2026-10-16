import type { FileUIPart } from 'ai'

export const MAX_FILES = 6
export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|yaml|yml|xml|html|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rs|go|java|c|h|cpp|hpp|cs|sh|sql|toml|ini|conf|env|vue|svelte|rb|php|swift|kt|gitignore|dockerfile)$/i
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export const FILE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,text/*,.md,.csv,.json,.jsonl,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.h,.cpp,.sh,.sql,.toml,.ini,.conf,.vue,.svelte'

export function attachmentType(file: Pick<File, 'type' | 'name'>): string {
  if (IMAGE_TYPES.has(file.type)) return file.type
  if (!file.type && /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
    const ext = file.name.split('.').pop()!.toLowerCase()
    return `image/${ext === 'jpg' ? 'jpeg' : ext}`
  }
  if ((file.type.startsWith('text/') && file.type !== 'text/rtf') || TEXT_EXTENSIONS.test(file.name) || /^(Dockerfile|Makefile|\.gitignore|\.env)$/i.test(file.name)) return 'text/plain'
  throw new Error(`不支持文件「${file.name}」。可添加图片、文本、代码、JSON、CSV 或日志；PDF / Office 请先导出为文本或图片。`)
}

export function validateSelection(current: File[], added: File[]): void {
  if (current.length + added.length > MAX_FILES) throw new Error(`最多添加 ${MAX_FILES} 个附件`)
  for (const file of added) {
    attachmentType(file)
    if (!file.size) throw new Error(`文件「${file.name}」为空`)
    if (file.size > MAX_FILE_BYTES) throw new Error(`文件「${file.name}」超过 4 MB`)
  }
  if ([...current, ...added].reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) throw new Error('附件总大小不能超过 8 MB')
}

function readBytes(file: File, signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const reader = new FileReader()
    const abort = () => { reader.abort(); reject(new DOMException('Cancelled', 'AbortError')) }
    const clean = () => signal?.removeEventListener('abort', abort)
    reader.onload = () => { clean(); resolve(new Uint8Array(reader.result as ArrayBuffer)) }
    reader.onerror = () => { clean(); reject(new Error(`无法读取文件「${file.name}」`)) }
    reader.onabort = clean
    signal?.addEventListener('abort', abort, { once: true })
    reader.readAsArrayBuffer(file)
  })
}

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

function imageSignature(bytes: Uint8Array, type: string): boolean {
  const head = (s: number[]) => s.every((b, i) => bytes[i] === b)
  if (type === 'image/png') return head([137, 80, 78, 71, 13, 10, 26, 10])
  if (type === 'image/jpeg') return head([255, 216, 255])
  if (type === 'image/gif') return head([71, 73, 70, 56]) && [55, 57].includes(bytes[4]) && bytes[5] === 97
  return type === 'image/webp' && head([82, 73, 70, 70]) && [87, 69, 66, 80].every((b, i) => bytes[i + 8] === b)
}

export async function prepareAttachments(files: File[], signal?: AbortSignal): Promise<FileUIPart[]> {
  validateSelection([], files)
  return Promise.all(files.map(async file => {
    const mediaType = attachmentType(file)
    let bytes = await readBytes(file, signal)
    signal?.throwIfAborted()
    if (mediaType.startsWith('image/')) {
      if (!imageSignature(bytes, mediaType)) throw new Error(`图片「${file.name}」的内容与格式不符`)
    } else {
      let text: string
      try {
        const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
        if (text.includes('\0')) throw new Error('binary')
      } catch { throw new Error(`文件「${file.name}」不是可读取的文本，请转换为 UTF-8 后重试`) }
      bytes = new TextEncoder().encode(text)
    }
    return { type: 'file', filename: file.name, mediaType, url: `data:${mediaType};base64,${encode(bytes)}` }
  }))
}

export function textAttachment(file: FileUIPart): string {
  if (file.mediaType !== 'text/plain' || !file.url.startsWith('data:text/plain;base64,')) throw new Error('附件必须是内联文本')
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(file.url.slice(file.url.indexOf(',') + 1)), c => c.charCodeAt(0)))
}

/** Every supported SDK file becomes real OpenAI content; unsupported files never disappear silently. */
export function attachmentContent(file: FileUIPart): Record<string, unknown> {
  if (IMAGE_TYPES.has(file.mediaType) && file.url.startsWith(`data:${file.mediaType};base64,`)) return { type: 'image_url', image_url: { url: file.url } }
  if (file.mediaType === 'text/plain') return { type: 'text', text: `附件 ${JSON.stringify(file.filename || '文件')}：\n${textAttachment(file)}` }
  throw new Error(`不支持附件「${file.filename || file.mediaType}」，未发送`)
}
