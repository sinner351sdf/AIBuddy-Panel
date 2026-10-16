import * as React from 'react'
import { BoxIcon, BrainIcon, CheckIcon, ChevronDownIcon, CircleHelpIcon, ImageIcon, VideoIcon, WrenchIcon } from 'lucide-react'
import { Button, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut, Popover, PopoverContent, PopoverTrigger } from '@ui'
import { t } from '../i18n'
import type { AssistantModelOption } from './assistant-models'

export function AssistantModelPicker({ models, value, disabled, onChange }: { models: AssistantModelOption[]; value: string; disabled: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const groups = [...new Set(models.map(model => model.group))]
  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant='secondary' size='sm' shape='pill' className='asst-model-control' />} disabled={disabled} role='combobox' aria-label={t('对话模型')} aria-expanded={open && !disabled}><BoxIcon data-icon='inline-start' /><span className='truncate'>{value || t('选择模型…')}</span><ChevronDownIcon data-icon='inline-end' /></PopoverTrigger>
    <PopoverContent side='top' align='start' className='asst-model-menu w-[min(340px,calc(100vw-32px))]' aria-label={t('选择对话模型')}>
      <Command><CommandInput placeholder={t('搜索模型…')} aria-label={t('搜索模型')} autoFocus /><CommandList><CommandEmpty>{t('没有匹配的模型')}</CommandEmpty>
        {groups.map(group => <CommandGroup key={group} heading={group}>{models.filter(model => model.group === group).map(model => <CommandItem key={model.id} value={model.id} keywords={model.search} data-checked={model.id === value || undefined} onSelect={() => { if (!disabled) { onChange(model.id); setOpen(false) } }}>
          <BoxIcon aria-hidden='true' /><span className='min-w-0 flex-1 truncate' title={model.id}>{model.id}</span>
          <CommandShortcut className='asst-model-capabilities'>
            {model.capabilities.supportsToolCall === true && <span role='img' aria-label={t('支持工具调用')} title={t('支持工具调用')}><WrenchIcon /></span>}
            {model.capabilities.supportsImages === true && <span role='img' aria-label={t('支持图片识别')} title={t('支持图片识别')}><ImageIcon /></span>}
            {model.capabilities.supportsVideo === true && <span role='img' aria-label={t('支持视频识别')} title={t('支持视频识别')}><VideoIcon /></span>}
            {model.capabilities.supportsReasoning === true && <span role='img' aria-label={t('支持思考模式')} title={t('支持思考模式')}><BrainIcon /></span>}
            {model.mixed && <span role='img' aria-label={t('不同提供商的能力声明不同')} title={t('不同提供商的能力声明不同，实际能力取决于所选线路。')}><CircleHelpIcon /></span>}
            {model.id === value && <CheckIcon aria-label={t('当前模型')} />}
          </CommandShortcut>
        </CommandItem>)}</CommandGroup>)}
      </CommandList></Command>
    </PopoverContent>
  </Popover>
}
