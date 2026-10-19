import { ManagementButton } from './ManagementPage'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@ui'
import { Badge as SharedBadge } from '@ui'
import { Switch } from '@ui'
import { Surface, MobileButton } from '../components/primitives'
import { useMemo, useState } from 'react'
import { PageIntro, IconButton, Empty, ErrorNote, SkeletonList } from '../components/ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { store } from '../state/store'
import { fetchManage, refreshModels, setModelEnabled, type ManageModel } from '../api/gateway'
import { usePolling } from '../lib/usePolling'
import { t } from '../i18n'

/** Compact mobile view; complete editors open within the mobile navigation shell. */

type Filter = 'all' | 'enabled' | 'hidden'

export function ModelsPage() {
  const [models, setModels] = useState<ManageModel[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')

  const load = async () => {
    try {
      const view = await fetchManage()
      setModels(view.models || [])
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  usePolling(load, 120_000)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return (models || []).filter(item => {
      if (filter === 'enabled' && !item.enabled) return false
      if (filter === 'hidden' && item.visibility !== 'hidden') return false
      if (!keyword) return true
      return `${item.id || ''} ${item.providerLabel || ''} ${item.provider || ''}`.toLowerCase().includes(keyword)
    })
  }, [models, filter, query])

  const groups = useMemo(() => {
    const map = new Map<string, ManageModel[]>()
    filtered.forEach(item => {
      const provider = String(item.provider || 'unknown')
      const list = map.get(provider) || []
      list.push(item)
      map.set(provider, list)
    })
    return [...map.entries()].map(([provider, list]) => ({
      provider,
      label: list[0]?.providerLabel,
      list: [...list].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    }))
  }, [filtered])

  const enabledCount = (models || []).filter(item => item.enabled).length
  const hiddenCount = (models || []).filter(item => item.visibility === 'hidden').length

  const toggle = async (model: ManageModel, next: boolean) => {
    if (!model.id || !model.provider) return
    setBusy(`${model.provider}:${model.id}`)
    try {
      const view = await setModelEnabled({ id: model.id, provider: model.provider, enabled: next })
      setModels(view.models || [])
      store.toast(next ? t('已启用 {name}', { name: model.id }) : t('已禁用 {name}', { name: model.id }))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const refresh = async () => {
    setBusy('refresh')
    try {
      await refreshModels()
      await load()
      store.toast(t('模型清单已刷新'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className='m-page'>
      <PageIntro actions={<IconButton name='refresh' label={t('刷新清单')} onClick={() => void refresh()} />}
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <InputGroup className='min-h-11'><InputGroupAddon><Icon name='search'/></InputGroupAddon><InputGroupInput value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('搜索模型 ID / 提供商')} aria-label={t('搜索模型 ID / 提供商')} className='text-base'/></InputGroup>
      </div>

      <div className='m-chips' style={{ padding: '10px 16px 12px' }}>
        <Chip label={t('全部')} count={(models || []).length} on={filter === 'all'} onClick={() => setFilter('all')} />
        <Chip label={t('已启用')} count={enabledCount} on={filter === 'enabled'} onClick={() => setFilter('enabled')} />
        <Chip label={t('不展示')} count={hiddenCount} on={filter === 'hidden'} onClick={() => setFilter('hidden')} />
      </div>

      {error ? <ErrorNote text={error} /> : null}
      {!models ? <SkeletonList rows={4} height={70} /> : null}

      {models && !groups.length ? (
        <div className='m-section'>
          <Surface className='m-card'>
            <Empty text={t('没有匹配的模型')} />
          </Surface>
        </div>
      ) : null}

      {groups.map(group => {
        const isCollapsed = collapsed.has(group.provider)
        return (
          <div key={group.provider} className='m-section' style={{ marginTop: 12 }}>
            <MobileButton
              type='button'
              onClick={() => {
                const next = new Set(collapsed)
                if (isCollapsed) next.delete(group.provider)
                else next.add(group.provider)
                setCollapsed(next)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                padding: '0 3px 8px',
                background: 'none',
                border: 0,
                textAlign: 'left',
              }}
            >
              <ProviderLogo id={group.provider} label={group.label} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{group.label || group.provider}</span>
              <span style={{ fontSize: 11, color: 'var(--m-text-3)' }}>{t('{n} 个模型', { n: group.list.length })}</span>
              <Icon
                name='chev'
                style={{
                  width: 15,
                  height: 15,
                  color: 'var(--m-text-3)',
                  transform: isCollapsed ? 'none' : 'rotate(90deg)',
                  transition: 'transform .16s',
                }}
              />
            </MobileButton>
            {isCollapsed ? null : (
              <Surface className='m-card'>
                {group.list.map(model => {
                  const key = `${model.provider}:${model.id}`
                  const hidden = model.visibility === 'hidden'
                  const caps = readCaps(model.capabilities)
                  return (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '11px 13px',
                        borderBottom: '1px solid var(--m-line)',
                        opacity: model.enabled ? 1 : 0.55,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className='m-mono'
                          style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {model.id}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 10.5, color: 'var(--m-text-3)', flexWrap: 'wrap' }}>
                          {caps.context ? <SharedBadge variant='secondary'>{caps.context}</SharedBadge> : null}
                          <SharedBadge variant='secondary'>{sourceLabel(model.source)}</SharedBadge>
                          {model.aliases?.length ? (
                            <SharedBadge variant='secondary' >
                              {t('{n} 个映射', { n: model.aliases.length })}
                            </SharedBadge>
                          ) : null}
                          {hidden ? (
                            <SharedBadge variant='secondary' >
                              {t('不展示')}
                            </SharedBadge>
                          ) : null}
                          {caps.reasoning ? (
                            <SharedBadge variant='secondary' >
                              {t('思考')}
                            </SharedBadge>
                          ) : null}
                        </div>
                      </div>
                      <SwitchSmall
                        checked={Boolean(model.enabled)}
                        disabled={busy === key}
                        label={String(model.id)}
                        onChange={next => void toggle(model, next)}
                      />
                    </div>
                  )
                })}
              </Surface>
            )}
          </div>
        )
      })}

      <div className='m-section' style={{ paddingBottom: 8 }}>
        <Surface className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
          <ManagementButton page="gateway">{t('编辑模型 / 映射与能力')}</ManagementButton>
        </Surface>
      </div>
    </div>
  )
}

function Chip({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <MobileButton type='button' className='m-chip' data-on={on} onClick={onClick}>
      {label}
      <span className='m-n'>{count}</span>
    </MobileButton>
  )
}

function SwitchSmall({checked,onChange,disabled,label}:{checked:boolean;onChange:(next:boolean)=>void;disabled?:boolean;label:string}) {return <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}/>}

function sourceLabel(source?: string): string {
  if (source === 'remote') return t('远程')
  if (source === 'builtin') return t('内置')
  if (source === 'manual') return t('手动')
  return t('自定义')
}

/** 从能力位里读两件手机上值得显示的事实（上下文窗口 / 是否支持思考） */
function readCaps(capabilities: unknown): { context?: string; reasoning?: boolean } {
  if (!capabilities || typeof capabilities !== 'object') return {}
  const caps = capabilities as Record<string, unknown>
  const input = caps.maxInputTokens ?? caps.contextWindow ?? caps.maxContextTokens
  const reasoning = Boolean(caps.reasoning || caps.reasoningLevels || caps.supportsReasoning)
  return {
    context: typeof input === 'number' && input > 0 ? formatWindow(input) : undefined,
    reasoning,
  }
}

function formatWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}
