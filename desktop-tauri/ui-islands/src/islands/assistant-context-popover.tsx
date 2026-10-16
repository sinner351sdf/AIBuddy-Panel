import { useEffect, useMemo, useState } from 'react'
import type { FileUIPart, UIMessage } from 'ai'
import { GaugeIcon, XIcon } from 'lucide-react'
import { Button, Popover, PopoverClose, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger, Progress } from '@ui'
import { t } from '../i18n'
import { assistantContextUsage } from './assistant-context'
import { attachmentType, prepareAttachments } from './assistant-files'
import { formatTokens } from './model-capability'
import type { AssistantModelOption } from './assistant-models'
import type { AssistantConfig } from './assistant-state'

const compact = (n: number) => n ? formatTokens(n) : '0'
export function AssistantContextPopover({ config, model, messages, draft, files }: {
  config: AssistantConfig | null; model?: AssistantModelOption; messages: UIMessage[]; draft: string; files: File[]
}) {
  const [pending, setPending] = useState<{ source: File[]; parts: FileUIPart[]; failed: boolean } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    // Reuse validated UTF-8 attachment conversion; image/base64 size is never a token estimate.
    const textFiles = files.filter(file => !attachmentType(file).startsWith('image/'))
    if (!textFiles.length) { setPending({ source: files, parts: [], failed: false }); return }
    void prepareAttachments(textFiles, controller.signal).then(parts => {
      if (!controller.signal.aborted) setPending({ source: files, parts, failed: false })
    }).catch(() => { if (!controller.signal.aborted) setPending({ source: files, parts: [], failed: true }) })
    return () => controller.abort()
  }, [files])
  const ready = pending?.source === files
  const usage = useMemo(() => assistantContextUsage(config, messages, draft, ready ? pending!.parts : []), [config, messages, draft, ready, pending])
  const images = usage.images + files.filter(file => attachmentType(file).startsWith('image/')).length
  const limit = typeof model?.capabilities.maxInputTokens === 'number' ? model.capabilities.maxInputTokens : null
  const percent = limit ? usage.total / limit * 100 : null
  const percentage = (n: number) => `${(n / (limit || 1) * 100).toFixed(1)}%`
  const rows = [
    { id: 'system', label: t('系统提示词'), value: usage.system },
    { id: 'tools', label: t('工具定义'), value: usage.definitions },
    { id: 'conversation', label: t('对话内容'), value: usage.conversation },
    { id: 'draft', label: t('待发送内容'), value: usage.pending },
  ]
  return <Popover>
    <PopoverTrigger render={<Button type='button' variant='ghost' size='sm' shape='pill' />} aria-label={t('上下文用量')} disabled={!config}>
      <GaugeIcon data-icon='inline-start' />{t('上下文')} {percent === null ? `≈ ${compact(usage.total)}` : `≈ ${percent.toFixed(1)}%`}
    </PopoverTrigger>
    <PopoverContent side='top' align='start' className='w-[min(340px,calc(100vw-32px))]' aria-label={t('上下文用量详情')}>
      <PopoverHeader className='justify-between'><PopoverTitle>{t('上下文用量')}</PopoverTitle><PopoverClose render={<Button type='button' variant='ghost' size='icon-sm' />} aria-label={t('关闭')}><XIcon data-icon='inline-start' /></PopoverClose></PopoverHeader>
      <div className='asst-context-body'>
        <div className='asst-context-summary'><strong>{percent === null ? compact(usage.total) : `${percent.toFixed(1)}%`}</strong><span>{t('估算')} {compact(usage.total)} / {limit ? compact(limit) : t('上限未知')} Token</span></div>
        {limit && <Progress value={Math.min(percent!, 100)} aria-label={t('上下文占用估算')} />}
        <dl className='asst-context-breakdown'>{rows.map(row => <div key={row.id} data-context-category={row.id}><dt><span className='asst-context-dot' data-category={row.id} />{row.label}</dt><dd title={`${row.value.toLocaleString()} Token`}>{compact(row.value)}{limit ? ` · ${percentage(row.value)}` : ''}</dd></div>)}</dl>
        {!ready && files.length > 0 && <p role='status'>{t('正在读取附件…')}</p>}
        {(images > 0 || pending?.failed || usage.incomplete) && <p>{t('图片或未读取的附件未计入，实际占用会更高。')}</p>}
        {!limit && <p>{t('模型未声明上下文上限，暂不计算百分比。')}</p>}
        {limit !== null && model?.contextWindowVaries && <p>{t('同名模型的窗口不同，按可用线路的最小值计算。')}</p>}
        {percent !== null && percent >= 100 && <p role='status'>{t('估算已达上下文上限，建议新建对话或减少内容。')}</p>}
        <p>{t('按发送内容本地估算，实际以模型分词为准；非累计用量。')}</p>
      </div>
    </PopoverContent>
  </Popover>
}
