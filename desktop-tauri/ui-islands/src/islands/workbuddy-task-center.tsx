import * as React from 'react'
import { Alert, AlertDescription, Badge, Button, Empty, EmptyHeader, EmptyDescription, Input, Tabs, TabsList, TabsTrigger, TabsContent, Collapsible, CollapsibleTrigger, CollapsibleContent, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, Switch } from '@ui'
import { taskRequest, taskAccount } from './task-center-api'
import { DEFAULT_PAGE_SIZE, SERVER_PAGE_SIZES, TableFooter, readPageSize, writePageSize } from './table-shell'
import { t } from '../i18n'
import { WorkBuddyTasksDialog } from './workbuddy-tasks-dialog'
import type { AccountRecord } from './accounts-shared'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@ui'

type AccountRow = { id: string; name?: string; provider?: string; edition?: string }
type Step = { code: string; outcome: string; message: string; credit?: number | null; energy?: number | null }
type Run = { id: number; accountId: string; accountName: string; kind: string; provider: string; source: string; startedAt: number; finishedAt?: number; outcome: string; message: string; items?: Step[] }
type Queue = { lastError?: string; running?: boolean; total?: number; done?: number; items?: { accountId: string; accountName: string; taskCode: string; status: string; message: string; runId?: number }[] }
type ScheduleRow = { kind: string; running?: boolean; lastRunAt?: number; lastOutcome?: string; nextRunAt?: number; reason?: string }
type Schedule = Record<string, unknown> & { tasks?: ScheduleRow[]; recordRetentionDays?: number }
const TASKS = [
  { kind: 'growth', name: '成长任务', flag: 'growthEnabled', time: 'growthTime', desc: '执行已支持的成长任务并领奖，排除夜猫；部分任务会消耗模型积分。' },
  { kind: 'night', name: '夜猫任务', flag: 'blackcatEnabled', time: 'blackcatTime', desc: '仅执行夜猫任务；北京时间23:00–08:00内按进度补足真实对话，可能消耗积分。' },
  { kind: 'travel', name: '猫猫旅行', flag: 'travelEnabled', time: 'travelHours', desc: '领养、派出、到站领奖；领奖后查询是否可以接续派出。' },
  { kind: 'activity', name: '活跃上报', flag: 'activityEnabled', time: 'activityTime', desc: '国内与国际版每天上报一次事件并验证，不自动补发真实对话。' },
  { kind: 'rewards', name: '奖励管家', flag: 'streakEnabled', time: 'streakTime', desc: '领取礼包、补偿、已达标档位和任务奖励；保留补签卡与抽奖机会。' },
]
const OUTCOMES: Record<string, string> = { success: '成功', ok: '成功', already: '已完成／已领取', skipped: '正常跳过', pending: '已提交待验证', pending_verification: '已提交待验证', failed: '失败', cancelled: '已取消', interrupted: '执行中断', running: '执行中', schedule: '定时', startup: '启动补跑', manual: '手动', pending_start: '等待执行' }
const RECORD_FILTER_LABELS = { kind: '全部任务', outcome: '全部结果', provider: '全部版本', source: '全部来源' } as const
function recordFilterOptions(key: keyof typeof RECORD_FILTER_LABELS): readonly (readonly [string, string])[] {
  if (key === 'kind') return TASKS.map(task => [task.kind, task.name] as const)
  if (key === 'provider') return [['workbuddy', '国内版'], ['workbuddy-intl', '国际版']]
  const values = key === 'source' ? ['manual', 'schedule', 'startup'] : ['success', 'already', 'skipped', 'pending', 'failed', 'cancelled', 'interrupted']
  return values.map(value => [value, OUTCOMES[value]] as const)
}
const title = (kind: string) => TASKS.find(task => task.kind === kind)?.name || kind
const time = (value?: number) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
function Outcome({ value }: { value: string }) { return <Badge variant={value === 'failed' ? 'destructive' : ['success', 'ok', 'already'].includes(value) ? 'success' : 'outline'}>{t(OUTCOMES[value] || value)}</Badge> }
function navigate(page: string) { (window as unknown as { wbApp?: { showPage?: (page: string) => void } }).wbApp?.showPage?.(page) }

export function WorkbuddyTaskCenter({ maintenance }: { maintenance: React.ReactNode }) {
  const [tab, setTab] = React.useState('overview')
  const [accounts, setAccounts] = React.useState<AccountRow[]>([])
  const [accountId, setAccountId] = React.useState(taskAccount)
  const [dialog, setDialog] = React.useState<AccountRow | null>(null)
  const [schedule, setSchedule] = React.useState<Schedule | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [queue, setQueue] = React.useState<Queue | null>(null)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [runs, setRuns] = React.useState<Run[]>([])
  const [total, setTotal] = React.useState(0)
  const [offset, setOffset] = React.useState(0)
  const [recordSize, setRecordSize] = React.useState(() => {
    const saved = readPageSize('task-records', SERVER_PAGE_SIZES)
    return typeof saved === 'number' ? saved : DEFAULT_PAGE_SIZE
  })
  const [recordLoading, setRecordLoading] = React.useState(false)
  const recordRequest = React.useRef(0)
  const [filters, setFilters] = React.useState({ kind: '', outcome: '', provider: '', source: '', from: '', to: '' })
  const [details, setDetails] = React.useState<Record<number, Run>>({})
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [scanned, setScanned] = React.useState<unknown>(null)
  const [concurrency, setConcurrency] = React.useState('1')
  const [travel, setTravel] = React.useState<Record<string, unknown> | null>(null)
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
  const loadSchedule = React.useCallback(async () => setSchedule(await taskRequest<Schedule>('GET', '/api/growth-tasks/schedule')), [])
  const loadAccounts = React.useCallback(async () => {const data=await taskRequest<{accounts?:AccountRow[]}>('GET','/api/accounts');setAccounts((data.accounts || []).filter(a=>['workbuddy','workbuddy-intl'].includes(a.provider || '')))},[])
  const loadQueue = React.useCallback(async () => setQueue(await taskRequest<Queue>('GET', '/api/growth-tasks/queue')), [])
  React.useEffect(() => { void Promise.all([loadSchedule(), loadQueue(), taskRequest<{ accounts?: AccountRow[] }>('GET', '/api/accounts').then(data => setAccounts((data.accounts || []).filter(a => ['workbuddy', 'workbuddy-intl'].includes(a.provider || ''))))]).catch(reportError) }, [loadSchedule, loadQueue])
  React.useEffect(() => { const timer=setInterval(() => { if(!document.hidden) void loadQueue().catch(reportError) },20000);return () => clearInterval(timer) },[loadQueue])
  React.useEffect(() => { if (!queue?.running) return; const timer = setTimeout(() => void Promise.all([loadQueue(), loadSchedule()]).catch(reportError), 3000); return () => clearTimeout(timer) }, [queue, loadQueue, loadSchedule])
  React.useEffect(() => { const handler = (event: Event) => { const id = (event as CustomEvent<string>).detail; setAccountId(id); setTab('overview') }; window.addEventListener('wb:task-account', handler); return () => window.removeEventListener('wb:task-account', handler) }, [])
  const loadRecords = React.useCallback(async () => {
    const request = ++recordRequest.current
    setRecordLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(recordSize), offset: String(offset), ...(accountId ? { accountId } : {}) })
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, key === 'from' || key === 'to' ? String(new Date(value + ':00+08:00').getTime()) : value)
      const result = await taskRequest<{ items: Run[]; total: number }>('GET', '/api/task-records?' + params)
      if (request !== recordRequest.current) return
      setRuns(result.items); setTotal(result.total); setError('')
      const lastOffset = Math.max(0, (Math.ceil(result.total / recordSize) - 1) * recordSize)
      if (offset > lastOffset) setOffset(lastOffset)
    } catch (cause) {
      if (request === recordRequest.current) throw cause
    } finally {
      if (request === recordRequest.current) setRecordLoading(false)
    }
  }, [offset, recordSize, accountId, filters])
  React.useEffect(() => { if (tab === 'records') void loadRecords().catch(reportError) }, [tab, loadRecords])
  async function save(patch: Record<string, unknown>) { setBusy(true); setError(''); try { setSchedule(await taskRequest('PUT', '/api/growth-tasks/schedule', patch));setDraft(old => {const next={...old};for(const key of Object.keys(patch)) delete next[key === 'recordRetentionDays' ? 'retention' : key];return next}) } catch (e) { reportError(e) } finally { setBusy(false) } }
  async function run(kind: string, mode = 'full') { setBusy(true); setError(''); try { const result=await taskRequest<{total:number}>('POST', '/api/growth-tasks/run', { taskKind: kind, mode, concurrency: Number(concurrency), ...(accountId ? { accountId } : {}) }); setNotice(result.total ? t('任务已加入后台队列') : t('本轮没有可执行待办，详情见执行记录')); await loadQueue() } catch (e) { reportError(e) } finally { setBusy(false) } }
  async function scan() { setBusy(true); setError(''); try { setScanned(await taskRequest('GET', '/api/growth-tasks/scan')); if (accountId) { const v = await taskRequest<{ travel?: Record<string, unknown> }>('GET', '/api/accounts/' + encodeURIComponent(accountId) + '/growth'); setTravel(v.travel || null) } } catch (e) { reportError(e) } finally { setBusy(false) } }
  async function manualReward(action: string) {
    if(!accountId) return
    setBusy(true);setError('')
    try { const r=await taskRequest<{message:string}>('POST','/api/growth-tasks/rewards',{accountId,action});setNotice(r.message);await loadQueue() }catch(e){reportError(e)}finally{setBusy(false)}
  }
  async function detail(id: number) { if (expanded === id) { setExpanded(null); return }; try { const v = await taskRequest<Run>('GET', '/api/task-records/' + id); setDetails(old => ({ ...old, [id]: v })); setExpanded(id) } catch (e) { reportError(e) } }
  const selected = accounts.find(a => a.id === accountId)
  return <Tabs value={tab} onValueChange={next => setTab(String(next))} className='contents'><Card as='section' variant='panel' size='sm' className='panel'>
    <CardHeader variant='panel' className='panel-head'><CardTitle>{t('任务中心')}</CardTitle><Badge id='tasks-badge' variant={queue?.running ? 'warning' : 'outline'}>{queue?.running ? t('执行中') : t('自动任务')}</Badge><span className='panel-sub'>{t('北京时间 · 后台执行 · 结果可追踪')}</span><div className='head-actions'><Button size='sm' variant='outline' onClick={() => void Promise.all([loadSchedule(), loadQueue(), loadAccounts(), tab === 'records' ? loadRecords() : Promise.resolve()]).catch(reportError)}>{t('刷新')}</Button><Button size='sm' variant='ghost' onClick={() => navigate('checkin')}>{t('签到中心')}</Button></div></CardHeader>
    <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3'>
      <TabsList aria-label={t('任务中心标签')}>{[{ value: 'overview', label: t('任务总览') }, { value: 'schedule', label: t('自动排程') }, { value: 'records', label: t('执行记录') }].map(option => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}</TabsList>
      <Select value={accountId || '__all__'} onValueChange={next => {
        if (next === null) return
        setAccountId(next === '__all__' ? '' : String(next)); setOffset(0); setTravel(null)
      }}>
        <SelectTrigger aria-label={t('账号范围')} className='max-w-full'>
          <SelectValue>{selected ? `${selected.name || selected.id} · ${selected.provider === 'workbuddy-intl' ? t('国际版') : t('国内版')}` : accountId || t('全部符合条件的账号')}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value='__all__'>{t('全部符合条件的账号')}</SelectItem>
            {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name || a.id} · {a.provider === 'workbuddy-intl' ? t('国际版') : t('国内版')}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
    <CardContent variant='panel' className='panel-body overflow-auto'>
      {queue?.lastError ? <Alert variant='destructive' className='m-4 w-auto'><AlertDescription>{queue.lastError}</AlertDescription></Alert> : null}
      {error ? <Alert variant='destructive' className='m-4 w-auto'><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert role='status' className='m-4 w-auto'><AlertDescription>{notice}</AlertDescription></Alert> : null}
      <TabsContent value='overview' keepMounted><div className='flex flex-col gap-5 p-4'>
        <div className='rounded-lg border border-border p-4'><div className='flex flex-wrap items-center justify-between gap-3'><div><h3 className='font-semibold'>{t('WorkBuddy任务')}</h3><p className='mt-1 text-xs text-subtle'>{t('成长、旅行和夜猫仅国内版；活跃上报覆盖两版。需要对话的任务可能消耗积分。')}</p></div><div className='flex flex-wrap gap-2'><Select value={concurrency} disabled={busy || queue?.running} onValueChange={next => { if (next !== null) setConcurrency(String(next)) }}>
              <SelectTrigger aria-label={t('手动账号并发')}><SelectValue>{t('并发')} {concurrency}</SelectValue></SelectTrigger>
              <SelectContent><SelectGroup>{[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{t('并发')} {n}</SelectItem>)}</SelectGroup></SelectContent>
            </Select><Button size='sm' variant='outline' disabled={busy || queue?.running} onClick={() => void scan()}>{t('查询任务')}</Button>{selected && selected.provider !== 'workbuddy-intl' ? <Button size='sm' variant='outline' onClick={() => setDialog(selected)}>{t('账号任务详情')}</Button> : null}<Button size='sm' variant='outline' disabled={busy || queue?.running} onClick={() => void run('growth', 'claim')}>{t('仅领取奖励')}</Button></div></div>
          <div className='mt-4 grid gap-2 sm:grid-cols-2'>{TASKS.map(task => <div key={task.kind} className='flex items-center justify-between gap-3 rounded-md border border-border p-3'><div><strong className='text-sm'>{t(task.name)}</strong><p className='mt-1 text-xs text-subtle'>{t(task.desc)}</p></div><Button size='sm' variant='outline' disabled={busy || queue?.running || (!!selected && selected.provider === 'workbuddy-intl' && task.kind !== 'activity')} onClick={() => void run(task.kind)}>{t('立即执行')}</Button></div>)}</div>
          {selected && selected.provider !== 'workbuddy-intl' ? <div className='mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3'><span className='text-xs text-subtle'>{t('手动使用权益')}</span><Button size='sm' variant='outline' disabled={busy || queue?.running} onClick={() => void manualReward('makeup')}>{t('使用补签卡补昨日')}</Button><Button size='sm' variant='outline' disabled={busy || queue?.running} onClick={() => void manualReward('lottery')}>{t('抽奖一次')}</Button></div> : null}
          {travel ? <p className='mt-3 text-sm'>{t('猫猫旅行')}：{String(travel.buddyName || '')} · {String(travel.state || (travel.hasBuddy === false ? t('未领养') : travel.error || t('尚未查询')))}</p> : null}
          {scanned ? <p className='mt-3 text-xs text-subtle'>{t('任务查询完成，可从账号详情查看进度；国际版不参与成长任务扫描。')}</p> : null}
        </div>
        <div className='rounded-lg border border-border p-4'><div className='flex justify-between gap-3'><h3 className='font-semibold'>{t('执行进度')} · {queue?.done || 0}/{queue?.total || 0}</h3>{queue?.running ? <Button size='sm' variant='outline' onClick={() => void taskRequest('POST', '/api/growth-tasks/stop').then(loadQueue).catch(reportError)}>{t('停止后续步骤')}</Button> : null}</div>{queue?.items?.length ? <div className='mt-3 flex flex-col divide-y divide-border'>{queue.items.map((item, i) => <div key={i} className='flex flex-wrap items-center gap-2 py-2 text-sm'><span className='min-w-24'>{item.accountName}</span><span>{item.taskCode.startsWith('@') ? title(item.taskCode.slice(1)) : item.taskCode}</span><Outcome value={item.status === 'pending' ? 'pending_start' : item.status} /><span className='text-xs text-subtle'>{item.message}</span></div>)}</div> : <p className='mt-3 text-sm text-subtle'>{t('当前没有运行任务。历史结果可在执行记录中查询。')}</p>}</div>
        <div><h3 className='mb-3 text-sm font-semibold text-subtle'>{t('系统维护')}</h3>{maintenance}</div>
      </div></TabsContent>
      <TabsContent value='schedule' keepMounted><div className='flex flex-col gap-3 p-4'><p className='text-sm text-subtle'>{t('未配置的任务默认开启，已保存的选择保持不变。关闭页面不影响执行；关闭开关停止尚未开始的自动任务。')}</p>{!schedule ? <p>{t('正在读取排程…')}</p> : TASKS.map(task => { const status = schedule.tasks?.find(row => row.kind === task.kind); return <div key={task.kind} className='rounded-lg border border-border p-4'><div className='flex flex-wrap items-start justify-between gap-3'><div className='flex min-w-0 gap-3'><Switch aria-label={t(task.name) + t('自动执行')} checked={schedule[task.flag] === true} disabled={busy} onCheckedChange={value => void save({ [task.flag]: value })} /><div><h3 className='text-sm font-semibold'>{t(task.name)}</h3><p className='mt-1 text-xs text-subtle'>{t(task.desc)}</p></div></div><div className='flex flex-wrap items-center gap-2'><label className='text-xs text-subtle'>{t('北京时间')}<Input aria-label={t(task.name) + t('执行时刻')} type={task.kind === 'travel' ? 'text' : 'time'} className='ml-2 inline-flex w-28 max-w-28' value={draft[task.time] ?? (Array.isArray(schedule[task.time]) ? (schedule[task.time] as number[]).join(',') : String(schedule[task.time] || ''))} onChange={e => setDraft(d => ({ ...d, [task.time]: e.target.value }))} /></label><Button size='sm' variant='outline' disabled={busy || draft[task.time] === undefined} onClick={() => { const v = draft[task.time]; if(task.kind==='travel' && !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(v.trim())){setError(t('旅行时刻请填写英文逗号分隔的小时'));return;} void save({ [task.time]: task.kind === 'travel' ? v.split(',').map(n => Number(n.trim())) : v }); }}>{t('保存时刻')}</Button><Button size='sm' variant='outline' disabled={busy || queue?.running} onClick={() => void run(task.kind)}>{t('立即执行')}</Button></div></div><div className='mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-subtle'><span>{t('范围')}：{task.kind === 'activity' ? t('全部可用WorkBuddy账号（两版）') : t('全部可用WorkBuddy国内版账号')}</span><span>{t('下次')}：{time(status?.nextRunAt)}</span><span>{t('最近')}：{time(status?.lastRunAt)} {status?.lastOutcome ? <Outcome value={status.lastOutcome} /> : null}</span></div>{task.kind === 'travel' ? <p className='mt-2 text-xs text-subtle'>{t('旅行时刻为0–23的整点，以英文逗号分隔，例如9,21。')}</p> : null}</div> })}</div></TabsContent>
      <TabsContent value='records' keepMounted><div className='flex flex-col gap-3 p-4'><div className='flex flex-wrap gap-2'>{(['kind', 'outcome', 'provider', 'source'] as const).map(key => <Select key={key} value={filters[key] || '__all__'} onValueChange={next => {
            if (next === null) return
            setOffset(0); setFilters(f => ({ ...f, [key]: next === '__all__' ? '' : String(next) }))
          }}>
            <SelectTrigger aria-label={key}>
              <SelectValue>{t(recordFilterOptions(key).find(([value]) => value === filters[key])?.[1] || RECORD_FILTER_LABELS[key])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='__all__'>{t(RECORD_FILTER_LABELS[key])}</SelectItem>
                {recordFilterOptions(key).map(([value, name]) => <SelectItem key={value} value={value}>{t(name)}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>)}{(['from', 'to'] as const).map(key => <label key={key} className='flex items-center gap-1 text-xs'>{key === 'from' ? t('从') : t('至')}<Input type='datetime-local' aria-label={key === 'from' ? t('起始时间（北京时间）') : t('结束时间（北京时间）')} value={filters[key]} onChange={e => { setOffset(0); setFilters(f => ({ ...f, [key]: e.target.value })) }} /></label>)}</div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-subtle'>{t('记录保留天数')}<Input type='number' min={1} max={3650} className='w-20 max-w-20' value={draft.retention ?? String(schedule?.recordRetentionDays ?? 90)} onChange={e => setDraft(d => ({ ...d, retention: e.target.value }))} /><Button size='xs' variant='outline' disabled={busy || !draft.retention} onClick={() => void save({ recordRetentionDays: Number(draft.retention) })}>{t('保存')}</Button><span>{t('仅明确的上游领奖返回值计入确认收益；未提供显示为—。')}</span></div>
        {!runs.length ? <Empty><EmptyHeader><EmptyDescription>{t('此筛选范围没有执行记录')}</EmptyDescription></EmptyHeader></Empty> : runs.map(run => <Collapsible key={run.id} open={expanded === run.id} onOpenChange={() => void detail(run.id)} className='rounded-lg border border-border'><CollapsibleTrigger render={<Button variant='ghost' className='h-auto w-full flex-wrap justify-start gap-x-4 gap-y-2 p-3' />}><span className='font-medium'>{run.accountName}</span><span>{t(title(run.kind))}</span><Outcome value={run.outcome} /><span className='text-xs text-subtle'>{time(run.startedAt)} · {t(OUTCOMES[run.source] || run.source)}</span><span className='ml-auto text-xs text-subtle'>#{run.id} {expanded === run.id ? '−' : '+'}</span></CollapsibleTrigger><CollapsibleContent keepMounted className='border-t border-border px-3 py-2 text-sm'><p className='mb-2 text-xs text-subtle'>{run.message} · {t('结束')} {time(run.finishedAt)}</p>{details[run.id]?.items?.map((item, i) => <div key={i} className='flex flex-wrap items-center gap-2 border-t border-border py-2'><span>{item.code}</span><Outcome value={item.outcome} /><span className='text-xs'>{item.message}</span><span className='ml-auto text-xs tabular-nums'>{t('确认积分')} {item.credit ?? '—'} · {t('能量')} {item.energy ?? '—'}</span></div>)}</CollapsibleContent></Collapsible>)}
        <TableFooter variant='inline'
          total={total} range={{ start: total ? offset + 1 : 0, end: offset + runs.length }}
          page={Math.floor(offset / recordSize) + 1} pageCount={Math.max(1, Math.ceil(total / recordSize))}
          size={recordSize} sizes={SERVER_PAGE_SIZES} disabled={recordLoading}
          onSizeChange={next => {
            if (typeof next !== 'number') return
            writePageSize('task-records', next); setRecordSize(next); setOffset(0)
          }}
          onPageChange={page => setOffset((page - 1) * recordSize)} />
      </div></TabsContent>
    </CardContent>
    <CardFooter variant='panel' className='panel-foot'><span>{t('排程与执行记录保存在本地数据库')}</span><span>{t('补签卡与抽奖仅手动使用')}</span></CardFooter>
    {dialog ? <WorkBuddyTasksDialog account={dialog as AccountRecord} onClose={() => setDialog(null)} /> : null}
  </Card></Tabs>
}
