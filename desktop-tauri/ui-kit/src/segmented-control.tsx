import * as React from 'react'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'
import { Badge } from './badge'
import { cn } from './lib/cn'

/** Required single selection, composed from the official Base UI ToggleGroup.
 * Ignore an empty toggle result so filters always keep their selected value.
 */
type SegmentedControlOption<Value extends string> = {
  value: Value
  label: React.ReactNode
  /**
   * 计数徽标：不传就不渲染徽标。
   * 传 0 时整项按「空段」弱化，与账号页筛选的既有约定一致。
   */
  count?: number
  disabled?: boolean
}

type SegmentedControlProps<Value extends string> = {
  options: readonly SegmentedControlOption<Value>[]
  /** 受控选中值：本控件不持有状态，值始终由调用方给 */
  value: Value
  onValueChange: (value: Value) => void
  /** 无障碍名：这一组档位在筛什么 */
  'aria-label': string
  disabled?: boolean
  /** 附加到容器上的类名（弹窗里的紧凑档位就是靠它带尺寸覆盖） */
  className?: string
}

function SegmentedControl<Value extends string>({
  options, value, onValueChange, disabled = false, className, ...props
}: SegmentedControlProps<Value>) {
  return (
    <ToggleGroup
      data-slot='segmented-control'
      value={[value]}
      onValueChange={next => { if (next.length && next[0] !== value) onValueChange(next[0] as Value) }}
      spacing={0.5}
      variant='segmented'
      size='xs'
      className={cn('inline-flex rounded-md bg-muted p-0.5', className)}
      {...props}
    >
      {options.map(option => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          data-slot='segmented-item'
          disabled={disabled || option.disabled}
          data-zero={option.count === 0 ? 'true' : undefined}
        >
          {option.label}
          {option.count !== undefined ? <Badge variant='secondary' shape='tag' className='min-w-4 px-1'>{option.count}</Badge> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export { SegmentedControl, type SegmentedControlOption, type SegmentedControlProps }
