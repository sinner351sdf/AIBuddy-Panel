import { Skeleton } from '@ui'
import { t } from '../i18n'

/** Shared loading state for lazily opened tabs and detail panels. */
export function SectionSkeleton() {
  return <div role='status' aria-label={t('加载中…')} className='flex w-full flex-col gap-4 p-4'>
    <div aria-hidden='true' className='flex flex-col gap-4'>
      <Skeleton className='h-4 w-32'/>
      {[0,1,2,3].map(row=><div key={row} className='flex items-center gap-3'><Skeleton className='size-8 shrink-0 rounded-md'/><div className='flex flex-1 flex-col gap-2'><Skeleton className='h-3 w-2/3'/><Skeleton className='h-3 w-1/3'/></div></div>)}
    </div>
  </div>
}
