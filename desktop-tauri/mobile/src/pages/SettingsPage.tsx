import type { ReactNode } from 'react'
import { useState } from 'react'
import { Badge, Button, Card, CardContent, Field, FieldLabel, FieldDescription, FieldGroup, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@ui'
import { FeatureSurface, openManagement } from './ManagementPage'
import { MobileSelect } from '../components/primitives'
import { Icon, type IconName } from '../components/Icon'
import { ThemeSwitch } from './MorePage'
import { store, useStore } from '../state/store'
import { locale, localeOptions, setLocale, t } from '../i18n'
import { storeApiKey } from '../api/client'
import { usePwa } from '../lib/usePwa'
import { applyUpdate, promptInstall } from '../lib/pwa'
import { isNativeDashboard, apiBase, baseLabel } from '../lib/servers'

export function SettingsPage() {
  return <div className='m-page'><FeatureSurface page='settings'/></div>
}

function PreferenceSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className='device-settings-section'><h2>{title}</h2><Card className='gap-0 py-0'><CardContent className='p-0'>{children}</CardContent></Card></section>
}
function PreferenceLink({ label, description, icon, onClick }: { label: string; description: string; icon: IconName; onClick: () => void }) {
  return <Item render={<Button variant='ghost' onClick={onClick} aria-label={label}/>} className='min-h-18 flex-nowrap justify-start gap-3 rounded-none border-0 px-4 py-3 text-left'>
    <ItemMedia variant='icon' className='size-8 rounded-lg bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0'><Icon name={icon}/></ItemMedia>
    <ItemContent className='min-w-0'><ItemTitle>{label}</ItemTitle><ItemDescription className='text-xs'>{description}</ItemDescription></ItemContent>
    <ItemActions><Icon name='chev' className='size-4 text-muted-foreground'/></ItemActions>
  </Item>
}

export function DeviceSettingsPage() {
  const { session, sessionError, packaged, server, servers } = useStore()
  const pwa = usePwa()
  const [installing, setInstalling] = useState(false)
  const currentLocale = locale(), options = localeOptions()
  const install = async () => {
    setInstalling(true)
    try {
      const outcome = await promptInstall()
      if (outcome === 'accepted') store.toast(t('正在安装…'))
      else if (outcome === 'dismissed') store.toast(t('已取消安装'))
    } finally { setInstalling(false) }
  }
  const signOut = async () => {
    const { logout } = await import('../api/auth')
    const { clearPanelAuth } = await import('../api/client')
    await logout(); clearPanelAuth(); store.setAuthLost('login'); store.toast(t('已退出登录'))
  }
  const gatewayLabel = sessionError ? t('连接异常') : session?.health?.upstreamConfigured ? t('网关运行中') : session ? t('上游未配置') : t('正在连接网关')
  return <div className='m-page m-device-settings'>
    <div className='device-settings-body'>
      <p className='device-settings-intro'>{t('这些偏好保存在这台设备上。')}</p>
      <Card className='gap-0 py-0'><CardContent className='p-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <Icon name='server' className='size-5 text-muted-foreground'/>
          <div className='min-w-0 flex-1'><p className='text-sm font-medium'>{gatewayLabel}</p><p className='m-mono truncate text-xs text-muted-foreground' title={baseLabel(apiBase())}>{baseLabel(apiBase())}</p></div>
          <Button variant='ghost' size='icon-lg' className='min-h-11 min-w-11' aria-label={t('刷新')} onClick={() => void store.refresh(true)}><Icon name='refresh' data-icon='inline-start'/></Button>
        </div>
      </CardContent></Card>
      {packaged ? <PreferenceSection title={t('服务器')}><ItemGroup role='group'><PreferenceLink label={server?.name || t('当前服务器')} description={servers.length > 1 ? t('{n} 台可选 · 点此切换', { n: servers.length }) : baseLabel(server?.base || '')} icon='server' onClick={() => store.push('servers')}/></ItemGroup></PreferenceSection> : null}

      <PreferenceSection title={t('外观')}>
        <FieldGroup className='gap-5 p-4'>
          <Field className='gap-3'><FieldLabel>{t('主题')}</FieldLabel><ThemeSwitch fullWidth/></Field>
          <Field className='gap-2'><FieldLabel>{t('界面语言')}</FieldLabel>
            <MobileSelect className='min-h-11 w-full' value={currentLocale} onChange={event => setLocale(event.target.value)} aria-label={t('界面语言')}>
              {options.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
            </MobileSelect>
            <FieldDescription className='text-xs'>{t('切换后会刷新当前界面。')}</FieldDescription>
          </Field>
        </FieldGroup>
      </PreferenceSection>
      <PreferenceSection title={t('接入')}><ItemGroup role='group' className='gap-0'>
        <PreferenceLink label={t('接口地址')} description={`${apiBase()}/v1`} icon='doc' onClick={() => store.push('docs')}/>
        <ItemSeparator className='mx-4 my-0 w-auto'/>
        <PreferenceLink label={t('网关 Key')} description={t('查看密钥与客户端接入范围')} icon='key' onClick={() => store.push('keys')}/>
      </ItemGroup></PreferenceSection>
      <PreferenceSection title={t('登录与凭证')}><ItemGroup role='group'>
        {packaged ? <PreferenceLink label={t('退出登录')} description={t('退出这台服务器，不影响其他连接')} icon='logout' onClick={() => void signOut()}/>
          : <PreferenceLink label={t('清除本机凭证')} description={t('清除浏览器保存的 API Key，不影响网关')} icon='logout' onClick={() => { storeApiKey(''); store.setAuthLost(null); store.toast(t('已清除本机保存的 API Key')); window.location.reload() }}/ >}
      </ItemGroup></PreferenceSection>

      {packaged || isNativeDashboard() ? null : <PreferenceSection title={t('安装到桌面')}>
        <div className='flex flex-col gap-3 p-4'>
          <div className='flex items-center justify-between gap-3'><span className='text-sm font-medium'>{pwa.standalone ? t('独立应用') : t('浏览器标签页')}</span><Badge variant={pwa.standalone ? 'success' : 'secondary'}>{pwa.standalone ? t('已安装') : t('未安装')}</Badge></div>
          <p className='text-xs leading-relaxed text-muted-foreground'>{pwa.standalone ? t('从主屏幕图标启动，使用独立窗口打开面板。') : pwa.showIosHint ? t('在 Safari 中点“分享”，再选择“添加到主屏幕”。') : t('使用浏览器菜单中的“添加到主屏幕”，下次可直接打开。')}</p>
          {!pwa.standalone && pwa.canInstall ? <Button className='min-h-11 w-full' disabled={installing} onClick={() => void install()}><Icon name='download' data-icon='inline-start'/>{installing ? t('正在安装…') : t('安装到主屏幕')}</Button> : null}
        </div>
      </PreferenceSection>}
      {pwa.updateReady || pwa.swState === 'unsupported' ? <PreferenceSection title={t('应用状态')}>
        <div className='flex flex-col gap-3 p-4'>
          {pwa.updateReady ? <><p className='text-sm font-medium'>{t('有新版本')}</p><p className='text-xs text-muted-foreground'>{t('重新加载后使用新版界面。')}</p><Button className='min-h-11 w-full' onClick={() => void applyUpdate()}>{t('重启更新')}</Button></> : null}
          {pwa.swState === 'unsupported' ? <><p className='text-sm font-medium'>{t('离线缓存未启用')}</p><p className='text-xs leading-relaxed text-muted-foreground'>{t('浏览器只在 https 或 localhost 下提供离线缓存；局域网 http 访问不影响正常使用。')}</p></> : null}
        </div>
      </PreferenceSection> : null}
      <PreferenceSection title={t('关于')}><ItemGroup role='group' className='gap-0'>
        <Item className='flex-nowrap gap-3 border-0 p-4'><ItemMedia variant='icon'><Icon name='info'/></ItemMedia><ItemContent><ItemTitle>{t('AIBuddy Panel 手机端')}</ItemTitle><ItemDescription className='text-xs'>{t('当前连接网关的手机管理面板')}</ItemDescription></ItemContent></Item>
        <ItemSeparator className='mx-4 my-0 w-auto'/><PreferenceLink label={t('社区与支持')} description={t('反馈与需求')} icon='heart' onClick={() => openManagement('settings', t('社区与支持'), 'feedback')}/>
      </ItemGroup></PreferenceSection>
    </div>
  </div>
}
