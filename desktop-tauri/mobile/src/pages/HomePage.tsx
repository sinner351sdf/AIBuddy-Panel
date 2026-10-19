import { useEffect, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Alert,
  AlertDescription,
  Badge,
  Progress,
} from '@ui'
import { Surface, MobileButton } from '../components/primitives'
import {
  PageHead,
  IconButton,
  SectionHead,
  Empty,
  ErrorNote,
  copyWithToast,
} from '../components/ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { useStore, store } from '../state/store'
import {
  fetchCheckinCenter,
  fetchRequests,
  type CheckinCenter,
  type RequestPage,
} from '../api/gateway'
import { formatInt, formatDuration, ellipsisMiddle } from '../lib/format'
import { apiBase, baseLabel } from '../lib/servers'
import { providerLabel } from '../lib/providers'
import { accountLimitState } from '../lib/accountLimits'
import { usePolling } from '../lib/usePolling'
import { t } from '../i18n'

export function HomePage() {
  const state = useStore(),
    session = state.session,
    accounts = session?.accounts?.accounts || []
  const enabled = accounts.filter((account) => account.enabled !== false).length
  const limited = accounts.filter(
    (account) => accountLimitState(account, state.balancesSnapshot).limited,
  ).length
  const available = accounts.filter(
    (account) =>
      account.enabled !== false &&
      account.available !== false &&
      !accountLimitState(account, state.balancesSnapshot).limited,
  ).length
  const [checkin, setCheckin] = useState<CheckinCenter | null>(null)
  const [requests, setRequests] = useState<RequestPage | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [center, page] = await Promise.all([
        fetchCheckinCenter(),
        fetchRequests({ limit: 3 }),
      ])
      setCheckin(center)
      setRequests(page)
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  // Check-in and request data poll independently of the shared session/usage snapshot.
  usePolling(load, 60_000, [session])

  useEffect(() => {
    if (!session) void store.refresh()
  }, [session])

  const gateway = session?.health?.upstreamConfigured,
    daily = checkin?.daily,
    eligible = daily?.todayEligible || 0,
    done = daily?.todayDone || 0
  const recent = requests?.entries || []
  return (
    <div className="m-page">
      <PageHead
        title={t('网关运行中')}
        subtitle={t('{n} 个账号启用 · {m} 个限流中', {
          n: enabled,
          m: limited,
        })}
        actions={
          <IconButton
            name="refresh"
            label={t('刷新')}
            onClick={() => void store.refresh(true)}
          />
        }
      />
      {state.sessionError ? <ErrorNote text={state.sessionError} /> : null}
      <section className="m-section mt-0">
        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="gap-3 px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={gateway ? 'success' : 'secondary'}>
                {gateway ? t('运行中') : t('未配置上游')}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0 max-w-full truncate font-mono text-xs"
                onClick={() =>
                  void copyWithToast(apiBase() + '/v1', 'Base URL')
                }
              >
                {baseLabel(apiBase())}/v1
                <Icon name="copy" data-icon="inline-end" />
              </Button>
            </div>
            <CardTitle>{t('网关概览')}</CardTitle>
            <CardDescription>
              {t('当前连接的网关状态与账号概况')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 px-4">
            <Metric
              label={t('可用账号')}
              value={`${available} / ${accounts.length}`}
            />
            <Metric label={t('限流中')} value={String(limited)} />
            <Metric
              label={t('最近请求')}
              value={formatInt(requests?.matched ?? requests?.total ?? 0)}
            />
          </CardContent>
          <CardFooter className="justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
            <span>
              {t('今日签到 {done}/{total}', { done, total: eligible })}
            </span>
            <span>{t('共 {n} 个账号', { n: accounts.length })}</span>
          </CardFooter>
        </Card>
      </section>
      <section className="m-section">
        <Card className="gap-3 py-4 shadow-none">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center justify-between gap-2">
              <span>
                {t('今日签到 {done} / {total}', { done, total: eligible })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => store.push('checkin')}
              >
                <Icon name="checkin" data-icon="inline-start" />
                {t('签到')}
              </Button>
            </CardTitle>
            <CardDescription>
              {eligible > done
                ? t('还有 {n} 个待签', { n: eligible - done })
                : t('今天都签完了')}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <Progress
              value={eligible ? (done / eligible) * 100 : 0}
              aria-label={t('今日签到进度')}
            />
          </CardContent>
        </Card>
      </section>
      <section className="m-section">
        <Card className="py-2 shadow-none">
          <CardContent className="grid grid-cols-4 gap-1 px-2">
            {(
              [
                { icon: 'checkin', label: t('签到'), screen: 'checkin' },
                { icon: 'model', label: t('模型'), screen: 'models' },
                { icon: 'key', label: t('Key'), screen: 'keys' },
                { icon: 'doc', label: t('接入'), screen: 'docs' },
              ] as const
            ).map((item) => (
              <Button
                key={item.screen}
                variant="ghost"
                className="h-auto min-h-16 flex-col gap-2 py-3"
                onClick={() => store.push(item.screen)}
              >
                <Icon name={item.icon} data-icon="inline-start" />
                <span className="text-xs">{item.label}</span>
              </Button>
            ))}
          </CardContent>
        </Card>
      </section>
      {limited > 0 ? (
        <section className="m-section">
          <Alert className="border-warning-bd bg-warning-soft text-warning">
            <Icon name="alert" />
            <AlertDescription className="flex items-center justify-between gap-2 text-inherit">
              <span>{t('{n} 个账号存在限流或额度限制', { n: limited })}</span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-inherit"
                onClick={() => store.push('accounts', { filter: 'limited' })}
              >
                {t('查看')}
              </Button>
            </AlertDescription>
          </Alert>
        </section>
      ) : null}
      <section className="m-section">
        <SectionHead
          title={t('最近请求')}
          action={{ label: t('全部'), onClick: () => store.push('requests') }}
        />
        <Surface>
          {error ? (
            <Empty text={error} />
          ) : recent.length ? (
            recent.map((row, index) => (
              <MobileButton
                className="m-row"
                key={row.id || index}
                onClick={() => store.push('requests')}
              >
                <StatusDot status={row.status} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {ellipsisMiddle(row.upstreamModel || row.model || '—', 26)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.durationMs ? formatDuration(row.durationMs) : '—'}
                </span>
              </MobileButton>
            ))
          ) : (
            <Empty text={t('还没有请求记录')} />
          )}
        </Surface>
      </section>
      <section className="m-section">
        <SectionHead
          title={t('账号分布')}
          action={{ label: t('管理'), onClick: () => store.go('accounts') }}
        />
        <Surface>
          {(session?.accounts?.providers || [])
            .filter((item) => (item.count || 0) > 0)
            .map((item) => (
              <MobileButton
                key={item.id}
                className="m-row"
                onClick={() => store.go('accounts')}
              >
                <ProviderLogo id={item.id} label={item.label} />
                <div className="m-grow">
                  <div className="m-t1">
                    {providerLabel(item.id, item.label)}
                  </div>
                  <div className="m-t2">
                    {t('{n} 个账号', { n: item.count || 0 })}
                  </div>
                </div>
                <Icon name="chev" data-icon="inline-end" />
              </MobileButton>
            ))}
          {!accounts.length ? <Empty text={t('还没有添加账号')} /> : null}
        </Surface>
      </section>
    </div>
  )
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </div>
    </div>
  )
}
export function StatusDot({ status }: { status?: number }) {
  return (
    <Badge
      variant={
        !status
          ? 'warning'
          : status >= 200 && status < 400
            ? 'success'
            : 'destructive'
      }
      className="size-2 min-h-0 shrink-0 rounded-full p-0"
      aria-label={status ? String(status) : t('查询中…')}
    />
  )
}
