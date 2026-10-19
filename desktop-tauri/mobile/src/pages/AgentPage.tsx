import { ManagementButton } from './ManagementPage'
import { confirmAction } from '../components/confirm'
import { Surface, MobileButton } from '../components/primitives'
import { useState } from 'react'
import { PageIntro, IconButton, Badge, Empty, ErrorNote, SkeletonList } from '../components/ui'
import { GlyphLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { store } from '../state/store'
import { fetchAgents, restoreAgentClient, type AgentClient } from '../api/gateway'
import { usePolling } from '../lib/usePolling'
import { t } from '../i18n'

/** Compact mobile view; complete editors open within the mobile navigation shell. */
export function AgentPage() {
  const [clients, setClients] = useState<AgentClient[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    try {
      const data = await fetchAgents()
      setClients(data.clients || [])
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  usePolling(load, 120_000)

  const restore = async (client: AgentClient) => {
    if (!client.id) return
    if (!(await confirmAction(t('确定按最近一次备份还原「{name}」？', { name: client.name || client.id })))) return
    setBusy(client.id)
    try {
      await restoreAgentClient(client.id)
      store.toast(t('已还原「{name}」', { name: client.name || client.id }))
      await load()
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className='m-page'>
      <PageIntro subtitle={t('改写网关所在机器上的客户端配置')}
        actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void load()} />}
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <Surface
          className='m-card m-card-pad'
          style={{ background: 'var(--m-warn-soft)', borderColor: 'color-mix(in srgb, var(--m-warn) 24%, transparent)' }}
        >
          <div style={{ fontSize: 12.3, lineHeight: 1.6, color: 'var(--m-text-2)' }}>
            {t('配置会写入当前连接的网关所在机器。保存配置后，先预览，再手动确认应用。')}
            <ManagementButton page="agent">{t('配置与应用接管')}</ManagementButton>
          </div>
        </Surface>
      </div>

      {error ? <ErrorNote text={error} /> : null}
      {!clients ? <SkeletonList rows={3} height={96} /> : null}

      {clients && !clients.length ? (
        <div className='m-section'>
          <Surface className='m-card'>
            <Empty text={t('没有检测到可接管的客户端')} />
          </Surface>
        </div>
      ) : null}

      {(clients || []).map(client => (
        <div key={client.id} className='m-section' style={{ marginTop: 10 }}>
          <Surface className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <GlyphLogo name='agent' />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name || client.id}</div>
                <div
                  className='m-mono'
                  style={{
                    fontSize: 11,
                    color: 'var(--m-text-3)',
                    marginTop: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {client.configPath || '—'}
                </div>
              </div>
              <Badge tone={client.viaGateway ? 'ok' : 'mute'}>{client.viaGateway ? t('已接管') : t('未接管')}</Badge>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 11,
                paddingTop: 10,
                borderTop: '1px solid var(--m-line)',
                fontSize: 11.5,
                color: 'var(--m-text-3)',
              }}
            >
              <span>{client.configMode === 'multi' ? t('多配置文件') : t('单配置文件')}</span>
              {client.hasBackup ? (
                <MobileButton
                  type='button'
                  className='m-btn m-sm m-ghost'
                  style={{ marginLeft: 'auto', height: 28, fontSize: 11.5, padding: '0 10px' }}
                  disabled={busy === client.id}
                  onClick={() => void restore(client)}
                >
                  <Icon name='refresh' style={{ width: 12, height: 12 }} />
                  {busy === client.id ? t('还原中…') : t('还原')}
                </MobileButton>
              ) : null}
            </div>
          </Surface>
        </div>
      ))}

      <div className='m-section' style={{ paddingBottom: 8 }}>
        <Surface className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
          {t('接管会把客户端的 base_url 指向本网关，并在写入前自动备份原文件。')}
        </Surface>
      </div>
    </div>
  )
}
