import * as React from 'react'
import { MessageSquareIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftIcon, PencilIcon, SquarePenIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger, Input, Label, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@ui'
import { cn } from '@ui'
import { t } from '../i18n'
import type { useAssistantHistory, Conversation } from './assistant-history'

type History = ReturnType<typeof useAssistantHistory>
export function HistoryToggle({ history, disabled, collapsed, onToggle, onSelected }: { history: History; disabled: boolean; collapsed: boolean; onToggle: () => void; onSelected: () => void }) {
  const [open, setOpen] = React.useState(false)
  return <><Button className={cn('asst-desktop-toggle hidden', collapsed && 'lg:inline-flex')} variant='ghost' size='icon-sm' aria-label={collapsed ? t('展开历史对话') : t('收起历史对话')} aria-expanded={!collapsed} onClick={onToggle}><PanelLeftIcon data-icon='inline-start' /></Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetTrigger render={<Button className='asst-mobile-toggle inline-flex lg:hidden' variant='ghost' size='icon-sm' />} aria-label={t('历史对话')}><PanelLeftIcon data-icon='inline-start' /></SheetTrigger><SheetContent side='left' className='asst-history-sheet'><SheetHeader><SheetTitle>{t('历史对话')}</SheetTitle></SheetHeader><HistoryList history={history} disabled={disabled} onSelected={() => { setOpen(false); onSelected() }} /></SheetContent></Sheet>
  </>
}
export function HistoryList({ history, disabled, onSelected, onCollapse }: { history: History; disabled: boolean; onSelected: () => void; onCollapse?: () => void }) {
  const [query, setQuery] = React.useState('')
  const [edit, setEdit] = React.useState<{ row?: Conversation; ids?: string[]; mode: 'rename' | 'delete' | 'delete-all' } | null>(null)
  const [title, setTitle] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const groups: { label: string; rows: Conversation[] }[] = [{ label: t('今天'), rows: [] }, { label: t('昨天'), rows: [] }, { label: t('过去 7 天'), rows: [] }, { label: t('更早'), rows: [] }]
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const week = new Date(today); week.setDate(week.getDate() - 7)
  for (const row of history.items.filter(row => row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) {
    groups[row.updatedAt >= +today ? 0 : row.updatedAt >= +yesterday ? 1 : row.updatedAt >= +week ? 2 : 3].rows.push(row)
  }
  const run = async () => {
    if (!edit || pending) return
    setPending(true)
    const ok = edit.mode === 'delete-all' ? await history.removeAll(edit.ids || []) : edit.row ? edit.mode === 'rename' ? await history.rename(edit.row.id, title.trim()) : await history.remove(edit.row.id) : false
    setPending(false); if (ok) setEdit(null)
  }
  return <div className='asst-history-list'>
    <div className='asst-history-head'><MessageSquareIcon aria-hidden='true' />{onCollapse && <Button variant='ghost' size='icon-sm' aria-label={t('收起历史对话')} onClick={onCollapse}><PanelLeftCloseIcon data-icon='inline-start' /></Button>}</div>
    <Button variant='outline' shape='pill' className='asst-new-chat w-full justify-start' disabled={disabled} onClick={() => { void history.newChat().then(ok => { if (ok) onSelected() }) }}><SquarePenIcon data-icon='inline-start' />{t('新聊天记录')}</Button>
    <Button variant='ghost' className='w-full justify-start' disabled={disabled || !history.items.length} onClick={() => setEdit({ mode: 'delete-all', ids: history.items.map(row => row.id) })}><Trash2Icon data-icon='inline-start' />{t('删除全部')}</Button>
    <h3 className='asst-history-label'>{t('历史')}</h3>
    {history.items.length > 0 && <div className='asst-history-search'><SearchIcon size={14} aria-hidden='true' /><Input className='pl-7' aria-label={t('搜索对话')} placeholder={t('搜索对话…')} value={query} onChange={event => setQuery(event.currentTarget.value)} /></div>}
    <nav className='asst-history-scroll' aria-label={t('历史对话列表')}>
      {history.loading ? <p className='asst-history-hint'>{t('加载历史对话…')}</p> : !history.items.length ? <p className='asst-history-hint'>{t('开始聊天后，对话记录会显示在这里。')}</p> : !groups.some(group => group.rows.length) ? <p className='asst-history-hint'>{t('没有匹配的对话')}</p> : groups.filter(group => group.rows.length).map(group => <section key={group.label}><h3>{group.label}</h3>{group.rows.map(row => <div className='asst-history-row' data-active={history.current?.id === row.id || undefined} key={row.id}>
        <Button className='asst-history-link' variant='ghost' disabled={disabled} aria-current={history.current?.id === row.id ? 'page' : undefined} title={row.title} onClick={() => { void history.select(row.id).then(ok => { if (ok) onSelected() }) }}><MessageSquareIcon data-icon='inline-start' /><span>{row.title}</span></Button>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant='ghost' size='icon-sm' />} disabled={disabled} aria-label={t('对话操作：{title}', { title: row.title })}><MoreHorizontalIcon data-icon='inline-start' /></DropdownMenuTrigger><DropdownMenuContent align='end'><DropdownMenuGroup><DropdownMenuItem onClick={() => { setEdit({ row, mode: 'rename' }); setTitle(row.title) }}><PencilIcon />{t('重命名')}</DropdownMenuItem><DropdownMenuItem variant='destructive' onClick={() => setEdit({ row, mode: 'delete' })}><Trash2Icon />{t('删除对话')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </div>)}</section>)}
    </nav>
    <Dialog open={!!edit} onOpenChange={open => { if (!open && !pending) setEdit(null) }}><DialogContent className='max-w-sm'><DialogHeader><DialogTitle>{edit?.mode === 'rename' ? t('重命名对话') : edit?.mode === 'delete-all' ? t('删除全部聊天记录') : t('删除对话')}</DialogTitle><DialogDescription>{edit?.mode === 'rename' ? t('为这段对话设置一个容易找到的名称。') : edit?.mode === 'delete-all' ? t('确定删除全部 {n} 条聊天记录及其中的消息和附件？此操作无法撤销。', { n: edit.ids?.length || 0 }) : t('删除「{title}」及其中的消息和附件？此操作无法撤销。', { title: edit?.row?.title || '' })}</DialogDescription></DialogHeader>{edit?.mode === 'rename' && <form id='assistant-rename' onSubmit={event => { event.preventDefault(); void run() }}><Label htmlFor='assistant-conversation-title'>{t('对话名称')}</Label><Input id='assistant-conversation-title' value={title} maxLength={120} onChange={event => setTitle(event.currentTarget.value)} autoFocus /></form>}{history.error && <p role='alert' className='text-sm text-destructive'>{history.error}</p>}<DialogFooter><Button variant='outline' disabled={pending} onClick={() => setEdit(null)}>{t('取消')}</Button><Button variant={edit?.mode !== 'rename' ? 'destructive' : 'default'} disabled={pending || disabled || (edit?.mode === 'rename' && !title.trim())} onClick={() => void run()}>{pending ? t('保存中…') : edit?.mode === 'rename' ? t('保存') : t('删除')}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
