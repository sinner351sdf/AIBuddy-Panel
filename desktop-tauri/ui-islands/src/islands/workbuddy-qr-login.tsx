import * as React from 'react'
import { toDataURL } from 'qrcode'
import { Alert, AlertDescription, cn, Button } from '@ui'
import { taskRequest } from './task-center-api'
import { shared, closeAddModals, type Edition } from './add-account-bridge'
import { t } from '../i18n'

type LoginStart = { state: string; authUrl: string; expiresAt?: number | string | null }
type Start = Omit<LoginStart, 'expiresAt'> & { expiresAt: number }
/** Older running gateways omit expiresAt. Preserve a finite five-minute UI deadline. */
export function normalizeLoginStart(result: LoginStart, now = Date.now()): Start {
  const raw = result.expiresAt
  let expiry = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim()
    ? (/^[+-]?\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : Date.parse(raw)) : NaN
  if (Number.isFinite(expiry) && expiry > 0) {
    if (expiry < 100_000_000_000) expiry *= 1000
  } else expiry = now + 300_000
  return { ...result, expiresAt: expiry }
}
type Status = { pending?: boolean; done?: boolean; phase?: string; error?: string; errorKind?: string; session?: { nickname?: string; accountId?: string; updated?: boolean } }
export function WorkbuddyQrLogin({ active, edition }: { active: boolean; edition: Edition }) {
  const [round, setRound] = React.useState(0)
  const [phase, setPhase] = React.useState('requesting')
  const [error, setError] = React.useState('')
  const [login, setLogin] = React.useState<Start | null>(null)
  const [qr, setQr] = React.useState('')
  const [summary, setSummary] = React.useState<Status['session']>()
  const [now, setNow] = React.useState(Date.now())
  const [copied, setCopied] = React.useState(false)
  const generation = React.useRef(0)
  const cancelRef = React.useRef<() => Promise<boolean>>(async () => true)

  React.useEffect(() => {
    const currentGeneration = ++generation.current
    if (!active) return
    let alive = true, state = '', terminal = false, polling = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const cancel = async (showResult = true) => {
      alive = false
      clearTimeout(pollTimer)
      if (terminal) return false
      if (state) {
        const result=await taskRequest<{canceled:boolean}>('POST', '/api/session/login/cancel', { state })
        if(!result.canceled) {
          const status=await taskRequest<Status>('GET','/api/session/login/wait?state='+encodeURIComponent(state)).catch(() => null)
          if(status?.done && status.session) { terminal=true;if(showResult && generation.current === currentGeneration) {setPhase('success');setSummary(status.session);await shared().wbApp?.refresh?.()}return false }
        }
      }
      return showResult && generation.current === currentGeneration
    }
    cancelRef.current = () => cancel(true)
    setPhase('requesting'); setError(''); setLogin(null); setQr(''); setSummary(undefined); setCopied(false)
    const poll = async () => {
      if (!alive || polling || !state) return
      polling = true
      try {
        const status = await taskRequest<Status>('GET', '/api/session/login/wait?state=' + encodeURIComponent(state))
        if (!alive) return
        if (status.done) {
          terminal = true
          if (status.error) { setPhase(status.errorKind === 'expired' ? 'expired' : 'error'); setError(status.error) }
          else { setPhase('success'); setSummary(status.session); await shared().wbApp?.refresh?.() }
        } else setPhase(status.phase === 'saving' || status.phase === 'saved' ? 'saving' : 'waiting')
      } catch (cause) { if (alive) { setError(String(cause)); setPhase('network') } }
      finally { polling = false; if (alive && !terminal) pollTimer = setTimeout(poll, 3000) }
    }
    void (async () => {
      try {
        const result = await taskRequest<LoginStart>('POST', '/api/session/login/start', { provider: edition === 'intl' ? 'workbuddy-intl' : 'workbuddy', edition })
        state = result.state
        if (!alive) { await cancel(false); return }
        if (!state || !result.authUrl) throw new Error('后端没有返回有效授权链接')
        const url = new URL(result.authUrl)
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('授权链接格式不受支持')
        const receivedAt = Date.now()
        setNow(receivedAt); setLogin(normalizeLoginStart(result, receivedAt))
        const image = await toDataURL(result.authUrl, { width: 240, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        if (alive) { setQr(image); setPhase('waiting'); void poll() }
      } catch (cause) { if (alive) { setError(String(cause)); setPhase('error') } }
    })()
    const wake = () => { if (!document.hidden) { clearTimeout(pollTimer); void poll() } }
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { ++generation.current;void cancel(false).catch(() => {}); clearInterval(clock); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake) }
  }, [active, edition, round])

  const remaining = login && Number.isFinite(login.expiresAt) ? Math.max(0, Math.ceil((login.expiresAt - now) / 1000)) : 0
  const expired = phase === 'expired' || (login && remaining === 0 && phase !== 'success')
  async function cancel() {
    const currentCancel = cancelRef.current
    try { const cancelled=await currentCancel(); if(cancelled && currentCancel === cancelRef.current) setPhase('cancelled');return cancelled }
    catch (cause) { setError(String(cause)); setPhase('error');return false }
  }
  const hasLink = login && !expired && !['cancelled', 'error', 'requesting'].includes(phase)
  const statusText = expired ? t('二维码已过期，请刷新') : phase === 'saving' ? t('正在保存账号…') : phase === 'cancelled' ? t('已取消授权') : phase === 'network' ? t('连接异常，正在重新检查授权结果…') : phase === 'waiting' ? t('等待授权完成') : phase === 'error' ? t('获取授权失败') : t('正在获取授权链接…')
  async function copyLink() {
    if (!login) return
    try { await navigator.clipboard.writeText(login.authUrl); setCopied(true) }
    catch (cause) { setError(String(cause)) }
  }
  return <div className='wb-qr-login' aria-live='polite'>
    {phase === 'success' ? <div className='wb-qr-success'>
      <span className='wb-qr-success-mark' aria-hidden='true'>✓</span>
      <strong>{t('添加成功')} · {summary?.nickname || summary?.accountId}</strong>
      <p>{edition === 'intl' ? t('国际版') : t('国内版')} · {summary?.updated ? t('已更新账号凭证，保留原有设置') : t('新账号已加入列表')}</p>
      <div className='wb-qr-actions'><Button onClick={() => setRound(v => v + 1)}>{t('继续添加')}</Button><Button variant='outline' onClick={closeAddModals}>{t('完成')}</Button></div>
    </div> : <>
      <p className='wb-qr-intro'>{edition === 'intl' ? t('点击下方链接或扫码打开国际版授权页，使用页面提供的登录方式；完成后自动加入账号列表。') : t('点击下方链接，或使用微信、QQ扫码打开授权页。可用登录方式以授权页为准，完成后自动加入账号列表。')}</p>
      <div className='wb-qr-frame'>
        {qr && !expired && !['cancelled', 'error'].includes(phase) ? <img src={qr} width={208} height={208} alt={t('WorkBuddy授权二维码')} /> : <span className='wb-qr-placeholder'>{expired ? t('二维码已过期') : phase === 'requesting' ? t('正在生成二维码…') : t('授权已停止')}</span>}
      </div>
      {hasLink ? <div className='wb-qr-link-area'>
        <a className='wb-qr-link' aria-label={t('打开授权链接')} href={login.authUrl} title={login.authUrl} target='_blank' rel='noopener noreferrer'>
          <svg aria-hidden='true' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7'><path d='M14 3h7v7M21 3l-10 10'/><path d='M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'/></svg>
          <span>{login.authUrl}</span>
        </a>
        <Button className='wb-qr-copy' variant='outline' size='sm' onClick={() => void copyLink()}>
          <svg data-icon='inline-start' aria-hidden='true' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7'><rect x='8' y='8' width='12' height='13' rx='2'/><path d='M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3'/></svg>
          {copied ? t('已复制') : t('复制链接')}
        </Button>
      </div> : null}
      <div className='wb-qr-status' role='status'>
        <span className='wb-qr-status-label'><span className={cn(['waiting', 'saving', 'requesting'].includes(phase) && !expired ? 'wb-qr-status-dot is-waiting' : 'wb-qr-status-dot')} aria-hidden='true' />{statusText}</span>
        {hasLink ? <span className='wb-qr-expiry'>{t('，二维码剩余有效时间')} <span aria-label={t('剩余有效时间')}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span></span> : null}
      </div>
      {error ? <Alert variant='destructive'><AlertDescription className='[overflow-wrap:anywhere]'>{error}</AlertDescription></Alert> : null}
      <div className='wb-qr-actions wb-qr-footer'>
        <Button className='wb-qr-refresh w-full' size='lg' variant='outline' onClick={() => void cancel().then(cancelled => {if(cancelled)setRound(v => v + 1)})}>{t('刷新二维码')}</Button>
        <Button className='wb-qr-cancel w-full' size='lg' variant='outline' onClick={() => void cancel()}>{t('取消')}</Button>
      </div>
    </>}
  </div>
}
