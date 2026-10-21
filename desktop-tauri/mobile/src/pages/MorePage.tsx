import {
  Badge, Card, CardContent, Item, ItemActions, ItemContent, ItemDescription,
  ItemGroup, ItemMedia, ItemSeparator, ItemTitle, SegmentedControl, Skeleton, cn,
} from '@ui'
import { Fragment } from 'react'
import { accountLimitState } from '../lib/accountLimits'
import { PageHead } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'
import { store, useStore } from '../state/store'
import { apiBase, baseLabel } from '../lib/servers'
import { t } from '../i18n'

type Entry = { id: string; label: string; description: string; icon: IconName; badge?: string }

/** Phone navigation hub: compact tools, descriptive diagnostics, and local preferences. */
export function MorePage() {
  const state = useStore()
  const accounts = state.session?.accounts?.accounts || []
  const limited = accounts.filter(item => accountLimitState(item, state.balancesSnapshot).limited).length
  const connection = state.sessionError ? 'error' : state.session ? 'connected' : state.loading ? 'loading' : 'unknown'
  const tools: Entry[] = [
    { id: 'checkin', label: t('签到中心'), description: t('每日签到与福利'), icon: 'checkin' },
    { id: 'models', label: t('模型管理'), description: t('启用与映射'), icon: 'model' },
    { id: 'agent', label: t('Agent 接管'), description: t('配置与恢复'), icon: 'agent' },
    { id: 'proxies', label: t('网络代理'), description: t('出口与订阅'), icon: 'proxy' },
    { id: 'keys', label: t('网关 Key'), description: t('密钥与额度'), icon: 'key' },
    { id: 'docs', label: t('接口文档'), description: t('地址与接入'), icon: 'doc' },
  ]
  const diagnostics: Entry[] = [
    { id: 'accounts', label: t('账号'), description: limited ? t('限流或额度限制') : t('账号状态与可用额度'), icon: 'users', badge: limited ? t('{n} 个受限', { n: limited }) : undefined },
    { id: 'credits', label: t('积分构成'), description: t('查看积分来源与消耗'), icon: 'wallet' },
    { id: 'requests', label: t('请求日志'), description: t('调用记录与转发详情'), icon: 'request' },
    { id: 'logs', label: t('运行日志'), description: t('服务事件与错误排查'), icon: 'log' },
    { id: 'tasks', label: t('定时任务'), description: t('执行计划与任务记录'), icon: 'task' },
  ]
  const system: Entry[] = [
    { id: 'settings', label: t('设置'), description: t('网关配置与系统管理'), icon: 'settings' },
    { id: 'report', label: t('报表'), description: t('Token 趋势与用量排行'), icon: 'chart' },
  ]

  return (
    <div className='m-page m-more'>
      <PageHead title={t('更多')} subtitle={t('管理工具与偏好设置')} />
      <div className='more-body'>
        <Card className='gap-0 py-0'>
          <CardContent className='p-0'>
            <ItemGroup role='group' className='gap-0' aria-label={t('当前网关')}>
              <Item render={<button type='button' aria-label={t('网关状态')} onClick={() => store.push('settings')} />} className='more-connection min-h-22 flex-nowrap gap-3 rounded-xl border-0 p-4 text-left hover:bg-muted/50'>
                <ItemMedia variant='icon' className='size-10 rounded-xl bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0'><Icon name='server' /></ItemMedia>
                <ItemContent className='min-w-0 gap-1'>
                  <ItemTitle className='text-xs text-muted-foreground'>{t('当前网关')}</ItemTitle>
                  <ItemDescription className='m-mono truncate text-[13px] text-foreground' title={baseLabel(apiBase())}>{baseLabel(apiBase())}</ItemDescription>
                </ItemContent>
                <ItemActions className='shrink-0 gap-2'>
                  {connection === 'loading' ? <Skeleton className='h-5 w-12' aria-label={t('连接状态加载中')} /> : <Badge variant={connection === 'connected' ? 'success' : connection === 'error' ? 'warning' : 'secondary'}>{connection === 'connected' ? t('已连接') : connection === 'error' ? t('连接异常') : t('待连接')}</Badge>}
                  <Icon name='chev' className='size-4 text-muted-foreground' />
                </ItemActions>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>

        <section aria-labelledby='more-tools-heading'>
          <h2 id='more-tools-heading' className='more-section-title'>{t('转发与接入')}</h2>
          <Card className='gap-0 py-0'><CardContent className='p-1.5'>
            <ItemGroup role='group' className='grid grid-cols-2 gap-1 md:grid-cols-3' aria-label={t('转发与接入')}>
              {tools.map(entry => <Item key={entry.id} render={<button type='button' aria-label={entry.label} onClick={() => store.push(entry.id)} />} className='min-h-20 flex-nowrap gap-2.5 border-0 px-2.5 py-3 text-left hover:bg-muted/60 active:bg-muted'>
                <ItemMedia variant='icon' className='size-8 rounded-lg bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0'><Icon name={entry.icon} /></ItemMedia>
                <ItemContent className='min-w-0 gap-1.5'>
                  <ItemTitle className='text-[13px]'>{entry.label}</ItemTitle>
                  <ItemDescription className='line-clamp-none text-[11px] leading-relaxed'>{entry.description}</ItemDescription>
                </ItemContent>
              </Item>)}
            </ItemGroup>
          </CardContent></Card>
        </section>

        <MenuSection id='more-diagnostics' title={t('运行与诊断')} entries={diagnostics} />
        <MenuSection id='more-system' title={t('系统')} entries={system} />

        <section aria-labelledby='more-appearance-heading'>
          <h2 id='more-appearance-heading' className='more-section-title'>{t('外观')}</h2>
          <Card className='gap-0 py-0'><CardContent className='flex flex-col gap-3 p-4'>
            <div className='flex items-center gap-2 text-sm font-medium'><Icon name='moon' className='size-4 text-muted-foreground' /><span>{t('主题')}</span></div>
            <ThemeSwitch fullWidth />
          </CardContent></Card>
        </section>
        <p className='more-footnote'>{t('配置修改作用于当前连接的服务。')}</p>
      </div>
    </div>
  )
}

function MenuSection({ id, title, entries }: { id: string; title: string; entries: Entry[] }) {
  return <section aria-labelledby={id}>
    <h2 id={id} className='more-section-title'>{title}</h2>
    <Card className='gap-0 py-0'><CardContent className='p-0'>
      <ItemGroup role='group' className='gap-0' aria-label={title}>
        {entries.map((entry, index) => <Fragment key={entry.id}>
          {index ? <ItemSeparator className='mx-4 my-0 w-auto' /> : null}
          <Item render={<button type='button' aria-label={entry.label} aria-describedby={`more-${entry.id}-description${entry.badge ? ` more-${entry.id}-badge` : ''}`} onClick={() => store.push(entry.id)} />} className='min-h-18 flex-nowrap gap-3 rounded-none border-0 px-4 py-3 text-left hover:bg-muted/50 active:bg-muted'>
            <ItemMedia variant='icon' className='size-8 rounded-lg bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0'><Icon name={entry.icon} /></ItemMedia>
            <ItemContent className='min-w-0 gap-1'>
              <ItemTitle>{entry.label}</ItemTitle>
              <ItemDescription id={`more-${entry.id}-description`} className='text-xs'>{entry.description}</ItemDescription>
            </ItemContent>
            <ItemActions className='shrink-0 gap-2'>
              {entry.badge ? <Badge id={`more-${entry.id}-badge`} variant='warning'>{entry.badge}</Badge> : null}
              <Icon name='chev' className='size-4 text-muted-foreground' />
            </ItemActions>
          </Item>
        </Fragment>)}
      </ItemGroup>
    </CardContent></Card>
  </section>
}

export function ThemeSwitch({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const { theme } = useStore()
  return <SegmentedControl aria-label={t('主题')} className={cn('more-theme grid grid-cols-3 gap-1 p-1 [&_[data-slot=segmented-item]]:min-h-11', fullWidth ? 'w-full' : 'w-fit shrink-0')} value={theme} onValueChange={value => store.setTheme(value)} options={[
    { value: 'system', label: fullWidth ? t('跟随系统') : t('系统') },
    { value: 'light', label: t('浅色') },
    { value: 'dark', label: t('深色') },
  ]} />
}
