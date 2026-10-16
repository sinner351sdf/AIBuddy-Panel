/**
 * 设置页 · 「AI 助手」分类的面板（对话模型 / 系统提示词 / 工具勾选）。
 *
 * ── 为什么单独成文件 ────────────────────────────────────────
 * settings-page.tsx 已经装着整个设置页的骨架与十几个面板；助手这三块自带一份
 * 独立的加载与保存（走 `/api/assistant/config`，与 settings-state 那套
 * `/api/config` 快照读写是两条数据流），塞进去只会让它更难读。依赖是单向的：
 * 本文件 import 设置页会导出的挂载点约定也没有 —— 它只被 settings-page 引入并
 * 放在对应 pane 里。
 *
 * ── 保存语义 ────────────────────────────────────────────────
 * 每次改动**立即保存**（与设置页其它开关一致，没有「保存」按钮）：开关、
 * 勾选、模型选择都只 PATCH 改动字段，共享最新快照。编辑提示词的正文在弹窗里改，弹窗自己带
 * 取消 / 保存。
 *
 * ── 「工具全不勾选 → 不注入系统提示词」在哪实现 ─────────────
 * 在后端（`AssistantConfig::system_prompt`）：开关只是第一层，工具为空是第二层。
 * 面板上的四态表把这件事写清楚 —— 用户不必去试。
 */

import * as React from 'react'
import {
  Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Checkbox, Field, FieldGroup, FieldLabel, SelectGroup, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from '@ui'
import { t } from '../i18n'
import {
  DEFAULT_SYSTEM_PROMPT,
  loadAssistantConfig,
  useAssistantConfig,
  loadModelNames,
  saveAssistantConfig,
  type AssistantConfig,
} from './assistant-state'
import { ASSISTANT_TOOLS, errorText, TOOL_META } from './assistant-tools'

function iconHtml(name: string, size: number): string {
  const api = (window as unknown as { wbIcons?: { icon?: (name: string, size: number) => string } }).wbIcons
  return api?.icon?.(name, size) || ''
}

/** 一行的开关（与设置页其它面板同构：label.switch 包住 @ui 的 Switch） */
function SwitchLine({ id, label, checked, disabled, onCheckedChange }: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (next: boolean) => void
}) {
  return (
    <label className='switch'>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={next => onCheckedChange(next)} />
      <span>{label}</span>
    </label>
  )
}

export function AssistantSettingsPane() {
  const config = useAssistantConfig()
  const [models, setModels] = React.useState<string[]>([])
  const [status, setStatus] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorDraft, setEditorDraft] = React.useState('')

  React.useEffect(() => {
    let alive = true
    void (async () => {
      // ① 助手配置（直连 HTTP）
      try {
        const next = await loadAssistantConfig()
        if (!alive) return
        void next
      } catch (error) {
        if (!alive) return
        setFailed(true)
        setStatus(t('加载助手设置失败：{message}', { message: errorText(error) }))
      }
      // ② 助手统一模型清单（含自定义提供商，口径与 /v1/models 一致）：与 ① 各自独立 ——
      //    配置读不到（后端版本旧）时，模型选择器仍应尽量把列表填上，
      //    两件事混在一个 try 里会一起废掉
      try {
        const list = await loadModelNames()
        if (!alive) return
        setModels(list)
      } catch (error) {
        if (!alive) return
        setStatus(prev => prev || t('读取模型清单失败：{message}', { message: errorText(error) }))
      }
    })()
    return () => { alive = false }
  }, [])

  /** 立即保存（改动类控件统一走它；失败时把状态行改成错误） */
  const save = React.useCallback(async (next: Partial<AssistantConfig>, note?: string) => {
    setBusy(true)
    try {
      const saved = await saveAssistantConfig(next)
      void saved
      setFailed(false)
      setStatus(note || t('已保存'))
    } catch (error) {
      setFailed(true)
      setStatus(t('保存失败：{message}', { message: errorText(error) }))
    } finally {
      setBusy(false)
    }
  }, [])

  const ready = config !== null
  const enabledTools = React.useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const tool of ASSISTANT_TOOLS) map[tool.id] = config?.tools?.[tool.id] ?? false
    return map
  }, [config])
  const enabledCount = Object.values(enabledTools).filter(Boolean).length
  const customPrompt = Boolean(config?.systemPrompt?.trim())

  /** 工具勾选：显式存 true / false 两个方向（「恢复推荐」存的是那一组布尔值） */
  const toggleTool = (id: string, on: boolean): void => {
    if (!config) return
    const label = TOOL_META.find(meta => meta.id === id)?.label || id
    const next = { tools: { [id]: on } }
    void save(next, on ? t('已勾选「{label}」', { label }) : t('已取消「{label}」', { label }))
  }

  return (
    <>
      {/* ① 对话模型 */}
      <Card as='section' variant='panel' size='sm' className='panel'>
        <CardHeader variant='panel' className='panel-head'>
          <CardTitle>{t('对话模型')}</CardTitle>
          <CardDescription className='panel-sub'>{t('助手自己用哪个模型生成回复')}</CardDescription>
        </CardHeader>
        <CardContent variant='panel' className='panel-body'>
          <div className='asst-row'>
            <label>{t('模型')}</label>
            {/* 列表口径与 /v1/models 一致：能请求的名字（启用的模型 ID + 启用的映射名） */}
            <Select
              value={config?.model ?? ''}
              disabled={!ready || busy}
              onValueChange={value => {
                if (!config) return
                const name = String(value)
                if (!name) return
                void save({ model: name }, t('对话模型已切换'))
              }}
            >
              <SelectTrigger className='asst-model-pick' aria-label={t('对话模型')}>
                <SelectValue>
                  {config?.model ?? t('选择模型…')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent><SelectGroup>
                {models.length === 0 && <SelectItem value='none' disabled>{t('没有可用的模型')}</SelectItem>}
                {models.map(name => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
            <span className='hint'>
              {t('列表 = 模型管理页里所有已启用的模型。助手走本地网关发起对话，消耗所选账号的额度。')}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ② 系统提示词 */}
      <Card as='section' variant='panel' size='sm' className='panel'>
        <CardHeader variant='panel' className='panel-head'>
          <CardTitle>{t('系统提示词')}</CardTitle>
          <CardDescription className='panel-sub'>{t('作为 system 消息注入给助手')}</CardDescription>
        </CardHeader>
        <CardContent variant='panel' className='panel-body'>
          <div className='asst-row'>
            <SwitchLine
              id='settings-assistant-prompt'
              label={t('注入系统提示词')}
              checked={config?.systemPromptEnabled !== false}
              disabled={!ready || busy}
              onCheckedChange={next => {
                if (!config) return
                void save({ systemPromptEnabled: next }, next ? t('系统提示词已开启') : t('系统提示词已关闭'))
              }}
            />
            <Button
              variant='outline'
              size='sm'
              disabled={!ready}
              onClick={() => {
                setEditorDraft(config?.systemPrompt?.trim() ? config.systemPrompt : DEFAULT_SYSTEM_PROMPT)
                setEditorOpen(true)
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: iconHtml('settings', 13) || '' }} />
              {t('编辑')}
            </Button>
            <span className='hint'>{t('点「编辑」弹窗改内容；开关关掉就整段不发。')}</span>
          </div>
          <div className='settings-state'>
            {config?.systemPromptEnabled === false
              ? t('当前：已关闭（助手不收到任何系统提示词，工具定义照发）')
              : customPrompt
                ? t('当前：已开启 · 自定义内容 {n} 字', { n: config?.systemPrompt.trim().length ?? 0 })
                : t('当前：已开启 · 使用内置默认提示词（还没自定义）')}
          </div>
          <div className='asst-matrix'>
            <div className='mt-title'>{t('四种组合的实际效果')}</div>
            <Table className='asst-mini-table'>
              <TableHeader><TableRow><TableHead>{t('提示词开关')}</TableHead><TableHead>{t('已勾选工具')}</TableHead><TableHead>{t('实际注入')}</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>{t('开')}</TableCell><TableCell>{t('有')}</TableCell><TableCell>{t('系统提示词 + 工具定义')}</TableCell></TableRow>
                <TableRow><TableCell>{t('开')}</TableCell><TableCell><b>{t('无')}</b></TableCell><TableCell><b>{t('都不注入（助手退化为纯聊天）')}</b></TableCell></TableRow>
                <TableRow><TableCell>{t('关')}</TableCell><TableCell>{t('有')}</TableCell><TableCell>{t('只注入工具定义')}</TableCell></TableRow>
                <TableRow><TableCell>{t('关')}</TableCell><TableCell>{t('无')}</TableCell><TableCell>{t('都不注入')}</TableCell></TableRow>
              </TableBody>
            </Table>
            <p className='hint'>
              {t('「工具全不勾选 → 不注入系统提示词」：想当纯聊天用时，不必再去关上面的开关。')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ③ 工具 */}
      <Card as='section' variant='panel' size='sm' className='panel'>
        <CardHeader variant='panel' className='panel-head'>
          <CardTitle>{t('工具')}</CardTitle>
          <CardDescription className='panel-sub'>{t('勾选即注入该工具；不勾选 = 助手看不到它')}</CardDescription>
        </CardHeader>
        <CardContent variant='panel' className='panel-body'>
          <div className='asst-tools-bar'>
            <span className='badge brand'>{t('已勾选 {n} / {total}', { n: enabledCount, total: ASSISTANT_TOOLS.length })}</span>
            <span className='spacer' />
            <Button variant='ghost' size='sm' disabled={!ready || busy}
              onClick={() => {
                if (!config) return
                const tools: Record<string, boolean> = {}
                for (const tool of ASSISTANT_TOOLS) tools[tool.id] = false
                void save({ tools }, t('已全部取消勾选'))
              }}>{t('全不选')}</Button>
            <Button variant='ghost' size='sm' disabled={!ready || busy}
              onClick={() => {
                if (!config) return
                const tools: Record<string, boolean> = {}
                for (const tool of ASSISTANT_TOOLS) tools[tool.id] = tool.kind === 'read'
                void save({ tools }, t('已恢复推荐勾选'))
              }}>{t('恢复推荐')}</Button>
          </div>

          {(['read', 'write'] as const).map(kind => (
            <React.Fragment key={kind}>
              <div className='asst-tool-group'>
                {kind === 'read'
                  ? <>{t('只读工具')} <span className='muted'>{t('· 不会改动任何配置')}</span></>
                  : <>{t('改动类工具')} <span className='muted'>{t('· 每次执行前列改动清单，等你确认')}</span></>}
              </div>
              {TOOL_META.filter(meta => {
                const tool = ASSISTANT_TOOLS.find(item => item.id === meta.id)
                const isRead = tool?.kind === 'read'
                return kind === 'read' ? isRead : !isRead
              }).map(meta => {
                const tool = ASSISTANT_TOOLS.find(item => item.id === meta.id)
                const checked = enabledTools[meta.id] === true
                return (
                  <label className='asst-tool' key={meta.id}>
                    <Checkbox checked={checked} disabled={!ready || busy} onCheckedChange={checked => toggleTool(meta.id, checked === true)} />
                    <span className='tt'>
                      <span className='tt-name'>
                        {meta.label}
                        {tool?.kind === 'read' && <span className='badge tag plain'>{t('只读')}</span>}
                        {meta.tag === 'cost' && <span className='badge tag'>{t('消耗额度')}</span>}
                        {meta.tag === 'danger' && <span className='badge tag bad'>{t('高危')}</span>}
                        {tool?.kind === 'write' && !meta.tag && <span className='badge tag warn'>{t('影响转发')}</span>}
                      </span>
                      <span className='tt-desc'>{meta.desc}</span>
                    </span>
                  </label>
                )
              })}
            </React.Fragment>
          ))}

          <div className={cn('settings-state', failed && 'text-destructive')}>{status}</div>
        </CardContent>
      </Card>

      {/* ④ 系统提示词编辑弹窗 */}
      <Dialog open={editorOpen} onOpenChange={open => { if (!open) setEditorOpen(false) }}>
        <DialogContent className='w-[min(680px,calc(100vw-48px))]'>
          <DialogHeader><DialogTitle>{t('编辑系统提示词')}</DialogTitle></DialogHeader>
          <DialogBody>
            <DialogSection>
              <p>
                {t('这段文本作为 system 消息排在对话最前面。工具的定义与当前配置概览由网关自动附加，不用写在这里。')}
              </p>
            </DialogSection>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='assistant-system-prompt'>{t('提示词正文')}</Label>
              <Textarea
                id='assistant-system-prompt'
                rows={14}
                className='asst-prompt-ta min-h-[300px]'
                spellCheck={false}
                value={editorDraft}
                onChange={event => setEditorDraft(event.currentTarget.value)}
              />
              <div className='hint'>
                {t('清空 = 回到内置默认（与「恢复默认」等价）。')}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant='outline' className='mr-auto'
              onClick={() => setEditorDraft(DEFAULT_SYSTEM_PROMPT)}>{t('恢复默认')}</Button>
            <Button variant='outline' onClick={() => setEditorOpen(false)}>{t('取消')}</Button>
            <Button
              variant='default'
              onClick={() => {
                if (!config) return
                const text = editorDraft.trim() === DEFAULT_SYSTEM_PROMPT.trim() ? '' : editorDraft
                void save({ systemPrompt: text }, t('系统提示词已保存'))
                setEditorOpen(false)
              }}>{t('保存')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
