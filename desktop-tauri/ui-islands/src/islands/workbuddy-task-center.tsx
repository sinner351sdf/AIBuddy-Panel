import * as React from 'react'
import { InfoTip } from '../components/info-tip'
import { Alert, AlertDescription, Badge, Button, Empty, EmptyHeader, EmptyDescription, Input, Tabs, TabsList, TabsTrigger, TabsContent, Collapsible, CollapsibleTrigger, CollapsibleContent, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, Switch } from '@ui'
import { taskRequest, taskAccount } from './task-center-api'
import { DEFAULT_PAGE_SIZE, SERVER_PAGE_SIZES, TableFooter, readPageSize, writePageSize } from './table-shell'
import { t } from '../i18n'
import { WorkBuddyTasksDialog } from './workbuddy-tasks-dialog'
import type { AccountRecord } from './accounts-shared'
import type { AccountGrowthTask, AccountGrowthDetails } from './workbuddy-tasks-api'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@ui'
import { Card, CardHeader, CardTitle, CardContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@ui'

type AccountRow = { id: string; name?: string; provider?: string; edition?: string }
type Step = { code: string; outcome: string; message: string; credit?: number | null; energy?: number | null }
type Run = { id: number; accountId: string; accountName: string; kind: string; provider: string; source: string; startedAt: number; finishedAt?: number; outcome: string; message: string; items?: Step[] }
type Queue = { lastError?: string; running?: boolean; total?: number; done?: number; items?: { accountId: string; accountName: string; taskCode: string; status: string; message: string; runId?: number }[] }
type TaskScan = { scannedAt: number; results: { id: string; name: string; error?: string | null; tasks: AccountGrowthTask[] }[] }
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

function TaskQueryResults({ data, querying, onDetails }: { data: TaskScan; querying: boolean; onDetails(row: TaskScan['results'][number]): void }) {
  const tasks = data.results.flatMap(row => row.error ? [] : row.tasks)
  const claimable = tasks.filter(task => !task.claimed && !task.locked && task.claimable).length
  const failed = data.results.filter(row => row.error).length
  return <Collapsible defaultOpen key={data.scannedAt} render={<section aria-label={t('任务查询结果')} aria-busy={querying} />} className='my-4 rounded-lg border border-border'>
    <div className='flex flex-wrap items-center justify-between gap-3 px-3 py-3'>
      <div className='flex flex-col gap-1'>
        <h3 className='text-sm font-semibold'>{t('任务查询结果')}</h3>
        <p role='status' className='text-xs text-subtle'>{t('{accounts} 个账号 · {tasks} 项任务 · {claimable} 项可领取', { accounts: data.results.length, tasks: tasks.length, claimable })}{failed ? ' · ' + t('{n} 个账号查询失败', { n: failed }) : ''}</p>
        <span className='text-xs text-subtle'>{t('查询时间')}：{time(data.scannedAt)}</span>
      </div>
      <CollapsibleTrigger render={<Button size='sm' variant='ghost' />}>{t('展开／收起结果')}</CollapsibleTrigger>
    </div>
    <CollapsibleContent>
      {!data.results.length ? <Empty variant='compact'><EmptyHeader><EmptyDescription>{t('没有可查询的国内版账号')}</EmptyDescription></EmptyHeader></Empty> : data.results.map(row => <div key={row.id} className='border-t border-border'>
        <div className='flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2'>
          <span className='min-w-0 break-words text-sm font-medium'>{row.name || row.id}</span>
          <Badge variant='outline'>{t('国内版')}</Badge>
          <span className='text-xs text-subtle'>{t('{n} 项任务', { n: row.tasks.length })}</span>
          <Button size='sm' variant='outline' className='ml-auto' onClick={() => onDetails(row)}>{t('查看任务详情')}</Button>
        </div>
        {row.error ? <Alert variant='destructive' className='m-3 w-auto'><AlertDescription>{row.error}</AlertDescription></Alert> : !row.tasks.length ? <Empty variant='compact'><EmptyHeader><EmptyDescription>{t('该账号没有返回成长任务')}</EmptyDescription></EmptyHeader></Empty> : <Table aria-label={t('{name}的任务查询结果', { name: row.name || row.id })} className='min-w-[480px]' containerClassName='max-h-72'>
          <TableHeader><TableRow><TableHead>{t('任务')}</TableHead><TableHead>{t('进度')}</TableHead><TableHead>{t('奖励')}</TableHead><TableHead>{t('状态')}</TableHead></TableRow></TableHeader>
          <TableBody>{row.tasks.map(task => <TableRow key={task.code}>
            <TableCell><span className='block font-medium'>{task.label || task.title || task.code}</span>{task.code !== (task.label || task.title) ? <span className='block text-xs text-subtle'>{task.code}</span> : null}</TableCell>
            <TableCell className='whitespace-nowrap tabular-nums'>{task.current ?? '—'} / {task.target ?? '—'}</TableCell>
            <TableCell className='whitespace-nowrap tabular-nums'>{t('积分')} {task.rewardCredit ?? '—'} · {t('能量')} {task.rewardEnergy ?? '—'}</TableCell>
            <TableCell><Badge variant={task.claimed || (!task.locked && task.claimable) ? 'success' : 'outline'}>{task.claimed ? t('已领取') : task.locked ? t('未解锁') : task.claimable ? t('可领取') : t('未完成')}</Badge></TableCell>
          </TableRow>)}</TableBody>
        </Table>}
      </div>)}
    </CollapsibleContent>
  </Collapsible>
}

export function WorkbuddyTaskCenter({ active = true }: { active?: boolean }) {
  const [tab, setTab] = React.useState('schedule')
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
  const [scanned, setScanned] = React.useState<TaskScan | null>(null)
  const [querying, setQuerying] = React.useState(false)
  const scanRequest = React.useRef(0)
  const [concurrency, setConcurrency] = React.useState('1')
  const [travel, setTravel] = React.useState<Record<string, unknown> | null>(null)
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
  const loadSchedule = React.useCallback(async () => setSchedule(await taskRequest<Schedule>('GET', '/api/growth-tasks/schedule')), [])
  const loadAccounts = React.useCallback(async () => {const data=await taskRequest<{accounts?:AccountRow[]}>('GET','/api/accounts');setAccounts((data.accounts || []).filter(a=>['workbuddy','workbuddy-intl'].includes(a.provider || '')))},[])
  const loadQueue = React.useCallback(async () => setQueue(await taskRequest<Queue>('GET', '/api/growth-tasks/queue')), [])
  React.useEffect(() => { void Promise.all([loadSchedule(), loadQueue(), loadAccounts()]).catch(reportError) }, [loadSchedule, loadQueue, loadAccounts])
  React.useEffect(() => { const timer=setInterval(() => { if(active && !document.hidden && (window as unknown as {wbApp?:{currentPage?:string}}).wbApp?.currentPage === 'checkin') void loadQueue().catch(reportError) },20000);return () => clearInterval(timer) },[active,loadQueue])
  React.useEffect(() => { if (!queue?.running) return; const timer = setTimeout(() => void Promise.all([loadQueue(), loadSchedule()]).catch(reportError), 3000); return () => clearTimeout(timer) }, [queue, loadQueue, loadSchedule])
  React.useEffect(() => { const handler = (event: Event) => { const id = (event as CustomEvent<string>).detail; setAccountId(id); setOffset(0); setTravel(null); setScanned(null); scanRequest.current++; setTab('schedule') }; window.addEventListener('wb:task-account', handler); return () => window.removeEventListener('wb:task-account', handler) }, [])
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
  React.useEffect(() => { if (active && tab === 'records') void loadRecords().catch(reportError) }, [active, tab, loadRecords])
  React.useEffect(() => {
    const refresh = () => { void Promise.all([loadSchedule(), loadQueue(), loadAccounts(), tab === 'records' ? loadRecords() : Promise.resolve()]).catch(reportError) }
    window.addEventListener('wb:task-center-refresh', refresh)
    return () => window.removeEventListener('wb:task-center-refresh', refresh)
  }, [loadSchedule, loadQueue, loadAccounts, loadRecords, tab])
  const wasRunning = React.useRef(false)
  React.useEffect(() => {
    if (wasRunning.current && !queue?.running) {
      setNotice('')
      if (tab === 'records') void loadRecords().catch(reportError)
    }
    wasRunning.current = queue?.running === true
  }, [queue?.running, tab, loadRecords])
  async function stop() {
    setBusy(true); setError('')
    try { await taskRequest('POST', '/api/growth-tasks/stop'); await loadQueue() } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }
  async function save(patch: Record<string, unknown>) { setBusy(true); setError(''); try { setSchedule(await taskRequest('PUT', '/api/growth-tasks/schedule', patch));setDraft(old => {const next={...old};for(const key of Object.keys(patch)) delete next[key === 'recordRetentionDays' ? 'retention' : key];return next}) } catch (e) { reportError(e) } finally { setBusy(false) } }
  async function run(kind: string, mode = 'full') { setBusy(true); setError(''); try { const result=await taskRequest<{total:number}>('POST', '/api/growth-tasks/run', { taskKind: kind, mode, concurrency: Number(concurrency), ...(accountId ? { accountId } : {}) }); setNotice(result.total ? t('任务已加入后台队列') : t('本轮没有可执行待办，详情见执行记录')); await loadQueue() } catch (e) { reportError(e) } finally { setBusy(false) } }
  async function scan() {
    const scope = accountId
    if (accounts.find(account => account.id === scope)?.provider === 'workbuddy-intl') return
    const request = ++scanRequest.current
    setBusy(true); setQuerying(true); setError(''); setNotice('')
    try {
      let result: TaskScan
      if (scope) {
        const data = await taskRequest<AccountGrowthDetails>('GET', '/api/growth-tasks/accounts/' + encodeURIComponent(scope))
        if (data.accountId !== scope || !Array.isArray(data.tasks)) throw new Error(t('任务列表响应异常'))
        result = { scannedAt: data.queriedAt ?? Date.now(), results: [{ id: scope, name: accounts.find(account => account.id === scope)?.name || scope, tasks: data.tasks }] }
      } else {
        result = await taskRequest<TaskScan>('GET', '/api/growth-tasks/scan')
        if (!Array.isArray(result.results) || result.results.some(row => typeof row.id !== 'string' || !Array.isArray(row.tasks))) throw new Error(t('任务列表响应异常'))
      }
      if (request !== scanRequest.current) return
      setScanned(result)
      if (scope) {
        try {
          const data = await taskRequest<{ travel?: Record<string, unknown> }>('GET', '/api/accounts/' + encodeURIComponent(scope) + '/growth')
          if (request === scanRequest.current) setTravel(data.travel || null)
        } catch (cause) {
          if (request === scanRequest.current) reportError(cause)
        }
      }
    } catch (cause) {
      if (request === scanRequest.current) reportError(cause)
    } finally { setBusy(false); setQuerying(false) }
  }
  async function manualReward(action: string) {
    if(!accountId) return
    setBusy(true);setError('')
    try { const r=await taskRequest<{message:string}>('POST','/api/growth-tasks/rewards',{accountId,action});setNotice(r.message);await loadQueue() }catch(e){reportError(e)}finally{setBusy(false)}
  }
  async function detail(id: number) { if (expanded === id) { setExpanded(null); return }; try { const v = await taskRequest<Run>('GET', '/api/task-records/' + id); setDetails(old => ({ ...old, [id]: v })); setExpanded(id) } catch (e) { reportError(e) } }
  const selected = accounts.find(a => a.id === accountId)
  return <Tabs value={tab} onValueChange={next => setTab(String(next))} className='contents'><Card as='section' variant='panel' size='sm' className='panel'>
    <CardHeader variant='panel' className='panel-head'>
      <CardTitle>{t('WorkBuddy任务')}</CardTitle>
      <InfoTip label={t('WorkBuddy任务说明')}>
        <p>{t('成长、旅行和夜猫仅国内版；活跃上报覆盖两版。需要对话的任务可能消耗积分。')}</p>
        <p>{t('北京时间 · 后台执行 · 结果可追踪')}</p>
        <p>{t('补签卡与抽奖仅手动使用')}</p>
        <p>{t('自动排程适用于各任务标注的账号范围；上方账号选择仅影响手动执行和记录筛选。')}</p>
        <p>{t('未配置的任务默认开启，已保存的选择保持不变。关闭页面不影响执行；关闭开关停止尚未开始的自动任务。')}</p>
      </InfoTip>
      {queue?.running ? <Badge id='workbuddy-task-badge' variant='outline'>{t('执行中')}</Badge> : null}
      <div className='head-actions'><Button size='sm' variant='outline' onClick={() => void Promise.all([loadSchedule(), loadQueue(), loadAccounts(), tab === 'records' ? loadRecords() : Promise.resolve()]).catch(reportError)}>{t('刷新')}</Button></div>
    </CardHeader>
    <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3'>
      <TabsList aria-label={t('WorkBuddy任务分区')}>
        <TabsTrigger value='schedule'>{t('任务与排程')}</TabsTrigger>
        <TabsTrigger value='records'>{t('执行记录')}</TabsTrigger>
      </TabsList>
      <Select value={accountId || '__all__'} onValueChange={next => {
        if (next === null) return
        setAccountId(next === '__all__' ? '' : String(next)); setOffset(0); setTravel(null); setScanned(null); scanRequest.current++
      }}>
        <SelectTrigger aria-label={t('账号范围')} className='max-w-full'>
          <SelectValue>{selected ? `${selected.name || selected.id} · ${selected.provider === 'workbuddy-intl' ? t('国际版') : t('国内版')}` : accountId || t('全部符合条件的账号')}</SelectValue>
        </SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value='__all__'>{t('全部符合条件的账号')}</SelectItem>
          {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name || a.id} · {a.provider === 'workbuddy-intl' ? t('国际版') : t('国内版')}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
    </div>
    <CardContent variant='panel' className='panel-body overflow-auto'>
      {queue?.lastError ? <Alert variant='destructive' className='w-auto'><AlertDescription>{queue.lastError}</AlertDescription></Alert> : null}
      {error ? <Alert variant='destructive' className='w-auto'><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert role='status' className='w-auto'><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {queue?.running ? <div role='status' aria-label={t('任务运行状态')} className='flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm'>
        <span className='mr-auto tabular-nums'>{t('执行中')} · {queue.done || 0}/{queue.total || 0}</span>
        <Button size='sm' variant='ghost' onClick={() => setTab('records')}>{t('查看执行记录')}</Button>
        <Button size='sm' variant='outline' disabled={busy} onClick={() => void stop()}>{t('停止后续步骤')}</Button>
      </div> : null}
      <TabsContent value='schedule' keepMounted>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-xs text-subtle'>{t('手动执行')}</span>
            <Select value={concurrency} disabled={busy || queue?.running} onValueChange={next => { if (next !== null) setConcurrency(String(next)) }}>
              <SelectTrigger aria-label={t('手动账号并发')}><SelectValue>{t('并发')} {concurrency}</SelectValue></SelectTrigger>
              <SelectContent><SelectGroup>{[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{t('并发')} {n}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            <InfoTip label={t('手动执行说明')}>{t('手动执行使用上方选择的账号和并发数，不修改自动排程。')}</InfoTip>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Button size='sm' variant='outline' disabled={busy || queue?.running || selected?.provider === 'workbuddy-intl'} onClick={() => void scan()}>{querying ? t('查询中…') : t('查询任务')}</Button>
            <Button size='sm' variant='outline' disabled={busy || queue?.running || selected?.provider === 'workbuddy-intl'} onClick={() => void run('growth', 'claim')}>{t('仅领取奖励')}</Button>
            {selected && selected.provider !== 'workbuddy-intl' ? <DropdownMenu>
              <DropdownMenuTrigger render={<Button size='sm' variant='outline' disabled={busy || queue?.running} />}>{t('更多操作')}</DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='min-w-44'><DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setDialog(selected)}>{t('账号任务详情')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void manualReward('makeup')}>{t('使用补签卡补昨日')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void manualReward('lottery')}>{t('抽奖一次')}</DropdownMenuItem>
              </DropdownMenuGroup></DropdownMenuContent>
            </DropdownMenu> : null}
          </div>
        </div>
        {travel ? <p className='mt-3 text-sm'>{t('猫猫旅行')}：{String(travel.buddyName || '')} · {String(travel.state || (travel.hasBuddy === false ? t('未领养') : travel.error || t('尚未查询')))}</p> : null}
        {selected?.provider === 'workbuddy-intl' ? <p className='mt-3 text-xs text-subtle'>{t('国际版不参与成长任务查询；可手动执行活跃上报，结果在执行记录查看。')}</p> : null}
        {scanned ? <TaskQueryResults data={scanned} querying={querying} onDetails={row => setDialog(accounts.find(account => account.id === row.id) || { id: row.id, name: row.name, provider: 'workbuddy' })} /> : null}
        {!schedule ? <p className='py-4'>{t('正在读取排程…')}</p> : <div className='divide-y divide-border'>
          {TASKS.map(task => {
            const status = schedule.tasks?.find(row => row.kind === task.kind)
            const enabled = schedule[task.flag] === true
            const unsupported = selected?.provider === 'workbuddy-intl' && task.kind !== 'activity'
            return <section key={task.kind} aria-label={t(task.name)} className='flex flex-col gap-4 py-4 last:pb-0 lg:flex-row lg:items-center'>
              <div className='flex min-w-0 flex-1 flex-col gap-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <h3 className='text-sm font-semibold'>{t(task.name)}</h3>
                  <InfoTip label={t(task.name) + t('说明')}><p>{t(task.desc)}</p><p>{t('范围')}：{task.kind === 'activity' ? t('全部可用WorkBuddy账号（两版）') : t('全部可用WorkBuddy国内版账号')}</p>{task.kind === 'travel' ? <p>{t('旅行时刻为0–23的整点，以英文逗号分隔，例如9,21。')}</p> : null}</InfoTip>
                  <Badge variant='outline'>{task.kind === 'activity' ? t('国内版／国际版') : t('国内版')}</Badge>
                </div>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle'>
                  <span>{t('下次')}：{enabled ? time(status?.nextRunAt) : t('已停用')}</span>
                  <span>{t('最近')}：{time(status?.lastRunAt)}</span>
                  {status?.lastOutcome ? <Outcome value={status.lastOutcome} /> : null}
                </div>
              </div>
              <div className='flex flex-wrap items-center gap-x-4 gap-y-3 lg:justify-end'>
                <div className='flex flex-wrap items-center gap-2'>
                  <label htmlFor={'wb-task-time-' + task.kind} className='text-xs text-subtle'>{t('北京时间')}</label>
                  <Input id={'wb-task-time-' + task.kind} aria-label={t(task.name) + t('执行时刻')} type={task.kind === 'travel' ? 'text' : 'time'} className='w-28 max-w-28' value={draft[task.time] ?? (Array.isArray(schedule[task.time]) ? (schedule[task.time] as number[]).join(',') : String(schedule[task.time] || ''))} onChange={e => setDraft(d => ({ ...d, [task.time]: e.target.value }))} />
                  {draft[task.time] !== undefined ? <Button size='sm' variant='outline' disabled={busy} onClick={() => {
                    const value = draft[task.time]
                    if (task.kind === 'travel' && !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(value.trim())) { setError(t('旅行时刻请填写英文逗号分隔的小时')); return }
                    void save({ [task.time]: task.kind === 'travel' ? value.split(',').map(n => Number(n.trim())) : value })
                  }}>{t('保存时刻')}</Button> : null}
                </div>
                <label className='flex items-center gap-2 text-xs text-subtle'>
                  <Switch aria-label={t(task.name) + t('自动执行')} checked={enabled} disabled={busy} onCheckedChange={value => void save({ [task.flag]: value })} />{t('自动执行')}
                </label>
                <Button size='sm' variant='outline' aria-label={t('立即执行') + t(task.name)} disabled={busy || queue?.running || unsupported} onClick={() => void run(task.kind)}>{t('立即执行')}</Button>
              </div>
            </section>
          })}
        </div>}
      </TabsContent>
      <TabsContent value='records' keepMounted><div className='flex flex-col gap-3'><div className='flex flex-wrap gap-2'>{(['kind', 'outcome', 'provider', 'source'] as const).map(key => <Select key={key} value={filters[key] || '__all__'} onValueChange={next => {
            if (next === null) return
            setOffset(0); setFilters(f => ({ ...f, [key]: next === '__all__' ? '' : String(next) }))
          }}>
            <SelectTrigger aria-label={t(RECORD_FILTER_LABELS[key])}>
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
    {dialog ? <WorkBuddyTasksDialog account={dialog as AccountRecord} onClose={() => setDialog(null)} /> : null}
  </Card></Tabs>
}
