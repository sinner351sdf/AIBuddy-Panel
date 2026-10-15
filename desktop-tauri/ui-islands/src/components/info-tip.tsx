import * as React from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@ui'
import { t } from '../i18n'

/** 悬停 / 键盘聚焦快速预览，点击后固定说明，供鼠标与触屏阅读长内容。 */
export function InfoTip({ children, label }: { children?: React.ReactNode; label?: string }) {
  const [pinned, setPinned] = React.useState(false)
  if (!children) return null
  return (
    <Popover open={pinned} onOpenChange={setPinned}>
      <Tooltip disabled={pinned}>
        <TooltipTrigger
          delay={150}
          closeDelay={80}
          render={<PopoverTrigger render={<Button variant='ghost' size='icon-xs' aria-label={label || t('说明')} />} />}
        >?</TooltipTrigger>
        <TooltipContent>{children}</TooltipContent>
      </Tooltip>
      <PopoverContent variant='tooltip' layer='tooltip' side='top' align='center' sideOffset={8} aria-label={label || t('说明')}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
