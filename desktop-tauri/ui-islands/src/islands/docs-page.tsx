import { InfoTip } from '../components/info-tip'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  Badge, Button, Spinner, ToggleGroup, ToggleGroupItem,
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockActions, CodeBlockContent,
  Item, ItemGroup, ItemContent, ItemTitle, ItemDescription, ItemFooter,
} from '@ui'
import { CopyIcon, RefreshCwIcon } from '@ui/navigation-icons'
import { t } from '../i18n'

/**
 * 接入文档：Base URL、协议与客户端示例、同源健康检测。
 * 五个 api-* 节点由 port-panel 写入真实地址，复制仍走 clipboard.js 的委托与权限兜底。
 * root 同步挂载在既有 section 上，保证 port-panel 初始化时这些节点已经存在。
 * 健康检测只在进入页面或手动重试时执行，不因应用启动、切换客户端或复制而触发。
 */

/* ─── 常量 ─────────────────────────────────── */

/** 面板头问号的说明全文（逐字照抄静态 DOM 的 data-tip，别删条目 —— 每一条都是踩过的边界）。
 *  整段作为 t() 的键（中文即键）：写成单个字符串字面量而不是多段拼接，扫描器才认得出这个键。 */
const PANEL_TIP = t('Base URL 填进客户端的「API 地址 / Base URL」栏；对话协议按客户端支持的类型三选一（Chat Completions / Responses / Anthropic Messages），三者共用同一套模型与账号池，可随时切换；鉴权用「网关 Key」页里任一启用 Key。')

/* ─── 小组件 ───────────────────────────────── */

type EndpointRowProps = {
  /** port-panel 与 clipboard.js 都按这个 id 找人：契约点，不许改 */
  id: string
  name: string
  note: string
}

/** 不加旧 copy-btn 类：旧委托会替换 textContent，破坏 React 图标；成功反馈沿用全局 toast。 */
function CopyAddress({ from, label, text = false }: { from: string; label: string; text?: boolean }) {
  return (
    <Button variant={text ? 'outline' : 'ghost'} size={text ? 'sm' : 'icon-sm'}
      data-copy-from={from} aria-label={label} title={label}>
      <CopyIcon data-icon='inline-start' />
      {text ? t('复制') : null}
    </Button>
  )
}

function EndpointRow({ id, name, note }: EndpointRowProps) {
  return (
    <Item role='listitem' size='sm' className='px-0'>
      <ItemContent className='min-w-0'>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription className='line-clamp-none'>{note}</ItemDescription>
      </ItemContent>
      <ItemFooter className='min-w-0'>
        <CodeBlock size='sm' className='flex-row items-center'>
          <CodeBlockContent className='flex-1' aria-label={t('{name} 请求地址', { name })}><span id={id}>—</span></CodeBlockContent>
          <div className='shrink-0 pr-2'><CopyAddress from={id} label={t('复制 {name} 地址', { name })} /></div>
        </CodeBlock>
      </ItemFooter>
    </Item>
  )
}

/* ─── 客户端快速接入：按当前网关地址生成现成配置 ─── */

type SharedWindow = {
  workbuddyDesktop?: { platform?: string }
}

/**
 * 当前网关对外地址（不带 /v1）。
 *
 * 首选「接口地址」面板里 port-panel 已写好的 Base URL（与页面显示永远同源）；
 * 它还没写进来（极早时序）时按同款规则现算：网页端非回环 → 当前 origin，桌面 → 127.0.0.1。
 */
function quickStartBase(): string {
  const text = document.getElementById('api-base')?.textContent?.trim()
  if (text && text !== '—' && text.startsWith('http')) return text.replace(/\/+v1$/, '')
  const host = window.location.hostname
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  const isWeb = (window as unknown as SharedWindow).workbuddyDesktop?.platform === 'web'
  if (isWeb && !loopback) return window.location.origin
  return 'http://127.0.0.1:3065'
}

type ClientKind = 'curl' | 'python' | 'node' | 'claude' | 'codex'

const CLIENT_TABS: { kind: ClientKind; label: string; hint: string }[] = [
  { kind: 'curl', label: 'curl', hint: '命令行直接测通' },
  { kind: 'python', label: 'Python', hint: 'openai SDK' },
  { kind: 'node', label: 'Node.js', hint: 'openai SDK（ESM）' },
  { kind: 'claude', label: 'Claude Code', hint: 'Anthropic 协议环境变量' },
  { kind: 'codex', label: 'Codex CLI', hint: 'config.toml 接入' },
]

/** 生成各客户端的接入片段（base 不带 /v1；Key 与模型名用占位符，用户替换） */
function clientSnippet(kind: ClientKind, base: string): string {
  switch (kind) {
    case 'curl':
      return [
        `curl ${base}/v1/chat/completions \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Authorization: Bearer sk-你的网关Key" \\`,
        `  -d '{`,
        `    "model": "模型名（GET /v1/models 里任选）",`,
        `    "messages": [{"role": "user", "content": "你好"}],`,
        `    "stream": true`,
        `  }'`,
      ].join('\n')
    case 'python':
      return [
        `from openai import OpenAI`,
        ``,
        `client = OpenAI(base_url="${base}/v1", api_key="sk-你的网关Key")`,
        `resp = client.chat.completions.create(`,
        `    model="模型名（GET /v1/models 里任选）",`,
        `    messages=[{"role": "user", "content": "你好"}],`,
        `)`,
        `print(resp.choices[0].message.content)`,
      ].join('\n')
    case 'node':
      return [
        `import OpenAI from 'openai'`,
        ``,
        `const client = new OpenAI({`,
        `  baseURL: '${base}/v1',`,
        `  apiKey: 'sk-你的网关Key',`,
        `})`,
        `const resp = await client.chat.completions.create({`,
        `  model: '模型名（GET /v1/models 里任选）',`,
        `  messages: [{ role: 'user', content: '你好' }],`,
        `})`,
        `console.log(resp.choices[0].message.content)`,
      ].join('\n')
    case 'claude':
      return [
        `# macOS / Linux（bash）`,
        `export ANTHROPIC_BASE_URL=${base}`,
        `export ANTHROPIC_AUTH_TOKEN=sk-你的网关Key`,
        `claude`,
        ``,
        `# Windows（PowerShell）`,
        `$env:ANTHROPIC_BASE_URL = "${base}"`,
        `$env:ANTHROPIC_AUTH_TOKEN = "sk-你的网关Key"`,
        `claude`,
      ].join('\n')
    case 'codex':
      return [
        `# ~/.codex/config.toml`,
        `model_provider = "aibuddy"`,
        ``,
        `[model_providers.aibuddy]`,
        `name = "Agent2API"`,
        `base_url = "${base}/v1"`,
        `wire_api = "responses"`,
        `env_key = "AIBUDDY_API_KEY"`,
        ``,
        `# 然后设置环境变量再启动：`,
        `export AIBUDDY_API_KEY=sk-你的网关Key`,
      ].join('\n')
  }
}

const DOCS_CLIENT_KEY = 'aibuddy-docs-client'
const DOCS_CLIENTS: ClientKind[] = ['curl', 'python', 'node', 'claude', 'codex']

/** 上次选过的客户端类型：设置页「页面偏好」与本处共用同一个键 */
function readDocsClient(): ClientKind {
  try {
    const saved = localStorage.getItem(DOCS_CLIENT_KEY)
    return saved !== null && (DOCS_CLIENTS as string[]).includes(saved) ? (saved as ClientKind) : 'curl'
  } catch {
    return 'curl'
  }
}

function QuickStartPanel() {
  const [kind, setKindState] = useState<ClientKind>(readDocsClient)
  const setKind = (next: ClientKind) => {
    setKindState(next)
    try {
      localStorage.setItem(DOCS_CLIENT_KEY, next)
    } catch {
      // 存储不可用只影响下次打开
    }
  }
  const [base, setBase] = useState(quickStartBase)
  useEffect(() => {
    const source = document.getElementById('api-base')
    if (!source) return
    const sync = () => setBase(quickStartBase())
    const observer = new MutationObserver(sync)
    observer.observe(source, { childList: true, characterData: true, subtree: true })
    sync()
    return () => observer.disconnect()
  }, [])
  const client = CLIENT_TABS.find(tab => tab.kind === kind)!
  const filenames: Record<ClientKind, string> = {
    curl: 'Terminal', python: 'example.py', node: 'example.mjs', claude: 'Terminal', codex: '~/.codex/config.toml',
  }
  return (
    <Card as='section' variant='panel' size='sm' className='min-w-0'>
      <CardHeader variant='panel'>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <CardTitle>{t('客户端快速接入')}</CardTitle>
          <CardDescription>{t('选择客户端，复制对应的接入示例。')}</CardDescription>
        </div>
        <InfoTip label={t('客户端快速接入说明')}>{t('按上方 Base URL 现生成接入片段；把「sk-你的网关Key」换成「网关 Key」页里创建的 Key，模型名从 GET /v1/models 里选。')}</InfoTip>
      </CardHeader>
      <CardContent variant='panel'>
        <ToggleGroup variant='outline' size='sm' spacing={2} value={[kind]}
          aria-label={t('选择客户端类型')} className='flex-wrap'
          onValueChange={next => { if (next.length) setKind(next[0] as ClientKind) }}>
          {CLIENT_TABS.map(tab => (
            <ToggleGroupItem key={tab.kind} value={tab.kind} title={t(tab.hint)}>{tab.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <CodeBlock size='sm'>
          <CodeBlockHeader>
            <CodeBlockTitle>{filenames[kind]}</CodeBlockTitle>
            <CodeBlockActions><CopyAddress from='qs-snippet' label={t('复制 {name} 配置', { name: client.label })} text /></CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent id='qs-snippet' aria-label={t('{name} 接入示例', { name: client.label })}>{clientSnippet(kind, base)}</CodeBlockContent>
        </CodeBlock>
        <CardDescription>{t(client.hint)} · {t('将示例中的 Key 和模型名替换为自己的配置。')}</CardDescription>
      </CardContent>
      <CardFooter variant='panel'>
        {t('各客户端共用同一套账号池与 Key；支持流式（SSE）响应。')}
      </CardFooter>
    </Card>
  )
}

/* ─── 网关健康：同源探活 + 引擎版本，三张状态卡 ─── */

/**
 * 一条探活的读数。`ok: null` = 还没测过（首帧给占位「—」）；失败细分两档，提示语
 * 也跟着分开：`net` = fetch 抛错（浏览器根本没连上本站 —— 不一定是网关挂了，
 * 地址 / 端口不对、跨机访问网络不通都长这样）；`http` = 本站回了非 2xx（进程在
 * 响应，是这个端点没过 —— 与「连不上」是两回事）。
 */
type ProbeOutcome = {
  ok: boolean | null
  /** 本站往返耗时（performance.now 差值四舍五入，毫秒）；只在成功时展示 */
  ms: number
  why: '' | 'net' | 'http'
  /** why === 'http' 时的状态码（net 恒为 0） */
  status: number
  /** 成功响应解出的 JSON（解析失败给 null；探活判定只看 HTTP 状态） */
  body: unknown
}

const IDLE_PROBE: ProbeOutcome = { ok: null, ms: 0, why: '', status: 0, body: null }

/**
 * GET 一个同源端点：网络错误与 HTTP 错误分开报、**永不抛出** —— 探活是页面里最
 * 不该有副作用的一类请求，任何异常都折进读数里。cache: 'no-store'：探活要的是
 * 「此刻的网关」，不是上一刻的缓存。
 */
async function probeGet(url: string): Promise<ProbeOutcome> {
  const started = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const ms = Math.round(performance.now() - started)
    const body = res.ok ? await res.json().catch(() => null) : null
    return { ok: res.ok, ms, why: res.ok ? '' : 'http', status: res.status, body }
  } catch {
    return { ok: false, ms: Math.round(performance.now() - started), why: 'net', status: 0, body: null }
  }
}

/** /v1/models 响应里的 OpenAI 形态 data 数组（缺字段 / 形状不对给 null） */
function modelsArrayOf(body: unknown): unknown[] | null {
  const data = (body as { data?: unknown } | null)?.data
  return Array.isArray(data) ? data : null
}

/** 管理 API 的 `{success, data}` 信封里取 data（形状不对给 null） */
function envelopeData(body: unknown): Record<string, unknown> | null {
  const data = (body as { data?: unknown } | null)?.data
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/** 探活失败的友好原因（空串 = 没失败 / 还没测）。连不上 ≠ 网关挂了：两种失败分开说 */
function probeError(p: ProbeOutcome): string {
  if (p.ok !== false) return ''
  if (p.why === 'net') return '无法连接本站：网关可能没启动，或地址 / 端口不对；跨机访问时先检查网络'
  return `本站有响应，但这个端点回了 HTTP ${p.status}`
}

/** 三张卡下方的小字说明（失败原因另起一行红字，见 probeError，不混在这句里） */
const GATEWAY_HINT = 'GET /health 不需要鉴权；延迟是浏览器到本站一个来回的耗时'
const MODELS_HINT = '客户端接入的第一步：GET /v1/models 不需要鉴权；没配 Key 时给空清单，也算可用'
const VERSION_HINT = '网关内核的版本号，登录面板后从 GET /api/update/status 读；读不到显示「—」'

/** 面板头问号的说明全文 */
const HEALTH_TIP = '三张卡回答「客户端能不能接」：网关进程探 GET /health、模型清单探 '
  + 'GET /v1/models，两条都不需要鉴权、与页面同源直连；引擎版本要登录面板后才读得到。'
  + '红色不一定是网关挂了 —— 浏览器连不上本站（地址 / 端口 / 网络不通）也会红，'
  + '卡片下方的小字会区分两种情形。'

/** 面板的全部读数：探活结果与两条管理 API 的派生值，一轮检测整体替换一次 */
type HealthSnapshot = {
  /** 检测在途（按钮转圈禁用；卡片保留上一轮读数，按钮自己表达「正在测」） */
  checking: boolean
  gateway: ProbeOutcome
  models: ProbeOutcome
  /** /v1/models 的 data 长度（只在探测成功且形状正确时有效） */
  modelCount: number
  /** 引擎版本号；空串 = 没读到（卡片显示「—」） */
  version: string
  /** /api/storage 的账号 / 请求数；null = 没读到（脚注整段省略） */
  accounts: number | null
  requests: number | null
}

const IDLE_SNAPSHOT: HealthSnapshot = {
  checking: false,
  gateway: IDLE_PROBE,
  models: IDLE_PROBE,
  modelCount: 0,
  version: '',
  accounts: null,
  requests: null,
}

type CardTone = 'ok' | 'bad' | 'info' | 'idle'

function HealthCard({ name, tone, value, hint, error }: {
  name: string
  tone: CardTone
  value: string
  hint: string
  error: string
}) {
  return (
    <Card size='sm' className='min-w-0'>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-1'>
            <CardTitle>{t(name)}</CardTitle>
            <InfoTip label={t('{name}说明', { name: t(name) })}>{t(hint)}</InfoTip>
          </div>
          <Badge variant={tone === 'bad' ? 'destructive' : 'secondary'}>
            {t(tone === 'ok' ? '检测通过' : tone === 'bad' ? '检测失败' : tone === 'info' ? '已读取' : '待检测')}
          </Badge>
        </div>
        <CardDescription>{value}</CardDescription>
      </CardHeader>
      {error ? <CardContent><CardDescription role='alert'>{t(error)}</CardDescription></CardContent> : null}
    </Card>
  )
}

function HealthPanel() {
  const [snap, setSnap] = useState<HealthSnapshot>(IDLE_SNAPSHOT)
  // 「一次只测一轮」的闸：按钮在 checking 时本来就禁用，这道闸主要挡「快速来回
  // 切页」时 MutationObserver 连环触发的自动检测 —— 后到的直接让路，在途那轮的
  // 结果照样落地
  const busyRef = useRef(false)

  const check = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setSnap(prev => ({ ...prev, checking: true }))
    // 四个读数互不依赖、失败互不拖累，并发打出去（探活函数自己不抛）。两个管理
    // API 未登录会 401：probeGet 只看 HTTP 状态，401 的 body 是 null，版本回落
    // 「—」、脚注省略 —— 登录态的缺失不该被画成「网关不健康」。
    const [gateway, models, updateStatus, storage] = await Promise.all([
      probeGet('/health'),
      probeGet('/v1/models'),
      probeGet('/api/update/status'),
      probeGet('/api/storage'),
    ])
    const version = String(envelopeData(updateStatus.body)?.currentVersion || '').trim()
    // /api/storage 的读数住在 data.database 小节里（账户数 / 累计请求数），形状
    // 由 storage_api.rs 定；形状不对时 Number() 给 NaN，下面统一按「没读到」处理
    const database = envelopeData(storage.body)?.database as Record<string, unknown> | undefined
    const accounts = Number(database?.accounts)
    const requests = Number(database?.requests)
    setSnap({
      checking: false,
      gateway,
      models,
      modelCount: modelsArrayOf(models.body)?.length ?? 0,
      version,
      accounts: Number.isFinite(accounts) ? accounts : null,
      requests: Number.isFinite(requests) ? requests : null,
    })
    busyRef.current = false
  }, [])

  // 进页面自动检测一轮：信号与理由见文件头「网关健康」一节。check 有 busyRef
  // 挡重复，快速来回切页不会叠出多轮请求。
  useEffect(() => {
    const section = document.querySelector('.page[data-page="docs"]')
    if (!section) return
    if (section.classList.contains('active')) void check()
    const observer = new MutationObserver(() => {
      if (section.classList.contains('active')) void check()
    })
    observer.observe(section, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [check])

  const gatewayValue = snap.gateway.ok === true
    ? (snap.gateway.ms > 0 ? `运行中 · ${snap.gateway.ms} ms` : '运行中')
    : snap.gateway.ok === false ? '不可达' : '—'
  const modelsValue = snap.models.ok === true
    ? `可用 · ${snap.modelCount} 个模型`
    : snap.models.ok === false ? '不可用' : '—'

  return (
    <Card as='section' variant='panel' size='sm' className='min-w-0'>
      <CardHeader variant='panel'>
        <CardTitle>网关健康</CardTitle>
        <InfoTip label={'网关健康面板说明'}>{HEALTH_TIP}</InfoTip>
        <div className='ml-auto'>
          <Button variant='outline' size='sm' disabled={snap.checking} onClick={() => void check()}>
            {snap.checking ? <Spinner data-icon='inline-start' /> : <RefreshCwIcon data-icon='inline-start' />}
            {snap.checking ? t('检测中…') : t('重新检测')}
          </Button>
        </div>
      </CardHeader>
      <CardContent variant='panel'>
        <div className='grid min-w-0 gap-3 md:grid-cols-3'>
          <HealthCard
            name='网关进程'
            tone={snap.gateway.ok === true ? 'ok' : snap.gateway.ok === false ? 'bad' : 'idle'}
            value={gatewayValue}
            hint={GATEWAY_HINT}
            error={probeError(snap.gateway)}
          />
          <HealthCard
            name='模型清单'
            tone={snap.models.ok === true ? 'ok' : snap.models.ok === false ? 'bad' : 'idle'}
            value={modelsValue}
            hint={MODELS_HINT}
            error={probeError(snap.models)}
          />
          <HealthCard
            name='引擎版本'
            tone={snap.version ? 'info' : 'idle'}
            value={snap.version || '—'}
            hint={VERSION_HINT}
            error=''
          />
        </div>
      </CardContent>
      <CardFooter variant='panel' className='justify-between'>
        <span>
          {'探活请求不带鉴权头、与页面同源；探活只看 HTTP 状态 —— '}
          <code>{'{"status":"ok"}'}</code>
          {' 或空模型清单同样算通过。'}
        </span>
        {snap.accounts !== null ? (
          <span>{`账号池 ${snap.accounts} 个账号 · 请求记录 ${snap.requests ?? 0} 条`}</span>
        ) : null}
      </CardFooter>
    </Card>
  )
}

/* ─── 页面 ─────────────────────────────────── */

function DocsPage() {
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <Card as='section' variant='panel' size='sm'>
        <CardHeader variant='panel'>
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <CardTitle>{t('接口地址')}</CardTitle>
            <CardDescription>{t('将 Base URL 填入客户端的「API 地址 / Base URL」。')}</CardDescription>
          </div>
          <InfoTip label={t('接口地址说明')}>{PANEL_TIP}</InfoTip>
        </CardHeader>
        <CardContent variant='panel'>
          <CodeBlock>
            <CodeBlockHeader>
              <CodeBlockTitle>Base URL</CodeBlockTitle>
              <CodeBlockActions><CopyAddress from='api-base' label={t('复制 Base URL')} text /></CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent aria-label='Base URL'><span id='api-base'>—</span></CodeBlockContent>
          </CodeBlock>
        </CardContent>
        <CardFooter variant='panel'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <Badge variant='secondary'>{t('Key 鉴权')}</Badge>
            <span>{t('使用「网关 Key」页中任一启用的 Key：')}</span>
            <code>{'Authorization: Bearer <key>'}</code>
            <span>{t('或')}</span>
            <code>{'x-api-key: <key>'}</code>
            <InfoTip label={t('鉴权与部署说明')}>{t('一把启用的 Key 都没有时不鉴权（默认网关只监听 127.0.0.1；在设置页开启「局域网访问」后监听所有网卡，鉴权与安全闸门随之启用）。服务器部署默认拒绝无 Key 的转发；创建第一把 Key 后恢复。')}</InfoTip>
          </div>
        </CardFooter>
      </Card>
      <div className='grid min-w-0 items-start gap-4 xl:grid-cols-2'>
        <Card as='section' variant='panel' size='sm' className='min-w-0'>
          <CardHeader variant='panel'>
            <div className='flex flex-col gap-1'>
              <CardTitle>{t('协议与端点')}</CardTitle>
              <CardDescription>{t('按客户端支持的协议选择，共用同一套模型与账号池。')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent variant='panel'>
            <ItemGroup aria-label={t('接口端点')}>
              <EndpointRow id='api-chat' name='OpenAI Chat Completions' note={t('多数 OpenAI 兼容客户端的默认协议')} />
              <EndpointRow id='api-responses' name='OpenAI Responses' note={t('OpenAI 新协议（Codex、新版 SDK）')} />
              <EndpointRow id='api-messages' name='Anthropic Messages' note={t('Claude Code / Anthropic SDK（token 计数：/v1/messages/count_tokens）')} />
              <EndpointRow id='api-models' name={t('模型列表')} note={t('客户端自动拉取可用模型；不受鉴权限制，配 Key 之前就能拉')} />
            </ItemGroup>
          </CardContent>
        </Card>
        <QuickStartPanel />
      </div>
      <HealthPanel />
    </div>
  )
}

/* ─── 挂载：接管 index.html 里既有的页面区块 ─────── */

const PAGE_SELECTOR = '.page[data-page="docs"]'

let mounted = false

/**
 * 把 React root 直接建在既有页面区块上，先清掉静态骨架，避免与 React 重复渲染。
 */
function mount(): void {
  if (mounted) return
  const section = document.querySelector<HTMLElement>(PAGE_SELECTOR)
  if (!section) return
  mounted = true
  section.replaceChildren()
  // 同步提交（与 login-page / settings-page 同一手法）：bundle 里本文件按字典序
  // 排在 port-panel.tsx 之前，而那边的模块初始化会立刻把接口地址写进下面渲染的
  // 五个 id 元素 —— render() 默认交给调度器异步提交的话，那五笔写入会扑空（元素
  // 还不存在，paint 静默跳过），文档页地址就永远停在占位的「—」。
  flushSync(() => {
    createRoot(section).render(<DocsPage />)
  })
}

// 脚本排在页面骨架之后（index.html 里 islands/ui.js 在各 section 之后），正常直接挂；
// 万一将来被挪到前面，退化成等 DOM 解析完再挂。
if (document.querySelector(PAGE_SELECTOR)) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
