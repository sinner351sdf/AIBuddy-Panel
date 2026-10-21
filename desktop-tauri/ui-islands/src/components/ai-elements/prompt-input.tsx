/** Official AI Elements Base UI Prompt Input / Attachment composition, wired to real files.
 * Source: https://ui.shadcn.com/docs/ai-elements/base/prompt-input.md (2026-10-16).
 * Local additions: validation, paste/drop, previews, abortable reading and draft retention. */
import * as React from 'react'
import type { FileUIPart } from 'ai'
import { ArrowUpIcon, FileTextIcon, ImageIcon, PaperclipIcon, SquareIcon, XIcon } from 'lucide-react'
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger, Alert, AlertDescription, CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle, CodeBlockActions, CodeBlockCopyButton, Dialog, DialogContent, DialogHeader, DialogTitle, Field, FieldGroup, InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea, Spinner } from '@ui'
import { t } from '../../i18n'
import { attachmentType, FILE_ACCEPT, prepareAttachments, textAttachment, validateSelection } from '../../islands/assistant-files'

export function ChatAttachment({ data, file, onRemove }: { data: FileUIPart; file?: File; onRemove?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [preview, setPreview] = React.useState('')
  const image = data.mediaType.startsWith('image/')
  React.useEffect(() => {
    if (!open || image) return
    const controller = new AbortController()
    if (file) void prepareAttachments([file], controller.signal).then(parts => { if (!controller.signal.aborted) setPreview(textAttachment(parts[0])) }).catch(error => { if (!controller.signal.aborted) setPreview(String(error)) })
    else { try { setPreview(textAttachment(data)) } catch { setPreview(t('无法预览此附件')) } }
    return () => controller.abort()
  }, [open, image, data.url, file])
  return <>
    <Attachment size='sm' state='done' className='max-w-full'>
      <AttachmentTrigger aria-label={t('预览附件 {name}', { name: data.filename || '' })} onClick={() => setOpen(true)} />
      <AttachmentMedia variant={image ? 'image' : 'icon'}>{image ? <img src={data.url} alt={data.filename || t('图片')} /> : <FileTextIcon />}</AttachmentMedia>
      <AttachmentContent><AttachmentTitle>{data.filename || t('附件')}</AttachmentTitle><AttachmentDescription>{image ? t('图片') : t('文本文件')}{file ? ` · ${(file.size / 1024).toFixed(1)} KB` : ''}</AttachmentDescription></AttachmentContent>
      {onRemove && <AttachmentActions><AttachmentAction type='button' aria-label={t('移除附件 {name}', { name: data.filename || '' })} onClick={onRemove}><XIcon data-icon="inline-start" /></AttachmentAction></AttachmentActions>}
    </Attachment>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className='max-w-3xl'><DialogHeader><DialogTitle>{data.filename || t('附件')}</DialogTitle></DialogHeader>
      {image ? <img className='max-h-[65vh] max-w-full object-contain' src={data.url} alt={data.filename || t('图片')} /> : <CodeBlock><CodeBlockHeader><CodeBlockTitle>{t('附件内容')}</CodeBlockTitle><CodeBlockActions><CodeBlockCopyButton value={preview} /></CodeBlockActions></CodeBlockHeader><CodeBlockContent wrap className='max-h-[60vh]'>{preview || t('读取中…')}</CodeBlockContent></CodeBlock>}
    </DialogContent></Dialog>
  </>
}

// These IDs identify draft UI rows, not credentials. LAN HTTP may omit randomUUID.
let attachmentSequence = 0
function attachmentId(): string { return globalThis.crypto?.randomUUID?.() || `draft-file-${++attachmentSequence}` }
type DraftFile = { id: string; file: File; part: FileUIPart }
export function PromptInput({ value, onChange, disabled, busy, awaiting, onStop, onSend, model, onFilesChange, initialFiles = [] }: {
  value: string; onChange: (text: string) => void; disabled: boolean; busy: boolean; awaiting: boolean
  onStop: () => void; onSend: (message: { text: string; files: FileUIPart[] }) => boolean | Promise<boolean>; model: React.ReactNode
  onFilesChange?: (files: File[]) => void
  initialFiles?: File[]
}) {
  const [files, setFiles] = React.useState<DraftFile[]>(() => initialFiles.map(file => ({ id: attachmentId(), file, part: {type: 'file', filename: file.name, mediaType: attachmentType(file), url: URL.createObjectURL(file)} })))
  const filesRef = React.useRef(files)
  const [error, setError] = React.useState('')
  const [preparing, setPreparing] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const formRef = React.useRef<HTMLFormElement>(null)
  const preparingRef = React.useRef<AbortController | null>(null)
  const locked = disabled || preparing
  const replaceFiles = (next: DraftFile[]) => { filesRef.current = next; setFiles(next); onFilesChange?.(next.map(item => item.file)) }
  const clearFiles = () => { filesRef.current.forEach(item => URL.revokeObjectURL(item.part.url)); replaceFiles([]) }
  React.useEffect(() => () => { preparingRef.current?.abort(); filesRef.current.forEach(item => URL.revokeObjectURL(item.part.url)) }, [])
  const add = (selected: File[]) => {
    if (locked || !selected.length) return
    try {
      validateSelection(filesRef.current.map(item => item.file), selected)
      replaceFiles([...filesRef.current, ...selected.map(file => ({ id: attachmentId(), file, part: { type: 'file' as const, filename: file.name, mediaType: attachmentType(file), url: URL.createObjectURL(file) } }))])
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const stop = () => { preparingRef.current?.abort(); preparingRef.current = null; setPreparing(false); onStop() }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (disabled || preparingRef.current || (!value.trim() && !filesRef.current.length)) return
    const current = new AbortController(); preparingRef.current = current; setPreparing(true); setError('')
    try {
      const prepared = await prepareAttachments(filesRef.current.map(item => item.file), current.signal)
      if (current.signal.aborted || preparingRef.current !== current) return
      if (await onSend({ text: value.trim(), files: prepared })) { onChange(''); clearFiles() }
    } catch (err) { if (!current.signal.aborted) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (preparingRef.current === current) { preparingRef.current = null; setPreparing(false) } }
  }
  return <div className='flex min-w-0 flex-col gap-2'>
    <form ref={formRef} onSubmit={event => void submit(event)} className='w-full' onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!locked) setDragging(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); add(Array.from(event.dataTransfer.files)) }}>
      <input ref={inputRef} type='file' aria-label={t('添加附件')} hidden tabIndex={-1} multiple accept={FILE_ACCEPT} disabled={locked} onChange={event => { add(Array.from(event.currentTarget.files || [])); event.currentTarget.value = '' }} />
      <FieldGroup><Field data-disabled={locked} data-invalid={!!error}><InputGroup className='asst-input-group' data-dragging={dragging || undefined}>
        <InputGroupTextarea aria-label={t('发送给 AI 助手的消息')} placeholder={t('问点什么…')} value={value} disabled={locked} onChange={event => onChange(event.target.value)}
          onPaste={event => { const incoming = Array.from(event.clipboardData.files); if (incoming.length) { event.preventDefault(); add(incoming) } }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); formRef.current?.requestSubmit() } }} />
        {files.length > 0 && <InputGroupAddon align='block-start' className='flex-wrap gap-2'>
          {files.map(item => <ChatAttachment key={item.id} data={item.part} file={item.file} onRemove={locked ? undefined : () => { URL.revokeObjectURL(item.part.url); replaceFiles(filesRef.current.filter(other => other.id !== item.id)); setError('') }} />)}
        </InputGroupAddon>}
        <InputGroupAddon align='block-end' className='asst-input-toolbar'>
          <InputGroupButton type='button' size='icon-sm' variant='ghost' aria-label={t('添加附件')} title={t('图片、文本、代码、JSON、CSV、日志；最多 6 个，单个 4 MB，总计 8 MB')} disabled={locked} onClick={() => inputRef.current?.click()}><PaperclipIcon data-icon="inline-start" /></InputGroupButton>
          <div className='min-w-0 flex-1'>{model}</div>
          {preparing || busy || awaiting
            ? <InputGroupButton type='button' size='icon-sm' shape='pill' variant='default' aria-label={t('停止')} onClick={stop}>{preparing ? <Spinner /> : <SquareIcon data-icon="inline-start" />}</InputGroupButton>
            : <InputGroupButton type='submit' size='icon-sm' shape='pill' variant='default' aria-label={t('发送')} disabled={disabled || (!value.trim() && !files.length)}><ArrowUpIcon data-icon="inline-start" /></InputGroupButton>}
        </InputGroupAddon>
      </InputGroup></Field></FieldGroup>
    </form>
    {dragging && <span role='status' className='text-xs text-muted-foreground'>{t('松开以添加附件')}</span>}
    {error && <Alert variant='destructive'><AlertDescription role='alert'>{error}</AlertDescription></Alert>}
  </div>
}
