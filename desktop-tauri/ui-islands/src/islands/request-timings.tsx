import { cn } from '@ui'
import * as React from 'react'
import { t } from '../i18n'

export type StageTiming = {
  stage: string
  startedAt: number
  durationMs: number | null
  completed: boolean | null
}

const STAGES = [
  ['credentials', '准备账号凭证'],
  ['build_request', '构造上游请求'],
  ['send_headers', '连接、发送并等待响应头'],
  ['first_byte', '响应头后等待首个字节'],
  ['first_content', '首字节后等待有效内容'],
  ['stream_response', '接收、转换并转发响应'],
] as const

const ms = (value: number) => value < 1000
  ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`

export function timingRows(timings: StageTiming[], running: boolean, now: number) {
  return STAGES.map(([stage, label]) => {
    const item = timings.find(item => item.stage === stage)
    if (!item) return { stage, label: t(label), duration: '—', state: t('未到达 / 未采集'), active: false }
    const measured = typeof item.durationMs === 'number' && Number.isFinite(item.durationMs)
    const active = !measured && running && item.completed == null
    const duration = measured ? Math.max(0, item.durationMs!)
      : active && Number.isFinite(item.startedAt) ? Math.max(0, now - item.startedAt) : null
    return {
      stage, label: t(label), duration: duration === null ? '—' : ms(duration), active,
      state: active ? t('进行中') : item.completed === true ? t('完成') : t('中断 / 未完成'),
    }
  })
}

export function RequestTimings({ attempts, running, startedAt }: {
  attempts: { timings?: StageTiming[] }[]; running: boolean; startedAt: unknown
}) {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [running])
  const measured = attempts.map((attempt, index) => ({ index, timings: attempt.timings }))
    .filter(item => Array.isArray(item.timings) && item.timings.length > 0)
  if (!measured.length) return <span className='text-muted-foreground'>{t('暂无阶段耗时记录（旧记录不会补算；目前采集 Accio 请求）')}</span>
  const first = measured[0].timings![0]
  const preparation = Number(startedAt) > 0 && first.startedAt >= Number(startedAt)
    ? first.startedAt - Number(startedAt) : null
  return <div className='flex flex-col gap-3'>
    {preparation !== null && <div>{t('进入账号转发前（选路与前置处理）')}：{ms(preparation)}</div>}
    {measured.map(({ index, timings }) => <div key={index}>
      <div className='mb-1 font-medium'>{t('尝试 {n}', { n: index + 1 })}</div>
      <table className='w-full text-[11.5px]'>
        <thead><tr>{[t('阶段'), t('阶段用时'), t('结果')].map(label =>
          <th key={label} className='border-b border-hairline px-2 py-1 text-left font-medium'>{label}</th>
        )}</tr></thead>
        <tbody>{timingRows(timings!, running, now).map(item => <tr key={item.stage} className={cn(item.active ? 'text-brand' : '')}>
          <td className='px-2 py-1'>{item.label}</td>
          <td className='px-2 py-1 tabular-nums whitespace-nowrap'>{item.duration}</td>
          <td className='px-2 py-1 whitespace-nowrap'>{item.state}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
    <p className='text-[11px] text-muted-foreground'>{t('连接、发送与等待响应头为合并计时，包含 DNS、TCP/TLS、代理握手及上传；连接复用时不会重新建连。首字节可能只是心跳，有效内容包括正文、思考、工具调用或结束帧。')}</p>
  </div>
}
