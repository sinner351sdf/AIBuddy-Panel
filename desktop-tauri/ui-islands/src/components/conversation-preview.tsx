import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Alert, AlertDescription, Attachment, AttachmentGroup, AttachmentMedia, AttachmentTrigger,
  Bubble, BubbleContent, Button, CodeBlock, CodeBlockActions, CodeBlockContent,
  CodeBlockHeader, CodeBlockTitle, Collapsible, CollapsibleContent, CollapsibleTrigger,
  Empty, EmptyDescription, EmptyHeader, Marker, MarkerContent,
  Message, MessageContent, MessageFooter, MessageGroup, MessageHeader,
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle,
} from '@ui'
import { t } from '../i18n'

type ToolCall = { name: string; args: string; id?: string }
type ToolResult = { label: string; text: string; images: string[] }
type Parts = { text: string; thinking: string; images: string[]; calls: ToolCall[]; results: ToolResult[] }
type ConversationMessage = Parts & { role: string; toolCallId?: string; errorText?: string }
export type ConversationData = {
  messages: ConversationMessage[]
  notices: { kind: string; text: string }[]
  raw: { kind: string; label: string; source: string }[]
}
type PreviewWindow = {
  wbConversationPreview?: { parse?: (request: unknown, response: unknown) => ConversationData }
  wbMarkdown?: { render?: (text: string) => string }
  wbConversationPreviewUi?: { render: (data: ConversationData) => string }
}
const shared = () => window as unknown as PreviewWindow

/** Markdown renderer is the existing escaping parser; an unavailable parser keeps literal text. */
function RichText({ text }: { text: string }) {
  let html = ''
  try { html = shared().wbMarkdown?.render?.(text) || '' } catch { /* Keep readable text. */ }
  return html ? <div className='md-body' dangerouslySetInnerHTML={{ __html: html }} /> : <div className='whitespace-pre-wrap'>{text}</div>
}
function CopyAction({ text, label = t('复制') }: { text: string; label?: string }) {
  // data-copy uses clipboard.js, including the desktop bridge and insecure-context fallback.
  return <Button variant='ghost' size='icon-xs' data-copy={text} aria-label={label} title={label}>⧉</Button>
}
function OriginalText({ title, text }: { title: string; text: string }) {
  return <CodeBlock size='sm'>
    <CodeBlockHeader><CodeBlockTitle>{title}</CodeBlockTitle><CodeBlockActions><CopyAction text={text} /></CodeBlockActions></CodeBlockHeader>
    <CodeBlockContent wrap className='max-h-72'>{text}</CodeBlockContent>
  </CodeBlock>
}
function Images({ images, label }: { images: string[]; label: string }) {
  if (!images.length) return null
  return <AttachmentGroup>{images.map((src, index) => <Attachment key={`${index}:${src}`} orientation='vertical' state='done'>
    <AttachmentMedia variant='image'><img src={src} alt={`${label} ${index + 1}`} loading='lazy' /></AttachmentMedia>
    <AttachmentTrigger render={<a href={src} target='_blank' rel='noreferrer' aria-label={t('在新窗口查看图片')} />} />
  </Attachment>)}</AttachmentGroup>
}
function Activity({ title, text, images, markdown = false }: { title: string; text: string; images?: string[]; markdown?: boolean }) {
  return <TraceCollapsible>
    <TraceCollapsibleTrigger render={<Button variant='ghost' size='xs' className='h-auto max-w-full justify-start px-0 py-1' />}>
      <TraceLine><TraceIcon>◇</TraceIcon><TraceTitle>{title}</TraceTitle></TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted>
      {text ? markdown ? <RichText text={text} /> : <OriginalText title={title} text={text} /> : null}
      <Images images={images || []} label={t('工具结果图片')} />
    </TraceCollapsibleContent>
  </TraceCollapsible>
}
function ConversationRow({ message }: { message: ConversationMessage }) {
  const user = message.role === 'user'
  const system = message.role === 'system' || message.role === 'developer'
  const tool = message.role === 'tool'
  const copy = [message.thinking, message.text, ...message.calls.map(call => `${call.name}\n${call.args}`), ...message.results.map(result => result.text)].filter(Boolean).join('\n\n')
  if (system) return <Message><MessageContent><MessageHeader><Marker><MarkerContent>{message.role}</MarkerContent></Marker></MessageHeader><Bubble variant='muted'><BubbleContent><RichText text={message.text} /><Images images={message.images} label={t('请求图片')} /></BubbleContent></Bubble>{copy ? <MessageFooter><CopyAction text={copy} label={t('复制消息')} /></MessageFooter> : null}</MessageContent></Message>
  return <Message align={user ? 'end' : 'start'}>
    <MessageContent>
      <MessageHeader>{tool ? t('工具结果') : user ? t('用户') : t('助手')}</MessageHeader>
      {message.errorText ? <Alert variant='destructive'><AlertDescription>{message.errorText}</AlertDescription></Alert> : null}
      {tool ? <Trace><Activity title={message.toolCallId ? t('工具结果 · {id}', { id: message.toolCallId }) : t('工具结果')} text={message.text} images={message.images} /></Trace> : <>
        {message.thinking ? <Trace><Activity title={t('思考过程')} text={message.thinking} markdown /></Trace> : null}
        {message.text || message.images.length ? <Bubble align={user ? 'end' : 'start'} variant={user ? 'default' : 'outline'}>
          <BubbleContent>{message.text ? user ? <div className='whitespace-pre-wrap'>{message.text}</div> : <RichText text={message.text} /> : null}<Images images={message.images} label={t('请求图片')} /></BubbleContent>
        </Bubble> : null}
        {message.calls.length || message.results.length ? <Trace>
          {message.calls.map((call, index) => <Activity key={`call:${index}`} title={t('调用工具 {name}', { name: call.name })} text={call.args} />)}
          {message.results.map((result, index) => <Activity key={`result:${index}`} title={result.label} text={result.text} images={result.images} />)}
        </Trace> : null}
      </>}
      {copy ? <MessageFooter><CopyAction text={copy} label={t('复制消息')} /></MessageFooter> : null}
    </MessageContent>
  </Message>
}
export function ConversationView({ data }: { data: ConversationData }) {
  if (!data.raw.length) return <Empty variant='compact'><EmptyHeader><EmptyDescription>{t('无报文原文（可能已被清理或超出保留范围）')}</EmptyDescription></EmptyHeader></Empty>
  return <MessageGroup className='gap-4'>
    {data.notices.filter(notice => notice.kind === 'request').map((notice, index) => <Empty key={`request-notice:${index}`} variant='compact'><EmptyHeader><EmptyDescription>{notice.text}</EmptyDescription></EmptyHeader></Empty>)}
    {data.messages.map((message, index) => <ConversationRow key={index} message={message} />)}
    {data.notices.filter(notice => notice.kind === 'response').map((notice, index) => <Empty key={`response-notice:${index}`} variant='compact'><EmptyHeader><EmptyDescription>{notice.text}</EmptyDescription></EmptyHeader></Empty>)}
    {data.raw.map(raw => <Collapsible key={raw.kind}>
      <CollapsibleTrigger render={<Button variant='ghost' size='sm' />}>{raw.label}</CollapsibleTrigger>
      <CollapsibleContent keepMounted><OriginalText title={raw.label} text={raw.source} /></CollapsibleContent>
    </Collapsible>)}
  </MessageGroup>
}
export function ConversationPreview({ requestBody, responseBody }: { requestBody: unknown; responseBody: unknown }) {
  const data = React.useMemo(() => shared().wbConversationPreview?.parse?.(requestBody, responseBody), [requestBody, responseBody])
  return data ? <ConversationView data={data} /> : <Empty variant='compact'><EmptyHeader><EmptyDescription>{t('对话预览暂不可用')}</EmptyDescription></EmptyHeader></Empty>
}
// Legacy consumers receive markup generated by the same actual components.
shared().wbConversationPreviewUi = { render: data => renderToStaticMarkup(<ConversationView data={data} />) }
