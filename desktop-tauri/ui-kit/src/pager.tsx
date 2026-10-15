import * as React from 'react'
import { Button } from './button'
import { cn } from './lib/cn'
import { t } from './i18n'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from './pagination'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

/** Clickable page numbers, active-page styling and icon navigation. */
type PagerProps = {
  /** 当前页，1 起数 */
  page: number
  /** 总页数（至少 1；调用方算不出来时传 1） */
  pageCount: number
  onPageChange: (page: number) => void
  /** 请求在途时禁用全部页码和翻页按钮 */
  disabled?: boolean
  /** 分页控件容器的布局类 */
  className?: string
  /** 保留旧调用方的辅助页码摘要顺序 */
  infoFirst?: boolean
}

function Pager({
  page,
  pageCount,
  onPageChange,
  disabled = false,
  className,
  infoFirst = false,
}: PagerProps) {
  // 页数兜底：后端还没回话时 pageCount 可能是 0 或 NaN，别让它变成「第 1 / 0 页」
  const total = Math.max(1, Number.isFinite(pageCount) ? Math.trunc(pageCount) : 1)
  const current = Math.min(Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1), total)
  // 保留首末页和当前页附近的数字，避免大量日志页码撑满底栏。
  const start = total <= 7 ? 1 : current <= 4 ? 1 : current >= total - 3 ? total - 4 : current - 1
  const end = total <= 7 ? total : current <= 4 ? 5 : current >= total - 3 ? total : current + 1
  const numbers = [...new Set([1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index), total])]
  const pages: Array<number | 'ellipsis'> = []
  for (const [index, number] of numbers.entries()) {
    const previous = numbers[index - 1]
    if (index > 0 && number - previous === 2) pages.push(previous + 1)
    else if (index > 0 && number - previous > 2) pages.push('ellipsis')
    pages.push(number)
  }

  const info = (
    <span
      data-slot='pager-info'
      aria-live='polite'
      aria-atomic='true'
      className='sr-only'
    >
      {t('第 {current} / {total} 页', { current, total })}
    </span>
  )

  return (
    <div data-slot='pager' className={cn('flex min-w-0 max-w-full items-center gap-2', className)}>
      {infoFirst && info}
      <Pagination aria-label={t('分页')} className='mx-0 w-auto max-w-full'>
        <PaginationContent className='flex-wrap justify-end'>
          <PaginationItem>
            <Button type='button' variant='outline' size='icon' className='max-sm:size-6' aria-label={t('上一页')} title={t('上一页')} disabled={disabled || current <= 1}
              onClick={() => onPageChange(current - 1)}>
              <ChevronLeftIcon data-icon='inline-start' />
            </Button>
          </PaginationItem>
          {pages.map((number, index) => (
            <PaginationItem key={number === 'ellipsis' ? `ellipsis-${index}` : number}>
              {number === 'ellipsis' ? <PaginationEllipsis className='max-sm:size-6' /> : (
                <PaginationLink href='#' isActive={number === current} disabled={disabled} className='max-sm:size-6'
                  aria-label={t('第 {current} / {total} 页', { current: number, total })}
                  onClick={event => {
                    event.preventDefault()
                    if (!disabled && number !== current) onPageChange(number)
                  }}>{number}</PaginationLink>
              )}
            </PaginationItem>
          ))}
          <PaginationItem>
            <Button type='button' variant='outline' size='icon' className='max-sm:size-6' aria-label={t('下一页')} title={t('下一页')} disabled={disabled || current >= total}
              onClick={() => onPageChange(current + 1)}>
              <ChevronRightIcon data-icon='inline-end' />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      {!infoFirst && info}
    </div>
  )
}

export { Pager, type PagerProps }
