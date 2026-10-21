import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, cn, DialogSection, FieldSet, FieldLegend, SegmentedControl } from '@ui'

export function isPhoneAccountForm(): boolean {
  return document.documentElement.dataset.mobileUi === 'true'
}

/** Shared layout only: provider engines, draft inputs and submission handlers stay at their callers. */
export function AccountFormSection({ title, description, children, className, ...props }: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
}) {
  if (!isPhoneAccountForm()) return <DialogSection className={className} {...props}><h3>{title}</h3>{description}{children}</DialogSection>
  return <Card as='section' className={cn('mobile-login-card mobile-provider-card', className)} {...props}>
    <CardHeader><CardTitle>{title}</CardTitle>{description ? <CardDescription>{description}</CardDescription> : null}</CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
}

export function AccountFormChoice({ title, label, options, value, onValueChange, inline = false }: {
  title: string
  label: string
  options: { value: string; label: React.ReactNode }[]
  value: string
  onValueChange: (value: string) => void
  inline?: boolean
}) {
  const mobile = isPhoneAccountForm()
  const control = <SegmentedControl aria-label={label} options={options} value={value} onValueChange={onValueChange}
    className={cn(mobile && 'mobile-login-segments mobile-provider-segments')} />
  if (mobile) return <FieldSet className='mobile-provider-choice gap-3' data-option-count={options.length}>
    <FieldLegend variant='label'>{title}</FieldLegend>{control}
  </FieldSet>
  if (inline) return <div className='flex flex-col gap-2.5 border-l-2 border-border pl-[11px]'><span className='text-[12.5px] text-subtle'>{title}</span>{control}</div>
  return <DialogSection><h3>{title}</h3>{control}</DialogSection>
}
