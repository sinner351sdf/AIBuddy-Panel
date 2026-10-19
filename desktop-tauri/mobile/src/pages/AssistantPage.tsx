import {
  MessageGroup,
  Message as ChatMessage,
  MessageContent,
  MessageAvatar,
  Bubble,
  BubbleContent,
  Trace,
  TraceLine,
  TraceTitle,
  TraceDescription,
  Badge,
  Button,
  Skeleton,
} from '@ui'
import { PageHead, IconButton } from '../components/ui'
import { accountLimitState } from '../lib/accountLimits'

import { openManagement } from './ManagementPage'
import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useStore, store } from '../state/store'
import { t } from '../i18n'

/** Compact mobile view; complete editors open within the mobile navigation shell. */

type Message =
  | { role: 'user'; text: string }
  | {
      role: 'assistant'
      text: string
      rows?: Array<{ label: string; value: string; mono?: boolean }>
    }
  | { role: 'tool'; title: string; state: 'done' | 'failed'; text: string }

type QuickAsk = {
  key: string
  label: string
  icon: Parameters<typeof Icon>[0]['name']
}

const QUICK_ASKS: QuickAsk[] = [
  { key: 'balance', label: t('各账号余额还剩多少？'), icon: 'wallet' },
  { key: 'duplicates', label: t('哪些模型在多家重复了？'), icon: 'model' },
  { key: 'today', label: t('今天用了多少 Token？'), icon: 'chart' },
  { key: 'limited', label: t('现在有哪些账号被限流？'), icon: 'alert' },
]

export function AssistantPage() {
  const state = useStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)

  const ask = async (item: QuickAsk) => {
    if (busy) return
    setBusy(true)
    setMessages((prev) => [...prev, { role: 'user', text: item.label }])
    try {
      const reply = await answer(item.key, state)
      setMessages((prev) => [...prev, ...reply])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'tool',
          title: item.label,
          state: 'failed',
          text: error instanceof Error ? error.message : String(error),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-page flex h-full min-h-0 flex-col">
      <PageHead
        title={t('AI 助手')}
        subtitle={t('快捷查询走本地网关，不消耗额度')}
        actions={
          <IconButton
            name="refresh"
            label={t('清空')}
            onClick={() => setMessages([])}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <MessageGroup>
          {!messages.length ? (
            <ChatMessage>
              <MessageAvatar className="size-8 self-start">
                <Icon name="spark" />
              </MessageAvatar>
              <MessageContent>
                <Bubble variant="secondary">
                  <BubbleContent>
                    {t(
                      '我可以直接查网关里的真实数据：余额、模型重复、今日用量、限流账号。',
                    )}
                    <br />
                    {t('点下方开始对话，可使用模型、历史记录和工具调用。')}
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </ChatMessage>
          ) : null}
          {messages.map((message, index) =>
            message.role === 'tool' ? (
              <Trace key={index}>
                <TraceLine>
                  <TraceTitle>
                    {message.title}
                    <Badge
                      variant={
                        message.state === 'done' ? 'success' : 'destructive'
                      }
                    >
                      {message.state === 'done' ? t('完成') : t('失败')}
                    </Badge>
                  </TraceTitle>
                  <TraceDescription>{message.text}</TraceDescription>
                </TraceLine>
              </Trace>
            ) : (
              <ChatMessage
                key={index}
                align={message.role === 'user' ? 'end' : 'start'}
              >
                <MessageContent>
                  <Bubble
                    variant={message.role === 'user' ? 'default' : 'secondary'}
                  >
                    <BubbleContent>
                      {message.text}
                      {message.role === 'assistant' && message.rows?.length ? (
                        <dl className="m-0 mt-3 divide-y divide-border">
                          {message.rows.map((row, i) => (
                            <div
                              key={i}
                              className="flex flex-wrap justify-between gap-2 py-2"
                            >
                              <dt className="min-w-0 break-all">{row.label}</dt>
                              <dd className={row.mono ? 'm-mono m-0' : 'm-0'}>
                                {row.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </ChatMessage>
            ),
          )}
          {busy ? (
            <Skeleton className="h-12 w-3/4" aria-label={t('查询中…')} />
          ) : null}
        </MessageGroup>
        <div className="mt-4 flex flex-col gap-2">
          {QUICK_ASKS.map((item) => (
            <Button
              key={item.key}
              variant="outline"
              className="h-auto min-h-11 justify-start whitespace-normal text-left"
              disabled={busy}
              onClick={() => void ask(item)}
            >
              <Icon name={item.icon} data-icon="inline-start" />
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <footer className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => openManagement('assistant', t('AI 助手'))}
        >
          {t('开始对话')}
          <Icon name="up" data-icon="inline-end" />
        </Button>
        <p className="m-0 text-center text-xs text-muted-foreground">
          {t('上面四个快捷查询直接读网关数据，不经过模型')}
        </p>
      </footer>
    </div>
  )
}

/* ─── 四个快捷查询的答案 ─────────────────────── */

async function answer(
  key: string,
  state: ReturnType<typeof useStore>,
): Promise<Message[]> {
  const {
    fetchAccounts,
    fetchManage,
    fetchStatsSummary,
    fetchBalanceSnapshot,
  } = await import('../api/gateway')

  if (key === 'balance') {
    const data = await fetchAccounts()
    const accounts = data.accounts || []
    if (!accounts.length) {
      return [
        {
          role: 'tool',
          title: t('查询账号'),
          state: 'done',
          text: t('还没有账号。'),
        },
      ]
    }
    const rows = accounts.slice(0, 8).map((item) => ({
      label: (item.email || item.name || item.id) as string,
      value: balanceText(item),
    }))
    return [
      {
        role: 'assistant',
        text: t('共 {n} 个账号，前 {m} 个的余额读数：', {
          n: accounts.length,
          m: rows.length,
        }),
        rows,
      },
      {
        role: 'tool',
        title: t('读取账号列表'),
        state: 'done',
        text: t('余额是缓存读数，点账号详情里的「刷新凭证」可触发实时查询。'),
      },
    ]
  }

  if (key === 'duplicates') {
    const view = await fetchManage()
    const models = view.models || []
    const byName = new Map<string, Set<string>>()
    models.forEach((item) => {
      const name = String(item.id || '')
      if (!name) return
      const set = byName.get(name) || new Set<string>()
      set.add(String(item.provider || ''))
      byName.set(name, set)
    })
    const dupes = [...byName.entries()].filter(
      ([, providers]) => providers.size > 1,
    )
    if (!dupes.length) {
      return [
        { role: 'assistant', text: t('当前没有同名模型分布在多家。') },
        {
          role: 'tool',
          title: t('读取模型清单'),
          state: 'done',
          text: t('共 {n} 个模型条目。', { n: models.length }),
        },
      ]
    }
    return [
      {
        role: 'assistant',
        text: t('找到 {n} 组同名模型：', { n: dupes.length }),
        rows: dupes.slice(0, 8).map(([name, providers]) => ({
          label: name,
          value: t('{n} 家', { n: providers.size }),
          mono: true,
        })),
      },
      {
        role: 'tool',
        title: t('读取模型清单'),
        state: 'done',
        text: t('共 {n} 个模型条目。映射与改名可在「模型管理」里编辑。', {
          n: models.length,
        }),
      },
    ]
  }

  if (key === 'today') {
    const summary = await fetchStatsSummary('today')
    const overview = summary.overview
    const tokens = Number(overview?.tokens) || 0
    const requests = Number(overview?.requests) || 0
    const successful = Number(overview?.successful) || 0
    return [
      {
        role: 'assistant',
        text: t('今天用了 {tokens} Token，共 {requests} 次请求。', {
          tokens: tokens.toLocaleString('zh-CN'),
          requests: requests.toLocaleString('zh-CN'),
        }),
        rows: [
          { label: t('总请求'), value: String(requests) },
          { label: t('成功'), value: String(successful) },
          {
            label: t('成功率'),
            value: requests
              ? `${((successful / requests) * 100).toFixed(1)}%`
              : '—',
          },
          {
            label: t('Top 模型'),
            value: String(overview?.topModel?.model || '—'),
            mono: true,
          },
        ],
      },
    ]
  }

  if (key === 'limited') {
    const [data, snapshot] = await Promise.all([
      fetchAccounts(),
      fetchBalanceSnapshot(),
    ])
    const limited = (data.accounts || []).filter(
      (item) => accountLimitState(item, snapshot).limited,
    )
    if (!limited.length) {
      return [{ role: 'assistant', text: t('现在没有账号被限流。') }]
    }
    return [
      {
        role: 'assistant',
        text: t('{n} 个账号正在限流：', { n: limited.length }),
        rows: limited.slice(0, 8).map((item) => ({
          label: (item.email || item.name || item.id) as string,
          value: accountLimitState(item, snapshot).balance
            ? t('余额不足')
            : accountLimitState(item, snapshot).token
              ? t('Token 限额')
              : t('限流中'),
        })),
      },
    ]
  }

  void state
  return [{ role: 'assistant', text: t('这个查询还没有实现。') }]
}

function balanceText(account: { [key: string]: unknown }): string {
  const candidates = ['balance', 'credits', 'points', 'available']
  for (const key of candidates) {
    const value = account[key]
    if (typeof value === 'number' && Number.isFinite(value))
      return value.toLocaleString('zh-CN')
    if (typeof value === 'string' && value) return value
  }
  return '—'
}
