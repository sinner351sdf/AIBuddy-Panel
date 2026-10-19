import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  Field,
  FieldLabel,
  FieldGroup,
  Input,
  Button,
  Alert,
  AlertDescription,
} from '@ui'

import { useEffect, useState } from 'react'

import { store, useStore } from '../state/store'
import { authenticate, fetchPanelStatus, solveCaptcha } from '../api/auth'
import { storeApiKey } from '../api/client'
import { baseLabel } from '../lib/servers'
import { t } from '../i18n'

/**
 * 登录 / 首次注册（仅 APK）。
 *
 * ── 为什么网页端不需要它 ──────────────────────────────────────
 * 浏览器打开 `/m` 时，未登录会被服务端 302 到 `/login` —— 那是一个服务端
 * 渲染的页面，与面板同源，登录完 cookie 就种好了。APK 里没有那个页面
 * （界面在包里，不是网关出的），所以必须自己实现一份。
 *
 * ── 令牌怎么落地 ──────────────────────────────────────────────
 * 登录请求带 `x-panel-auth-mode: body`，服务端据此把双令牌放进响应体
 * （见 `server::api::panel::tokens_in_body`）。拿到后按服务器 id 存进
 * localStorage，之后每条请求带 `x-panel-token` 头 —— 跨源请求没有别的
 * 办法带上凭证（`Allow-Origin: *` 下浏览器不带 cookie）。
 *
 * ── 人机验证 ──────────────────────────────────────────────────
 * 网关开了 ALTCHA 时，登录 / 注册都必须带一次性 payload。进入页面就先领题
 * 求解（用户在输密码，题目在后台算完），提交时直接带上；提交失败后 payload
 * 已作废，要重新求解。
 */
export function LoginPage({
  mode,
  onDone,
}: {
  mode: 'login' | 'key'
  onDone?: () => void
}) {
  const { server } = useStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 该网关有没有管理员 —— 没有就是首次注册 */
  const [setup, setSetup] = useState(false)
  const [statusKnown, setStatusKnown] = useState(false)
  /** 人机验证：idle 求解中 / ready 已就绪 / off 网关没开 */
  const [captchaState, setCaptchaState] = useState<
    'idle' | 'solving' | 'ready' | 'off'
  >('idle')
  const [captcha, setCaptcha] = useState<string | null>(null)

  // 进页面就探测：有没有管理员、要不要人机验证
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const status = await fetchPanelStatus()
        if (!alive) return
        setSetup(!status.registered)
        setStatusKnown(true)
      } catch {
        if (!alive) return
        setStatusKnown(true)
      }
      if (!alive) return
      setCaptchaState('solving')
      try {
        const payload = await solveCaptcha()
        if (!alive) return
        if (payload) {
          setCaptcha(payload)
          setCaptchaState('ready')
        } else {
          // 领题失败：要么网关没开校验（回 400），要么网关不可达。
          // 两种都当作「不需要验证」继续，提交时服务端若真要会报错说明原因。
          setCaptchaState('off')
        }
      } catch {
        if (alive) setCaptchaState('off')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const submit = async () => {
    if (mode === 'key') {
      const value = apiKey.trim()
      if (!value) return
      storeApiKey(value)
      store.setAuthLost(null)
      onDone?.()
      await store.refresh(true)
      return
    }

    if (!username.trim() || !password) {
      setError(t('请填写账号与密码'))
      return
    }
    setBusy(true)
    setError('')
    const result = await authenticate({
      mode: setup ? 'setup' : 'login',
      username: username.trim(),
      password,
      captcha,
    })
    setBusy(false)
    if ('error' in result) {
      setError(result.error)
      // payload 一次性，失败后重新解一道
      setCaptcha(null)
      setCaptchaState('solving')
      void solveCaptcha()
        .then((payload) => {
          if (payload) {
            setCaptcha(payload)
            setCaptchaState('ready')
          } else {
            setCaptchaState('off')
          }
        })
        .catch(() => setCaptchaState('off'))
      return
    }
    store.setAuthLost(null)
    onDone?.()
    await store.refresh(true)
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
            {mode === 'key'
              ? t('需要网关 API Key')
              : setup
                ? t('创建管理员账号')
                : t('登录面板')}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>
            {server ? baseLabel(server.base) : t('未选择服务器')} ·{' '}
            {mode === 'key'
              ? t('用一把已启用的 API Key 访问')
              : t('输入这台网关的管理员账号与密码。')}
          </DialogDescription>
        </DialogBody>
        <form
          className="px-5 pb-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FieldGroup>
            {mode === 'key' ? (
              <Field>
                <FieldLabel htmlFor="apk-key">API Key</FieldLabel>
                <Input
                  id="apk-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  placeholder="sk-…"
                  className="min-h-10 text-base"
                />
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="apk-username">{t('账号')}</FieldLabel>
                  <Input
                    id="apk-username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="min-h-10 text-base"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="apk-password">{t('密码')}</FieldLabel>
                  <Input
                    id="apk-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={setup ? 'new-password' : 'current-password'}
                    className="min-h-10 text-base"
                  />
                </Field>
              </>
            )}
            {captchaState === 'solving' ? (
              <p className="text-xs text-muted-foreground">
                {t('正在完成人机验证…')}
              </p>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              className="min-h-10 w-full"
              disabled={
                busy ||
                (mode === 'key'
                  ? !apiKey.trim()
                  : !statusKnown || !username.trim() || !password)
              }
            >
              {busy
                ? t('验证中…')
                : mode === 'key'
                  ? t('保存并继续')
                  : setup
                    ? t('创建并进入')
                    : t('登录')}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
