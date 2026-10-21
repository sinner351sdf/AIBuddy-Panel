import { MobileButton, Surface } from '../components/primitives'
import { useEffect, useRef, useState } from 'react'
import { PageIntro, IconButton, Empty, ErrorNote, SkeletonList } from '../components/ui'
import { ProviderLogo } from '../components/ProviderLogo'

import { Alert, AlertDescription, Badge as SharedBadge, Button, SegmentedControl, Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetFooter } from '@ui'
import { store } from '../state/store'
import { fetchRequests, type RequestPage, type RequestRow } from '../api/gateway'
import { ellipsisMiddle, formatClock, formatDuration, formatInt } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'

/**
 * 请求日志。
 *
 * ── 九列宽表 → 一请求一卡 ────────────────────────────────────
 * 桌面端是「时间 / 提供商·账号 / 重试 / 状态 / 模型 / 客户端 / 用时 / 用量 /
 * 错误 / 详情」十列。手机上每张卡三行：
 *   ① 状态码 + 模型 + 时间
 *   ② 提供商图标 + 名称 + 账号
 *   ③ 用时 · Token · 客户端 · 重试次数
 * 换号链、退避重试、上游报错原本要悬停才看得到，手机上直接铺成卡内提示条
 * —— 这是排查时最需要的信息。
 */

type Filter = 'all' | 'error' | 'retry' | 'running'

const PAGE_SIZE = 20

export function RequestsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState<RequestPage | null>(null)
  const [extra, setExtra] = useState<RequestRow[]>([])
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<RequestRow | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [refreshKey, setRefreshKey] = useState(0)
  const lastFilter = useRef(filter)
  const sequence = useRef(0), currentFilter = useRef(filter), moreRequest = useRef<AbortController | null>(null)
  currentFilter.current = filter
  const load = () => setRefreshKey(value => value + 1)
  useEffect(() => {
    const version = ++sequence.current
    let disposed = false, busy = false, request: AbortController | undefined
    if (lastFilter.current !== filter) { setPage(null); setExtra([]); lastFilter.current = filter }
    setLoadingMore(false); setError('')
    async function refresh() {
      if (busy) return
      busy = true; request = new AbortController()
      try {
        const next = await fetchRequests({limit: PAGE_SIZE, status: filter === 'error' ? 'error' : undefined}, request.signal)
        if (!disposed && version === sequence.current) { setPage(next); setExtra([]); setError('') }
      } catch (failure) {
        if (!disposed && version === sequence.current) setError(failure instanceof Error ? failure.message : String(failure))
      } finally { busy = false }
    }
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 30_000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; request?.abort(); moreRequest.current?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [filter, refreshKey])

  const rows = [...(page?.entries || []), ...extra]
  const filtered = rows.filter(row => {
    if (filter === 'retry') return (row.attempts || 1) > 1
    if (filter === 'running') return !row.status
    return true
  })

  const loadMore = async () => {
    if (loadingMore) return
    const version = sequence.current, requestedFilter = filter
    const request = new AbortController(); moreRequest.current = request
    setLoadingMore(true)
    try {
      const next = await fetchRequests({ offset: rows.length, limit: PAGE_SIZE, status: filter === 'error' ? 'error' : undefined }, request.signal)
      if (version === sequence.current && currentFilter.current === requestedFilter && !request.signal.aborted) setExtra(prev => [...prev, ...(next.entries || [])])
    } catch (failure) {
      if (!request.signal.aborted && version === sequence.current) store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      if (version === sequence.current) setLoadingMore(false)
    }
  }

  const total = Number(page?.total) || 0
  const matched = Number(page?.matched) || 0
  const running = Number(page?.running) || 0

  return (
    <div className='m-page'>
      <PageIntro actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void load()} />}
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <SegmentedControl aria-label={t('请求筛选')} value={filter} onValueChange={setFilter} className='grid w-full grid-cols-4 gap-1 p-1' options={[
          { value: 'all', label: t('全部') }, { value: 'error', label: t('失败') },
          { value: 'retry', label: t('有重试') }, { value: 'running', label: running ? t('在途 {n}', {n:running}) : t('在途') },
        ]}/>

      </div>

      {error ? <ErrorNote text={error} /> : null}
      {!page && !error ? <SkeletonList rows={4} height={104} /> : null}

      {page && !filtered.length ? (
        <div className='m-section'>
          <Surface className='m-card'>
            <Empty text={filter === 'all' ? t('暂无请求日志') : t('当前筛选下没有记录')} />
          </Surface>
        </div>
      ) : null}

      <div className='m-section' style={{ marginTop: 12 }}>
        {filtered.map((row, index) => (
          <RequestCard key={row.id || `${row.ts}-${index}`} row={row} onClick={() => setDetail(row)} />
        ))}
      </div>

      {page && rows.length < matched ? (
        <div className='m-section'>
          <MobileButton type='button' className='m-btn m-ghost' disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t('加载中…') : t('加载更早的请求')}
          </MobileButton>
        </div>
      ) : null}

      <RequestSheet row={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

function RequestCard({ row, onClick }: { row: RequestRow; onClick: () => void }) {
  const status = Number(row.status) || 0
  const tone = !status ? 'warn' : status >= 200 && status < 400 ? 'ok' : 'bad'
  const note = buildNote(row)
  return (
    <Button type='button' variant='outline' onClick={onClick} className='m-request-card mb-3 block h-auto w-full whitespace-normal rounded-xl p-4 text-left'>
      <div className='flex min-w-0 items-center gap-2'>
        <SharedBadge variant={tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : 'destructive'} className='shrink-0'>{status || t('在途')}</SharedBadge>
        <span className='m-mono min-w-0 flex-1 truncate text-xs' title={row.upstreamModel || row.model}>{ellipsisMiddle(row.upstreamModel || row.model || '—',30)}</span>
        <time className='shrink-0 text-[11px] tabular-nums text-muted-foreground'>{formatClock(row.ts)}</time>
      </div>
      <div className='mt-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
        <ProviderLogo id={row.provider}/>
        <div className='min-w-0 flex-1'><p className='m-0 truncate'>{providerLabel(row.provider,row.providerLabel)}</p>{row.accountName ? <p className='m-0 mt-1 truncate text-[11px]' title={row.accountName}>{row.accountName}</p> : null}</div>
      </div>
      <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground'>
        <span>{formatDuration(row.durationMs)}</span><span>{formatInt(Number(row.totalTokens) || 0)} tokens</span>
        {(row.attempts || 1) > 1 ? <span>{t('重试 {n}',{n:(row.attempts || 1)-1})}</span> : null}
      </div>
      {note ? <Alert role='note' variant={note.tone === 'bad' ? 'destructive' : 'default'} className='mt-3'><AlertDescription className='break-words text-xs'>{note.text}</AlertDescription></Alert> : null}
    </Button>
  )
}

function buildNote(row: RequestRow): { text: string; tone: 'mute' | 'warn' | 'bad' } | null {
  const attempts = row.attempts || 1
  const details = Array.isArray(row.attemptDetails) ? row.attemptDetails : []
  const failed = details.filter(item => Number(item.status) >= 400)
  if (row.error) {
    return { text: row.error, tone: Number(row.status) >= 400 ? 'bad' : 'warn' }
  }
  if (attempts > 1) {
    const chain = details
      .map(item => `${providerLabel(item.provider)} ${item.status || ''}`.trim())
      .join(' → ')
    return {
      text: chain ? t('换号链：{chain}', { chain }) : t('重试 {n} 次', { n: attempts - 1 }),
      tone: failed.length ? 'warn' : 'mute',
    }
  }
  const hits = Array.isArray(row.sensitiveHits) ? row.sensitiveHits : []
  if (hits.length) {
    return { text: t('脱敏命中：{words}', { words: hits.map(item => item.word).join('、') }), tone: 'mute' }
  }
  if (row.clientModel && row.upstreamModel && row.clientModel !== row.upstreamModel) {
    return { text: t('模型映射：{from} → {to}', { from: row.clientModel, to: row.upstreamModel }), tone: 'mute' }
  }
  return null
}

function RequestSheet({ row, onClose }: { row: RequestRow | null; onClose: () => void }) {
  const details = Array.isArray(row?.attemptDetails) ? row?.attemptDetails || [] : []
  return (
    <Sheet open={Boolean(row)} onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent side='bottom' className='max-h-[85dvh]'>
        <SheetHeader>
          <SheetTitle>{t('请求详情')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {row ? (
            <>
              <div className='m-kv'>
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('状态')}</div>
                  <div
                    className='v'
                    style={{
                      color:
                        !row.status
                          ? 'var(--m-warn)'
                          : row.status < 400
                            ? 'var(--m-ok)'
                            : 'var(--m-danger)',
                    }}
                  >
                    {row.status || t('在途')}
                  </div>
                </Surface>
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('用时')}</div>
                  <div className='v'>{formatDuration(row.durationMs)}</div>
                </Surface>
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('输入 Token')}</div>
                  <div className='v'>{formatInt(Number(row.promptTokens) || 0)}</div>
                </Surface>
                <Surface className='m-kv-cell'>
                  <div className='k'>{t('输出 Token')}</div>
                  <div className='v'>{formatInt(Number(row.completionTokens) || 0)}</div>
                </Surface>
              </div>

              <Surface className='m-rows'>
                <div className='m-row'>
                  <span className='m-k'>{t('模型')}</span>
                  <span className='m-v m-mono' style={{ fontSize: 11 }}>
                    {row.model || '—'}
                  </span>
                </div>
                {row.clientModel ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('客户端请求的模型')}</span>
                    <span className='m-v m-mono' style={{ fontSize: 11 }}>
                      {row.clientModel}
                    </span>
                  </div>
                ) : null}
                {row.upstreamModel ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('发给上游的模型')}</span>
                    <span className='m-v m-mono' style={{ fontSize: 11 }}>
                      {row.upstreamModel}
                    </span>
                  </div>
                ) : null}
                <div className='m-row'>
                  <span className='m-k'>{t('提供商')}</span>
                  <span className='m-v'>{providerLabel(row.provider, row.providerLabel)}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('账号')}</span>
                  <span className='m-v'>{row.accountName || '—'}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('尝试次数')}</span>
                  <span className='m-v'>{row.attempts || 1}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('首响')}</span>
                  <span className='m-v'>{formatDuration(row.firstResponseMs ?? null)}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('时间')}</span>
                  <span className='m-v m-mono' style={{ fontSize: 11 }}>
                    {row.ts ? new Date(row.ts).toLocaleString('zh-CN', { hour12: false }) : '—'}
                  </span>
                </div>
              </Surface>

              {details.length ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--m-text-2)' }}>{t('尝试链')}</div>
                  <Surface className='m-rows'>
                    {details.map((item, index) => (
                      <div key={index} className='m-row'>
                        <span className='m-k'>#{index + 1}</span>
                        <span className='m-v' style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          {providerLabel(item.provider)} · {item.status || '—'}
                          {item.error ? (
                            <span style={{ display: 'block', color: 'var(--m-danger)', fontSize: 11, marginTop: 2 }}>
                              {item.error}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </Surface>
                </>
              ) : null}

              {row.error ? <div className='m-error'>{row.error}</div> : null}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <MobileButton type='button' className='m-btn m-ghost' onClick={onClose}>
            {t('关闭')}
          </MobileButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
