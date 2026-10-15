/** shadcn/Base UI view for the existing aibuddy-prefs controller. */
import * as React from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import {
  Badge, Button, Card, CardDescription, CardHeader, CardTitle, cn, Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
  Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet,
  Input, Progress, RadioGroup, RadioGroupItem,
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
  Switch, Tabs, TabsContent, TabsList, TabsTrigger, ToggleGroup, ToggleGroupItem,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ui'
import { t } from '../i18n'
import type { PreferencePatch, Preferences, PreferencesController, PreferencesSnapshot } from './pref-controller'
import { FileText, KeyRound, Users } from '@ui/navigation-icons'
import { CloseIcon, LayoutPreview, LinkIcon, MonitorIcon, MoonIcon, SearchIcon, SettingsIcon, SunIcon } from './pref-graphics'

type API = PreferencesController

function SwitchField({ id, label, hint, checked, onChange }: {
  id: string; label: string; hint?: string; checked: boolean; onChange(value: boolean): void
}) {
  return <Field orientation='horizontal' className='py-2 has-[>[data-slot=field-content]]:items-center'>
    <FieldContent>
      <FieldLabel htmlFor={id}>{t(label)}</FieldLabel>
      {hint ? <FieldDescription>{t(hint)}</FieldDescription> : null}
    </FieldContent>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </Field>
}

function TextField({ id, label, hint, value, onValue, type = 'text', maxLength }: {
  id: string; label: string; hint: string; value: string; onValue(value: string): void
  type?: 'text' | 'password'; maxLength?: number
}) {
  const [draft, setDraft] = React.useState(value)
  const focused = React.useRef(false)
  React.useEffect(() => { if (!focused.current) setDraft(value) }, [value])
  return <Field>
    <FieldLabel htmlFor={id}>{t(label)}</FieldLabel>
    <Input id={id} type={type} value={draft} maxLength={maxLength} autoComplete={type === 'password' ? 'new-password' : 'off'}
      onFocus={() => { focused.current = true }} onBlur={() => { focused.current = false; setDraft(value) }}
      onChange={event => { setDraft(event.currentTarget.value); onValue(event.currentTarget.value) }} aria-describedby={`${id}-description`} />
    <FieldDescription id={`${id}-description`}>{t(hint)}</FieldDescription>
  </Field>
}

function NumberField({ id, label, hint, value, min, max, onValue }: {
  id: string; label: string; hint: string; value: number; min: number; max: number; onValue(value: number): void
}) {
  const [draft, setDraft] = React.useState<string | null>(null)
  return <Field orientation='horizontal' className='py-2 has-[>[data-slot=field-content]]:items-center'>
    <FieldContent>
      <FieldLabel htmlFor={id}>{t(label)}</FieldLabel>
      <FieldDescription id={`${id}-description`}>{t(hint)}</FieldDescription>
    </FieldContent>
    <Input id={id} type='number' min={min} max={max} step={1} inputMode='numeric' className='w-[92px] shrink-0 text-right tabular-nums'
      value={draft ?? String(value)} aria-describedby={`${id}-description`}
      onFocus={() => setDraft(String(value))} onBlur={() => setDraft(null)}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
      onChange={event => {
        const raw = event.currentTarget.value
        setDraft(raw)
        const n = Math.floor(Number(raw))
        onValue(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min)
      }} />
  </Field>
}

type Choice = { value: string; label: string; icon?: React.ComponentType<React.SVGProps<SVGSVGElement>> }
function ChoiceField({ id, label, hint, value, choices, onValue, previews = false }: {
  id: string; label: string; hint?: string; value: string; choices: Choice[]; onValue(value: string): void; previews?: boolean
}) {
  return <Field>
    <FieldLabel id={`${id}-label`}>{t(label)}</FieldLabel>
    <ToggleGroup id={id} aria-labelledby={`${id}-label`} variant='outline' size='sm' spacing={1}
      value={[value]} className='w-full flex-wrap'
      onValueChange={next => { if (next[0]) onValue(String(next[0])) }}>
      {choices.map(choice => {
        const Icon = choice.icon
        return <ToggleGroupItem key={choice.value} value={choice.value} className={cn('flex-1', previews && 'h-auto min-h-16 flex-col gap-2 px-2 py-3')}>
          {previews ? <LayoutPreview kind={choice.value} /> : null}
          {Icon ? <Icon /> : null}
          {t(choice.label)}
        </ToggleGroupItem>
      })}
    </ToggleGroup>
    {hint ? <FieldDescription>{t(hint)}</FieldDescription> : null}
  </Field>
}

function Palette({ api, state }: { api: API; state: PreferencesSnapshot }) {
  const { prefs, palette } = state
  return <FieldSet>
    <FieldLegend variant='label'>{t('内置主题色')}</FieldLegend>
    <FieldGroup className='gap-3'>
      <RadioGroup value={prefs.primary.toLowerCase()} onValueChange={color => api.set({ primary: String(color) })} aria-label={t('内置主题色')} className='grid grid-cols-3 gap-2'>
        {palette.map(([color, label], index) => <Field key={color} orientation='horizontal' className='gap-1.5'>
          <RadioGroupItem id={`pref-palette-${index}`} value={color} />
          <FieldLabel htmlFor={`pref-palette-${index}`} className='min-w-0 gap-1.5'>
            <span className='pref-component-swatch' style={{ backgroundColor: color }} aria-hidden='true' />{t(label)}
          </FieldLabel>
        </Field>)}
      </RadioGroup>
      <Field orientation='horizontal' className='flex-wrap gap-2'>
        <FieldLabel htmlFor='pref-primary-color'>{t('自定义')}</FieldLabel>
        <Input id='pref-primary-color' type='color' value={/^#[\da-f]{6}$/i.test(prefs.primary) ? prefs.primary : '#171717'} className='w-12 shrink-0 p-1'
          onChange={event => api.set({ primary: event.currentTarget.value })} />
        <span className='min-w-0 font-mono text-xs text-muted-foreground'>{prefs.primary || t('跟随默认')}</span>
        <Button variant='outline' size='sm' className='ml-auto' onClick={() => api.set({ primary: '' })}>{t('恢复默认')}</Button>
      </Field>
    </FieldGroup>
  </FieldSet>
}

function AppearanceTab({ api, state }: { api: API; state: PreferencesSnapshot }) {
  const p = state.prefs
  return <FieldGroup>
    <ChoiceField id='pref-theme' label='主题' value={p.theme} choices={[
      { value: 'light', label: '浅色', icon: SunIcon }, { value: 'dark', label: '深色', icon: MoonIcon }, { value: 'system', label: '跟随系统', icon: MonitorIcon },
    ]} onValue={theme => api.changeTheme(theme as Preferences['theme'])} />
    <FieldSet>
      <FieldLegend variant='label'>{t('外观')}</FieldLegend>
      <FieldGroup className='gap-1'>
        <SwitchField id='pref-dark-sidebar' label='深色侧边栏' checked={p.darkSidebar} onChange={darkSidebar => api.set({ darkSidebar })} hint='仅把侧边栏换成深色，内容区跟随当前主题' />
        <SwitchField id='pref-dark-topbar' label='深色顶栏' checked={p.darkTopbar} onChange={darkTopbar => api.set({ darkTopbar })} hint='仅把顶栏换成深色，内容区跟随当前主题' />
        <SwitchField id='pref-topbar-gradient' label='顶栏渐变' checked={p.topbarGradient} onChange={topbarGradient => api.set({ topbarGradient })} hint='顶栏背景改为「主色的明暗过渡」横向渐变，浅色 / 深色主题下都协调' />
        <SwitchField id='pref-gray-filter' label='灰色模式' checked={p.filter === 'gray'} onChange={value => api.set({ filter: value ? 'gray' : '' })} hint='页面整体去色，只保留明暗层级（适合打印 / 专注场景）' />
        <SwitchField id='pref-weak-filter' label='色弱模式' checked={p.filter === 'weak'} onChange={value => api.set({ filter: value ? 'weak' : '' })} hint='反转明度并回旋色相，提升颜色之间的辨识度' />
      </FieldGroup>
    </FieldSet>
    <Palette api={api} state={state} />
  </FieldGroup>
}

function LayoutTab({ api, p }: { api: API; p: Preferences }) {
  return <FieldGroup>
    <ChoiceField id='pref-layout' label='布局模式' value={p.layout} previews choices={[
      { value: 'vertical', label: '垂直' }, { value: 'classic', label: '经典' }, { value: 'mix', label: '混合' }, { value: 'horizontal', label: '水平' },
    ]} onValue={layout => { api.selectLayout(layout as Preferences['layout']) }} hint='当前版本提供「垂直」布局；经典 / 混合 / 水平正在适配中。' />
    <ChoiceField id='pref-content-width' label='内容宽度' value={p.contentWidth} choices={[
      { value: 'fluid', label: '流式' }, { value: 'boxed', label: '定宽' },
    ]} onValue={contentWidth => api.set({ contentWidth: contentWidth as Preferences['contentWidth'] })} hint='流式跟随窗口宽度；定宽将内容收在 1200px 版心里。两种宽度都实时预览。' />
    <ChoiceField id='pref-density' label='界面密度' value={p.density} choices={[
      { value: 'compact', label: '紧凑' }, { value: 'default', label: '默认' }, { value: 'relaxed', label: '宽松' },
    ]} onValue={density => api.set({ density: density as Preferences['density'] })} hint='紧凑收紧全局留白与面板行高，宽松放大呼吸感；默认即原始密度，实时生效。' />
    <FieldSet>
      <FieldLegend variant='label'>{t('侧栏')}</FieldLegend>
      <FieldGroup className='gap-1'>
        <SwitchField id='pref-show-logo' label='显示 Logo' checked={p.isShowLogo} onChange={isShowLogo => api.set({ isShowLogo })} hint='关闭后隐藏侧栏顶部的圆形 Logo，品牌文字保留' />
        <SwitchField id='pref-menu-highlight' label='选中菜单高亮条' checked={p.menuHighlight} onChange={menuHighlight => api.set({ menuHighlight })} hint='当前菜单项左侧额外显示一条主色竖条指示' />
        <SwitchField id='pref-group-label' label='折叠时隐藏分组标题' checked={p.isGroupLabel} onChange={isGroupLabel => api.set({ isGroupLabel })} hint='关闭后，侧栏折叠 / 手机抽屉模式也显示「运行状态」等分组标题' />
      </FieldGroup>
    </FieldSet>
  </FieldGroup>
}

function GeneralTab({ api, p }: { api: API; p: Preferences }) {
  const switches: Array<[keyof Preferences, string, string]> = [
    ['dynamicTitle', '动态标题', '把当前页面名写进标签页标题（如「报表 · Agent2API」）'],
    ['progressbar', '页面切换进度条', '切换页面时顶部显示细进度条'],
    ['isBreadcrumb', '面包屑', '顶栏显示当前页面位置（如「首页 / 报表」）；手机窄屏下始终隐藏'],
    ['isFooter', '页脚版权', '在内容区底部显示版权行，右侧附带「检查更新」按钮'],
    ['isTagsview', '页签栏', '内容区顶部显示已打开页面的页签条，可单独关闭页签'],
  ]
  return <FieldGroup>
    <FieldSet>
      <FieldLegend variant='label'>{t('浏览体验')}</FieldLegend>
      <FieldGroup className='gap-1'>
        {switches.map(([key, label, hint]) => <SwitchField key={key} id={`pref-general-${key}`} label={label} hint={hint} checked={p[key] === true} onChange={value => api.set({ [key]: value } as PreferencePatch)} />)}
      </FieldGroup>
    </FieldSet>
    <ChoiceField id='pref-page-animation' label='页面切换动画' value={p.pageAnim} choices={[
      { value: 'none', label: '无' }, { value: 'fade', label: '淡入' }, { value: 'slide', label: '滑入' },
    ]} onValue={pageAnim => api.set({ pageAnim: pageAnim as Preferences['pageAnim'] })} hint='切换页面时的过场效果；系统开启「减少动态效果」时自动禁用。' />
    <NumberField id='pref-notify-interval' label='通知轮询间隔（分钟）' hint='顶栏通知中心每隔多久拉取一次网关事件，允许 1–60 分钟，修改立即生效' value={p.notifyInterval} min={1} max={60} onValue={notifyInterval => api.set({ notifyInterval })} />
    <FieldSet>
      <FieldLegend variant='label'>{t('水印')}</FieldLegend>
      <FieldGroup className='gap-3'>
        <SwitchField id='pref-watermark-enabled' label='水印' checked={p.watermark} onChange={watermark => api.set({ watermark })} hint='在页面最上层平铺半透明文字，适用于录屏与演示场景' />
        <TextField id='pref-watermark-text' label='水印文字' value={p.watermarkText || ''} maxLength={40} onValue={value => api.set({ watermarkText: value.trim() })} hint='自定义水印内容（最长 40 字），输入即生效；留空使用品牌名和日期。' />
      </FieldGroup>
    </FieldSet>
  </FieldGroup>
}

function LockTab({ api, p }: { api: API; p: Preferences }) {
  return <FieldGroup>
    <SwitchField id='pref-lock-enabled' label='启用锁屏' checked={p.lockScreen.enabled} onChange={enabled => api.set({ lockScreen: { enabled } })} hint='开启后可点下方「立即锁屏」；空闲达到下方分钟数也会自动锁屏' />
    <TextField id='pref-lock-password' label='锁屏密码' type='password' value={p.lockScreen.password} onValue={password => api.set({ lockScreen: { password } }, { apply: false })} hint='仅明文保存在本机 localStorage，用于本机解锁校验，不会上传；留空则锁屏后可直接解锁' />
    <NumberField id='pref-lock-minutes' label='自动锁屏（分钟）' hint='鼠标 / 键盘空闲达到该分钟数自动锁屏；0 = 不自动锁屏' value={p.lockScreen.minutes} min={0} max={1440} onValue={minutes => api.set({ lockScreen: { minutes } }, { apply: false })} />
    <Button onClick={() => api.lock()}>{t('立即锁屏')}</Button>
  </FieldGroup>
}

function PreferencesSheet({ api, state }: { api: API; state: PreferencesSnapshot }) {
  const [tab, setTab] = React.useState('look')
  const viewport = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (state.drawerOpen) setTab('look') }, [state.drawerOpen])
  React.useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0 }, [tab])
  return <Sheet open={state.drawerOpen} onOpenChange={open => { if (!open) api.close() }}>
    <SheetContent id='pref-drawer-mask' side='right' showCloseButton={false} className='pref-sheet flex w-[min(440px,100vw)] max-w-[100vw] flex-col gap-0 p-0 sm:max-w-[440px]'>
      <SheetHeader className='flex-row items-center gap-3 border-b border-border p-5'>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <SheetTitle>{t('偏好设置')}</SheetTitle>
          <SheetDescription>{t('自定义界面 · 实时生效')}</SheetDescription>
        </div>
        <SheetClose render={<Button variant='ghost' size='icon-sm' aria-label={t('关闭')} />}><CloseIcon /></SheetClose>
      </SheetHeader>
      <Tabs value={tab} onValueChange={value => setTab(String(value))} className='min-h-0 flex-1 gap-0'>
        <TabsList className='mx-5 mt-4 grid w-auto shrink-0 grid-cols-4'>
          <TabsTrigger value='look'>{t('外观')}</TabsTrigger><TabsTrigger value='layout'>{t('布局')}</TabsTrigger>
          <TabsTrigger value='general'>{t('通用')}</TabsTrigger><TabsTrigger value='lock'>{t('锁屏')}</TabsTrigger>
        </TabsList>
        <div ref={viewport} className='min-h-0 flex-1 overflow-y-auto p-5'>
          <TabsContent value='look'><AppearanceTab api={api} state={state} /></TabsContent>
          <TabsContent value='layout'><LayoutTab api={api} p={state.prefs} /></TabsContent>
          <TabsContent value='general'><GeneralTab api={api} p={state.prefs} /></TabsContent>
          <TabsContent value='lock'><LockTab api={api} p={state.prefs} /></TabsContent>
        </div>
      </Tabs>
      <SheetFooter className='grid shrink-0 grid-cols-3 gap-2 border-t border-border p-4'>
        <Button id='pref-copy' variant='outline' size='sm' onClick={() => void api.copy()}>{t('复制偏好')}</Button>
        <Button id='pref-paste' variant='outline' size='sm' onClick={() => void api.paste()}>{t('导入偏好')}</Button>
        <Button id='pref-reset' variant='destructive' size='sm' onClick={() => api.reset()}>{t('恢复默认')}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
}

function SearchPalette({ api, open }: { api: API; open: boolean }) {
  // 读实际导航，包含签到和积分页，也保留按页面 id 搜索的旧用法。
  const pages = Array.from(document.querySelectorAll<HTMLButtonElement>('#nav .nav-item[data-page]')).map(button => ({
    id: button.dataset.page || '', label: button.querySelector('.label')?.textContent?.trim() || '',
  })).filter(page => page.id && page.label)
  return <CommandDialog open={open} onOpenChange={next => { if (!next) api.closeSearch() }} title={t('搜索页面')} description={t('输入名称后点击条目跳转，Esc 关闭')}>
    <Command>
    <CommandInput id='pref-search-input' placeholder={t('搜索页面，回车跳转…')} />
    <CommandList>
      <CommandEmpty>{t('没有匹配的页面')}</CommandEmpty>
      <CommandGroup heading={t('页面')}>
        {pages.map(page => <CommandItem key={page.id} value={`${page.id} ${page.label}`} keywords={[page.id, page.label]} onSelect={() => api.go(page.id)}>
          <span className='min-w-0 flex-1 truncate'>{page.label}</span>
          <CommandShortcut className='shrink-0 text-right font-mono tracking-normal'>{page.id}</CommandShortcut>
        </CommandItem>)}
      </CommandGroup>
    </CommandList>
    </Command>
  </CommandDialog>
}

function LockDialog({ api, state }: { api: API; state: PreferencesSnapshot }) {
  const [password, setPassword] = React.useState('')
  const input = React.useRef<HTMLInputElement>(null)
  const unlock = React.useRef<HTMLButtonElement>(null)
  const requiresPassword = Boolean(state.prefs.lockScreen.password)
  React.useEffect(() => { if (!state.locked) setPassword('') }, [state.locked])
  return <Dialog open={state.locked} disablePointerDismissal onOpenChange={(next, details) => { if (!next) details.cancel() }}>
    <DialogContent id='pref-lockscreen' layer='lock-screen' showCloseButton={false} initialFocus={requiresPassword ? input : unlock} className='w-[min(380px,calc(100vw-32px))]'>
      <DialogHeader className='flex-col items-center gap-2 px-5 pr-5 text-center'>
        <div className='pref-component-clock' aria-hidden='true'>{state.clockTime}</div>
        <div className='text-xs text-muted-foreground'>{state.clockDate}</div>
        <DialogTitle>{t('屏幕已锁定')}</DialogTitle>
        <DialogDescription>{t(requiresPassword ? '屏幕已锁定，输入密码解锁' : '未设置密码，点击直接解锁')}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <form onSubmit={event => {
          event.preventDefault()
          if (!api.tryUnlock(password)) { input.current?.focus(); input.current?.select() }
        }}>
          <FieldGroup className='gap-3'>
            {requiresPassword ? <Field data-invalid={Boolean(state.lockError) || undefined}>
              <FieldLabel htmlFor='pref-unlock-password'>{t('锁屏密码')}</FieldLabel>
              <Input ref={input} id='pref-unlock-password' type='password' autoComplete='off' value={password} aria-invalid={Boolean(state.lockError) || undefined}
                aria-describedby={state.lockError ? 'pref-lock-error' : undefined} onChange={event => setPassword(event.currentTarget.value)} />
              {state.lockError ? <FieldError id='pref-lock-error' key={state.lockAttempt}>{t(state.lockError)}</FieldError> : null}
            </Field> : null}
            <Button ref={unlock} type='submit' className='w-full'>{t(requiresPassword ? '解锁' : '点击解锁')}</Button>
          </FieldGroup>
        </form>
      </DialogBody>
    </DialogContent>
  </Dialog>
}

function TopbarActions({ api, state }: { api: API; state: PreferencesSnapshot }) {
  const mode = state.prefs.theme
  const themeTitle = t('当前：') + t(mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统') + t('（点击切换）')
  const actions = [
    { id: 'pref-btn-search', title: t('搜索页面'), Icon: SearchIcon, run: api.search },
    { id: 'pref-btn-link', title: t('复制 OpenAI 兼容 Base URL'), Icon: LinkIcon, run: api.copyGatewayLink },
    { id: 'pref-btn-theme', title: themeTitle, Icon: mode === 'dark' ? SunIcon : MoonIcon, run: api.cycleTheme },
    { id: 'pref-btn-prefs', title: t('偏好设置'), Icon: SettingsIcon, run: api.open },
  ]
  return <>{actions.map(({ id, title, Icon, run }) => <Tooltip key={id}>
    <TooltipTrigger render={<Button id={id} variant='ghost' size='icon' aria-label={title} disabled={state.locked} onClick={() => run()} />}><Icon /></TooltipTrigger>
    <TooltipContent side='bottom'>{title}</TooltipContent>
  </Tooltip>)}</>
}

function WelcomeBanner({ api, state }: { api: API; state: PreferencesSnapshot }) {
  const firstUse = state.pool?.accounts === 0
  return <Card as='section' variant='panel' size='sm' aria-labelledby='welcome-banner-title'>
    <CardHeader variant='panel-flush' className='flex-col items-stretch gap-4 p-4 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <CardTitle id='welcome-banner-title'>{t(state.greeting)}{t('，欢迎回来')}</CardTitle>
        <CardDescription className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          <time dateTime={state.date}>{state.date}</time>
          {firstUse ? <span>{t('配置首个账号，开始使用网关。')}</span> : null}
        </CardDescription>
      </div>
      <div role='group' aria-label={t('快捷操作')} className='grid grid-cols-2 items-center gap-2 min-[480px]:flex min-[480px]:flex-wrap lg:shrink-0 lg:flex-nowrap'>
        <Button variant={firstUse ? 'default' : 'outline'} size='sm' className='max-[480px]:min-h-10' disabled={state.locked} onClick={() => api.go('accounts')}>
          <Users data-icon='inline-start' />{t(firstUse ? '配置账号' : '账号池')}
          {state.pool && !firstUse ? <Badge variant='secondary'>{state.pool.accounts}</Badge> : null}
        </Button>
        <Button variant='outline' size='sm' className='max-[480px]:min-h-10' disabled={state.locked} onClick={() => api.go('keys')}>
          <KeyRound data-icon='inline-start' />{t('网关 Key')}
        </Button>
        <Button variant={firstUse ? 'outline' : 'default'} size='sm' className='col-span-2 max-[480px]:min-h-10' disabled={state.locked} onClick={() => api.go('docs')}>
          <FileText data-icon='inline-start' />{t('接入文档')}
        </Button>
      </div>
    </CardHeader>
  </Card>
}

function PreferencesRoot({ api }: { api: API }) {
  const state = React.useSyncExternalStore(api.subscribe, api.getSnapshot)
  const brand = document.querySelector('.brand-text h1')?.textContent?.trim() || 'Agent2API'
  return <TooltipProvider>
    {state.topbarHost?.isConnected ? createPortal(<TopbarActions api={api} state={state} />, state.topbarHost) : null}
    {state.footerHost?.isConnected ? createPortal(<>
      <span className='pref-footer-copy'>© {new Date().getFullYear()} {brand} · {t('基于 agent2api')}</span>
      <Button variant='outline' size='sm' className='pref-footer-check' disabled={state.footerBusy} onClick={() => api.checkUpdate()}>{t('检查更新')}</Button>
    </>, state.footerHost) : null}
    {state.bannerHost?.isConnected ? createPortal(<WelcomeBanner api={api} state={state} />, state.bannerHost) : null}
    {state.progressVisible ? <Progress value={state.progress} aria-label={t('页面切换进度')} className='pref-component-progress [&_[data-slot=progress-track]]:h-[3px] [&_[data-slot=progress-track]]:rounded-none' /> : null}
    <PreferencesSheet api={api} state={state} />
    <SearchPalette api={api} open={state.searchOpen} />
    <LockDialog api={api} state={state} />
  </TooltipProvider>
}

let root: Root | null = null
function connect(api: API) {
  if (!document.getElementById('topbar-status')) return
  if (!root) {
    const host = document.createElement('div')
    host.id = 'shell-preferences-host'
    document.body.append(host)
    root = createRoot(host)
  }
  root.render(<PreferencesRoot api={api} />)
}
window.wbPrefsUi = { connect }
if (window.wbPrefs) connect(window.wbPrefs)
