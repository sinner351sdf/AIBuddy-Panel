import { Alert, AlertDescription, Field, FieldContent, FieldLabel } from '@ui'
import { InfoTip } from '../components/info-tip'
import * as React from 'react'
import { cn, Badge, Button, Checkbox, Input, Spinner, Switch } from '@ui'
import { formatTime, shared, toast } from './accounts-shared'
import { t } from '../i18n'
import {
  getCheckinStore, setCheckinTab, setKeepaliveDraft, submitKeepaliveModels, submitWebConversation, subscribeCheckinStore,
  type CheckinStore, type TravelScheduleState, saveTravelSchedule, runTravelScheduleNow,
} from './checkin-state'
import {
  deleteSchedule, getSchedulesStore, loadSchedules, runScheduleNow, saveSchedule,
  setEditingId, subscribeSchedulesStore, toggleMaster, toggleScheduleEnabled,
  type SchedulesStore,
} from './checkin-schedules-state'
import type { ScheduleEntry } from './checkin-state'
import { Card, CardHeader, CardTitle, Empty, EmptyHeader, EmptyDescription } from '@ui'

/**
 * 签到中心的「定时签到」标签页。
 *
 * ── 结构 ────────────────────────────────────────────────────
 *   · 总开关面板 —— `autoCheckin.enabled`（写走老的 /api/auto-checkin，见
 *     checkin-schedules-state 的模块头）。关了所有条目都不跑；开着时每条
 *     条目按自己的时刻与范围各自执行、各自当天去重。
 *   · 条目列表 —— 每条：开关 / 时刻 / 范围 / 下次执行 / 上次执行摘要 +
 *     立即执行 / 编辑 / 删除。行内展开编辑表单（一次只开一张，状态在
 *     schedules-state 的 editingId）；新建同表单（editingId = 'new'）。
 *   · 保活模型链面板 —— 自原「自动签到」卡迁入（它是全局一份的配置，
 *     与条目无关，所以独立成卡）：WorkBuddy 国际版日活保活的免费模型，
 *     按顺序回退；清空提交 = 恢复缺省链。
 *
 * 数据：GET /api/checkin-schedules 一次拉全（loadSchedules，挂载时调）；
 * 写动作的响应自带整份新状态，无轮询。
 */

/**
 * 提供商完整规则（在可展开区域阅读；问号只保留通用调度规则）。
 * 整段是一个键：扫描器只认字符串字面量（拼接串 / 模板串提不到键），所以不拆行。
 */
const AUTO_CHECKIN_DESC = t(
    '到点后自动签到勾选提供商的可用账号（WorkBuddy 国内版走每日签到接口，国际版走每日活跃任务：探测活动、领日活奖励、再用免费模型保活，开启网页会话保活后另建网页会话点亮日活；小浣熊走桌面端每日积分链路；AutoClaw 走官方客户端的每日签到任务；Qoder 中国版走活动领取，没被下发活动的账号会得到中性提示；Qoder 国际版要先带设备风控身份（本机 Qoder 客户端 / qodercli 的 UMID 组件生成）才能看到「每日 100 Credits」活动，缺组件时会得到明确的说明而不是报错；Trae 领 SOLO 的每日签到积分（按自然日 0 点重置），上游没对该账号开活动、或凭据里没有设备号时得到的是「未领取 + 具体原因」而不是报错；Loomy 每天替账号打一次首次登录积分；KukuAI 领「免费领积分」的每日任务；CodeArts 领当日的运营福利（领取 → 确认 → 回读核实，自动执行受每天 6 次 / 间隔 10 分钟的写请求限流）；OfficeAce 果办一次领当天全部奖励（每日签到 + 新人礼））。错过时点开机后会自动补签，不会因为当时没开机而漏掉。各家签到接口都是幂等的，重复执行不会重复领取。',
)

/* ─── store 订阅 ───────────────────────────── */

function useSchedulesStore(): SchedulesStore {
  const [store, setStore] = React.useState(getSchedulesStore())
  React.useEffect(() => subscribeSchedulesStore(() => setStore(getSchedulesStore())), [])
  return store
}

/** 保活模型链的草稿 / 快照在 checkin-state 里，这里只订阅读 */
function useCheckinSnapshot(): CheckinStore {
  const [store, setStore] = React.useState(getCheckinStore())
  React.useEffect(() => subscribeCheckinStore(() => setStore(getCheckinStore())), [])
  return store
}

/* ─── 展示工具 ─────────────────────────────── */

/** 勾选的家名（providers 顺序即注册顺序：注册表顺序，不是勾选先后） */
function pickedLabels(entry: ScheduleEntry, options: Array<{ id: string; label: string }>): string[] {
  const picked = Array.isArray(entry.providers) ? entry.providers : []
  return options.filter(option => picked.includes(option.id)).map(option => option.label)
}

/**
 * 范围摘要。**全选时只说「全部 n 家」**：默认就是全选，把 12 个名字铺一行
 * 之后，这一行里真正该被看见的「每天几点」和「上次执行」全被名字淹掉了
 * （名称列被挤成两行）。部分勾选才逐家列 —— 那时名单本身就是信息
 * （悬停看全貌，见 `providersFullList`）。
 */
function providersSummary(entry: ScheduleEntry, options: Array<{ id: string; label: string }>): string {
  const labels = pickedLabels(entry, options)
  if (!labels.length) return t('未勾选提供商')
  if (options.length > 0 && labels.length >= options.length) return t('全部 {n} 个提供商', { n: options.length })
  return labels.join(t('、'))
}

/** 完整名单（行里会截断，悬停提示用这一份） */
function providersFullList(entry: ScheduleEntry, options: Array<{ id: string; label: string }>): string {
  const labels = pickedLabels(entry, options)
  return labels.length ? labels.join(t('、')) : t('未勾选提供商')
}

/** 结果摘要；时间和触发原因单独展示，避免挤在同一行。 */
function lastResultLine(entry: ScheduleEntry): string {
  const last = entry.lastResult
  if (!last) return t('还没执行过')
  const numberOf = (value: unknown): number => Number(value) || 0
  const parts = [t('成功 {n}', { n: numberOf(last.succeeded) })]
  const active = numberOf(last.active)
  if (active > 0) parts.push(t('保活 {n}', { n: active }))
  const failed = numberOf(last.failedCount)
  if (failed > 0) parts.push(t('失败 {n}', { n: failed }))
  const skipped = numberOf(last.skipped)
  if (skipped > 0) parts.push(t('跳过 {n}', { n: skipped }))
  return parts.join(t(' · '))
}

/* ─── 编辑表单 ─────────────────────────────── */

/**
 * 条目的行内编辑 / 新建表单。草稿是**组件内**状态（展开时按 entry 现起，
 * 收起即弃）—— 与时刻草稿跨卡共享的旧场景不同，这里一次只开一张表单。
 */
function ScheduleEditor({ entry, store }: { entry: ScheduleEntry | null; store: SchedulesStore }) {
  const options = Array.isArray(store.data?.providerOptions) ? store.data!.providerOptions! : []
  const isNew = entry === null
  const [label, setLabel] = React.useState(entry?.label ?? '')
  const [time, setTime] = React.useState(entry?.time ?? '00:01')
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(
    new Set(isNew ? options.map(option => option.id) : entry?.providers ?? []),
  )
  const dirty = label !== (entry?.label ?? '') || time !== (entry?.time ?? '00:01')
    || picked.size !== (isNew ? options.length : entry?.providers?.length ?? 0)
    || (entry?.providers ?? []).some(id => !picked.has(id))
  // 新建缺省全选；没有 options（后端没给）时退到这条已有的 providers
  React.useEffect(() => {
    if (isNew && options.length > 0) setPicked(new Set(options.map(option => option.id)))
    // 只在挂载 / 切换编辑对象时初始化一次：options 后到不该把用户改了一半的勾选冲掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const canSave = time.trim() !== '' && picked.size > 0
  const pickAll = (): void => setPicked(new Set(options.map(option => option.id)))
  const clearAll = (): void => setPicked(new Set<string>())
  const submit = async (): Promise<void> => {
    await saveSchedule({
      id: entry?.id,
      label: label.trim(),
      enabled: entry?.enabled ?? true,
      time: time.trim(),
      providers: options.map(option => option.id).filter(id => picked.has(id)),
    })
  }
  return (
    <div className='ck-sched-editor'>
      <div className='ck-set-line'>
        <span className='ck-set-k'>{t('名称')}</span>
        <span className='ck-set-v'>
          <Input
            type='text'
            aria-label={t('计划名称')}
            className='max-w-[220px]'
            placeholder={t('可选 · 缺省显示时刻')}
            value={label}
            disabled={store.saving}
            onChange={event => setLabel(event.currentTarget.value)}
          />
        </span>
      </div>
      <div className='ck-set-line'>
        <span className='ck-set-k'>{t('每天时刻')}</span>
        <span className='ck-set-v flex items-center gap-2'>
          <Input
            type='time'
            aria-label={t('每天执行时刻（北京时间）')}
            className='w-[96px] max-w-[96px] font-mono tabular-nums'
            value={time}
            disabled={store.saving}
            onChange={event => setTime(event.currentTarget.value)}
          />
          <span className='text-subtle text-xs'>{t('北京时间 · 错过时点开机后会自动补签')}</span>
        </span>
      </div>
      <div className='ck-set-line ck-set-line-top'>
        <span className='ck-set-k'>{t('签到范围')}</span>
        <span className='ck-set-v'>
          <div className='ck-mini-row'>
            <span className='ck-mini-note'>
              {t('已选 {n} / {total} 个提供商', { n: picked.size, total: options.length })}
            </span>
            <Button variant='ghost' size='xs' disabled={store.saving} onClick={pickAll}>{t('全选')}</Button>
            <Button variant='ghost' size='xs' disabled={store.saving || picked.size === 0} onClick={clearAll}>{t('清空')}</Button>
          </div>
          <div className='ck-range' role='group' aria-label={t('签到范围')}>
            {options.map(option => (
              <label className='ck-range-item' key={option.id}>
                <Checkbox
                  checked={picked.has(option.id)}
                  disabled={store.saving}
                  onCheckedChange={next => {
                    const nextPicked = new Set(picked)
                    if (next === true) nextPicked.add(option.id)
                    else nextPicked.delete(option.id)
                    setPicked(nextPicked)
                  }}
                />
                <span className='ck-range-name' title={option.label}>{option.label}</span>
              </label>
            ))}
          </div>
          {picked.size === 0 ? (
            <div className='ck-mini-warn'>{t('至少勾一家才能保存（不勾等于这条条目不签到）')}</div>
          ) : null}
        </span>
      </div>
      <div className='ck-sched-actions'>
        {dirty ? <span className='ck-sched-unsaved' role='status'>{t('尚未保存')}</span> : null}
        <Button size='sm' variant='outline' disabled={store.saving} onClick={() => setEditingId(null)}>
          {t('取消')}
        </Button>
        <Button size='sm' variant='default' disabled={!canSave || store.saving} onClick={() => void submit()}>
          {store.saving ? t('保存中…') : t('保存计划')}
        </Button>
      </div>
    </div>
  )
}

/* ─── 条目行 ───────────────────────────────── */

/**
 * 新建条目的那一行。它必须是**真渲染出来的一段界面** —— 之前「添加条目」
 * 只把 `editingId` 置成 `'new'`，而没有一处按这个值渲染（条目行只认
 * `entry.id`），于是点了完全没反应（状态变了、界面没动）。
 *
 * 位置在列表**首位**：点按钮的地方（卡头右上）离它最近，也不会被已有条目
 * 推到看不见的地方去。
 */
function NewEntryRow({ store }: { store: SchedulesStore }) {
  return (
    <div className='ck-sched-row open ck-sched-row-new'>
      <div className='ck-sched-new-heading'>
        <span className='ck-new-dot' aria-hidden>＋</span>
        <div className='ck-prov-info'>
          <div className='ck-prov-name'>{t('新建签到计划')}</div>
          <div className='ck-prov-desc'>
            {t('设置每天的执行时间与提供商范围，名称可留空。')}
          </div>
        </div>
      </div>
      <ScheduleEditor entry={null} store={store} />
    </div>
  )
}

function ScheduleEntryRow({ entry, store }: { entry: ScheduleEntry; store: SchedulesStore }) {
  const options = Array.isArray(store.data?.providerOptions) ? store.data!.providerOptions! : []
  const expanded = store.editingId === entry.id
  const busy = store.runningId === entry.id
  const masterOn = store.data?.enabled === true
  const nextRunAt = Number(entry.nextRunAt)
  const remove = async (): Promise<void> => {
    const ask = shared().wbConfirm?.ask
    if (!ask) return
    // ConfirmOptions 只收 html（调用方负责转义）：条目名来自用户输入，先转义再拼
    const name = entry.displayLabel || entry.time || entry.id
    const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (!(await ask({
      title: t('删除定时条目'),
      html: t('确定删除「<strong>{name}</strong>」？删除后到点不再执行。', { name: escaped }),
      okText: t('删除'),
      okClass: 'danger',
    }))) return
    await deleteSchedule(entry.id)
  }
  return (
    <div className={cn(expanded ? 'ck-sched-row open' : 'ck-sched-row')}>
      <div className='ck-sched-main'>
        <Switch
          aria-label={t('启用计划 {name}', { name: entry.displayLabel || entry.time || entry.id })}
          checked={entry.enabled === true}
          disabled={store.saving}
          onCheckedChange={next => void toggleScheduleEnabled(entry, next === true)}
        />
        <div className='ck-sched-identity'>
          <div className='ck-prov-name'>
            {entry.displayLabel || entry.time || entry.id}
            {entry.enabled === true
              ? null
              : <Badge variant='outline' shape='tag'>{t('已停用')}</Badge>}
          </div>
          <div className='ck-prov-desc ck-sched-scope' title={providersFullList(entry, options)}>
            {entry.label ? t('每天 {time}', { time: entry.time ?? '—' }) : t('每天执行')}
            {' · '}{providersSummary(entry, options)}
          </div>
        </div>
        <div className='ck-sched-result'>
          <div className='ck-sched-label'>{t('最近一次')}</div>
          <div className={cn('ck-sched-value', Number(entry.lastResult?.failedCount) > 0 && 'ck-sched-failed')}>
            {busy ? t('执行中…') : lastResultLine(entry)}
          </div>
          {entry.lastResult ? <div className='ck-sched-detail'>
            {entry.lastResult.at ? formatTime(entry.lastResult.at) : '—'}
            {entry.lastResult.reason ? ` · ${entry.lastResult.reason}` : ''}
          </div> : null}
        </div>
        <div className='ck-sched-next'>
          <div className='ck-sched-label'>{t('下次自动执行 · 北京时间')}</div>
          <div className='ck-sched-value'>
            {!masterOn ? t('自动签到已暂停') : entry.enabled !== true ? t('此计划已停用')
              : Number.isFinite(nextRunAt) && nextRunAt > 0 ? formatTime(nextRunAt)
                : entry.lastFiredToday ? t('今日已执行，等待下次调度') : t('等待调度')}
          </div>
        </div>
        <div className='ck-sched-row-actions'>
          <Button
            size='sm'
            variant='ghost'
            disabled={busy || store.runningId !== null}
            onClick={() => void runScheduleNow(entry.id)}
          >
            {busy ? t('执行中…') : t('执行一次')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setEditingId(expanded ? null : entry.id)}
          >
            {expanded ? t('收起') : t('编辑')}
          </Button>
          <Button size='sm' variant='ghost-destructive' disabled={store.saving} onClick={() => void remove()}>
            {t('删除')}
          </Button>
        </div>
      </div>
      {expanded ? <ScheduleEditor entry={entry} store={store} /> : null}
    </div>
  )
}

/* ─── 保活模型链（清单编辑器：增 / 删 / 按住拖动排序）───── */

/** 两份清单是否逐项相同（判「草稿有没有真改过」） */
function sameModels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * 拖动状态放在**模块级**：指针监听挂在 window 上，回调里拿不到组件闭包。
 *
 * ── 为什么拖动是「换一份新数组」而不是自己搬 DOM ─────────────
 * 清单由 React 按 `key={模型名}` 渲染，拖动时做的只是把数组换一份新的 ——
 * React 会**移动既有节点**（不重建），所以拖动中 row 的 DOM 身份不变、
 * 后面的落点判定始终量的还是那一行。自己搬 DOM 的话下一次 diff 就会把顺序打回去。
 */
type ChainDrag = {
  /** 当前顺序（每次落点变化就换一份新的） */
  list: string[]
  /** 被拖的行现在在第几位 */
  from: number
  row: HTMLElement
  onChange: (models: string[]) => void
}

let chainDrag: ChainDrag | null = null

/** 指针落在第几位：拿其余各行的中线比（与账号页顺序拖拽同一口径） */
function chainInsertIndex(others: HTMLElement[], clientY: number): number {
  for (let index = 0; index < others.length; index += 1) {
    const rect = others[index].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return index
  }
  return others.length
}

function onChainPointerMove(event: PointerEvent): void {
  const state = chainDrag
  if (!state) return
  // 指针中途被放开（没接到 pointerup）时收尾，别留一个卡住的拖动态
  if (event.buttons === 0) { finishChainDrag(); return }
  const container = state.row.parentElement
  if (!container) return
  const rows = [...container.querySelectorAll<HTMLElement>('.ck-chain-row')]
  const others = rows.filter(row => row !== state.row)
  const to = chainInsertIndex(others, event.clientY)
  if (to === state.from) return
  const next = [...state.list]
  const [moved] = next.splice(state.from, 1)
  next.splice(to, 0, moved)
  // 就地记住新秩序：下一次落点判定要用它，而不是等 React 回灌
  state.list = next
  state.from = to
  state.onChange(next)
}

function finishChainDrag(): void {
  const state = chainDrag
  chainDrag = null
  window.removeEventListener('pointermove', onChainPointerMove)
  window.removeEventListener('pointerup', finishChainDrag)
  window.removeEventListener('pointercancel', finishChainDrag)
  document.body.classList.remove('ck-chain-dragging')
  state?.row.classList.remove('dragging')
}

/** 按住把手起拖（把手是**唯一**的拖动起点：行里还有移除按钮，整行可拖会点错） */
function startChainDrag(
  event: React.PointerEvent<HTMLElement>,
  index: number,
  models: string[],
  onChange: (models: string[]) => void,
): void {
  if (event.button !== 0 || chainDrag) return
  if (models.length < 2) return
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.ck-chain-row')
  if (!row) return
  event.preventDefault()
  chainDrag = { list: [...models], from: index, row, onChange }
  row.classList.add('dragging')
  document.body.classList.add('ck-chain-dragging')
  window.addEventListener('pointermove', onChainPointerMove)
  window.addEventListener('pointerup', finishChainDrag)
  window.addEventListener('pointercancel', finishChainDrag)
}

/**
 * 保活模型链面板。
 *
 * ── 为什么从一行输入框改成清单 ──────────────────────────────
 * 原来是一个用「、」分隔的文本框，加一个模型要挪光标、删一个要精确选中、想换顺序
 * 得手动剪贴 —— 而这条链的语义恰恰**就是顺序**（按顺序逐个尝试、第一个成功即止）。
 * 现在：一行一个模型，+ 添加、× 移除、按住把手拖动排序，整份清单一次保存
 * （清空后保存 = 恢复缺省链）。
 */
function KeepalivePanel({ models, defaultModels, dirty, saving, webConversationEnabled }: {
  webConversationEnabled: boolean
  models: string[]
  defaultModels: string[]
  dirty: boolean
  saving: boolean
}) {
  const [input, setInput] = React.useState('')
  const add = (): void => {
    const name = input.trim()
    if (!name) return
    if (models.includes(name)) {
      toast(t('清单里已经有「{name}」', { name }), 'err')
      return
    }
    setKeepaliveDraft([...models, name])
    setInput('')
  }
  return (
    <Card as='section' variant='panel' size='sm' className='panel ck-chain-panel'>
      <details>
        <summary className='ck-chain-summary'>
          <span className='ck-chain-heading'>{t('WorkBuddy 国际版保活设置')}</span>
          <span className='ck-chain-summary-note'>{models.length
            ? t('{n} 个模型，按顺序回退', { n: models.length }) : t('使用默认模型')}</span>
          {dirty ? <span className='ck-chain-dirty' role='status'>{t('尚未保存')}</span> : null}
        </summary>
        <div className='p-4'>
          <p className='ck-chain-description'>{t('仅用于 WorkBuddy 国际版日活保活，对所有相关签到计划生效。')}</p>
          <Field orientation='horizontal' className='mb-4' data-disabled={saving}>
            <FieldContent>
              <div className='flex items-center gap-2'>
              <FieldLabel htmlFor='checkin-web-conversation'>{t('网页会话保活')}</FieldLabel>
              <InfoTip>{t('默认关闭。开启后，完整签到和保活会在 WorkBuddy 国际版创建带 Hi 提示词的网页会话，可能产生用量；仅领取奖励不会创建会话。')}</InfoTip>
              </div>
            </FieldContent>
            <Switch id='checkin-web-conversation' checked={webConversationEnabled} disabled={saving} onCheckedChange={enabled => void submitWebConversation(enabled)} />
          </Field>
          <div className='ck-set-line ck-set-line-top'>
            <span className='ck-set-k'>{t('模型清单')}</span>
            <span className='ck-set-v'>
              {/* 计数与「填入缺省链」并排放在清单上方：原来想回到缺省链只能一个个 ×
                  删空了再保存，现在一键填好（仍然要点「保存」才生效） */}
              <div className='ck-mini-row'>
                <span className='ck-mini-note'>{t('按序逐个尝试，共 {n} 个', { n: models.length })}</span>
                <Button variant='ghost' size='xs' disabled={saving || defaultModels.length === 0} title={t('填入默认模型，保存后生效')} onClick={() => setKeepaliveDraft([...defaultModels])}>{t('恢复默认模型')}</Button>
              </div>
              <div className='ck-chain'>
                {models.map((model, index) => (
                  <div className='ck-chain-row' key={model}>
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      type='button'
                      className='ck-chain-grip'
                      disabled={saving}
                      aria-label={t('调整 {name} 的顺序，当前位置 {n}', { name: model, n: index + 1 })}
                      title={t('拖动或使用上下方向键调整顺序')}
                      aria-keyshortcuts='ArrowUp ArrowDown'
                      onPointerDown={event => startChainDrag(event, index, models, setKeepaliveDraft)}
                      onKeyDown={event => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        const to = index + (event.key === 'ArrowUp' ? -1 : 1)
                        if (to < 0 || to >= models.length) return
                        const next = [...models]
                        ;[next[index], next[to]] = [next[to], next[index]]
                        setKeepaliveDraft(next)
                      }}
                      dangerouslySetInnerHTML={{ __html: shared().wbIcons?.icon?.('gripVertical', 14) || '' }}
                    />
                    <span className='ck-chain-name' title={model}>{model}</span>
                    <span className='ck-chain-index'>#{index + 1}</span>
                    <Button variant='ghost' size='icon-xs' disabled={saving} aria-label={t('移除 {name}', { name: model })} title={t('从清单里移除')} onClick={() => setKeepaliveDraft(models.filter((_, keep) => keep !== index))}>×
                    </Button>
                  </div>
                ))}
                {models.length === 0 ? (
                  <Empty variant='compact' className='ck-chain-empty'><EmptyHeader><EmptyDescription>{t('清单为空 —— 保存后恢复缺省链')}</EmptyDescription></EmptyHeader></Empty>
                ) : null}
              </div>
              <div className='ck-chain-add'>
                <Input
                  type='text'
                  aria-label={t('新增保活模型')}
                  className='max-w-[260px] font-mono text-xs'
                  placeholder={t('WorkBuddy 国际版保活模型，按顺序回退')}
                  value={input}
                  disabled={saving}
                  onChange={event => setInput(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); add() }
                  }}
                />
                <Button size='sm' variant='outline' disabled={saving || input.trim() === ''} onClick={add}>
                  {t('添加模型')}
                </Button>
                {dirty ? <span className='ck-chain-dirty'>{t('有未保存的改动')}</span> : null}
              </div>
            </span>
          </div>
          <div className='ck-chain-footer'>
            <span className='ck-chain-description'>{t('按顺序尝试，首个成功后停止。清空并保存将恢复默认模型。')}</span>
            <Button size='sm' disabled={!dirty || saving} onClick={() => void submitKeepaliveModels(models)}>
              {saving ? t('保存中…') : t('保存模型设置')}
            </Button>
          </div>
        </div>
      </details>
    </Card>
  )
}

/* ─── 页面 ─────────────────────────────────── */

function ScheduleTab({ active = true }: { active?: boolean }): React.ReactElement {
  const store = useSchedulesStore()
  const checkin = useCheckinSnapshot()
  // 切到本标签页才刷新；TabsContent 常驻保留输入与展开态。
  React.useEffect(() => { if (active) void loadSchedules() }, [active])

  if (!store.loaded) {
    return (
      <div className='ck-loading'>
        <Spinner className='size-5' />
        <span>{t('正在读取定时签到数据…')}</span>
      </div>
    )
  }

  const data = store.data
  const masterOn = data?.enabled === true
  const entries = Array.isArray(data?.schedules) ? data!.schedules! : []
  // 保活模型链（全局一份，随卡迁入本页）：草稿非空表示用户正在编辑，否则跟随快照
  const keepalive = checkin.snapshot?.keepalive
  const keepaliveModels = Array.isArray(keepalive?.models) ? keepalive!.models : []
  const defaultModels = Array.isArray(keepalive?.defaultModels) ? keepalive!.defaultModels : []
  const chainDraft = checkin.keepaliveDraft
  const chainModels = chainDraft ?? keepaliveModels
  const chainDirty = chainDraft !== null && !sameModels(chainDraft, keepaliveModels)

  return (
    <div>
      {store.loadError ? (
        <Alert variant='destructive'>
          <AlertDescription>{t('读取定时签到数据失败：{error}', { error: store.loadError })}</AlertDescription>
          <Button size='sm' variant='outline' onClick={() => void loadSchedules()}>{t('重试')}</Button>
        </Alert>
      ) : null}

      <Card as='section' variant='panel' size='sm' className='panel ck-schedule-panel'>
        <CardHeader variant='panel' className='panel-head'>
          <CardTitle>{t('定时签到')}</CardTitle>
          <InfoTip>{t('按北京时间执行；错过时点后开机会自动补签；每个计划当天去重。')}</InfoTip>
          <span className='panel-sub'>{t('按北京时间执行，支持自动补签')}</span>
          {/* 新建入口放卡头（原先是卡尾的一颗按钮：条目一多就要滚到底才看得见，
              而它恰恰是「这个页面第一件要做的事」） */}
          <Button
            size='sm'
            variant='default'
            className='ml-auto flex-none'
            disabled={store.saving}
            onClick={() => setEditingId(store.editingId === 'new' ? null : 'new')}
          >
            {store.editingId === 'new' ? t('收起新建') : t('新建签到计划')}
          </Button>
        </CardHeader>
        <div className='ck-sched-master'>
          <div className='ck-sched-master-control'>
              <Switch
                aria-label={t('自动签到总开关')}
                checked={masterOn}
                disabled={store.saving}
                onCheckedChange={next => void toggleMaster(next === true)}
              />
              <div>
                <div className='ck-sched-master-title'>{masterOn ? t('自动签到已开启') : t('自动签到已暂停')}</div>
                <div className='ck-sched-detail'>{masterOn
                  ? t('已启用的计划将按各自时刻执行，开关即时生效。')
                  : t('暂停自动调度，仍可手动执行一次。开关即时生效。')}</div>
              </div>
          </div>
          <div className='ck-sched-master-meta'>
            <span>{t('已启用 {enabled} / {total} 个计划', { enabled: entries.filter(entry => entry.enabled === true).length, total: entries.length })}</span>
            <Button size='sm' variant='ghost' onClick={() => setCheckinTab('records')}>{t('查看签到记录')}</Button>
          </div>
        </div>
        <div>
          {store.editingId === 'new' ? <NewEntryRow store={store} /> : null}
          {entries.map(entry => <ScheduleEntryRow key={entry.id} entry={entry} store={store} />)}
          {entries.length === 0 ? (
            <Empty variant='compact' className='ck-empty'><EmptyHeader><EmptyDescription>{t('还没有签到计划，点击「新建签到计划」设置每天的执行时间。')}</EmptyDescription></EmptyHeader></Empty>
          ) : null}
        </div>
        <details className='ck-sched-rules'>
          <summary>{t('查看各提供商的签到规则')}</summary>
          <div className='ck-sched-rules-body'>
            {AUTO_CHECKIN_DESC.split(/[；;]/).map((rule, index) => <p key={index}>{rule}</p>)}
          </div>
        </details>
      </Card>

      <KeepalivePanel
        webConversationEnabled={keepalive?.webConversationEnabled === true}
        models={chainModels}
        defaultModels={defaultModels}
        dirty={chainDirty}
        saving={checkin.keepaliveSaving}
      />

      <TravelPanel
        travel={checkin.snapshot?.travel}
        saving={checkin.travelSaving}
        running={checkin.travelRunning}
      />
    </div>
  )
}

/* ─── 猫猫旅行定时排程 ─────────────────────── */

/**
 * 猫猫旅行定时排程面板（国内版）。
 *
 * ── 为什么与「定时签到」分卡 ────────────────────────────────
 * 两个排程完全独立（`autoCheckin` vs `growthSchedule`）：用户可能只想自动
 * 签到、不想自动派猫，或反过来。合成一张卡会让「关掉旅行」变成「关掉签到」
 * 的副作用（参考项目也是两套开关与时刻）。
 *
 * ── 时刻怎么编 ──────────────────────────────────────────────
 * 用逗号分隔的 `HH:MM` 列表（缺省 `09:00, 21:00`）：早上派出、晚上领奖。
 * 保存时后端归一化（排序去重、校验范围），界面以后端返回为准。
 */
function TravelPanel({
  travel,
  saving,
  running,
}: {
  travel?: TravelScheduleState
  saving: boolean
  running: boolean
}): React.ReactElement {
  const enabled = travel?.enabled === true
  const times = Array.isArray(travel?.times) ? travel!.times : []
  const fired = new Set(Array.isArray(travel?.firedToday) ? travel!.firedToday : [])
  const [draft, setDraft] = React.useState<string | null>(null)
  const text = draft ?? times.join(', ')
  const dirty = draft !== null && draft.replace(/\s+/g, '') !== times.join(',')
  const last = travel?.lastResult
  const actions = Array.isArray(last?.actions) ? last!.actions! : []
  const submit = (): void => {
    const list = text
      .split(/[,，\s]+/)
      .map(item => item.trim())
      .filter(Boolean)
    void saveTravelSchedule({ times: list }).then(() => setDraft(null))
  }
  return (
    <section className='panel'>
      <div className='panel-head'>
        <h2>{t('猫猫旅行定时排程')}</h2>
        <span
          className='tip-q'
          data-tip={t(
            '每天按这里的时刻自动巡检一遍 WorkBuddy 国内版账号：没有猫就领养、在家就派出、到站就领奖。一趟只推进一步，所以建议留两个时刻（早上派出、晚上领奖）。企业版与国际版账号自动跳过。',
          )}
        ></span>
        <span className='panel-sub'>{t('每天定点巡检 · 一趟推进一步 · 与签到排程互相独立')}</span>
        <Button
          size='sm'
          variant='outline'
          className='ml-auto flex-none'
          disabled={running}
          onClick={() => void runTravelScheduleNow()}
        >
          {running ? t('巡检中…') : t('立即巡检全部')}
        </Button>
      </div>
      <div className='p-4'>
        <div className='ck-set-line'>
          <span className='ck-set-k'>{t('开关')}</span>
          <span className='ck-set-v flex items-center gap-2'>
            <Switch
              checked={enabled}
              disabled={saving}
              onCheckedChange={next => void saveTravelSchedule({ enabled: next === true })}
            />
            <span className='text-subtle text-xs'>
              {enabled ? t('开着：按下面的时刻自动巡检') : t('关着：不自动巡检（仍可手动巡检）')}
            </span>
          </span>
        </div>
        <div className='ck-set-line'>
          <span className='ck-set-k'>{t('时刻')}</span>
          <span className='ck-set-v flex items-center gap-2'>
            <Input
              value={text}
              disabled={saving}
              placeholder='09:00, 21:00'
              onChange={event => setDraft(event.target.value)}
            />
            <Button size='sm' variant='outline' disabled={!dirty || saving} onClick={submit}>
              {t('保存')}
            </Button>
          </span>
        </div>
        <div className='ck-fold-note'>
          {t('北京时间 · 逗号分隔 · 最多 6 条 · 到点后最多晚 30 秒执行；错过时点开机后会补跑一轮。')}
          {fired.size > 0
            ? ` ${t('今天已执行：{list}', { list: Array.from(fired).join(' / ') })}`
            : ''}
        </div>
        {last && actions.length > 0 ? (
          <div className='ck-fold-note'>
            {t('上一轮（{time}）：{n} 个动作，+{credit} 积分', {
              time: last.at ? formatTime(Number(last.at)) : '',
              n: actions.length,
              credit: Number(last.credit) || 0,
            })}
            {actions
              .slice(0, 6)
              .map(action => ` · ${action.name ?? action.accountId ?? ''}: ${action.message ?? action.outcome ?? ''}`)
              .join('')}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export { ScheduleTab }
