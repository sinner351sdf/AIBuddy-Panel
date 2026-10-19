import { useEffect, useState } from 'react'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsIcon,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Field,
  FieldLabel,
  Input,
} from '@ui'
import { Icon, type IconName } from './Icon'
import { useStore, store } from '../state/store'
import { LoginPage } from '../pages/LoginPage'
import { accountLimitState } from '../lib/accountLimits'
import { t } from '../i18n'

const TABS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'home', label: t('首页'), icon: 'home' },
  { id: 'report', label: t('报表'), icon: 'chart' },
  { id: 'accounts', label: t('账号'), icon: 'users' },
  { id: 'assistant', label: t('助手'), icon: 'spark' },
  { id: 'more', label: t('更多'), icon: 'grid' },
]
export const PRIMARY_SCREENS = new Set(TABS.map((tab) => tab.id))
export function TabBar() {
  const state = useStore()
  if (!PRIMARY_SCREENS.has(state.route.screen) || state.stack.length > 0)
    return null
  const limited = (state.session?.accounts?.accounts || []).filter(
    (account) => accountLimitState(account, state.balancesSnapshot).limited,
  ).length
  return (
    <nav className="m-tabbar" aria-label={t('主导航')}>
      <Tabs
        value={state.route.screen}
        onValueChange={(value) => store.go(String(value))}
        className="w-full"
      >
        <TabsList variant="mobile">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              variant="mobile"
              aria-label={tab.label}
              aria-describedby={
                tab.id === 'more' && limited > 0
                  ? 'mobile-nav-restricted-count'
                  : undefined
              }
            >
              <TabsIcon>
                <Icon name={tab.icon} data-icon="inline-start" />
                {tab.id === 'more' && limited > 0 ? (
                  <Badge
                    variant="warning"
                    shape="counter"
                    id="mobile-nav-restricted-count"
                    className="absolute right-0 top-0"
                    aria-label={t('{n} 个受限账号', { n: limited })}
                  >
                    {limited}
                  </Badge>
                ) : null}
              </TabsIcon>
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  )
}
// Store notifications use ui-kit's Toaster, mounted once by App.
export function Toast() {
  return null
}
export function AuthGate() {
  const state = useStore()
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false)
  if (!state.authLost) return null
  if (state.packaged)
    return (
      <LoginPage mode={state.authLost} onDone={() => store.setAuthLost(null)} />
    )
  const submit = async () => {
    if (!key.trim()) return
    setBusy(true)
    const { storeApiKey } = await import('../api/client')
    storeApiKey(key.trim())
    store.setAuthLost(null)
    await store.refresh(true)
    setBusy(false)
  }
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        layer="lock-screen"
        showCloseButton={false}
        className="max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>
            {state.authLost === 'login'
              ? t('需要重新登录')
              : t('需要网关 API Key')}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>
            {state.authLost === 'login'
              ? t('会话已过期。重新登录后会自动回到手机端。')
              : t(
                  '这个面板没有管理员，用一把已启用的 API Key 访问（在桌面端「网关 Key」页创建）。',
                )}
          </DialogDescription>
        </DialogBody>
        {state.authLost === 'key' ? (
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="mobile-panel-key">API Key</FieldLabel>
              <Input
                id="mobile-panel-key"
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                className="min-h-10 text-base"
              />
            </Field>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button
            className="min-h-10 w-full"
            disabled={busy || (state.authLost === 'key' && !key.trim())}
            onClick={() => {
              if (state.authLost === 'login')
                window.location.href = '/login?next=%2Fm'
              else void submit()
            }}
          >
            {state.authLost === 'login'
              ? t('去登录')
              : busy
                ? t('验证中…')
                : t('保存并继续')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function ThemeSync() {
  const { theme } = useStore()
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return null
}
