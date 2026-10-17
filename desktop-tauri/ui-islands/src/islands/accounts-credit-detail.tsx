/**
 * Account credit packs: a compact balance trigger opens a searchable side sheet.
 * Figures and pack ordering come from the provider; unknown values stay unknown.
 * Displayed amounts use at most two decimals; exact upstream values remain in titles.
 */

import * as React from 'react'
import { Badge, Button, Empty, EmptyHeader, EmptyDescription, Input, Progress, ScrollArea, Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, Tabs, TabsList, TabsTrigger, TabsContent, cn } from '@ui'
import { PanelRightOpen, X } from 'lucide-react'
import { t } from '../i18n'
import { formatTime, numberText, type UsageEntry } from './accounts-shared'

/** 明细里的一行（`creditRowsOf` 的产物；渲染输入与 `usageDetailOf` 的行同形） */
export type CreditRow = {
  name: string
  /** 右侧读数：『剩 x / y [单位]』；一个数都读不到时给「—」 */
  view: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  /** **剩余**百分比（条画的是剩余，与其余几处同向）；null = 不画条 */
  percent: number | null
  /** 「领取 … · 到期 …」那一行（两边都没有就 null） */
  window: string | null
  /** 悬停全文（完整时刻、来源、为什么没条 —— 界面上不放长句的原因） */
  title: string
  /**
   * 这一份还能不能花。两条判据：**剩余读到 0**（或已用 ≥ 总量）算耗尽，
   * **到期时刻已过**算作废 —— 对看盘的人来说「花不出去」是同一件事，
   * 都收进弹层末尾那组（见 `CreditDetailButton`）。
   *
   * 两种"看着像用完、其实没完"的必须留在主列表：**每日重置**的包明天回满
   * （`remain` 现在就是 0），**不限量**的（`-1` 哨兵）本来就花不完。
   */
  spent: boolean
}

/**
 * 数值字段 → number 或 null。
 *
 * 与 `usagePool` 的 `numberOrNull` 同一口径且同样不能省：`Number(null)` 是 0，
 * 照直转换会把「上游没给」变成「这个数是 0」。后端的 `credits[]` 已经缺键不写，
 * 这里是第二道闸。
 */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function amountText(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** 毫秒时间戳 → `MM-DD HH:mm`（年份在悬停的完整时刻里；取不出来给空串） */
function shortTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 行单位 → 界面文案。
 *
 * 后端 `credits[].unit` 是**口径名**（积分 / 额度），不是界面文案；主读数那一路
 * （`usageSummary` 的「可用 {value} {unit}」）也照原样显示，中文界面下两者一致。
 * 这里只把能翻译的两个过一遍词典，别让英文界面里冒出「额度」两个汉字
 * （其余取值原样透出 —— 认不出的口径宁显原名，与各家 `quota_meter_label`
 * 的回落同一取向）。
 */
function unitLabel(unit: string): string {
  if (unit === '积分') return t('积分')
  if (unit === '额度') return t('额度')
  return unit
}

/**
 * 读数文档 → 明细行（没有 `credits` 数组、或数组为空 → 空数组）。
 *
 * 顺序**照后端给的那份**：各家都在后端排好了（如 Trae 按最近到期在前、WorkBuddy
 * 按套餐优先级 + 到期升序；排序口径与各自的聚合读数同源）。前端再排一次只会让两处
 * 的口径分叉。
 */
export function creditRowsOf(entry: UsageEntry): CreditRow[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
  const data = entry as Record<string, unknown>
  const packs = Array.isArray(data.credits) ? data.credits as Array<Record<string, unknown>> : []
  const now = Date.now()
  return packs.map(pack => {
    const name = String(pack?.name || '').trim() || t('积分包')
    const unit = String(pack?.unit || '').trim()
    const total = numberOrNull(pack?.total)
    const used = numberOrNull(pack?.used)
    const remain = numberOrNull(pack?.remain)
    const unlimited = pack?.unlimited === true
    const grantAt = numberOrNull(pack?.grantAt)
    const startAt = numberOrNull(pack?.startAt)
    const expireAt = numberOrNull(pack?.expireAt)
    const daily = pack?.daily === true
    const reason = String(pack?.grantReason || '').trim()
    const expired = expireAt !== null && expireAt > 0 && expireAt <= now

    // ── 读数 ────────────────────────────────────────────────
    // 「不限」写在读数里而不是画一个数：-1 那种哨兵值摆上屏会被读成"欠费"。
    // 单位贴在整串末尾（「剩 400 / 500 额度」），不夹在中间 —— 中间那一版读起来
    // 像「剩 400 额度 / 共 500 额度」的省略写法，数字与单位的归属全靠猜。
    // 三个数都过 `numberText`：上游给的是高精度浮点（`39.430000335` 这种），
    // 照直拼会把小数尾巴铺满弹层（口径见 accounts-shared 那个函数）。
    const hasTotal = total !== null && total > 0
    const amount = unlimited
      ? t('不限')
      : remain !== null
        ? hasTotal
          ? t('剩 {remaining} / {total}', { remaining: amountText(remain), total: amountText(total!) })
          : t('剩 {remaining}', { remaining: amountText(remain) })
        : used !== null
          ? t('已用 {used}', { used: amountText(used) })
          : '—'
    const view = !unlimited && unit && amount !== '—' ? `${amount} ${unitLabel(unit)}` : amount
    // 剩余比例：只在有真总量时算（画不出比例就不装作有）
    const percent = hasTotal && remain !== null
      ? Math.max(0, Math.min(100, (remain / total) * 100))
      : null

    // ── 还能不能花（分组用，见 CreditRow.spent）────────────────
    // 「用完」认两个读数：剩余读到 0；剩余读不到但「已用 ≥ 总量」也认 ——
    // 上游只给 used/total 的那一档同样答得出这个问题，不该因为缺 remain 就漏判。
    // 两者都读不到时**不猜**（宁留在主列表让人看见，也不凭空的把它折叠起来）。
    const exhausted = (remain !== null && remain <= 0)
      || (remain === null && used !== null && hasTotal && used >= total)
    const spent = !unlimited && !daily && (exhausted || expired)

    // ── 领取 → 到期 ─────────────────────────────────────────
    // 左边那一半两个来源，**名字必须跟着来源变**：`grantAt`（上游的发放时刻）
    // 才叫「领取」；只剩 `startAt`（抵扣开始）时写「生效」—— 这两件事不能混称，
    // 缺了发放时刻就标成「领取」等于替上游编一个到手时间。
    const parts: string[] = []
    if (grantAt !== null && grantAt > 0) {
      parts.push(t('{time} 领取', { time: shortTime(grantAt) }))
    } else if (startAt !== null && startAt > 0) {
      parts.push(t('{time} 生效', { time: shortTime(startAt) }))
    }
    if (daily) {
      // 日额度包的「到期」是今天 24 点（周期边界），不是这笔钱作废 ——
      // 照「到期」写会让人以为额度明天就没了（实际是重置回满）
      parts.push(t('每日重置'))
    } else if (expireAt !== null && expireAt > 0) {
      parts.push(expired ? t('已过期') : t('{time} 到期', { time: shortTime(expireAt) }))
    }
    if (reason) parts.push(reason)

    // ── 语义色与悬停 ────────────────────────────────────────
    const tone: CreditRow['tone'] = expired || remain === 0
      ? 'muted'
      : percent !== null && percent < 20
        ? 'warn'
        : remain === null && used === null && !unlimited
          ? 'muted'
          : 'ok'
    const title = [
      name,
      view,
      remain !== null ? t('剩 {remaining}', { remaining: remain }) : '',
      grantAt !== null && grantAt > 0
        ? t('领取 {time}', { time: formatTime(grantAt) })
        : startAt !== null && startAt > 0
          ? t('生效 {time}', { time: formatTime(startAt) })
          : '',
      expireAt !== null && expireAt > 0
        ? (expired
          ? t('已过期（{time}）', { time: formatTime(expireAt) })
          : t('到期 {time}', { time: formatTime(expireAt) }))
        : '',
      daily ? t('每日重置（额度按周期回满，不是作废）') : '',
      reason,
      percent === null && remain !== null ? t('上游未给总量，画不出剩余比例') : '',
      used !== null && total !== null ? t('已用 {used} / 共 {total}', { used: numberText(used), total: numberText(total) }) : '',
    ].filter(Boolean).join(' · ')
    return { name, view, tone, percent, window: parts.length ? parts.join(' · ') : null, title, spent }
  })
}

/** Pack labels wrap fully; exact values and complete timestamps remain in the title. */
function CreditRowView({ row }: { row: CreditRow }) {
  return <article className='credit-detail-pack' title={row.title}>
    <div className='flex items-start justify-between gap-4'>
      <h3 className='min-w-0 flex-1 break-words text-sm font-medium leading-6'>{row.name}</h3>
      <span className={cn('shrink-0 pt-0.5 text-sm font-semibold tabular-nums', row.tone === 'warn' ? 'text-warning' : row.tone === 'muted' ? 'text-muted-foreground' : 'text-foreground')}>{row.view}</span>
    </div>
    {row.window ? <p className='mt-1 break-words text-xs leading-5 text-muted-foreground'>{row.window}</p> : null}
    {row.percent !== null ? <div className='mt-3 flex items-center gap-3'>
      <Progress value={row.percent} className='h-1 flex-1' aria-label={t('剩余 {percent}%', { percent: Math.round(row.percent) })} />
      <span className='w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>{Math.round(row.percent)}%</span>
    </div> : null}
  </article>
}

export function CreditDetailButton({ rows, subscriptionLine, accountName, balanceText, planName, variant, title, children }: {
  rows: CreditRow[]
  subscriptionLine: string
  accountName: string
  balanceText: string
  planName?: string
  variant: 'sum' | 'pool'
  kind: string
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState('available')
  const [search, setSearch] = React.useState('')
  const viewport = React.useRef<HTMLDivElement | null>(null)
  const liveRows = rows.filter(row => !row.spent)
  const spentRows = rows.filter(row => row.spent)
  const query = search.trim().toLocaleLowerCase()
  const filter = (items: CreditRow[]) => items.filter(row => !query || [row.name, row.view, row.window, row.title].join(' ').toLocaleLowerCase().includes(query))
  // Opening and switching views always starts at the first pack, without focus jumps.
  React.useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = 0 }, [open, tab, search])
  return <Sheet open={open} onOpenChange={next => { setOpen(next); if (next) { setTab('available'); setSearch('') } }}>
    <SheetTrigger render={<Button variant='outline' size='xs' className={cn('credit-detail-trigger', variant === 'pool' && 'credit-detail-trigger-pool')} title={title} aria-label={t('积分明细')} />}>
      <span className='credit-detail-trigger-value'>{children}</span>
      <PanelRightOpen data-icon='inline-end' aria-hidden='true' />
    </SheetTrigger>
    <SheetContent showCloseButton={false} className='credit-detail-sheet w-full gap-0 sm:max-w-[540px]'>
      <SheetHeader className='shrink-0 gap-1 border-b border-border px-6 py-5 pr-12'>
        <SheetTitle>{t('积分明细')}</SheetTitle>
        <SheetDescription>{accountName}{planName ? ' · ' + planName : ''}</SheetDescription>
        <SheetClose render={<Button variant='ghost' size='icon-sm' className='absolute right-4 top-4' aria-label={t('关闭')} />}><X data-icon='inline-start' aria-hidden='true' /></SheetClose>
      </SheetHeader>
      <div className='shrink-0 px-6 py-5' title={subscriptionLine || title}>
        <p className='text-xs text-muted-foreground'>{t('可用余额')}</p>
        <p className='mt-2 break-words text-3xl font-semibold tracking-tight tabular-nums'>{balanceText}</p>
        <p className='mt-2 text-xs text-muted-foreground'>{t('{count} 份可用积分包', { count: liveRows.length })}</p>
      </div>
      <Tabs value={tab} onValueChange={next => setTab(String(next))} className='min-h-0 flex-1 gap-0'>
        <div className='flex shrink-0 flex-col gap-4 border-b border-border px-6 pb-4'>
          <TabsList className='w-full' aria-label={t('积分包状态')}>
            <TabsTrigger value='available'>{t('可用')}<Badge variant='secondary'>{liveRows.length}</Badge></TabsTrigger>
            <TabsTrigger value='spent'>{t('已用完 / 已过期')}<Badge variant='secondary'>{spentRows.length}</Badge></TabsTrigger>
          </TabsList>
          <Input type='search' value={search} onChange={event => setSearch(event.target.value)} aria-label={t('搜索积分包')} placeholder={t('搜索积分包名称、来源或日期')} />
        </div>
        {([['available', liveRows], ['spent', spentRows]] as const).map(([value, items]) => <TabsContent key={value} value={value} className='min-h-0 overflow-hidden'>
          <ScrollArea className='h-full' viewportRef={value === tab ? viewport : undefined}>
            <div className='px-6 pb-6'>
              {filter(items).length ? filter(items).map((row, index) => <CreditRowView key={`${row.name}-${index}`} row={row} />)
                : <Empty variant='compact' className='py-12'><EmptyHeader><EmptyDescription>{query ? t('没有匹配的积分包') : t('暂无积分包')}</EmptyDescription></EmptyHeader></Empty>}
            </div>
          </ScrollArea>
        </TabsContent>)}
      </Tabs>
    </SheetContent>
  </Sheet>
}
