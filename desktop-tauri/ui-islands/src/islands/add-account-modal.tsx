import { cn } from '@ui'
/**
 * Agent2API · 「登录 / 添加账号」弹窗（React 岛，命令式弹窗形态）。
 *
 * 替换旧的四份脚本：ui/add-account.js（弹窗外壳 + WorkBuddy 那段）、
 * ui/add-provider-forms.js（两步结构 + 各家表单块 + 分段交互）、
 * ui/add-provider-import.js（导入段）、ui/add-custom-provider.js（自定义块）
 * 以及四份纯常量的表单配置（add-qoder / add-cline / add-accio / add-zcode）。
 *
 * ── 挂载形态：与面板岛不同 ──────────────────────────────────
 * 这个弹窗不是页面，是命令式弹窗（按需创建 / 关闭即卸）：open() 建宿主 div 挂
 * React root，close() 时 unmount + 摘宿主（与 confirm-dialog.tsx / conc-dialog.tsx
 * 同一手法）。index.html 里那段 47 行的静态骨架（#add-modal）随之删除。
 *
 * ── 两层弹窗（与旧实现的对应关系）──────────────────────────
 *   第 1 步 #add-modal       → 这里的列表 Dialog（选提供商），宽 1100px；
 *   第 2 步 #add-form-modal  → 这里的表单 Dialog（选方式 + 填凭证），宽 620px。
 * 两层都用组件库的 Dialog：Esc / 点遮罩 / 焦点陷阱 / 关闭后焦点归位由 Base UI
 * 内建，嵌套弹窗的 Esc 只收最上面那层（旧实现靠 document 上的 keydown +
 * closeFormStep 手工分流）。**一处行为差异**：关掉表单层时旧实现只是把它的 DOM
 * 藏起来（表单内容与登录引擎的闭包都还在），这里保持挂载 —— 输入框内容也由
 * 模块级草稿（add-account-bridge 的 draftProps）保住，手机验证码那一步的
 * deviceId 和发码冷却由常驻的表单节点保留。
 *
 * ── 对外接口（调用点逐个 grep 确认过，见最终报告）────────────
 *   window.wbAddAccountModal  = { open, close }   —— 跨模块打开这张弹窗的唯一入口
 *   window.wbAccountAddForms  = { syncAddProvider, openNewCustomForm }
 *     · syncAddProvider   账号页（account-panel.js）在「添加账号」按钮上同步调用
 *     · openNewCustomForm 模型管理页左栏的「＋ 新建自定义提供商」直达新建表单
 * 旧接口里其余成员（closeFormStep / registerAddForm / bindSeg / segValueOf /
 * setSegValue / SEG_EVENT）只被本子系统内部用，随旧文件一起消失。
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogSection, DialogTitle } from '@ui'

import { existingCustomOfPreset, registerAddPageClose, shared, type CustomProviderRecord, type SharedWindow } from './add-account-bridge'
import {
  BUILTIN_CONFIGS,
  CUSTOM_PROVIDER,
  WORKBUDDY_ENTRY_LABEL,
  WORKBUDDY_PROVIDER,
  configOf,
} from './add-account-configs'
import { CustomFootActions, CustomProviderBlock, type CustomMode } from './add-custom-provider'
import { ImportFootActions, ImportPanel } from './add-provider-import'
import {
  IMPORT_SEGMENT_ENABLED,
  NEW_PROVIDER_CARD_ID,
  PRESET_CARD_PREFIX,
  PickStep,
  PROVIDER_ICONS,
  TYPE_IMPORT,
  TYPE_PROXY,
  type AccountType,
} from './add-provider-pick'
import { ProviderBlock, WorkBuddyBlock } from './add-provider-blocks'
import { t } from '../i18n'

type Step = 'pick' | 'form'

type IslandState = {
  step: Step
  accountType: AccountType
  search: string
  /** 当前选中哪一家的块（provider id / 'workbuddy' / 'custom'） */
  provider: string
  /** 从某一家已有自定义提供商的卡片进来时的 id（空串 = 没有指定） */
  providerHint: string
  /** 从预置家卡片进来时的 key（空串 = 不是从预置卡进来的） */
  presetKey: string
  /** 第 1 步每点一次卡 +1：预填 / 目录重读这类「进这一屏就要跑一次」的动作用它当信号 */
  showToken: number
}

/** 打开弹窗（以及点「添加账号」）时的复位落点：第 1 步 + Agent 段 + WorkBuddy */
const INITIAL: IslandState = {
  step: 'pick',
  accountType: TYPE_PROXY,
  search: '',
  provider: WORKBUDDY_PROVIDER,
  providerHint: '',
  presetKey: '',
  showToken: 0,
}

/** 命令式外壳暴露给模块级函数的那几个动作（组件挂载后登记，卸载时撤销） */
export type IslandHandle = {
  /** 重画卡片列表并复位到第 1 步（旧 resetAddStep，对外叫 syncAddProvider） */
  reset: () => void
  /** 直达「新建自定义提供商」表单（旧 openNewCustomForm） */
  openNewCustomForm: () => void
}

const customList = (): CustomProviderRecord[] => shared().wbProviders?.customList?.() || []

export function AddAccountModal({
  onClose,
  onReady,
  mobile = document.documentElement.dataset.mobileUi === 'true',
  presentation = 'dialog',
}: {
  mobile?: boolean
  presentation?: 'dialog' | 'page'
  onClose: () => void
  onReady: (handle: IslandHandle | null) => void
}): React.ReactElement {
  const [state, setState] = React.useState<IslandState>(INITIAL)
  const pageRef = React.useRef<HTMLElement>(null)
  const pickedId = React.useRef('')
  React.useEffect(() => presentation === 'page' ? registerAddPageClose(onClose) : undefined, [presentation, onClose])
  React.useEffect(() => () => {
    if (mobile) { void shared().wbWebLogin?.cancelIfActive?.(''); shared().wbAutoclawOauth?.cancel?.() }
  }, [mobile])
  /** 摘要 / 自定义目录异步到位后的重画信号（值本身不参与渲染） */
  const [version, setVersion] = React.useState(0)
  const bump = React.useCallback(() => setVersion(value => value + 1), [])

  const reset = React.useCallback(() => {
    setState(INITIAL)
    const providers = shared().wbProviders
    // 摘要还没到（首次打开弹窗早于首屏那次 refresh）时补拉一次再重画：
    // 否则卡片上会清一色写「还没有账号」，而账号其实早就有了
    if (!(providers?.all?.() || []).length) void providers?.load?.().then(bump)
    // 自定义目录同理：切到「自定义」段时已建的家要显示出来
    void providers?.refreshCustom?.().then(bump)
  }, [bump])

  // An inline page has no imperative open() call to initialize the provider directory.
  React.useEffect(() => { if (presentation === 'page') reset() }, [presentation, reset])

  const openNewCustomForm = React.useCallback(() => {
    reset()
    setState({ ...INITIAL, step: 'form', provider: CUSTOM_PROVIDER })
  }, [reset])

  React.useEffect(() => {
    onReady({ reset, openNewCustomForm })
    return () => onReady(null)
  }, [onReady, reset, openNewCustomForm])

  // 打开时以主进程真实状态复位按钮（旧 openModal 里那一次 refresh）：
  // 上次若在等待中被关窗，这里会重新可用
  React.useEffect(() => {
    void shared().wbWebLogin?.refresh?.()
  }, [])

  // 自定义目录提前拉一次：第一次打开这一屏时下拉就有数据（旧实现加载期就拉）
  React.useEffect(() => {
    void shared().wbProviders?.refreshCustom?.().then(bump)
  }, [bump])

  // 每次进入自定义块都重读目录（旧 onShow 里那次 refreshCustom）
  React.useEffect(() => {
    if (state.step !== 'form' || state.provider !== CUSTOM_PROVIDER) return
    void shared().wbProviders?.refreshCustom?.().then(bump)
  }, [state.step, state.provider, state.showToken, bump])

  const config = configOf(state.provider)
  const isCustom = state.provider === CUSTOM_PROVIDER
  const hasBlock = state.provider === WORKBUDDY_PROVIDER || isCustom || Boolean(config)
  const customMode: CustomMode = state.providerHint ? 'existing' : 'create'
  const customLabel = state.providerHint
    ? customList().find(item => item.id === state.providerHint)?.name || ''
    : state.presetKey
      ? shared().wbPresetProviders?.presetOf?.(state.presetKey)?.name || ''
      : ''
  // WorkBuddy 用中性品牌名（不带地区）：这个块内部有「账号版本」分段，标题写着
  // 「国内版」而用户当场切到国际版就自相矛盾了（与第 1 步那张卡同一口径，名字
  // 见 add-account-configs 的 WORKBUDDY_ENTRY_LABEL）。别家用注册表名，
  // 注册名要过一遍词典（「AutoClaw 国内版」这类在非中文界面得翻）。
  const providerLabel = state.provider === WORKBUDDY_PROVIDER
    ? WORKBUDDY_ENTRY_LABEL
    : t(shared().wbProviders?.labelOf?.(state.provider) || state.provider)
  // 标题写在表单弹窗的头部：列表弹窗的标题始终是「添加账号」，不跟着步骤变
  const heading = isCustom
    ? (state.providerHint || state.presetKey
      ? t('登录 / 添加 {name} 账号', { name: customLabel || t('自定义提供商') })
      : t('新建自定义提供商'))
    : t('登录 / 添加 {name} 账号', { name: providerLabel })

  /** 第 1 步点一张卡：三种特殊取值分别落到自定义块的哪种模式（见 pickProvider 的旧注释） */
  function pick(id: string): void {
    if (!id) return
    pickedId.current = id
    const entry = { step: 'form' as Step, showToken: state.showToken + 1 }
    if (id === NEW_PROVIDER_CARD_ID) {
      setState(prev => ({ ...prev, ...entry, provider: CUSTOM_PROVIDER, providerHint: '', presetKey: '' }))
    } else if (id.startsWith(PRESET_CARD_PREFIX)) {
      const presetKey = id.slice(PRESET_CARD_PREFIX.length)
      // 模板卡分两种落法（判重口径与卡片文案共用 bridge 的 existingCustomOfPreset）：
      //   · 这家还没建过 —— 空 providerHint，落到「新建」模式（模板预填名称 / 协议 /
      //     Base URL），提交即建家 + 首个账号；
      //   · 已建过同名家 —— 带上那家的 id，落到「加入已有」模式并预选它，点几次
      //     模板卡就能加几个账号（同一家多把 key 轮换），不会建出重名的第二家。
      // presetKey 照带：`CustomFootActions` 在新建提交时要用它取 quirks。
      const built = existingCustomOfPreset(shared().wbPresetProviders?.presetOf?.(presetKey))
      setState(prev => ({
        ...prev,
        ...entry,
        provider: CUSTOM_PROVIDER,
        providerHint: built?.id || '',
        presetKey,
      }))
    } else if (customList().some(item => item.id === id)) {
      setState(prev => ({ ...prev, ...entry, provider: CUSTOM_PROVIDER, providerHint: id, presetKey: '' }))
    } else {
      setState(prev => ({ ...prev, ...entry, provider: id, providerHint: '', presetKey: '' }))
    }
  }

  const backToPick = (): void => {
    // 表单层是 keepMounted：只退回列表不会卸载引擎，必须显式取消本家的登录。
    void shared().wbWebLogin?.cancelIfActive?.(state.provider)
    if (state.provider === 'autoclaw-intl') shared().wbAutoclawOauth?.cancel?.()
    setState(prev => ({ ...prev, step: 'pick' }))
  }
  const importing = state.accountType === TYPE_IMPORT

  React.useEffect(() => {
    if (presentation !== 'page' || state.step !== 'form') return
    const back = (event: Event) => { event.preventDefault(); backToPick() }
    document.addEventListener('aibuddy:mobile-back', back)
    return () => document.removeEventListener('aibuddy:mobile-back', back)
  }, [presentation, state.step, state.provider])

  React.useEffect(() => {
    if (presentation !== 'page') return
    const target = state.step === 'form'
      ? pageRef.current?.querySelector<HTMLElement>('.mobile-add-heading h2')
      : [...(pageRef.current?.querySelectorAll<HTMLElement>('[data-provider]') || [])].find(item => item.dataset.provider === pickedId.current)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
  }, [presentation, state.step])

  const picker = (<PickStep
            mobile={mobile}
            accountType={state.accountType}
            onAccountTypeChange={value => setState(prev => ({ ...prev, accountType: value }))}
            search={state.search}
            onSearchChange={value => setState(prev => ({ ...prev, search: value }))}
            onPick={pick}
            version={version}
            importing={importing}
            importPanel={
              IMPORT_SEGMENT_ENABLED ? <ImportPanel segmentOn={importing} /> : undefined
            }
          />)
  // Both steps stay mounted: SMS device IDs, cooldowns and credential drafts belong to the engines.
  const forms = (<>
    <WorkBuddyBlock mobile={mobile} active={state.step === 'form' && state.provider === WORKBUDDY_PROVIDER} />
              {BUILTIN_CONFIGS.map(item => (
                <ProviderBlock
                  key={item.provider}
                  config={item}
                  active={state.step === 'form' && state.provider === item.provider}
                />
              ))}
              <div
                className='add-provider-block'
                hidden={!isCustom}
              >
                <CustomProviderBlock
                  mode={customMode}
                  providerHint={state.providerHint}
                  presetKey={state.presetKey}
                  showToken={state.showToken}
                  version={version}
                />
              </div>
              {hasBlock ? null : (
                <div className='add-provider-block'>
                  <DialogSection>
                    <h3>{t('该提供商账号添加功能即将上线')}</h3>
                    <p>{t('「{name}」的账号添加功能还在开发中，敬请期待。', { name: providerLabel })}</p>
                  </DialogSection>
                </div>
              )}
  </>)
  const identityLabel = isCustom ? customLabel || t('自定义提供商') : providerLabel
  const identityIcon = state.presetKey ? shared().wbPresetProviders?.iconOf?.(state.presetKey) : PROVIDER_ICONS[state.provider]
  const formActions = isCustom ? <CustomFootActions mode={customMode} presetKey={state.presetKey} /> : null

  if (presentation === 'page') return (
    <section ref={pageRef} className='mobile-add-flow' data-step={state.step} aria-label={t('添加账号')}>
      <div className='mobile-add-picker' hidden={state.step !== 'pick'} inert={state.step !== 'pick'}>
        {picker}
        {IMPORT_SEGMENT_ENABLED && importing ? <div className='mobile-add-actions'><ImportFootActions /></div> : null}
      </div>
      <div className='mobile-add-form' hidden={state.step !== 'form'} inert={state.step !== 'form'}>
        <div className='mobile-add-heading'>
          <div className='mobile-provider-identity'>
            {identityIcon ? <img src={identityIcon} alt='' width={44} height={44} /> : <span className='mobile-provider-fallback' aria-hidden='true'>{identityLabel.slice(0,1)}</span>}
            <div>
              <h2 tabIndex={-1}>{identityLabel}</h2>
              <p>{isCustom ? t('填写连接信息并添加账号') : t('登录或导入一个账号')}</p>
            </div>
          </div>
        </div>
        <div className='mobile-add-fields'>{forms}</div>
        {formActions ? <div className='mobile-add-actions'>{formActions}</div> : null}
      </div>
    </section>
  )

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent layout={mobile ? 'fullscreen' : 'center'} className={cn(mobile ? 'mobile-feature-dialog mobile-add-picker' : 'w-[min(1100px,calc(100vw-48px))]')}>
        <DialogHeader><DialogTitle>{t('添加账号')}</DialogTitle></DialogHeader>
        <DialogBody>{picker}</DialogBody>
        {IMPORT_SEGMENT_ENABLED && importing ? <DialogFooter><ImportFootActions /></DialogFooter> : null}
        <Dialog open={state.step === 'form'} onOpenChange={next => { if (!next) backToPick() }}>
          <DialogContent layout={mobile ? 'fullscreen' : 'center'} keepMounted overlayForceRender className={cn(mobile ? 'mobile-feature-dialog mobile-add-form' : 'w-[min(620px,calc(100vw-48px))]')}>
            <DialogHeader><DialogTitle>{heading}</DialogTitle></DialogHeader>
            <DialogBody>{forms}</DialogBody>
            {formActions ? <DialogFooter>{formActions}</DialogFooter> : null}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

/* ─── 命令式外壳：与旧实现的 window 接口一致 ─── */

let root: ReturnType<typeof createRoot> | null = null
let host: HTMLElement | null = null
let handle: IslandHandle | null = null
/** 挂载后才执行的那一个动作（open / openNewCustomForm 在同一 tick 里被调到时用） */
let pendingAction: (() => void) | null = null

function unmountModal(): void {
  if (root) {
    root.unmount()
    root = null
  }
  if (host) {
    host.remove()
    host = null
  }
  handle = null
}

function mountModal(): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(
    <AddAccountModal
      onClose={closeModal}
      onReady={next => {
        handle = next
        if (!next) return
        const action = pendingAction
        pendingAction = null
        action?.()
      }}
    />,
  )
}

/**
 * 关闭弹窗：两层一起关（整个岛卸载），并放弃等待中的登录。
 *
 * 关窗即放弃等待：通知主进程中止后端轮询，否则按钮会一直卡在禁用态。
 * 不传 provider = 「谁在等待就取消谁」：多家共用同一个弹窗，这里无需区分。
 * AutoClaw 国际版的 OAuth 另有一套等待（先跑验证码、再等登录窗口），与上面那条
 * 链的取消语义不同（它还要作废本地那次验证码等待），因此单独通知一次 ——
 * 没有发起过时它什么都不做。
 */
function closeModal(): void {
  void shared().wbWebLogin?.cancelIfActive?.('')
  shared().wbAutoclawOauth?.cancel?.()
  unmountModal()
}

/** 打开弹窗（已开着时等价于「重画卡片列表并复位到第 1 步」） */
function openModal(): void {
  if (root) {
    handle?.reset()
    return
  }
  pendingAction = () => handle?.reset()
  mountModal()
}

/** 直达「新建自定义提供商」表单：打开弹窗、复位，再走「新建」那张卡的同一路径 */
function openNewCustomForm(): void {
  if (root) {
    handle?.openNewCustomForm()
    return
  }
  pendingAction = () => handle?.openNewCustomForm()
  mountModal()
}

// 账号页的「添加账号」按钮（报表页那个已随会话状态卡片删除，id 保留同一约定）。
// 岛在 index.html 的 islands/ui.js 里加载，位置在那两个按钮之后，DOM 必已解析。
for (const id of ['btn-add-account', 'btn-add-account-2']) {
  document.getElementById(id)?.addEventListener('click', openModal)
}

// 对外接口用「窄类型 + 转型」写回（SharedWindow 里已声明这两个属性），
// 不用 declare global 往 Window 上加属性 —— 并行迁移时同名属性类型不一致会撞 TS2717。
const bridgeWindow = window as unknown as SharedWindow
bridgeWindow.wbAddAccountModal = { open: openModal, close: closeModal }
bridgeWindow.wbAccountAddForms = {
  /** 账号页的「添加账号」按钮：按 providers 摘要重建卡片并复位到 WorkBuddy */
  syncAddProvider: () => {
    if (root) handle?.reset()
    else openModal()
  },
  openNewCustomForm,
}
