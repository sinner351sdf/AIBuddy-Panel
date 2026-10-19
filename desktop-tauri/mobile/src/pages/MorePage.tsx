import { Button, Badge, Tabs, TabsList, TabsTrigger } from '@ui'
import { accountLimitState } from '../lib/accountLimits'
import { Surface, MobileButton } from '../components/primitives'
import { PageHead, SectionHead, IconButton } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'
import { store, useStore } from '../state/store'
import { apiBase, baseLabel } from '../lib/servers'
import { t } from '../i18n'

/**
 * 更多。
 *
 * 桌面端 13 个一级菜单在这里收成三组宫格。**宫格不是垃圾桶**：按
 * 「转发链路 / 诊断 / 系统」分组，每组内部按使用频率排；每个入口带实时
 * 角标（待签数、限流数），不用点进去才知道有事。
 */

type Entry = { id: string; label: string; icon: IconName; badge?: string }

export function MorePage() {
  const state = useStore()
  const accounts = state.session?.accounts?.accounts || []
  const limited = accounts.filter(
    (item) => accountLimitState(item, state.balancesSnapshot).limited,
  ).length
  const groups: Array<{ title: string; entries: Entry[] }> = [
    {
      title: t('转发链路'),
      entries: [
        { id: 'checkin', label: t('签到中心'), icon: 'checkin' },
        { id: 'models', label: t('模型管理'), icon: 'model' },
        { id: 'agent', label: t('Agent 接管'), icon: 'agent' },
        { id: 'proxies', label: t('网络代理'), icon: 'proxy' },
        { id: 'keys', label: t('网关 Key'), icon: 'key' },
        { id: 'docs', label: t('接口文档'), icon: 'doc' },
      ],
    },
    {
      title: t('诊断'),
      entries: [
        {
          id: 'accounts',
          label: t('账号'),
          icon: 'users',
          badge: limited ? String(limited) : undefined,
        },
        { id: 'requests', label: t('请求日志'), icon: 'request' },
        { id: 'logs', label: t('运行日志'), icon: 'log' },
        { id: 'tasks', label: t('定时任务'), icon: 'task' },
      ],
    },
    {
      title: t('系统'),
      entries: [
        { id: 'settings', label: t('设置'), icon: 'settings' },
        { id: 'report', label: t('报表'), icon: 'chart' },
      ],
    },
  ]

  return (
    <div className="m-page">
      <PageHead
        title={t('更多')}
        subtitle={t('转发链路 · 诊断 · 系统')}
        actions={
          <IconButton
            name="settings"
            label={t('设置')}
            onClick={() => store.push('settings')}
          />
        }
      />
      {groups.map((group) => (
        <section key={group.title} className="m-section">
          <SectionHead title={group.title} />
          <Surface>
            <div className="grid grid-cols-3 gap-1 p-2 sm:grid-cols-4">
              {group.entries.map((entry) => (
                <Button
                  key={entry.id}
                  variant="ghost"
                  className="relative h-auto min-h-20 flex-col gap-2 whitespace-normal px-1 py-3 text-xs"
                  onClick={() => store.push(entry.id)}
                >
                  <Icon name={entry.icon} data-icon="inline-start" />
                  {entry.label}
                  {entry.badge ? (
                    <Badge variant="warning" className="absolute right-2 top-1">
                      {entry.badge}
                    </Badge>
                  ) : null}
                </Button>
              ))}
            </div>
          </Surface>
        </section>
      ))}
      <section className="m-section">
        <SectionHead title={t('外观')} />
        <Surface>
          <div className="m-row flex-wrap">
            <Icon name="moon" />
            <span className="m-grow">{t('主题')}</span>
            <ThemeSwitch />
          </div>
        </Surface>
      </section>
      <section className="m-section">
        <Surface>
          <MobileButton
            className="m-row"
            onClick={() => store.push('settings')}
          >
            <Icon name="server" />
            <div className="m-grow">
              <div className="m-t1">{t('网关状态')}</div>
              <div className="m-t2 m-mono">{baseLabel(apiBase())}</div>
            </div>
            <Icon name="chev" />
          </MobileButton>
          <MobileButton className="m-row" onClick={() => store.push('docs')}>
            <Icon name="doc" />
            <div className="m-grow">
              <div className="m-t1">{t('接口地址')}</div>
              <div className="m-t2">{t('把 Base URL 复制给客户端')}</div>
            </div>
            <Icon name="chev" />
          </MobileButton>
        </Surface>
      </section>
      <section className="m-section">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            '手机端只做查看与高频操作；添加账号、编辑凭证、改写客户端配置仍需桌面端。',
          )}
        </p>
      </section>
    </div>
  )
}
export function ThemeSwitch() {
  const { theme } = useStore()
  return (
    <Tabs
      value={theme}
      onValueChange={(value) =>
        store.setTheme(value as 'system' | 'light' | 'dark')
      }
    >
      <TabsList className="h-auto group-data-horizontal/tabs:h-auto">
        {(
          [
            { value: 'system', label: t('系统') },
            { value: 'light', label: t('浅色') },
            { value: 'dark', label: t('深色') },
          ] as const
        ).map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className="min-h-10 px-3 text-xs"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
