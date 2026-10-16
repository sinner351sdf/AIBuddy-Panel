import { useId, useRef, useState } from 'react'
import { Alert, AlertDescription, Badge, Button, Item, ItemActions, ItemContent, ItemDescription, ItemTitle, Label, Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger, Switch } from '@ui'
import { ChevronDownIcon, ShieldCheckIcon } from 'lucide-react'
import { t } from '../i18n'
import { saveAssistantConfig, type AssistantConfig } from './assistant-state'
import { ASSISTANT_TOOLS, TOOL_META } from './assistant-tools'
export function AssistantToolsPopover({ config }: { config: AssistantConfig | null }) {
  const id = useId()
  const saving = useRef(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const toggleTool = async (toolId: string, on: boolean) => {
    if (!config || saving.current) return
    saving.current = true
    setPending(toolId)
    setError('')
    try {
      // Patch this permission only; the shared store also updates the settings island.
      await saveAssistantConfig({ tools: { [toolId]: on } })
    } catch (error) {
      setError(t('保存失败：{message}', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      saving.current = false
      setPending(null)
    }
  }
  const enabled = ASSISTANT_TOOLS.filter(tool => config?.tools[tool.id] === true)
  const mode = !config ? t('加载设置…') : !enabled.length ? t('纯聊天') : enabled.some(tool => tool.kind !== 'read') ? t('操作前确认') : t('只读')
  return <Popover><PopoverTrigger render={<Button type='button' size='sm' shape='pill' variant='ghost' />} aria-label={t('已启用工具详情')} title={t('已启用 {n} / {total} 个工具', { n: enabled.length, total: ASSISTANT_TOOLS.length })} disabled={!config}><ShieldCheckIcon data-icon='inline-start' />{mode} · {enabled.length} / {ASSISTANT_TOOLS.length}<ChevronDownIcon data-icon='inline-end' /></PopoverTrigger>
    <PopoverContent side='top' align='start' className='w-[min(420px,calc(100vw-32px))]' aria-label={t('助手工具')}><PopoverHeader><PopoverTitle>{t('助手工具')}</PopoverTitle></PopoverHeader>
      {error && <Alert variant='destructive' className='mx-3 w-auto'><AlertDescription>{error}</AlertDescription></Alert>}
      <div className='min-h-0 overflow-y-auto p-2' role='list' aria-label={t('工具权限列表')}>
        {TOOL_META.map(meta => { const tool = ASSISTANT_TOOLS.find(tool => tool.id === meta.id); const on = config?.tools[meta.id] === true
          return <Item size='sm' key={meta.id} role='listitem' data-tool-id={meta.id} data-enabled={on}>
            <ItemContent className='min-w-0'><ItemTitle><Label className='cursor-pointer text-sm text-foreground' htmlFor={`${id}-${meta.id}`}>{meta.label}</Label></ItemTitle><ItemDescription id={`${id}-${meta.id}-description`}>{meta.desc}</ItemDescription><div className='flex flex-wrap items-center gap-2'><Badge variant='outline'>{tool?.kind === 'read' ? t('只读') : tool?.kind === 'run' ? t('测试 · 每次确认') : t('修改 · 每次确认')}</Badge><span className='text-xs text-muted-foreground' role='status'>{pending === meta.id ? t('保存中…') : on ? t('已启用') : t('未启用')}</span></div></ItemContent>
            <ItemActions><Switch id={`${id}-${meta.id}`} checked={on} disabled={!config || pending !== null} aria-describedby={`${id}-${meta.id}-description`} aria-busy={pending === meta.id} onCheckedChange={next => { void toggleTool(meta.id, next) }} /></ItemActions>
          </Item>
        })}
      </div>
    </PopoverContent>
  </Popover>
}
