import { Alert, AlertDescription } from '@ui'
import { InfoTip } from '../components/info-tip'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  cn,
  SelectGroup,
  Badge,
  BadgeDot,
  Button,
  Checkbox,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@ui'
import { t } from '../i18n'
import { WorkbuddyTaskCenter } from './workbuddy-task-center'
import { Empty, EmptyHeader, EmptyDescription } from '@ui'

/**
 * 定时任务面板（间隔型任务）—— 本项目的第一个**面板岛**。
 *
 * 替换的是 ui/tasks-panel.js（那份用 innerHTML 拼 .task-item / .badge 那套老类名、
 * 事件走容器委托）。对外接口与原实现**完全一致**：`window.wbTasksPanel.load()`，
 * 调用点只有 ui/app.js 切到本页时的那一处，调用方一行都不用改。
 *
 * ── 与弹窗岛的差别：面板岛接管 index.html 里既有的页面区块 ──────────
 * 弹窗岛是自己建宿主挂到 body；本岛找到 `<section class="page" data-page="tasks">`，
 * 清空它的子节点后把 React root 直接建在**这个 section 上**，由本文件的 JSX 把面板
 * 骨架（.panel / .panel-head / .panel-body / .panel-foot）连同卡片一起渲染出来。
 *   · 为什么不套一层宿主 div：页面 CSS 里 `.page[data-page="tasks"] .panel` 那组声明
 *     （见 ui/css/layout.css）按「.panel 是 .page 的子元素」定高度分配 —— 面板要吃掉
 *     整页高度、滚动只发生在 .task-list 上。中间插一层宿主盒子会打断这条链。
 *   · 为什么 React 接管子节点是安全的：app.js 的 showPage 只在这个 section 上切
 *     class（active），从不碰它的子节点，两边不会抢同一个 DOM。
 *
 * ── 边界：页面布局类名照旧，控件换成组件库 ────────────────────────
 * `.panel` / `.panel-head` / `.head-actions` / `.task-list` / `.task-grid` /
 * `.task-item` / `.task-main` / `.task-title` / `.task-state` / `.task-actions` /
 * `.task-interval` / `.task-providers` / `.log-empty` 全部保留（样式在
 * ui/css/page-tasks.css）—— 布局不是「组件」，换成 Tailwind 会让这一页与其它页
 * 长得不一样。里面的**控件**一律换成 @ui：button → Button、.badge → Badge、
 * 开关 → Switch、复选框 → Checkbox、数字 / 时刻输入 → Input。
 *
 * ── 这一页管什么（接口只有一组）──────────────────────────────
 *   · **间隔型**（凭证自动维护 / 模型目录刷新 /
 *     日志页自动刷新 / 请求日志自动刷新 / 报表自动刷新）
 *     —— 形状统一：`{enabled, interval}`，走 /api/scheduled-tasks。
 *     「软件版本检查」也是间隔型、也走同一组接口，但它的配置入口收进了
 *     「更新设置」弹窗（update-settings.tsx）—— 那一行在本页过滤掉（见
 *     HIDDEN_TASK_IDS），后端的定时执行不受影响。
 *   · **成长任务** —— 手动触发的扫描 → 队列执行 → 进度轮询三段交互，
 *     走 /api/growth-tasks/*（GET scan / POST run / GET queue / POST stop），
 *     只覆盖国内版 WorkBuddy 账号；卡片**常驻**、整行铺开放在列表末尾（empty 分支
 *     也渲染，后端不可达时卡内降级——见 growthCard）。
 *     它的四个接口在桥里没有具名方法，直连 api_request 壳命令（见 growthApi）。
 *   · `runner: "frontend"` 的三条（日志页 / 请求日志页 / 报表页自动刷新）执行者是
 *     **页面自己**，所以它们没有「上次执行 / 下次执行」，也不给「立即执行」按钮 ——
 *     按钮点了也没有任何东西可跑；改完配置由本文件推给那三个面板（见 pushAutoRefresh）。
 *   · **自动签到曾是本页的一条卡片**，已迁到「签到中心」（checkin-page.tsx）——
 *     签到的执行、范围、历史与设置从此只有那一个出处；两边的接口形状本来就不同
 *     （定点 vs 间隔），拆开之后本页只剩 /api/scheduled-tasks 一组。
 *
 * ── 旧实现刻意保留的交互：结构没变时只就地更新每张卡的值 ──────────
 * 整块重建会让正在编辑的间隔输入框丢焦点、正在输入的数字被冲掉。React 里同一 id
 * 的卡片由 key 协调、DOM 不重建，焦点天然保住；但**受控输入**还有第二重风险：
 * 轮询回来的外部值会把用户敲到一半的内容覆盖掉。旧实现靠「只更新未聚焦的输入」
 * 解决，这里用等价手法：输入框在编辑期间由本地草稿（intervalDrafts）接管 value，
 * 外部值只在草稿为空（= 用户没在编辑）时才写进去 —— 于是间隔走「失焦或回车才
 * 提交」，开关这类瞬时动作则立即存（见 submitInterval）。
 */

/* ─── 类型 ─────────────────────────────────── */

/**
 * 一条间隔型任务（GET /api/scheduled-tasks 的 tasks[]）。
 * 字段与后端 task_json 一一对应；单位 / 上下限 / 默认值都由后端下发，前端不抄一份。
 */
type IntervalTask = {
  id: string
  label: string
  /** 说明文案（问号 tooltip 的内容），后端随任务下发 */
  description: string
  /** 'seconds' | 'minutes' */
  unit: string
  /** 'backend'（后端循环执行）| 'frontend'（页面自己的定时器执行） */
  runner: string
  enabled: boolean
  interval: number
  min: number
  max: number
  defaultInterval: number
  running: boolean
  lastRunAt: number | null
  lastResult: string | null
  /**
   * 上次执行失败的原因（成功时后端写 null）。「上次失败」徽标按它判定：
   * `lastResult` 在成功 / 失败两条路径上都会写摘要（成功摘要里也有「失败 N 个」），
   * 拿它判定会把成功误报成失败 —— 失败标记是 `lastError`（core::task_state 的
   * RunGuard::finish 失败路径写它、成功路径清空它）。
   */
  lastError?: string | null
  /** 失败冷却的到期时刻（仅后端任务） */
  retryAt: number | null
  nextRunAt: number | null
  /** 能不能「立即执行」：后端按 runner 算好，前端不猜 */
  canRun: boolean
}

/**
 * 本岛用到的后端桥（间隔型任务一组；自动签到的 /api/auto-checkin 已随那张卡片
 * 迁到签到中心，见 checkin-page.tsx）
 */
/**
 * 扫描结果里的一条成长任务（GET /api/growth-tasks/scan 的 results[].tasks[]）。
 * 字段与后端契约一一对应：`current/target` 是任务进度（target 缺失 = 无进度概念），
 * `claimed / claimable / locked` 三个互斥的状态位由后端按上游实况下发，前端不猜。
 */
type GrowthTask = {
  /** 上游任务码（队列明细按它回对到中文任务名） */
  code: string
  /** 中文任务名（后端翻译好的，前端不再抄一份映射表） */
  label?: string
  rewardCredit?: number
  rewardEnergy?: number
  claimed?: boolean
  claimable?: boolean
  locked?: boolean
  current?: number
  target?: number
}

/** 扫描结果里的一个账号分组（results[]：只含国内版 WorkBuddy 账号，后端已筛过） */
type GrowthAccountScan = {
  id?: string
  name?: string
  tasks?: GrowthTask[]
}

/** GET /api/growth-tasks/scan 的响应 */
type GrowthScanResult = {
  results?: GrowthAccountScan[]
  scannedAt?: number
}

/** 队列明细里的一条（GET /api/growth-tasks/queue 的 items[]）：账号 × 任务 × 状态 */
type GrowthQueueItem = {
  accountId?: string
  accountName?: string
  taskCode?: string
  status?: 'pending' | 'running' | 'ok' | 'failed' | 'skipped'
  message?: string | null
}

/** GET /api/growth-tasks/queue 的响应（3 秒轮询它） */
type GrowthQueueState = {
  running?: boolean
  total?: number
  done?: number
  items?: GrowthQueueItem[]
}

/** POST /api/growth-tasks/run 的响应 */
type GrowthRunResult = {
  started?: boolean
  total?: number
}

/** 本岛用到的后端桥（两组接口，见文件头） */
type TasksBridge = {
  /** GET /api/scheduled-tasks */
  getScheduledTasks(): Promise<{ tasks?: IntervalTask[] } | null | undefined>
  /** PATCH /api/scheduled-tasks/{id}，响应是改完的那条任务 */
  saveScheduledTask(id: string, patch: Record<string, unknown>): Promise<IntervalTask>
  /** POST /api/scheduled-tasks/{id}/run，响应带刷新后的那条任务 */
  runScheduledTask(
    id: string,
  ): Promise<{ task?: IntervalTask; summary?: string } | null | undefined>
}

/** 壳的原始 IPC 形状（与 logs-panel.tsx / add-account-bridge.ts 的直连同款） */
type TauriInternals = { invoke?: (command: string, args: unknown) => Promise<unknown> }

/**
 * window 上由其它脚本 / 其它岛挂载的共享桥。
 *
 * 刻意用「局部窄类型 + 转型」而不是 declare global 往 Window 上加属性：
 * workbuddyDesktop / wbApp / wbLogsPanel 这些是多个岛共用的桥，若每个岛各
 * declare 一份，接口合并会因同名属性类型不一致直接报 TS2717 —— 并行迁移时
 * 必然互相撞车。本文件只声明自己独占的 wbTasksPanel（见文件末尾）。
 */
type SharedWindow = {
  workbuddyDesktop?: TasksBridge
  /**
   * 壳的原始 IPC（logs-panel / add-account-bridge 的直连同款）：成长任务的四个接口
   * （/api/growth-tasks/*）在桥里没有具名方法，只能直连 —— 见 growthApi 的说明。
   */
  __TAURI_INTERNALS__?: TauriInternals
  wbApp?: {
    toast?: (message: string, kind?: 'err' | 'ok') => void
    /** 主状态刷新（签到会改积分，跑完顺带刷一次账号页） */
    refresh?: () => Promise<void> | void
    /** 顶栏状态区重画：本页徽标是顶栏那枚的镜像，重绘完让它跟上 */
    renderTopbarStatus?: () => void
    /** 当前页标识：自动同步只在「用户正看着本页」时打后端 */
    readonly currentPage?: string
  }
  wbLogsPanel?: {
    /** 跳转入口：预设分类并切到日志页 */
    showCategory?: (category: string) => unknown
    applyAutoRefresh?: (task: IntervalTask | null) => unknown
  }
  wbRequestsPanel?: { applyAutoRefresh?: (task: IntervalTask | null) => unknown }
  wbReport?: { applyAutoRefresh?: (task: IntervalTask | null) => unknown }
  wbAccountsView?: {
    syncBalancesSnapshot?: () => unknown
  }
}

function shared(): SharedWindow {
  return window as unknown as SharedWindow
}

/* ─── 常量 ─────────────────────────────────── */

/**
 * 本页**不渲染**的任务 id：软件版本检查（后端 `config::KEY_UPDATE_CHECK`）。
 *
 * 任务本身还在后端注册表里照常跑（到期自动查 GitHub、状态与冷却照旧落库），
 * 只是开关与间隔的配置入口收进了「软件更新」面板的「更新设置」弹窗 ——
 * 和版本相关的设置收在一个地方。本页在 load 与 sync 两个数据入口统一过滤，
 * 卡片、计数、徽标因此都不看它。
 */
const HIDDEN_TASK_IDS: ReadonlySet<string> = new Set(['updateCheck'])

/** 数据入口统一过滤：本页不渲染的任务不进状态（卡片 / 计数 / 徽标因此都不看它） */
function filterVisibleTasks(list: { tasks?: IntervalTask[] } | null | undefined): IntervalTask[] {
  const tasks = Array.isArray(list?.tasks) ? list.tasks : []
  return tasks.filter(task => !HIDDEN_TASK_IDS.has(task.id))
}

/** 页面可见时的自动同步间隔：与 app.js 的主状态轮询同频，页面不可见时不跑 */
const SYNC_MS = 20_000

/**
 * 「下次执行」倒计时的重算间隔：本页一条**共享**的 30 秒心跳推进一个 `now`，
 * 所有卡片上的相对时间（倒计时 / 冷却）随它一起重算 —— 不是每条任务各挂一个
 * 定时器。它只重算文案，不发任何请求；页面隐藏时整条停掉（见组件里的 effect）。
 */
const COUNTDOWN_MS = 30_000

/**
 * 整行铺开的卡片条数：凭证自动维护（清单的第一条）。
 * 其余卡片裹进 `.task-grid` 两栏（行优先逐行配对，见 page-tasks.css 的说明）。
 * 自动签到曾占第一条的位置，迁到签到中心后这里只剩它。
 */
const LEAD_CARDS = 1

/** 列表里两段文字之间的分隔符（全角空格 + 间隔号），与旧实现逐字一致 */
const SEP = '　·　'

/* ─── 成长任务（第三组接口，见 GrowthTask 的类型注释）────────── */

/** 成长任务队列的轮询间隔：执行中每 3 秒拉一次 /api/growth-tasks/queue */
const GROWTH_POLL_MS = 3_000

/**
 * 执行完成后、静默重扫前的延时：与完成 toast 错开一拍（不同帧抢渲染），也让后端把
 * 队列收尾落定——running 刚翻 false 的瞬间立刻扫，读到的可能还是收尾前的上游状态。
 */
const GROWTH_RESCAN_DELAY_MS = 1_000

/** 并发档位（1-4）：后端只认这个范围，界面照抄一遍，不自己算 */
const GROWTH_CONCURRENCIES = ['1', '2', '3', '4']

/** 成长任务卡的说明行（要求文案）：与「仅国内版」这条边界一起放在卡头常驻 */
const GROWTH_DESC = '一键完成 WorkBuddy 国内版账号的成长任务：纯上报类零对话消耗；仅国内版账号。'

/** 成长任务卡的问号 tooltip：说明行放不下的执行细节都收在这里 */
const GROWTH_TIP =
  '先「扫描待办」拉取每个国内版账号还没完成的成长任务，再「执行全部待办」排队执行：' +
  '账号之间按选择的并发数并行，账号内串行。纯上报类任务零对话消耗，含真实对话的任务耗时较长。' +
  '执行中可点「停止」，已排到的剩余任务会退出队列。国际版账号没有成长任务，不参与扫描。'

/** 成长任务在界面上的 id：它不是间隔型任务，但要有 data-task 锚点（与 CHECKIN_ID 同理） */
const GROWTH_ID = 'growthTasks'

/**
 * 一条成长任务的状态归一：后端下发的是三个互斥的状态位
 * （claimed 已领 / locked 锁定 / claimable 可办），三者皆否 = 进行中
 * （current/target 是它的进度）。展示与「待办数」统计都从这里取，不散落判断。
 */
type GrowthTaskState = 'claimed' | 'claimable' | 'locked' | 'progress'

function growthTaskState(task: GrowthTask): GrowthTaskState {
  if (task.claimed) return 'claimed'
  if (task.locked) return 'locked'
  if (task.claimable) return 'claimable'
  return 'progress'
}

/** 状态 → 徽章（Badge 的 variant 档 + 中文词）：可办用 brand 档点亮，是「能做」的语义色 */
const GROWTH_STATE_BADGE: Record<GrowthTaskState, { text: string; variant: 'success' | 'brand' | 'outline' }> = {
  claimed: { text: '已领', variant: 'success' },
  claimable: { text: '可办', variant: 'brand' },
  locked: { text: '锁定', variant: 'outline' },
  progress: { text: '进行中', variant: 'outline' },
}

/** 队列明细的状态 → 徽章：与参考实现的 ST_WORDS 同一份词表（pending 之外的都算终态） */
const GROWTH_ITEM_BADGE: Record<
  string,
  { text: string; variant: 'success' | 'warning' | 'destructive' | 'outline' | 'ghost' }
> = {
  ok: { text: '完成', variant: 'success' },
  failed: { text: '失败', variant: 'destructive' },
  skipped: { text: '跳过', variant: 'ghost' },
  pending: { text: '排队', variant: 'outline' },
  running: { text: '执行中', variant: 'warning' },
}

/** 一条任务的奖励文案：只显示非零的那一档，两档都有时并列（+5 积分　+2 能量） */
function growthRewardText(task: GrowthTask): string {
  const parts: string[] = []
  const credit = Number(task.rewardCredit) || 0
  const energy = Number(task.rewardEnergy) || 0
  if (credit) parts.push(`+${credit} 积分`)
  if (energy) parts.push(`+${energy} 能量`)
  return parts.join('　')
}

/* ─── 工具 ─────────────────────────────────── */

/** 脚注 / toast 的统一出口（运行期读 wbApp，不在模块顶层解构） */
function toast(message: string, kind?: 'err' | 'ok') {
  shared().wbApp?.toast?.(message, kind)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 成长任务接口的统一调用（直连 api_request 壳命令）。
 *
 * 桥里没有这组具名方法（bridge.rs 的方法表是壳的产物，本岛的改动约定只落在这一个
 * tsx 文件里），所以走 `__TAURI_INTERNALS__` 直连 —— 日志页审计视图 / 添加账号弹窗的
 * 同款做法；网页端 shim 也装了同名对象，两端通用。返回的是拆掉信封后的 data；
 * 非 2xx（含 409「已在跑」）会被壳归一成 rejection —— rejection 值可能是裸字符串
 * （桌面端直连没走桥的 asError），一律经 errorMessage() 取文案。
 */
async function growthApi<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const internals = shared().__TAURI_INTERNALS__
  if (!internals || typeof internals.invoke !== 'function') {
    throw new Error('桌面运行时不可用（Tauri 未初始化）')
  }
  const result = await internals.invoke('api_request', {
    request: { method, path, body: body === undefined ? null : body },
  })
  return (result ?? null) as T
}

/** 间隔单位的展示名：单位由后端给定（'seconds' | 'minutes'），前端不自己猜 */
function unitLabel(unit: string): string {
  return unit === 'seconds' ? t('秒') : t('分钟')
}

/** 把毫秒时间戳化成「时:分:秒」，供上次 / 下次执行展示 */
function clockOf(value: unknown): string {
  const ms = Number(value) || 0
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * 「下次执行」的相对说法：比只给一个时刻更有用（用户关心的是还有多久）。
 *
 * `now` 由调用方传入（面板的 30 秒心跳推进它）而不是自己取 Date.now()：
 * 同一次渲染里所有行的倒计时用同一个基准，重算也只发生在心跳上。
 * 分钟以上是四舍五入的约数，按口径加「约」；秒级是确切剩余量，不加。
 */
function describeNext(value: unknown, now: number): string {
  const ms = Number(value) || 0
  if (!ms) return ''
  const diff = ms - now
  if (diff <= 0) return t('即将执行')
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return t('{n} 秒后', { n: seconds })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('{n} 分钟后', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{n} 小时后', { n: hours })
  return t('{n} 天后', { n: Math.round(hours / 24) })
}

/**
 * 「每天 HH:mm」的下一次触发时刻（签到排期字段缺失时的估算基准）：
 * 今天还没到就取今天，过了就取明天。解析不出时刻返回 0（调用方再往下降级）。
 */
function nextDailyAt(hhmm: string, now: number): number {
  const [hours, minutes] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  const next = new Date(now)
  next.setHours(hours, minutes, 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 1)
  return next.getTime()
}

/**
 * 间隔型任务的运行状态一行。
 *
 * ── 文案取的是旧实现 `updateTask()` 那一份，不是 `taskCard()` 模板那一份 ──
 * 两份在旧文件里就不一致：模板写「本次启动后还未执行」，就地更新写「还没有执行记录」，
 * 而排期与上次执行都跨重启保留（后端落库），所以「本次启动后」是过时说法 ——
 * updateTask 的注释也这么说。这里统一取后者（用户停留 20 秒后本来就会看到的那份），
 * 并补上模板漏掉的「失败冷却」行（那是用户唯一能看出「为什么一直没跑」的地方）。
 *
 * 「下次执行」不再拼进这一行：它升级成了每张卡自己的一行小字（见 taskNextRun，
 * 带倒计时与「上次失败」徽标），留在这里会把同一件事说两遍。
 */
function taskStateText(task: IntervalTask, now: number): string {
  const backend = task.runner === 'backend'
  const lines: string[] = []
  if (task.lastRunAt) {
    const at = clockOf(task.lastRunAt)
    // 上次执行的结果原文是后端数据，包进 {result} 形参、不翻译
    lines.push(task.lastResult
      ? t('上次执行 {time}（{result}）', { time: at, result: task.lastResult })
      : t('上次执行 {time}', { time: at }))
  } else {
    lines.push(backend ? t('还没有执行记录') : t('由页面按间隔自动刷新'))
  }
  if (backend && task.enabled && task.nextRunAt) {
    lines.push(t('下次执行 {time}（{relative}）', {
      time: clockOf(task.nextRunAt),
      relative: describeNext(task.nextRunAt, now),
    }))
  }
  if (backend && task.retryAt && task.retryAt > Date.now()) {
    lines.push(t('冷却中，{relative}重试', { relative: describeNext(task.retryAt, now) }))
  }
  return lines.join(SEP)
}

/* ─── 「下次执行」一行 ─────────────────────── */

/** 「下次执行」一行的内容：文案，外加要不要挂「上次失败」徽标 */
type NextRunInfo = {
  /** 空字符串 = 这张卡不画这一行（签到设置读不到时整卡已降级，不再重复说明） */
  text: string
  /** 上次执行失败：文案旁挂一枚「上次失败」小徽标（组件库里 --warn 档） */
  failed: boolean
  /** 已停用：整行灰字，不显示倒计时也不挂徽标 */
  disabled: boolean
}

/**
 * 间隔型任务的「下次执行」一行（随 30 秒心跳用新的 `now` 重算相对说法）。
 *
 * ── 数据口径 ──────────────────────────────────────────────
 *   - **确切排期优先**：后端任务开启时 /api/scheduled-tasks 下发确切的
 *     `nextRunAt`（core::scheduled_tasks 的 task_json，已把失败冷却与在途
 *     占位一并 max 进去），显示绝对时刻 + 相对倒计时；
 *   - **字段缺失才估算**：按「上次执行 + 间隔」推算并在文案注明——它没算上
 *     失败冷却，只能当参考；
 *   - **前端任务不编时刻**：三条页面自动刷新的执行者是页面自己的定时器，
 *     只在对应页面打开时才走，排期概念不存在，如实说明；
 *   - **已停用**：按口径只给「已停用」灰字。
 *
 * 「上次失败」按 `lastError` 判定（见 IntervalTask 上的注释：`lastResult`
 * 成功失败都写摘要，不能当判定字段）。
 */
function taskNextRun(task: IntervalTask, now: number): NextRunInfo {
  if (!task.enabled) return { text: '已停用', failed: false, disabled: true }
  const failed = typeof task.lastError === 'string' && task.lastError.trim() !== ''
  if (task.runner !== 'backend') {
    return { text: '下次执行 由所在页面按间隔刷新（无固定时刻）', failed: false, disabled: false }
  }
  const next = Number(task.nextRunAt) || 0
  if (next) {
    return { text: `下次执行 ${clockOf(next)}（${describeNext(next, now)}）`, failed, disabled: false }
  }
  const last = Number(task.lastRunAt) || 0
  const step = (Number(task.interval) || 0) * (task.unit === 'seconds' ? 1000 : 60_000)
  if (last && step) {
    return {
      text: `下次执行 ${describeNext(last + step, now)}（按上次执行与间隔估算）`,
      failed,
      disabled: false,
    }
  }
  return { text: '下次执行 未知（后端未返回排期）', failed, disabled: false }
}

/**
 * 自动签到的「下次执行」一行。口径同 taskNextRun：开启时后端下发确切的
 * `nextRunAt`（auto_checkin::state 按触发时刻算好的绝对时刻）；缺失才按
 * 「每天 HH:mm」推下一次并注明估算。上次失败按 `lastResult.failedCount`
 * 判定（部分账号失败也算 —— 与「立即签到」完成后的失败 toast 同一口径）。
 */

/**
 * 「下次执行」小字行的渲染：复用 `.task-state` 的排版（弱化色小字 + 等宽数字，
 * 样式在 page-tasks.css）—— 它与上一行运行状态是同一档信息，不另起一套样式；
 * 颜色随 tokens 变量走，深浅主题自动成立。「上次失败」徽标取组件库的 warning
 * 档（与旧 `.badge.warn` 同一语义色，浅深两套取值同 ui/css/tokens.css 的
 * `--warn` 那组），tag 形态比标题行的胶囊徽章小一号，贴在倒计时旁边不撑行。
 */
function nextRunLine(info: NextRunInfo) {
  if (!info.text) return null
  return (
    <div className='task-state'>
      {info.text}
      {info.failed ? (
        <Badge variant='warning' shape='tag' className='ml-[6px] align-middle'>
          上次失败
        </Badge>
      ) : null}
    </div>
  )
}

/**
 * 间隔提交前的本地校验：与后端同一范围（范围由后端随任务下发，两边不会漂）。
 * 旧实现同样在前端先挡一道 —— 让「越界」在失焦那一刻就说清楚，而不是等一个 400。
 */
function parseInterval(
  task: IntervalTask,
  raw: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const text = String(raw ?? '').trim()
  const unit = unitLabel(task.unit)
  if (!text) {
    return { ok: false, message: t('间隔不能为空（可填 {min}–{max} {unit}）', { min: task.min, max: task.max, unit }) }
  }
  if (!/^\d+$/.test(text)) return { ok: false, message: t('间隔必须是整数') }
  const value = Number(text)
  if (value < task.min || value > task.max) {
    return {
      ok: false,
      message: t('间隔必须在 {min}–{max} {unit} 之间（当前填的是 {value}）', {
        min: task.min,
        max: task.max,
        unit,
        value: text,
      }),
    }
  }
  return { ok: true, value }
}

/**
 * 把三条**前端**任务的配置推给执行者（日志页 / 请求日志页 / 报表页的定时器）。
 *
 * 只有这三条需要推：后端任务由后端的循环自己读配置（下一轮生效），而前端页面的
 * 定时器长在各自的模块里，改完得有人告诉它们。
 *
 * 走可选链：那几个面板可能还没加载（加载顺序上本岛排在它们之后，所以正常都就绪；
 * 但万一脚本加载失败，这里不该抛错把保存流程带崩）。它们在启动时也会自读一次
 * 配置，所以推失败不会留下不一致。
 */
function pushAutoRefresh(task: IntervalTask) {
  const bridge = shared()
  if (task.id === 'logsAutoRefresh') bridge.wbLogsPanel?.applyAutoRefresh?.(task)
  else if (task.id === 'requestsAutoRefresh') bridge.wbRequestsPanel?.applyAutoRefresh?.(task)
  else if (task.id === 'reportAutoRefresh') bridge.wbReport?.applyAutoRefresh?.(task)
}

/* ─── 模块级状态（跨渲染的守卫与入口登记）────────── */

/**
 * 「全局一次只干一件事」的互斥锁（旧实现的 panelBusy）。
 *
 * 刻意放在模块级而不是组件 state：它必须在事件回调里被**同步**读到 —— 同一次
 * 交互里的第二下、轮询与保存撞车，都靠它早退。state 的更新是异步的，晚一拍就会
 * 放过去。本页只有一个实例，所以模块级变量不会串台。
 */
let panelBusy = false

/** 面板挂载后登记的加载函数：window.wbTasksPanel.load 与首屏自持加载都经它转发 */
let runLoad: (() => Promise<void>) | null = null
/** 组件挂载完成前就被调用的 load()：记一笔，挂载后立刻补发（见文件末尾） */
let loadBeforeMount = false

/** 对外契约：app.js 切到本页时调 load() */
async function load() {
  if (!runLoad) {
    loadBeforeMount = true
    return
  }
  await runLoad()
}

/* ─── 面板本体 ───────────────────────────────── */

function TasksPanel() {
  /** 最近一次拉到的间隔型任务清单 */
  const [tasks, setTasks] = React.useState<IntervalTask[]>([])
  /**
   * 是否已经成功拉到过数据。
   * 用来区分「还在加载」与「加载失败」—— 两者都是 tasks 空，
   * 只看数据会把「后端不可用」显示成永远转不完的「正在加载…」。
   */
  const [loaded, setLoaded] = React.useState(false)
  /** 正在「立即执行」的那条任务 id（按钮文案切「执行中…」；同时只可能有一条） */
  const [runningId, setRunningId] = React.useState<string | null>(null)
  /**
   * 间隔输入框的编辑草稿：有值 = 用户正在编辑，value 以它为准（不被轮询冲掉）。
   * 提交（失焦 / 回车）后清掉，于是重新跟随后端值 —— 与旧实现
   * 「document.activeElement !== interval 时才回填」等价。
   */
  const [intervalDrafts, setIntervalDrafts] = React.useState<Record<string, string | undefined>>({})

  /* ─── 成长任务的状态（与上面两组互不干扰：它不进 panelBusy 互斥，理由见 scanGrowth）── */

  /** 最近一次扫描结果（逐账号分组）；空数组 + growthScanned=false = 还没扫描过 */
  const [growthResults, setGrowthResults] = React.useState<GrowthAccountScan[]>([])
  /** 最近一次扫描的时刻（展示「上次扫描 HH:MM:SS」用；后端缺 scannedAt 时落到本地扫描时刻） */
  const [growthScannedAt, setGrowthScannedAt] = React.useState(0)
  /** 是否成功扫描过：区分「没扫过」与「扫过了但没有待办」两种空态 */
  const [growthScanned, setGrowthScanned] = React.useState(false)
  /** 正在扫描（按钮切「扫描中…」，扫描要走完所有账号，可能好几秒） */
  const [growthScanning, setGrowthScanning] = React.useState(false)
  /** 正在启动队列（按钮切「启动中…」，挡住第二下点击） */
  const [growthStarting, setGrowthStarting] = React.useState(false)
  /** 最近一次拉到的队列状态（null = 本会话还没拉到过）；running 时驱动进度条与 3 秒轮询 */
  const [growthQueue, setGrowthQueue] = React.useState<GrowthQueueState | null>(null)
  /** 并发档位（1-4 的字符串，Select 的 value 是字符串；提交时才转数字） */
  const [growthConcurrency, setGrowthConcurrency] = React.useState('1')
  /**
   * 最近一次扫描失败的文案（成功即清）：卡内错误行 + 重试按钮的数据源。
   * 本卡是常驻区（不依赖间隔型/签到两组接口的成功与否），后端不可达时错误落在卡内
   * 而不是只闪一条 toast——入口在，失败也可感知、可重试。
   */
  const [growthScanError, setGrowthScanError] = React.useState<string | null>(null)
  /**
   * 拉队列失败的文案（成功即清）。展示上有意收窄：只在「手上还没有任何队列数据」时
   * 显示（进页那次接管拉取就失败 = 后端不可达，卡内给错误行 + 重试）；已有数据后的
   * 轮询失败保持静默——3 秒后下一拍自会重试，执行中每拍闪一条错误只会轰炸。
   */
  const [growthQueueError, setGrowthQueueError] = React.useState<string | null>(null)

  /** 队列是否在执行：进度条、轮询、按钮禁用、停止按钮的显隐都从这一个判定出发 */
  const growthRunning = growthQueue?.running === true

  /**
   * 拉一次成长任务队列状态（3 秒轮询与「进页接管道」共用）。
   * 失败不弹 toast：记进 growthQueueError（卡内按上面的口径决定显不显示），下一轮
   * 轮询自然会重试，弹 toast 只会轰炸。
   */
  const pollGrowthQueue = React.useCallback(async () => {
    try {
      setGrowthQueue(await growthApi<GrowthQueueState>('GET', '/api/growth-tasks/queue'))
      setGrowthQueueError(null)
    } catch (error) {
      setGrowthQueueError(errorMessage(error))
    }
  }, [])

  function clearIntervalDraft(id: string) {
    setIntervalDrafts(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  /* ─── 加载与同步 ─────────────────────────── */

  /**
   * 拉一次清单（结构与数据都更新）。
   *
   * 外层 catch 兜的是这一路失败：置 loaded = true 后显示「后端未返回任务清单」
   * 的失败说明，而不是永远停在加载中。
   */
  const loadPanel = React.useCallback(async () => {
    const api = shared().workbuddyDesktop
    // 成长任务的队列状态顺带拉一次（轻 GET、自带静默失败）：队列可能在本岛之外
    // 启动过（上次执行没跑完 / 别的入口触发），用户一进本页就把「执行中」接过来
    // —— 与参考实现的 reattachQueueView 同一意图。失败不影响下面两组数据的加载。
    void pollGrowthQueue()
    try {
      if (!api) throw new Error(t('后端桥不可用'))
      const list = await api.getScheduledTasks()
      setTasks(filterVisibleTasks(list))
      setLoaded(true)
    } catch (error) {
      console.warn('读取定时任务失败:', errorMessage(error))
      setTasks([])
      setLoaded(true) // 标记「尝试过了」，于是空态显示成失败说明而不是加载中
    }
  }, [pollGrowthQueue])

  /**
   * 静默同步：只更新数据，不动结构（结构变化由 React 的 key 协调消化）。
   *
   * 每 20 秒一次，跟随 app.js 的主状态轮询节奏；页面不可见、用户不在本页、
   * 或正有一次保存 / 执行在飞时不请求（旧实现同一套早退条件）。
   * 失败一律静默：下一次同步自然会重试，不必打扰正在看页面的人。
   */
  const sync = React.useCallback(async () => {
    if (panelBusy || document.hidden || shared().wbApp?.currentPage !== 'tasks') return
    const api = shared().workbuddyDesktop
    if (!api) return
    try {
      const list = await api.getScheduledTasks()
      setTasks(filterVisibleTasks(list))
    } catch (error) {
      console.warn('同步定时任务状态失败:', errorMessage(error))
    }
  }, [])

  /** 起轮询：组件挂载即开始，卸载时清表（见下面的 effect） */
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void sync()
    }, SYNC_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [sync])

  /**
   * 「下次执行」倒计时的心跳：一条共享的 30 秒 interval 推 `now` 前进，
   * 页面上所有相对时间随它一起重算 —— 不是每条任务各挂一个定时器。
   * 纯前端重算，不发任何请求；页面隐藏时把 interval 停掉（省电也免得
   * 白算），回到前台先立即重算一次再重启，不必等下一个 30 秒才追上。
   */
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    let timer: number | null = null
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const start = () => {
      if (timer === null && !document.hidden) {
        timer = window.setInterval(() => setNow(Date.now()), COUNTDOWN_MS)
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
        return
      }
      setNow(Date.now())
      start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  /** 顶栏那块是本页徽标的镜像（app.js 的 renderTopbarStatus 读 #tasks-badge）：
   *  数据一更新就让它跟上，否则要等下一次主状态轮询（20 秒）才同步。 */
  React.useEffect(() => {
    shared().wbApp?.renderTopbarStatus?.()
  }, [tasks, loaded])

  /** 把加载函数登记给模块级的 load()；顺带补发「挂载前就来的那次加载」 */
  React.useEffect(() => {
    runLoad = loadPanel
    if (loadBeforeMount) {
      loadBeforeMount = false
      void loadPanel()
    }
    return () => {
      runLoad = null
    }
  }, [loadPanel])

  /* ─── 成长任务：轮询与完成汇报 ─────────────── */

  /**
   * 执行中的 3 秒轮询：growthRunning 翻回 false 时本 effect 先清掉定时器再不再重启
   * （依赖数组带 growthRunning，翻假 = 卸载旧 effect = 清表），卸载时同样清掉
   * —— 与上面 20 秒同步那条 effect 同一个写法。
   * 「进页接管道」的第一次拉取在 loadPanel 里（见彼处说明），这里只管执行中的节奏。
   */
  React.useEffect(() => {
    if (!growthRunning) return
    const timer = window.setInterval(() => {
      void pollGrowthQueue()
    }, GROWTH_POLL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [growthRunning, pollGrowthQueue])

  /**
   * 执行结束的 toast 汇总（成功 X 失败 Y）+ 静默重扫。判定用 ref 记上一拍的 running：
   * 只在「从 true 翻到 false」那一次报，之后的每次重渲染都不再重复。
   * 有失败按错误色报（与「立即签到」完成后的失败 toast 同一口径）。
   *
   * 重扫延后一拍（GROWTH_RESCAN_DELAY_MS）再发：既不与完成 toast 同帧抢渲染，也让
   * 后端把队列收尾落定——刚翻 false 就扫，读到的可能还是收尾前的上游状态。重扫成功
   * 后「可办」徽章立即反映执行后的真实状态；失败只落卡内错误行，不弹 toast。
   */
  const growthWasRunningRef = React.useRef(false)
  /**
   * 重扫延时器放 ref 而不是 effect cleanup：完成那一拍之后 growthQueue 若再变
   * （任何 loadPanel 触发的接管拉取都会让它换一个身份），本 effect 重跑不该把
   * 还没到点的重扫清掉——只有卸载才清（见下一条 effect）。
   */
  const growthRescanTimerRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    const finished = growthWasRunningRef.current && !growthRunning && growthQueue
    growthWasRunningRef.current = growthRunning
    if (!finished) return
    const items = Array.isArray(finished.items) ? finished.items : []
    const ok = items.filter(item => item.status === 'ok').length
    const failed = items.filter(item => item.status === 'failed').length
    if (failed) toast(`成长任务执行完成：成功 ${ok} 个，失败 ${failed} 个`, 'err')
    else toast(`✅ 成长任务执行完成：成功 ${ok} 个，失败 ${failed} 个`)
    growthRescanTimerRef.current = window.setTimeout(() => {
      growthRescanTimerRef.current = null
      void rescanGrowthSilently()
    }, GROWTH_RESCAN_DELAY_MS)
  }, [growthQueue, growthRunning])

  /** 卸载时把还没到点的完成重扫清掉：卸载后再 setState 不该发生（fetch 也别白发） */
  React.useEffect(() => {
    return () => {
      if (growthRescanTimerRef.current !== null) {
        window.clearTimeout(growthRescanTimerRef.current)
        growthRescanTimerRef.current = null
      }
    }
  }, [])

  /* ─── 操作：间隔型任务 ───────────────────── */

  /**
   * 保存一条任务。
   *
   * 以接口返回值为准（后端会把非法值夹到范围内并在必要时回落默认值），所以不能
   * 「按前端算的值渲染」—— 那会在后端实际拒绝时显示成已生效。
   * 失败时回滚到后端的真实状态：界面显示的可能是用户刚拨过去的假值。
   *
   * `label` 是 toast 里用的展示名，调用方拼好且已走 t()（任务名是后端下发的展示文案）。
   */
  async function saveTask(id: string, patch: Record<string, unknown>, label: string) {
    if (panelBusy) return
    const api = shared().workbuddyDesktop
    if (!api) return
    panelBusy = true
    try {
      const saved = await api.saveScheduledTask(id, patch)
      setTasks(prev => prev.map(task => (task.id === id ? saved : task)))
      pushAutoRefresh(saved)
      toast(t('✅ 已更新「{label}」', { label }))
    } catch (error) {
      toast(t('保存失败：{reason}', { reason: errorMessage(error) }), 'err')
      await loadPanel()
    } finally {
      panelBusy = false
    }
  }

  /**
   * 间隔输入框的提交（失焦 / 回车）。
   *
   * 与后端一致就不发请求：数字框里换个写法（如 010）也会走到这里。
   * 校验不过时把草稿清掉 = 回填后端值（旧实现是 input.value = task.interval）。
   */
  async function submitInterval(task: IntervalTask, raw: string) {
    const parsed = parseInterval(task, raw)
    if (!parsed.ok) {
      toast(parsed.message, 'err')
      clearIntervalDraft(task.id)
      return
    }
    if (parsed.value === task.interval) {
      clearIntervalDraft(task.id)
      return
    }
    await saveTask(task.id, { interval: parsed.value }, t('{name}间隔', { name: t(task.label) }))
    // 成功时以后端返回值为准；失败时 saveTask 内部已 loadPanel() 回滚 —— 两种情况都让草稿归位
    clearIntervalDraft(task.id)
  }

  /** 立即执行一条**后端**任务（前端任务的按钮不渲染，见 canRun） */
  async function runTask(task: IntervalTask) {
    if (panelBusy) return
    const api = shared().workbuddyDesktop
    if (!api) return
    panelBusy = true
    setRunningId(task.id)
    try {
      const result = await api.runScheduledTask(task.id)
      if (result?.task) {
        const refreshed = result.task
        setTasks(prev => prev.map(item => (item.id === task.id ? refreshed : item)))
      }
      toast(t('✅ {task}：{summary}', {
        task: t(task.label),
        summary: result?.summary || t('已执行'),
      }))
      // 凭证刷新会改账号页的有效期 / 凭证状态，顺手刷新主界面
      if (task.id === 'credentialMaintenance') await shared().wbApp?.refresh?.()
    } catch (error) {
      toast(t('执行失败：{reason}', { reason: errorMessage(error) }), 'err')
      await loadPanel()
    } finally {
      panelBusy = false
      setRunningId(null)
    }
  }

  /* ─── 操作：成长任务 ─────────────────────── */

  /** 一个账号分组里的待办数（claimable 的条数）：徽章与汇总行都从它取 */
  function growthPendingOf(account: GrowthAccountScan): number {
    return (Array.isArray(account.tasks) ? account.tasks : []).filter(
      task => growthTaskState(task) === 'claimable',
    ).length
  }

  /**
   * 拉一次扫描结果并落进 state（手动扫描与完成后的静默重扫共用）：返回待办数。
   * 成功清掉卡内的扫描错误行；失败原样抛给调用方——手动路径弹 toast，静默路径只落
   * 卡内错误行。
   */
  async function fetchGrowthScan(): Promise<number> {
    const data = await growthApi<GrowthScanResult>('GET', '/api/growth-tasks/scan')
    const results = Array.isArray(data?.results) ? data.results : []
    setGrowthResults(results)
    setGrowthScannedAt(Number(data?.scannedAt) || Date.now())
    setGrowthScanned(true)
    setGrowthScanError(null)
    return results.reduce((sum, account) => sum + growthPendingOf(account), 0)
  }

  /**
   * 扫描待办（GET /api/growth-tasks/scan）。
   *
   * 刻意**不进 panelBusy 互斥**：扫描要走完所有账号的上游请求，可能好几秒甚至更久，
   * 占着那把锁会把其它卡片的保存 / 执行全部挡住 —— 那是在改别的卡片的行为。
   * 它用自己的 growthScanning 挡连点，与间隔型 / 签到两条链互不等待。
   * 失败双通道：toast 即时反馈 + 卡内错误行常驻（常驻卡在后端不可达时也得可感知可重试）。
   */
  async function scanGrowth() {
    if (growthScanning || growthRunning) return
    setGrowthScanning(true)
    try {
      const pending = await fetchGrowthScan()
      toast(pending ? `✅ 扫描完成：${pending} 项待办` : '✅ 扫描完成：没有待办任务')
    } catch (error) {
      const message = errorMessage(error)
      setGrowthScanError(message)
      toast(`扫描失败：${message}`, 'err')
    } finally {
      setGrowthScanning(false)
    }
  }

  /**
   * 执行完成后的静默重扫（由完成 effect 延时一拍调起）：成功只更新数据，让「可办」
   * 徽章立即反映执行后的真实状态；失败不弹 toast——只落卡内错误行，不打扰刚看完
   * 执行结果的人。scan 是只读 GET（见契约），就算恰逢新队列在跑也没有副作用。
   */
  async function rescanGrowthSilently() {
    try {
      await fetchGrowthScan()
    } catch (error) {
      setGrowthScanError(errorMessage(error))
    }
  }

  /**
   * 执行全部待办（POST /api/growth-tasks/run，body 带并发数）。
   * 409（已在跑）不按失败报：壳把状态码归一成了文案，按请求日志页压缩那条的同一
   * 手法正则识别 —— 提示一句、顺手把在跑的队列接过来轮询。
   */
  async function runGrowth() {
    if (growthStarting || growthScanning || growthRunning) return
    const concurrency = Math.min(4, Math.max(1, Number(growthConcurrency) || 1))
    setGrowthStarting(true)
    try {
      const result = await growthApi<GrowthRunResult>('POST', '/api/growth-tasks/run', { concurrency })
      if (result?.started === false) {
        toast('没有待办任务')
        return
      }
      toast(`✅ 队列已启动：${Number(result?.total) || 0} 项（并发 ${concurrency}）`)
      await pollGrowthQueue() // 立即拉一次，不等第一个 3 秒才出进度
    } catch (error) {
      const message = errorMessage(error)
      if (/409|已在|正在/.test(message)) {
        toast('已有队列在执行')
        await pollGrowthQueue()
      } else {
        toast(`启动失败：${message}`, 'err')
      }
    } finally {
      setGrowthStarting(false)
    }
  }

  /** 停止执行（POST /api/growth-tasks/stop）：后端退出队列，轮询看到 running=false 自会收表 */
  async function stopGrowth() {
    try {
      await growthApi('POST', '/api/growth-tasks/stop', {})
      toast('已发送停止请求')
    } catch (error) {
      toast(`停止失败：${errorMessage(error)}`, 'err')
    }
  }

  /* ─── 渲染 ───────────────────────────────── */

  /**
   * 一条间隔型任务的卡片。
   *
   * 类名结构与旧模板一一对应（.task-item / .task-main / .task-title / .task-state /
   * .task-actions / .task-interval …），只把控件换成组件库；问号说明仍是
   * 共享 InfoTip（Tooltip 负责悬停、聚焦与无障碍关联，
   * React 渲染出来的也会被增强）。
   *
   * 输入框**不带** `data-island-input`：那是另一个岛（输入框就地升级）的钩子，
   * 两个岛同时挂一个输入框会打架（见任务边界）。文案不再需要 esc()：
   * 旧实现是拼 innerHTML，这里交给 React 的文本节点，天然不解析标签。
   */
  function taskCard(task: IntervalTask) {
    const unit = unitLabel(task.unit)
    const running = runningId === task.id
    return (
      <div className='task-item' data-task={task.id} key={task.id}>
        <div className='task-main'>
          <div className='task-title'>
            {/* 开关与任务名同在一个 label 里（与旧模板同构）：组件库的 Switch 是自绘
                控件，但 DOM 里带一个真实的隐藏 checkbox，label 的原生激活行为照样
                把点击转给它 —— 点名字也能拨动开关，与旧实现一致。 */}
            <label className='switch'>
              <Switch
                checked={task.enabled === true}
                onCheckedChange={next => void saveTask(task.id, { enabled: next }, t('{name}开关', { name: t(task.label) }))}
              />
              {/* 任务名 / 描述由后端随任务下发（固定中文常量），走 t() 让词典能翻 */}
              <span className='task-name'>{t(task.label)}</span>
            </label>
            <InfoTip>{t(task.description)}</InfoTip>
            <Badge className='task-badge' variant={task.enabled ? 'success' : 'outline'}>
              {task.enabled ? t('已开启') : t('已关闭')}
            </Badge>
            {task.running ? (
              <Badge className='task-badge' variant='warning'>
                {t('执行中…')}
              </Badge>
            ) : null}
          </div>
          <div className='task-state'>{taskStateText(task, now)}</div>
          {nextRunLine(taskNextRun(task, now))}
        </div>
        <div className='task-actions'>
          <span className='task-interval'>
            <span className='task-interval-label'>{t('每')}</span>
            {/* 单位是后端的固定属性（'seconds' | 'minutes'），不是一个可选字段：
                PATCH 只受理 {enabled?, interval?}，做成下拉会「看着能改、其实不生效」。

                宽度 / 对齐 / 等宽数字写成工具类（组件库的工具类带 !important，能盖过
                ui/css 里的老规则）：旧实现靠 page-tasks.css 的
                `.task-interval input[type="number"]` 收窄到 74px 并居中，那条规则随
                控件迁移会变成死规则被清掉，尺寸得由本岛自己带 —— 否则组件库 Input 的
                `w-full` 会让输入框撑满整行。 */}
            <Input
              type='number'
              inputMode='numeric'
              min={task.min}
              max={task.max}
              step={1}
              className='w-[74px] max-w-[74px] text-center tabular-nums'
              value={intervalDrafts[task.id] ?? String(task.interval)}
              title={t('可填 {min}–{max} {unit}（默认 {def} {unit}）', {
                min: task.min,
                max: task.max,
                unit,
                def: task.defaultInterval,
              })}
              // onChange 只记草稿、不发请求：提交交给 blur / 回车（见 submitInterval）
              onChange={event => {
                const value = event.currentTarget.value
                setIntervalDrafts(prev => ({ ...prev, [task.id]: value }))
              }}
              onBlur={event => void submitInterval(task, event.currentTarget.value)}
              // 回车等价于「失焦提交」：主动 blur 一次把两条路径合成一条（旧实现同款）
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            <span className='task-interval-unit'>{unit}</span>
          </span>
          {task.canRun === true ? (
            <Button
              size='sm'
              variant='outline'
              disabled={running || task.running === true}
              onClick={() => void runTask(task)}
            >
              {running ? t('执行中…') : t('立即执行')}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  function growthCard() {
    const pendingTotal = growthResults.reduce((sum, account) => sum + growthPendingOf(account), 0)
    /** 「执行全部待办」只在扫描后有可办事项时出现（要求口径；started=false 的兜底在 runGrowth 里） */
    const startable = pendingTotal > 0
    /** 扫描中 / 启动中 / 执行中任一在飞，扫描与执行都禁用（执行中还要禁并发下拉） */
    const busy = growthScanning || growthStarting || growthRunning
    const queueItems = growthQueue && Array.isArray(growthQueue.items) ? growthQueue.items : []
    const queueTotal = Number(growthQueue?.total) || queueItems.length
    const queueDone =
      Number(growthQueue?.done) ||
      queueItems.filter(
        item => item.status === 'ok' || item.status === 'failed' || item.status === 'skipped',
      ).length
    const queuePercent = queueTotal ? Math.min(100, Math.round((queueDone / queueTotal) * 100)) : null
    /** 队列明细的任务码 → 中文任务名：从扫描结果带出（参考实现 GROWTH_TITLES 的同款做法），
     *  没扫过 / 任务不在最近一次结果里时退回任务码原文。 */
    const taskLabels = new Map<string, string>()
    for (const account of growthResults) {
      for (const task of Array.isArray(account.tasks) ? account.tasks : []) {
        if (task.code && !taskLabels.has(task.code)) taskLabels.set(task.code, task.label || task.code)
      }
    }
    return (
      <div className='task-item' data-task={GROWTH_ID} key={GROWTH_ID}>
        <div className='task-main'>
          <div className='task-title'>
            <span className='task-name text-[13px] font-semibold'>成长任务</span>
            <InfoTip>{GROWTH_TIP}</InfoTip>
            <Badge
              className='task-badge'
              variant={!growthScanned ? 'outline' : pendingTotal ? 'brand' : 'outline'}
            >
              {!growthScanned ? '未扫描' : `待办 ${pendingTotal} 项`}
            </Badge>
          </div>
          <div className='task-state'>{GROWTH_DESC}</div>
          {growthScanned ? (
            <div className='task-state'>
              {growthScannedAt ? `上次扫描 ${clockOf(growthScannedAt)}` : ''}
              {!pendingTotal
                ? `${growthScannedAt ? SEP : ''}没有待办任务，全部账号的成长任务都已完成`
                : ''}
            </div>
          ) : null}
          {/* 卡内降级行（本卡是常驻区，后端不可达时错误落在卡内、可感知可重试，
              而不是只闪一条 toast）：扫描失败手动扫过/静默重扫失败都会记在这；
              队列错误只在「手上还没有任何队列数据」时显示（已有数据后的轮询失败
              保持静默，3 秒后下一拍自会重试——见 growthQueueError 的注释）。 */}
          {growthScanError ? (
            <Alert variant='destructive'>
              <AlertDescription>扫描失败：{growthScanError}</AlertDescription>
              <Button size='xs' variant='outline' className='mt-2 w-fit' onClick={() => void scanGrowth()}>
                重试
              </Button>
            </Alert>
          ) : null}
          {!growthQueue && growthQueueError ? (
            <Alert variant='destructive'>
              <AlertDescription>队列状态拉取失败：{growthQueueError}</AlertDescription>
              <Button size='xs' variant='outline' className='mt-2 w-fit' onClick={() => void pollGrowthQueue()}>
                重试
              </Button>
            </Alert>
          ) : null}
          {/* 执行进度：running 时每 3 秒随轮询刷新；结束后终态留在卡里（执行了什么、各自结果），
              直到下一次扫描 / 执行把它换掉 —— 与参考实现「终态只渲染这一次」同一语义。 */}
          {growthQueue && (growthRunning || queueItems.length) ? (
            <div className='flex min-w-0 flex-col gap-1.5'>
              <div className='flex flex-wrap items-center gap-3'>
                <Progress value={queuePercent} className='min-w-[180px] max-w-[360px] flex-1' />
                <span className='task-state'>
                  {growthRunning ? '执行中' : '已结束'} {queueDone} / {queueTotal}
                </span>
              </div>
              {queueItems.length ? (
                <div className='flex flex-col gap-1'>
                  {queueItems.map((item, index) => {
                    const badge = GROWTH_ITEM_BADGE[item.status ?? 'pending'] ?? GROWTH_ITEM_BADGE.pending
                    const label = item.taskCode ? taskLabels.get(item.taskCode) || item.taskCode : ''
                    return (
                      <div
                        key={`${item.accountId || 'acc'}-${item.taskCode || 'task'}-${index}`}
                        className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] leading-5'
                      >
                        <span className='text-foreground'>
                          {item.accountName || item.accountId || '未知账号'}
                        </span>
                        {label ? <span className='task-state'>{label}</span> : null}
                        <Badge shape='tag' variant={badge.variant}>
                          <BadgeDot aria-hidden='true' />
                          {badge.text}
                        </Badge>
                        {item.message ? <span className='task-state'>{item.message}</span> : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          {/* 扫描结果：逐账号分组（账号名 + 待办数徽章），任务行 = 中文名 / 进度 / 奖励 / 状态徽章，
              可办的那条用 primary-tint 底色点亮 —— 与「可办」徽标的 brand 档同一语义色。 */}
          {growthResults.length ? (
            <div className='flex min-w-0 flex-col gap-2.5'>
              {growthResults.map((account, index) => {
                const pending = growthPendingOf(account)
                const tasks = Array.isArray(account.tasks) ? account.tasks : []
                return (
                  <div key={account.id || `acc-${index}`} className='flex min-w-0 flex-col gap-1'>
                    <div className='task-title'>
                      <span className='task-name text-[12.5px] font-semibold'>
                        {account.name || account.id || '未命名账号'}
                      </span>
                      <Badge className='task-badge' shape='tag' variant={pending ? 'brand' : 'outline'}>
                        {pending ? `${pending} 项待办` : '无待办'}
                      </Badge>
                    </div>
                    {tasks.map(task => {
                      const state = growthTaskState(task)
                      const badge = GROWTH_STATE_BADGE[state]
                      const reward = growthRewardText(task)
                      return (
                        <div
                          key={task.code}
                          className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm px-1.5 py-0.5', state === 'claimable' ? 'bg-primary-tint' : '')}
                        >
                          <span className='text-[12px] text-foreground'>{task.label || task.code}</span>
                          {task.target ? (
                            <span className='task-state'>
                              {Number(task.current) || 0}/{Number(task.target)}
                            </span>
                          ) : null}
                          {reward ? <span className='task-state'>{reward}</span> : null}
                          <Badge shape='tag' variant={badge.variant}>
                            {badge.text}
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ) : growthScanned ? (
            <div className='task-state'>没有扫到国内版账号的成长任务（仅国内版账号参与）。</div>
          ) : null}
        </div>
        <div className='task-actions flex-wrap'>
          <span className='task-interval'>
            <span className='task-interval-label'>并发</span>
            {/* 展示文案显式给 SelectValue（与日志页筛选下拉同一做法，不依赖 value 自动显示）；
                执行中禁用换档 —— 改了也不影响在跑的队列，看着能改其实不生效的控件不如禁掉。 */}
            <Select
              value={growthConcurrency}
              onValueChange={next => setGrowthConcurrency(String(next ?? '1'))}
              disabled={growthRunning}
            >
              <SelectTrigger
                className='w-[56px]'
                title='同时执行的账号数（账号内任务串行）'
                aria-label='执行并发数'
              >
                <SelectValue>{growthConcurrency}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {GROWTH_CONCURRENCIES.map(value => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </span>
          <Button size='sm' variant='outline' disabled={busy} onClick={() => void scanGrowth()}>
            {growthScanning ? '扫描中…' : '扫描待办'}
          </Button>
          {startable ? (
            <Button size='sm' disabled={busy} onClick={() => void runGrowth()}>
              {growthStarting ? '启动中…' : '执行全部待办'}
            </Button>
          ) : null}
          {growthRunning ? (
            <Button size='sm' variant='outline' onClick={() => void stopGrowth()}>
              停止
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  /** 一条任务都没有：区分「还在加载」与「加载失败 / 后端没返回任务」 */
  const empty = tasks.length === 0
  const enabledCount = tasks.filter(task => task.enabled).length
  const badgeText = empty
    ? loaded
      ? t('不可用')
      : '—'
    : t('{enabled} / {total} 个已开启', { enabled: enabledCount, total: tasks.length })
  /** 徽标配色：无数据未定 → 无修饰；尝试过但读不到 → bad；正常 → 有开启就 ok */
  const badgeVariant: 'destructive' | 'outline' | 'success' = empty
    ? loaded
      ? 'destructive'
      : 'outline'
    : enabledCount
      ? 'success'
      : 'outline'
  /** 顶栏镜像用的语义记号（app.js 的 mirror 读它，不再按 className 拆 Tailwind 类） */
  const badgeTone = badgeVariant === 'destructive' ? 'bad' : badgeVariant === 'success' ? 'ok' : ''

  // 卡片顺序：按后端给的顺序（第一条「凭证自动维护」整行铺开，见 LEAD_CARDS）。
  // 其余条裹进 .task-grid 分两栏（行优先逐行配对），条数变了只是行数变，不会错位。
  const cards = tasks.map(task => taskCard(task))
  const rest = cards.slice(LEAD_CARDS)

  return <WorkbuddyTaskCenter maintenance={<div className='task-list'>{empty ? <Empty variant='compact' className='log-empty'><EmptyHeader><EmptyDescription>{loaded ? t('维护任务暂不可用') : t('正在加载…')}</EmptyDescription></EmptyHeader></Empty> : <>{cards.slice(0, LEAD_CARDS)}{rest.length ? <div className='task-grid'>{rest}</div> : null}</>}</div>} />

}

/* ─── 挂载：接管 index.html 里既有的页面区块 ─────── */

const PAGE_SELECTOR = '.page[data-page="tasks"]'

let mounted = false

/**
 * 把 React root 直接建在页面区块上。
 *
 * 先清掉骨架里的静态子节点（.panel / .panel-head / .task-list …）：这些节点由
 * 下面的 JSX 按同样的类名重新渲染，留着会与 React 的接管打架。
 */
function mount() {
  if (mounted) return
  const section = document.querySelector<HTMLElement>(PAGE_SELECTOR)
  if (!section) return
  mounted = true
  section.replaceChildren()
  createRoot(section).render(<TasksPanel />)
}

// 脚本排在页面骨架之后（index.html 里 islands/ui.js 在各 section 之后），正常直接挂；
// 万一将来被挪到前面，退化成等 DOM 解析完再挂。
if (document.querySelector(PAGE_SELECTOR)) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })

declare global {
  interface Window {
    /** 定时任务面板（替换 ui/tasks-panel.js，接口与原实现一致） */
    wbTasksPanel?: { load(): Promise<void> }
  }
}

window.wbTasksPanel = { load }

// 首屏自持加载：app.js 的 showPage 在本脚本加载前就执行过（那时 window.wbTasksPanel
// 还不存在，切页那次调用落空），用户上次若停在本页，这里补一次加载 —— 否则一直停在
// 「正在加载定时任务…」。此刻组件刚 render、还没挂载，load() 会把这次请求记在
// loadBeforeMount 上，由组件的挂载 effect 补发。
if (shared().wbApp?.currentPage === 'tasks') void load()
