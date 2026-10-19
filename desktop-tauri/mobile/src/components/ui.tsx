import type { ReactNode } from 'react'
import {
  Button,
  Badge as KitBadge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Empty as KitEmpty,
  EmptyDescription,
  Alert,
  AlertDescription,
  Skeleton,
} from '@ui'
import { Icon, type IconName } from './Icon'
import { t } from '../i18n'
import { store } from '../state/store'

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="m-head">
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle ? <p className="m-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="m-head-actions">{actions}</div> : null}
    </header>
  )
}
export function PageIntro({
  subtitle,
  actions,
}: {
  subtitle?: string
  actions?: ReactNode
}) {
  return !subtitle && !actions ? null : (
    <div className="flex items-center justify-between gap-3 px-4 pb-3">
      <span className="text-sm text-muted-foreground">{subtitle}</span>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  )
}
export function IconButton({
  name,
  label,
  onClick,
  primary,
}: {
  name: IconName
  label: string
  onClick?: () => void
  primary?: boolean
}) {
  return (
    <Button
      type="button"
      variant={primary ? 'default' : 'outline'}
      size="icon-lg"
      className="min-h-10 min-w-10"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={name} data-icon="inline-start" />
    </Button>
  )
}
export function SectionHead({
  title,
  action,
}: {
  title: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="m-section-head">
      <h2>{title}</h2>
      {action ? (
        <Button
          variant="ghost"
          size="sm"
          className="min-h-9"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
export function Badge({
  tone,
  dot,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'mute' | 'brand'
  dot?: boolean
  children: ReactNode
}) {
  const variants = {
    ok: 'success',
    warn: 'warning',
    bad: 'destructive',
    mute: 'secondary',
    brand: 'outline',
  } as const
  return (
    <KitBadge variant={variants[tone]}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </KitBadge>
  )
}
export function Empty({ text }: { text: string }) {
  return (
    <KitEmpty className="border-0 py-8">
      <EmptyDescription>{text}</EmptyDescription>
    </KitEmpty>
  )
}
export function ErrorNote({ text }: { text: string }) {
  return (
    <div className="mx-4">
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertDescription>{text}</AlertDescription>
      </Alert>
    </div>
  )
}
export function SkeletonList({
  rows = 4,
  height = 64,
}: {
  rows?: number
  height?: number
}) {
  return (
    <div className="m-section flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="w-full" style={{ height }} />
      ))}
    </div>
  )
}
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand('copy')
    } catch {
      /* 复制失败：提示由调用方给 */
    }
    area.remove()
  }
}

/** 复制 + 提示的常用组合 */
export async function copyWithToast(
  text: string,
  label?: string,
): Promise<void> {
  await copyText(text)
  store.toast(t('已复制{label}', { label: label ? `：${label}` : '' }))
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'up' | 'ok'
}) {
  return (
    <Card className="gap-2 py-4 shadow-none">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub ? (
        <CardContent
          className={
            tone
              ? 'px-4 text-xs text-success'
              : 'px-4 text-xs text-muted-foreground'
          }
        >
          {sub}
        </CardContent>
      ) : null}
    </Card>
  )
}
