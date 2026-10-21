import * as React from 'react'
import {
  Button,
  Card,
  CardContent,
  Input,
  cn,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@ui'

// Compatibility at the page boundary keeps existing handlers while every control uses ui-kit.
// Only layout styles survive: colors, borders, radii and shadows belong to shadcn variants.
export function layoutStyle(
  style?: React.CSSProperties,
): React.CSSProperties | undefined {
  if (!style) return undefined
  return Object.fromEntries(
    Object.entries(style).filter(
      ([key]) =>
        !/^(background|border|boxShadow|color|outline|fontFamily|fontWeight|fontSize)/.test(
          key,
        ),
    ),
  )
}
export function MobileButton({
  className = '',
  style,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const row = /m-row|m-quick|m-tab/.test(className)
  const destructive =
    /m-danger|m-bad/.test(className) || style?.color === 'var(--m-danger)'
  const active = (props as Record<string, unknown>)['data-on'] === true
  const variant = destructive
    ? 'destructive'
    : active ||
        /m-primary/.test(className) ||
        (/m-btn/.test(className) && !/m-ghost/.test(className))
      ? 'default'
      : row
        ? 'ghost'
        : /m-link|m-icon-btn|m-notice-later/.test(className) ||
            style?.background === 'none'
          ? 'ghost'
          : 'outline'
  return (
    <Button
      {...props}
      type={props.type || 'button'}
      aria-pressed={typeof (props as Record<string, unknown>)['data-on'] === 'boolean' ? active : props['aria-pressed']}
      variant={variant}
      size="lg"
      className={cn(
        'min-h-11 shrink-0 text-sm',
        row && 'h-auto justify-start whitespace-normal text-left',
        style?.padding && 'h-auto',
        style?.width && 'max-w-full',
        className,
      )}
      style={layoutStyle(style)}
    >
      {children}
    </Button>
  )
}
export function MobileInput({
  className,
  style,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      aria-label={props['aria-label'] || props.placeholder}
      {...props}
      className={cn('min-h-10 text-base', className)}
      style={layoutStyle(style)}
    />
  )
}
export function Surface({
  className,
  style,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      {...props}
      className={cn('gap-0 overflow-hidden py-0 shadow-none', className)}
    >
      <CardContent
        className={cn(
          className?.includes('m-card-pad')
            ? 'p-4'
            : className?.includes('m-kv-cell')
              ? 'p-3'
              : !style?.padding
                ? 'p-0'
                : undefined,
        )}
        style={layoutStyle(style)}
      >
        {children}
      </CardContent>
    </Card>
  )
}
export function MobileSelect({
  value,
  onChange,
  children,
  className,
  style,
  disabled,
  id,
  'aria-label': label,
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = React.Children.toArray(children)
    .filter(React.isValidElement)
    .map((child) => {
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>
      return {
        value: String(props.value ?? ''),
        label: props.children,
        disabled: props.disabled,
      }
    })
  return (
    <Select
      value={String(value ?? '')}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null)
          onChange?.({
            target: { value: next },
            currentTarget: { value: next },
          } as React.ChangeEvent<HTMLSelectElement>)
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn('min-h-10 min-w-28 text-base', className)}
        style={layoutStyle(style)}
      >
        <SelectValue>
          {options.find((option) => option.value === String(value))?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
