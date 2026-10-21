import { usePageReady } from '../components/use-page-ready'
import { cn } from '@ui'
/** AI Elements Base UI Chat / Message / Confirmation patterns with the real Rust transport.
 * https://ui.shadcn.com/docs/ai-elements/base/{chat,message,confirmation,tool}.md */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { CheckIcon, CopyIcon, RefreshCcwIcon, SparklesIcon, WrenchIcon } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, Alert, AlertDescription, Badge, Bubble, BubbleContent, Button, CodeBlock, CodeBlockContent, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Item, ItemActions, ItemContent, ItemDescription, ItemTitle, Message, MessageContent, MessageFooter, MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@ui'
import { ChatAttachment, PromptInput } from '../components/ai-elements/prompt-input'
import { t } from '../i18n'
import { useAssistantChat, type ToolView } from './assistant-chat'
import { DEFAULT_SYSTEM_PROMPT, gatewayBase, loadAssistantConfig, saveAssistantConfig, useAssistantConfig } from './assistant-state'
import { HistoryList, HistoryToggle } from './assistant-history-view'
import { useAssistantHistory } from './assistant-history'
import { AssistantModelPicker } from './assistant-model-picker'
import { loadAssistantModelOptions, type AssistantModelOption } from './assistant-models'
import { AssistantToolsPopover } from './assistant-tools-popover'
import { AssistantContextPopover } from './assistant-context-popover'
import { errorText, toolById } from './assistant-tools'

function Markdown({ text }: { text: string }) {
  const api = (window as unknown as { wbMarkdown?: { render?: (value: string) => string } }).wbMarkdown
  const html = api?.render ? api.render(text) : text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch))
  return <div className='asst-markdown' dangerouslySetInnerHTML={{ __html: html }} />
}

function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer) }, [copied])
  const copy = async () => {
    try {
      const shared = (window as unknown as { copyToClipboard?: (value: string) => Promise<boolean> }).copyToClipboard
      if (shared) { if (!(await shared(text))) throw new Error('Copy failed') }
      else await navigator.clipboard.writeText(text)
      setCopied(true); setFailed(false)
    } catch { setFailed(true) }
  }
  return <Tooltip><TooltipTrigger render={<Button size='icon-sm' variant='ghost' />} aria-label={failed ? t('复制失败，请重试') : copied ? t('已复制') : t('复制回答')} onClick={() => void copy()}>{copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}</TooltipTrigger><TooltipContent>{failed ? t('复制失败，请重试') : copied ? t('已复制') : t('复制回答')}</TooltipContent></Tooltip>
}

function ToolCallView({ item, onConfirm }: { item: ToolView; onConfirm: (approved: boolean) => void }) {
  const [open, setOpen] = React.useState(item.state === 'failed')
  React.useEffect(() => { if (item.state === 'failed') setOpen(true) }, [item.state])
  const tool = toolById(item.call.name)
  const label = tool?.label || item.call.name
  if (item.state === 'confirm') return <Item variant='outline' className='flex-wrap items-start' data-tool-confirm={item.call.id}>
    <ItemContent className='min-w-0 gap-3'>
      <ItemTitle>{label}<Badge variant='secondary'>{t('待确认')}</Badge></ItemTitle>
      <ItemDescription>{item.plan?.lead || t('请确认是否执行这次操作')}</ItemDescription>
      {item.plan?.table && <Table><TableHeader><TableRow>{item.plan.table.head.map((cell, index) => <TableHead key={index}>{cell}</TableHead>)}</TableRow></TableHeader><TableBody>{item.plan.table.rows.slice(0, 20).map((row, i) => <TableRow key={i}>{row.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table>}
      {item.plan?.table && item.plan.table.rows.length > 20 && <ItemDescription>{t('（仅显示前 20 条，共 {n} 条）', { n: item.plan.table.rows.length })}</ItemDescription>}
      <ItemDescription>{item.plan?.note}{tool?.kind === 'run' ? t('这会真实发起上游请求并消耗额度') : t('确认后立即生效')}</ItemDescription>
    </ItemContent>
    <ItemActions><Button size='sm' variant='outline' onClick={() => onConfirm(false)}>{t('取消')}</Button><Button size='sm' onClick={() => onConfirm(true)}>{t('执行')}</Button></ItemActions>
  </Item>
  const state = item.state === 'running' ? t('运行中') : item.state === 'cancelled' ? t('已取消') : item.state === 'failed' ? t('失败') : item.summary || t('完成')
  return <TraceCollapsible open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger><TraceLine status={item.state === 'running' ? 'running' : item.state === 'failed' ? 'error' : undefined}><TraceIcon>{item.state === 'running' ? <Spinner /> : item.state === 'done' ? <CheckIcon data-icon="inline-start" /> : <WrenchIcon />}</TraceIcon><TraceTitle>{label}</TraceTitle><TraceDescription>{state}</TraceDescription></TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      {item.error && <Alert variant='destructive'><AlertDescription>{item.error}</AlertDescription></Alert>}
      {item.detail && <CodeBlock size='sm'><CodeBlockContent wrap className='max-h-72'>{item.detail}</CodeBlockContent></CodeBlock>}
      {item.call.arguments !== '{}' && <CodeBlock size='sm'><CodeBlockContent wrap className='max-h-48'>{item.call.arguments}</CodeBlockContent></CodeBlock>}
    </TraceCollapsibleContent>
  </TraceCollapsible>
}

function AssistantTurn({ message, cards, onConfirm }: { message: UIMessage; cards: Record<string, ToolView>; onConfirm: (id: string, approved: boolean) => void }) {
  const sections: React.ReactNode[] = []
  let tools: React.ReactNode[] = []
  const flush = () => { if (tools.length) { sections.push(<Trace key={`trace-${sections.length}`}>{tools}</Trace>); tools = [] } }
  for (const [index, part] of message.parts.entries()) {
    if (part.type === 'text') { flush(); sections.push(<Markdown key={index} text={part.text} />) }
    else if (part.type === 'reasoning') tools.push(<TraceCollapsible key={index}><TraceCollapsibleTrigger><TraceLine status={part.state === 'streaming' ? 'running' : undefined}><TraceIcon><SparklesIcon /></TraceIcon><TraceTitle>{t('思考过程')}</TraceTitle></TraceLine></TraceCollapsibleTrigger><TraceCollapsibleContent><Markdown text={part.text} /></TraceCollapsibleContent></TraceCollapsible>)
    else if (isToolUIPart(part)) {
      const call = { id: part.toolCallId, name: getToolName(part), arguments: JSON.stringify(part.input || {}) }
      const item: ToolView = cards[call.id] || { call, state: part.state === 'output-error' ? 'failed' : part.state === 'output-available' ? 'done' : 'running', error: part.state === 'output-error' ? part.errorText : undefined, detail: part.state === 'output-available' ? String(part.output ?? '') : undefined }
      const element = <ToolCallView key={index} item={item} onConfirm={approved => onConfirm(call.id, approved)} />
      if (item.state === 'confirm') { flush(); sections.push(element) } else tools.push(element)
    }
  }
  flush()
  return <>{sections}</>
}

let mobileDraft = ''
let mobileDraftFiles: File[] = []
export function AssistantPage({ mobile = false }: { mobile?: boolean } = {}) {
  const config = useAssistantConfig()
  const chat = useAssistantChat()
  const history = useAssistantHistory(chat)
  const historyReload = React.useRef(history.reload); historyReload.current = history.reload
  const [collapsed, setCollapsed] = React.useState(false)
  const [models, setModels] = React.useState<AssistantModelOption[]>([])
  const [draft, setDraft] = React.useState(mobile ? mobileDraft : '')
  const [draftFiles, setDraftFiles] = React.useState<File[]>(mobile ? mobileDraftFiles : [])
  React.useEffect(() => { if (mobile) { mobileDraft = draft; mobileDraftFiles = draftFiles } }, [mobile, draft, draftFiles])
  const [status, setStatus] = React.useState('')
  const [loadingFailed, setLoadingFailed] = React.useState(false)
  usePageReady('assistant', Boolean(config) || loadingFailed)
  const [savingModel, setSavingModel] = React.useState(false)
  const [composerKey, setComposerKey] = React.useState(0)
  const activate = React.useCallback(async () => {
    void historyReload.current()
    try { await loadAssistantConfig(); setLoadingFailed(false); setStatus('') } catch (error) { setLoadingFailed(true); setStatus(errorText(error)) }
    try { setModels(await loadAssistantModelOptions()) } catch (error) { setStatus(errorText(error)) }
  }, [])
  React.useEffect(() => {
    const api = window as unknown as { wbAssistant?: { activate?: () => void } }
    api.wbAssistant = { activate: () => { void activate() } }; void activate()
    return () => { delete api.wbAssistant }
  }, [activate])
  const locked = chat.busy || chat.awaiting || savingModel || history.loading || history.working
  const displayStatus = chat.error ? errorText(chat.error) : status || history.error || chat.notice
  const modelPicker = <AssistantModelPicker models={models} value={config?.model || ''} disabled={locked} onChange={value => {
    if (!value || locked) return
    setSavingModel(true)
    void saveAssistantConfig({ model: value }).then(() => setStatus('')).catch(error => setStatus(errorText(error))).finally(() => setSavingModel(false))
  }} />
  const resetComposer = () => { setDraft(''); setDraftFiles([]); setStatus(''); setComposerKey(key => key + 1) }
  return <TooltipProvider><div className={cn(mobile ? 'asst-shell mobile-assistant' : 'asst-shell')} data-collapsed={collapsed || undefined}>
    {!collapsed && <aside className='asst-history-desktop'><HistoryList history={history} disabled={locked} onSelected={resetComposer} onCollapse={() => setCollapsed(true)} /></aside>}
    <div className='asst-layout' data-empty={!chat.messages.length || undefined}>
    <header className='asst-top'><div className='asst-title-row'><HistoryToggle history={history} disabled={locked} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} onSelected={resetComposer} /><h2 title={history.current?.title}>{history.current?.title || t('AI 助手')}</h2></div><div className='flex items-center gap-2'><span className='asst-save-status' role='status'>{history.saving ? t('保存中…') : history.current && !history.error ? t('已保存') : ''}</span></div></header>
    <MessageScrollerProvider key={history.current?.id || 'new-chat'} autoScroll><MessageScroller className='min-h-0 flex-1'><MessageScrollerViewport className='asst-scroll'><MessageScrollerContent className='asst-thread'>
      {!chat.messages.length && <Empty className='asst-empty px-0 py-4'><EmptyHeader><EmptyTitle className='text-[clamp(22px,2.4vw,28px)] font-semibold'>{t('我能帮您什么？')}</EmptyTitle><EmptyDescription>{t('提出问题、编写代码或探索各种想法吧。')}</EmptyDescription></EmptyHeader></Empty>}
      {chat.messages.map((message, index) => {
        const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n')
        return <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === 'user'}><Message align={message.role === 'user' ? 'end' : 'start'}><MessageContent className='min-w-0 gap-3'>
          {message.role === 'user' ? <><div className='flex max-w-full flex-wrap justify-end gap-2'>{message.parts.filter(part => part.type === 'file').map((part, partIndex) => <ChatAttachment key={partIndex} data={part} />)}</div>{text && <Bubble align='end' variant='muted'><BubbleContent className='whitespace-pre-wrap'>{text}</BubbleContent></Bubble>}</> : <AssistantTurn message={message} cards={chat.cards} onConfirm={chat.confirm} />}
          {message.role === 'assistant' && !locked && <MessageFooter>{text && <CopyReply text={text} />}{index === chat.messages.length - 1 && <Tooltip><TooltipTrigger render={<Button variant='ghost' size='icon-sm' />} aria-label={t('重新生成')} onClick={() => void chat.retry(message.id)}><RefreshCcwIcon data-icon="inline-start" /></TooltipTrigger><TooltipContent>{t('重新生成')}</TooltipContent></Tooltip>}</MessageFooter>}
        </MessageContent></Message></MessageScrollerItem>
      })}
      {chat.status === 'submitted' && <MessageScrollerItem><Message><MessageContent><span role='status' className='flex items-center gap-2 text-sm text-muted-foreground'><Spinner />{t('正在回复…')}</span></MessageContent></Message></MessageScrollerItem>}
    </MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton /></MessageScroller></MessageScrollerProvider>
    <div className='asst-composer'>
      {!chat.messages.length && <div className='asst-suggestions' aria-label={t('快捷问题')}>
        {[{ title: t('查找重复模型'), prompt: t('看看哪些模型在多家重复了') }, { title: t('查看账号余额'), prompt: t('查看各账号的剩余额度') }, { title: t('分析文件'), prompt: t('请帮我分析附件中的内容') }, { title: t('检查网关配置'), prompt: t('帮我检查当前网关配置，先给出建议，不要修改。') }].map(({ title, prompt }) => <Button key={title} variant='outline' size='sm' aria-label={prompt} onClick={() => { setDraft(prompt); document.querySelector<HTMLTextAreaElement>('[data-page="assistant"] textarea')?.focus() }}>{title}</Button>)}
      </div>}
      <PromptInput initialFiles={mobile ? draftFiles : undefined} key={composerKey} value={draft} onChange={setDraft} onFilesChange={setDraftFiles} disabled={locked} busy={chat.busy} awaiting={chat.awaiting} onStop={chat.stop} model={<div className='flex min-w-0 flex-wrap items-center gap-1'>{modelPicker}<Select value={config?.reasoning || 'default'} disabled={locked} onValueChange={level => {
        setSavingModel(true); void saveAssistantConfig({ reasoning: level === 'default' ? null : level }).catch(error => setStatus(errorText(error))).finally(() => setSavingModel(false))
      }}><SelectTrigger aria-label={t('思考等级')} className='w-auto'><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
        {['default','none','minimal','low','medium','high','xhigh','max'].map(level => <SelectItem key={level} value={level}>{level === 'default' ? t('默认思考等级') : level}</SelectItem>)}
      </SelectGroup></SelectContent></Select><AssistantContextPopover config={config} model={models.find(model => model.id === config?.model)} messages={chat.messages} draft={draft} files={draftFiles} /><AssistantToolsPopover config={config} /></div>} onSend={async ({ text, files }) => {
        if (locked) return false
        if (chat.messages.length >= 198) { setStatus(t('这段对话已达到消息上限，请新建对话后继续。')); return false }
        if (!config?.model) { setStatus(t('请先选择对话模型，输入的内容会保留。')); return false }
        try { await history.ensure(text, files[0]?.filename) } catch (error) { setStatus(errorText(error)); return false }
        setStatus(''); void chat.send(text, files).catch(error => setStatus(errorText(error))); return true
      }} />
      {displayStatus && <Alert variant={chat.notice && !chat.error && !status ? 'default' : 'destructive'}><AlertDescription>{displayStatus}{history.error ? <Button size='sm' variant='ghost' onClick={() => { void history.flush().then(() => history.reload()).catch(() => {}) }}>{t('重试')}</Button> : loadingFailed ? <Button size='sm' variant='ghost' onClick={() => void activate()}>{t('重试')}</Button> : chat.error && !locked && <Button size='sm' variant='ghost' onClick={() => void chat.retry()}>{t('重试')}</Button>}</AlertDescription></Alert>}
    </div>
  </div></div></TooltipProvider>
}

const PAGE_SELECTOR = '.page[data-page="assistant"]'
let root: ReturnType<typeof createRoot> | null = null
function mount(): void {
  if (root) return
  const section = document.querySelector<HTMLElement>(PAGE_SELECTOR)
  if (!section) return
  section.replaceChildren(); root = createRoot(section); root.render(<AssistantPage />)
}
if (document.querySelector(PAGE_SELECTOR)) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
void gatewayBase().catch(() => {})
export { DEFAULT_SYSTEM_PROMPT }
