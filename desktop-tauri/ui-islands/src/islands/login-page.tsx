/**
 * Agent2API · 登录 / 首次注册页（ui/login.html）—— React 岛。
 *
 * 这一页独立于主面板（没有 index.html 那套骨架，也不属于任何 .page），界面整块由
 * 本岛渲染。但**登录逻辑仍归页面底部那段内联脚本**：它按 id 直接读写
 * #username / #password / #submit / #error / #mode-tip，还把 submit 处理器挂在
 * #form 上（capture 阶段，先于页面里其它 submit 监听）。所以本岛刻意做成
 * 「表单骨架渲染一次就不再更新」—— LoginPage 不持 state、不重渲染，脚本对这些节点
 * 的命令式改动（按钮文案与禁用、错误行、占位符、提示行）不会被 React 覆盖回去。
 * 密码显隐的局部 state 只放在 PasswordInput 子树，不会重绘表单或提交按钮。
 * 动这个文件之前请先读那段脚本，它是这一页真正的行为来源。
 *
 * 首次提交必须同步（flushSync）：脚本是紧随本岛之后的经典脚本，求值时就要拿到
 * 这些节点（`widget.addEventListener` 拿到 null 会直接抛错，整段脚本作废、点登录
 * 毫无反应）；而 createRoot().render() 默认交给调度器异步提交，同步脚本会跑在提交
 * 之前、拿到空 DOM。代价是本页的 `<script src="islands/ui.js">` 必须排在 #login-app
 * 之后，且不能加 defer/async —— 加了顺序就散了。
 *
 * 视觉上不再自己硬编码一套深色变量：颜色一律走组件库令牌（ui.css 的 --ui-*，
 * 跟随 `<html data-theme="dark">`），布局尺寸用 Tailwind 工具类还原原样式。
 * 页面级样式（html/body、第三方 widget）留在 login.html 的 <style> 里。
 */

import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldGroup, FieldLabel, Input,
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ui'
import { t } from '../i18n'

/** 挂载点 id：login.html 里唯一的岛容器 */
const HOST_ID = 'login-app'

/**
 * 机器人校验组件：`<panel-captcha>` 由 ui/panel-captcha.js 定义（协议见
 * server::altcha，文件头注释解释了为什么不用官方 altcha widget —— 它在
 * http://<内网IP> 这类非安全上下文里没有 crypto.subtle，会一直卡在「验证中…」）。
 *
 * 用 createElement 而不是 JSX 标签：TS 的 IntrinsicElements 里没有这个标签，而为一个
 * 自家自定义元素去扩全局 JSX 命名空间会波及其他岛（也可能与并行迁移的文件撞车）。
 * 元素只认 id：领题端点、文案、事件都在组件内部，这里不传任何属性。
 */
const captchaWidget = React.createElement('panel-captcha', { id: 'captcha' })

/** Only the password group re-renders; the login engine keeps its form and submit nodes. */
function PasswordInput() {
  const [visible, setVisible] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const label = visible ? t('隐藏密码') : t('显示密码')
  return (
    <InputGroup>
      <InputGroupInput ref={inputRef} id='password' type={visible ? 'text' : 'password'}
        autoComplete='new-password' placeholder={t('至少 8 位')} />
      <InputGroupAddon align='inline-end'>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={
              <InputGroupButton size='icon-xs' aria-label={label} aria-pressed={visible}
                onClick={() => { setVisible(current => !current); inputRef.current?.focus() }} />
            }>
              <svg data-icon='inline-end' viewBox='0 0 24 24' fill='none' stroke='currentColor'
                strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                {visible ? (
                  <>
                    <path d='m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.8 10.8 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-3.2 4.4M6.5 6.5A19 19 0 0 0 1 12s4 8 11 8a11 11 0 0 0 5.5-1.5' />
                  </>
                ) : (
                  <><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z' /><circle cx='12' cy='12' r='3' /></>
                )}
              </svg>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </InputGroupAddon>
    </InputGroup>
  )
}

/**
 * 卡片外壳与其中的表单。
 *
 * 五个 id 一个都不能少（见文件头）。#mode-tip 与 #error 渲染成空节点：文案由底部
 * 脚本填，这里只提供位置与占位高度（min-h-5 让错误行出现前后布局不跳）。
 */
function LoginPage() {
  return (
    <Card variant='auth' className='w-[min(400px,100%)]'>
      {/* 同一份 SVG 供登录页、侧栏和桌面图标使用。 */}
      <CardHeader className='mb-[26px] flex flex-col items-center gap-3 px-0 text-center'>
        <img
          data-brand-logo
          src='brand/logo-icon.svg?v=b-mono-1'
          alt='Agent2API'
          width={52}
          height={52}
          className='size-[52px] rounded-[12px] shadow-1'
        />
        <div>
          <CardTitle as='h1' variant='brand'>Agent2API</CardTitle>
          <CardDescription>{t('OpenAI 兼容网关 · 管理面板')}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className='px-0'>
      <div id='mode-tip' className='mb-[18px] text-center text-[13px] text-muted-foreground' />

      <form id='form' autoComplete='on'>
        <FieldGroup className='gap-3.5'>
          <Field className='gap-1.5'>
            <FieldLabel htmlFor='username'>{t('账号')}</FieldLabel>
            <Input id='username' autoComplete='username' placeholder={t('管理员账号')} />
          </Field>
          <Field className='gap-1.5'>
            <FieldLabel htmlFor='password'>{t('密码')}</FieldLabel>
            <PasswordInput />
          </Field>
        </FieldGroup>
        {/* 领题求解放后台跑 → 绿勾已验证（组件见 ui/panel-captcha.js） */}
        {captchaWidget}
        {/* type='submit' 必须显式给：Base UI 的 useButton 会给原生 button 补一个
            type="button"，只有显式传入（合并时外部 props 优先）才盖得掉 */}
        <Button id='submit' type='submit' size='lg' className='w-full'>
          {t('继续')}
        </Button>
        <div id='error' className='mt-3 min-h-5 text-center text-[13px] whitespace-pre-wrap text-destructive' />
      </form>
      </CardContent>

    </Card>
  )
}

/**
 * 挂载。主面板里没有 #login-app（岛随同一个 bundle 一起加载），直接跳过 ——
 * 这是预期行为，不是漏挂。
 */
function mount(): void {
  const host = document.getElementById(HOST_ID)
  if (!host) return
  // 同步提交，理由见文件头
  flushSync(() => {
    createRoot(host).render(<LoginPage />)
  })
}

mount()
