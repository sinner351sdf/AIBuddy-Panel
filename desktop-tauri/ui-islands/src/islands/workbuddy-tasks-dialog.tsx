import * as React from 'react'
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Spinner } from '@ui'
import { t } from '../i18n'
import { displayNameOf } from './accounts-domain'
import { errorMessage, shared, toast, type AccountRecord } from './accounts-shared'
import { accountGrowthClient as api, canAcceptTask, canAutomateTask, taskState,
  type AccountGrowthDetails, type AccountGrowthQueue, type AccountGrowthTask } from './workbuddy-tasks-api'

const CSS = `
.growth-task-heading { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.growth-task-account { color: var(--text-3); font-size: 12px; font-weight: 400; }
.growth-task-description { color: var(--text-3); font-size: 12px; line-height: 1.65; margin-top: 7px; }
.growth-task-body { padding: 0 20px; gap: 0; min-height: 170px; }
.growth-task-table { width: 100%; min-width: 590px; border-collapse: collapse; font-size: 12px; }
.growth-task-table th { position: sticky; top: 0; z-index: 1; background: var(--surface); color: var(--text-3); text-align: left; font-size: 11px; font-weight: 500; }
.growth-task-table th, .growth-task-table td { border-bottom: 1px solid var(--hairline); padding: 13px 8px; }
.growth-task-table th:first-child, .growth-task-table td:first-child { padding-left: 0; width: 43%; }
.growth-task-table th:last-child, .growth-task-table td:last-child { text-align: right; padding-right: 0; }
.growth-task-name { color: var(--text); font-weight: 600; line-height: 1.5; }
.growth-task-code { color: var(--text-3); font-family: var(--font-mono, monospace); font-size: 10.5px; margin-top: 4px; overflow-wrap: anywhere; }
.growth-task-number { font-variant-numeric: tabular-nums; white-space: nowrap; }
.growth-task-reward { display: flex; gap: 7px; flex-wrap: wrap; }
.growth-task-empty { padding: 36px 0; color: var(--text-3); text-align: center; font-size: 12px; }
.growth-task-notice { margin: 12px 0; padding: 10px 12px; border-radius: var(--r-md); background: var(--surface-2); color: var(--text-2); font-size: 12px; line-height: 1.6; }
.growth-task-error { color: var(--danger); }
.growth-task-footer { flex-wrap: wrap; justify-content: flex-end; }
.growth-task-count { color: var(--text-3); font-size: 11px; margin-right: auto; }
@media(max-width: 640px) { .growth-task-count { width: 100%; } }
`

function Status({ task }: { task: AccountGrowthTask }) {
  switch (taskState(task)) {
    case 'claimed': return <Badge variant='success'>{t('已领取')}</Badge>
    case 'locked': return <Badge variant='outline'>{t('未解锁')}</Badge>
    case 'claimable': return <Badge variant='brand'>{t('可领取')}</Badge>
    case 'accepted': return <Badge variant='outline'>{t('进行中')}</Badge>
    default: return <Badge variant='warning'>{t('待接受')}</Badge>
  }
}

export function WorkBuddyTasksDialog({ account, onClose }: { account: AccountRecord; onClose(): void }) {
  const [details, setDetails] = React.useState<AccountGrowthDetails | null>(null)
  const [queue, setQueue] = React.useState<AccountGrowthQueue | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [queueError, setQueueError] = React.useState('')
  const alive = React.useRef(true)
  React.useEffect(() => () => { alive.current = false }, [])
  const tasks = details?.tasks || []
  const ownItems = (queue?.items || []).filter(item => item.accountId === account.id)
  const running = queue?.running === true
  const blocked = loading || busy !== '' || running || queue === null || error !== '' || queueError !== ''
  const completed = ownItems.filter(item => ['ok', 'failed', 'skipped'].includes(item.status)).length
  const acceptCount = tasks.filter(canAcceptTask).length
  const autoCount = tasks.filter(canAutomateTask).length

  const load = React.useCallback(async () => {
    setLoading(true); setError('')
    try {
      const next = await api.list(account.id)
      if (next.accountId !== account.id || !Array.isArray(next.tasks)) throw new Error(t('任务列表响应异常'))
      if (alive.current) setDetails(next)
    } catch (err) {
      if (alive.current) setError(errorMessage(err))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [account.id])

  const poll = React.useCallback(async () => {
    try {
      const next = await api.queue()
      if (alive.current) { setQueue(next); setQueueError('') }
      return next
    } catch (err) {
      if (alive.current) setQueueError(errorMessage(err))
      return null
    }
  }, [])

  React.useEffect(() => { void load(); void poll() }, [load, poll])
  React.useEffect(() => {
    if (!running) return
    let polling = false
    const timer = window.setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const next = await poll()
        if (next && !next.running) {
          await load()
          void shared().wbApp?.refresh?.()
        }
      } finally { polling = false }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [running, poll, load])

  async function act(action: 'accept' | 'claim' | 'run', code?: string) {
    if (blocked) return
    setBusy(action + (code || '')); setError('')
    try {
      if (action === 'accept') {
        const result = await api.accept(account.id, code)
        toast(t('已接受 {n} 项任务', { n: result.accepted }))
      } else if (action === 'claim' && code) {
        await api.claim(account.id, code)
        toast(t('任务奖励已领取'))
        void shared().wbApp?.refresh?.()
      } else if (action === 'run') {
        const result = await api.run(account.id)
        toast(result.total ? t('已启动当前账号的 {n} 项任务', { n: result.total }) : t('当前账号没有可自动执行的待办'))
      }
      if (!alive.current) return
      await poll()
      if (action !== 'run') await load()
    } catch (err) {
      if (alive.current) setError(errorMessage(err))
    } finally {
      if (alive.current) setBusy('')
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <style>{CSS}</style>
    <DialogContent overlayClassName='z-[1099]' className='growth-task-dialog z-[1100] w-[min(960px,calc(100vw-40px))] max-sm:w-[calc(100vw-20px)] max-sm:max-h-[calc(100dvh-20px)]'>
      <DialogHeader>
        <div className='w-full'>
          <DialogTitle className='growth-task-heading'>
            {t('积分任务')}<span className='growth-task-account'>{displayNameOf(account) || account.id}</span>
          </DialogTitle>
          <DialogDescription className='growth-task-description'>
            {t('查询当前账号的任务进度；接受用于报名，领取在进度达标后可用。含真实对话的自动任务会消耗账号额度。')}
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogBody className='growth-task-body gap-0 px-5 py-0'>
        {error ? <div role='alert' className='growth-task-notice growth-task-error'>{error}</div> : null}
        {busy ? <div role='status' className='growth-task-notice flex items-center gap-2'><Spinner className='size-3' />{t('正在处理…')}</div> : null}
        {queueError ? <div role='alert' className='growth-task-notice growth-task-error'>{t('执行状态查询失败：{reason}', { reason: queueError })}</div> : null}
        {running ? <div role='status' className='growth-task-notice'>
          {ownItems.length ? t('当前账号任务执行中：{done} / {total}，关闭弹窗后仍会继续。', { done: completed, total: ownItems.length })
            : t('其他成长任务正在执行，请等本轮结束后再操作。')}
        </div> : null}
        {loading && !details ? <div className='growth-task-empty flex items-center justify-center gap-2'><Spinner className='size-3' />{t('正在查询任务…')}</div> : null}
        {!loading && details && tasks.length === 0 ? <div className='growth-task-empty'>{t('该账号暂无成长任务')}</div> : null}
        {tasks.length ? <table className='growth-task-table'>
          <thead><tr><th>{t('任务')}</th><th>{t('进度')}</th><th>{t('奖励')}</th><th>{t('状态')}</th><th aria-label={t('操作')} /></tr></thead>
          <tbody>{tasks.map(task => <tr key={task.code}>
            <td><div className='growth-task-name' title={task.description}>{task.title || task.label || task.code}</div>
              <div className='growth-task-code'>{task.code}{task.tag ? ' · ' + task.tag : ''}</div></td>
            <td className='growth-task-number'>{Number(task.current) || 0} / {Number(task.target) || 0}</td>
            <td><div className='growth-task-reward growth-task-number'>
              {task.rewardCredit ? <span>{t('+{n} 积分', { n: task.rewardCredit })}</span> : null}
              {task.rewardEnergy ? <span>{t('+{n} 能量', { n: task.rewardEnergy })}</span> : null}
              {!task.rewardCredit && !task.rewardEnergy ? '—' : null}
            </div></td>
            <td><Status task={task} /></td>
            <td>{taskState(task) === 'claimable' ? <Button variant='outline' size='xs' disabled={blocked}
              onClick={() => void act('claim', task.code)}>{t('领取')}</Button>
              : canAcceptTask(task) ? <Button variant='outline' size='xs' disabled={blocked}
                onClick={() => void act('accept', task.code)}>{t('接受')}</Button> : <span className='muted'>—</span>}</td>
          </tr>)}</tbody>
        </table> : null}
      </DialogBody>
      <DialogFooter className='growth-task-footer'>
        <span className='growth-task-count'>{details ? t('共 {n} 项 · 已领取 {done} 项', { n: tasks.length, done: tasks.filter(task => task.claimed).length }) : ''}</span>
        <Button variant='outline' disabled={blocked || !acceptCount} onClick={() => void act('accept')}>{t('全部接受')}</Button>
        <Button disabled={blocked || !autoCount} onClick={() => void act('run')}>{t('一键完成可自动任务')}</Button>
        <Button variant='outline' disabled={loading || busy !== ''} onClick={() => { void load(); void poll() }}>{t('重新查询')}</Button>
        <Button variant='outline' onClick={onClose}>{t('关闭')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
