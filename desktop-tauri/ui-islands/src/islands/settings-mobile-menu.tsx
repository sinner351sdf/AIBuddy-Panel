import * as React from 'react'
import {
  Button, Card, CardContent, Empty, EmptyDescription, EmptyHeader, EmptyTitle,
  InputGroup, InputGroupAddon, InputGroupInput, Item, ItemActions, ItemContent,
  ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle,
} from '@ui'
import { Activity, BellIcon, Blocks, ChevronRight, DownloadIcon, EyeIcon, GaugeIcon, Globe, LayoutGrid, List, RefreshCwIcon, Server, Settings2Icon, ShieldCheckIcon, Sparkles, SearchIcon, Workflow } from '@ui/navigation-icons'
import { t } from '../i18n'

type Category = { id: string; label: string; icon: string }
const GROUPS = [
  { label: '基础与外观', ids: ['general', 'display', 'brand', 'prefs', 'shell'] },
  { label: '转发与助手', ids: ['gateway', 'routing', 'retry', 'timeout', 'assistant'] },
  { label: '安全与维护', ids: ['security', 'data', 'notify', 'backup'] },
  { label: '系统与支持', ids: ['deploy', 'feedback', 'about'] },
]
const DESCRIPTIONS: Record<string, string> = {
  general: '语言、启动与运行偏好', display: '主题与界面显示', brand: '面板名称与图标',
  prefs: '配色、布局与页面偏好', shell: '通知提示与页签行为',
  gateway: '请求队列、提示词与兼容设置', routing: '账号选择策略与会话粘性', retry: '失败重试与状态码规则',
  timeout: '连接、响应与流式超时', assistant: '模型、提示词与工具权限', security: '面板认证与访问控制',
  data: '存储位置、保留时间与清理', notify: '告警事件、推送渠道与静默时段', backup: '备份、恢复与运行维护',
  deploy: '版本、运行模式与服务信息', feedback: '问题反馈与项目支持', about: '版本检查与更新记录',
}
function CategoryIcon({ id }: { id: string }) {
  const icons: Record<string, React.ComponentType<{className?:string}>> = {
    general:Globe,display:EyeIcon,brand:Blocks,prefs:LayoutGrid,shell:List,gateway:Server,routing:Workflow,
    retry:RefreshCwIcon,timeout:GaugeIcon,assistant:Sparkles,security:ShieldCheckIcon,data:Activity,
    notify:BellIcon,backup:DownloadIcon,deploy:Activity,feedback:Globe,about:DownloadIcon,
  }
  const Component = icons[id] || Settings2Icon
  return <Component />
}

export function SettingsMobileMenu({ categories, open, onDevicePreferences }: {
  categories: readonly Category[]; open: (id: string) => void; onDevicePreferences?: () => void
}) {
  const [query, setQuery] = React.useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const groups = GROUPS.map(group => ({ ...group, items: group.ids.map(id => categories.find(item => item.id === id)).filter((item): item is Category => Boolean(item))
    .filter(item => !normalized || `${t(item.label)} ${t(DESCRIPTIONS[item.id] || '')}`.toLocaleLowerCase().includes(normalized)) })).filter(group => group.items.length)
  return <div className='mobile-settings-menu'>
    <div className='mobile-settings-intro'><p>{t('配置当前连接的网关，或调整这台手机的使用偏好。')}</p></div>
    <InputGroup className='min-h-11'>
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜索设置…')} aria-label={t('搜索设置')} />
      {query ? <InputGroupAddon align='inline-end'><Button variant='ghost' size='sm' onClick={() => setQuery('')}>{t('清除')}</Button></InputGroupAddon> : null}
    </InputGroup>
    {onDevicePreferences && !normalized ? <Card className='gap-0 py-0'><CardContent className='p-0'>
      <ItemGroup role='group' aria-label={t('本机偏好')}>
        <Item render={<Button variant='ghost' aria-label={t('本机偏好与安装')} onClick={onDevicePreferences} />} className='mobile-settings-device min-h-20 flex-nowrap justify-start gap-3 border-0 p-4 text-left'>
          <ItemMedia variant='icon' className='size-9 rounded-lg bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0'><Settings2Icon /></ItemMedia>
          <ItemContent className='min-w-0'><ItemTitle>{t('本机偏好与安装')}</ItemTitle><ItemDescription className='text-xs'>{t('手机主题、语言与主屏幕安装')}</ItemDescription></ItemContent>
          <ItemActions><ChevronRight className='size-4 text-muted-foreground' /></ItemActions>
        </Item>
      </ItemGroup>
    </CardContent></Card> : null}
    <nav id='settings-nav' className='mobile-settings-groups' aria-label={t('设置分类')}>
      {groups.map(group => <section key={group.label} aria-label={t(group.label)}>
        <h2 className='mobile-settings-section-label'>{t(group.label)}</h2>
        <Card className='gap-0 py-0'><CardContent className='p-0'>
          <ItemGroup role='group' className='gap-0' aria-label={t(group.label)}>
            {group.items.map((item, index) => <React.Fragment key={item.id}>
              {index ? <ItemSeparator className='mx-4 my-0 w-auto' /> : null}
              <Item render={<Button variant='ghost' data-cat={item.id} aria-label={t(item.label)} aria-describedby={`settings-category-${item.id}-description`} onClick={() => open(item.id)} />} className='min-h-18 flex-nowrap justify-start gap-3 rounded-none border-0 px-4 py-3 text-left'>
                <ItemMedia variant='icon' className='size-8 rounded-lg bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0'><CategoryIcon id={item.id} /></ItemMedia>
                <ItemContent className='min-w-0'><ItemTitle>{t(item.label)}</ItemTitle><ItemDescription id={`settings-category-${item.id}-description`} className='text-xs'>{t(DESCRIPTIONS[item.id] || '')}</ItemDescription></ItemContent>
                <ItemActions><ChevronRight className='size-4 text-muted-foreground' /></ItemActions>
              </Item>
            </React.Fragment>)}
          </ItemGroup>
        </CardContent></Card>
      </section>)}
    </nav>
    {!groups.length ? <Empty><EmptyHeader><EmptyTitle>{t('没有找到相关设置')}</EmptyTitle><EmptyDescription>{t('试试“路由”“通知”或“备份”。')}</EmptyDescription></EmptyHeader><Button variant='outline' onClick={() => setQuery('')}>{t('清除搜索')}</Button></Empty> : null}
  </div>
}
