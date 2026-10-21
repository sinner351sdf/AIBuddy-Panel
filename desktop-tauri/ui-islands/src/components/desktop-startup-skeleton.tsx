import { Alert, AlertTitle, AlertDescription } from '@ui/alert'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import { cn } from '@ui/lib/cn'
import { Card, CardContent, CardHeader } from '@ui/card'

function Lines({ count = 3 }: { count?: number }) {
  return <div className='flex min-w-0 flex-1 flex-col gap-3'>{Array.from({length:count},(_,i)=><Skeleton key={i} className={cn('h-3', i===count-1 ? 'w-2/3' : 'w-full')}/>)}</div>
}
function LoadingCard({ chart = false }: { chart?: boolean }) {
  return <Card variant='panel' className='startup-card'>
    <CardHeader variant='panel'><Skeleton className='h-4 w-24'/></CardHeader>
    <CardContent variant='panel' className='min-h-60'>
      {chart ? <div className='flex min-h-52 items-center gap-6'><Skeleton className='size-36 shrink-0 rounded-full'/><Lines count={5}/></div>
        : <div className='flex flex-col gap-5'>{Array.from({length:7},(_,i)=><div key={i} className='flex items-center gap-3'><Skeleton className='size-5 shrink-0 rounded-full'/><Skeleton className='h-3 w-20'/><Skeleton className={cn('h-2', i%2 ? 'w-1/3' : 'w-1/2')}/></div>)}</div>}
    </CardContent>
  </Card>
}
function ReportSkeleton() {
  return <div className='startup-page' data-startup-layout='report'>
    <Card variant='panel' className='startup-welcome startup-card'><CardHeader variant='panel-flush' className='flex-row items-center justify-between gap-4 p-4'><div className='flex flex-col gap-3'><Skeleton className='h-4 w-36'/><Skeleton className='h-3 w-24'/></div><div className='flex gap-2'><Skeleton className='h-8 w-24'/><Skeleton className='h-8 w-20'/><Skeleton className='h-8 w-24'/></div></CardHeader></Card>
    <Card variant='panel' className='startup-card'>
      <CardHeader variant='panel' className='justify-between'><Skeleton className='h-4 w-24'/><Skeleton className='h-7 w-1/2'/></CardHeader>
      <CardContent variant='panel'><div className='startup-metrics'>{Array.from({length:6},(_,i)=><Card key={i} variant='panel' className='gap-0'><CardHeader className='px-3 pt-3 pb-2'><Skeleton className='h-3 w-20'/></CardHeader><CardContent className='flex flex-col gap-2 px-3 pb-3'><Skeleton className='h-4 w-16'/><Skeleton className='h-3 w-24'/></CardContent></Card>)}</div></CardContent>
    </Card>
    <div className='startup-columns'><LoadingCard/><LoadingCard/></div>
    <div className='startup-columns'><LoadingCard chart/><LoadingCard chart/></div>
  </div>
}
function TableSkeleton() {
  return <div className='startup-page' data-startup-layout='table'><Card variant='panel' className='startup-card'><CardHeader variant='panel' className='justify-between'><Skeleton className='h-5 w-32'/><Skeleton className='h-8 w-24'/></CardHeader><CardContent variant='panel'><div className='flex gap-3'><Skeleton className='h-9 w-72'/><Skeleton className='h-9 w-24'/></div><div className='mt-3 flex flex-col gap-5'>{Array.from({length:10},(_,i)=><div key={i} className='flex items-center gap-5'><Skeleton className='size-8 shrink-0 rounded-full'/><Lines count={2}/><Skeleton className='h-6 w-16'/><Skeleton className='h-6 w-20'/></div>)}</div></CardContent></Card></div>
}
function FormSkeleton() {
  return <div className='startup-page startup-settings' data-startup-layout='form'><Card variant='panel' className='startup-card'><CardContent className='flex flex-col gap-6 p-4'>{Array.from({length:8},(_,i)=><Skeleton key={i} className='h-5 w-full'/>)}</CardContent></Card><div className='flex min-w-0 flex-col gap-4'>{[0,1].map(i=><Card key={i} variant='panel' className='startup-card'><CardHeader variant='panel'><Skeleton className='h-4 w-28'/></CardHeader><CardContent variant='panel'>{[0,1,2].map(j=><div key={j} className='flex flex-col gap-3 py-2'><Skeleton className='h-3 w-24'/><Skeleton className='h-9 w-full'/></div>)}</CardContent></Card>)}</div></div>
}
function ChatSkeleton() {
  return <div className='startup-page' data-startup-layout='chat'><Card variant='panel' className='startup-card'><CardHeader variant='panel'><Skeleton className='h-5 w-40'/></CardHeader><CardContent variant='panel' className='min-h-96 justify-between'><div className='flex flex-col gap-8 py-8'><Lines count={3}/><Lines count={2}/></div><Skeleton className='h-24 w-full'/></CardContent></Card></div>
}
/** Rendered at build time from the same shared components, before browser JavaScript runs. */
export function DesktopStartupSkeleton() {
  return <div id='desktop-startup-skeleton' role='status' aria-live='polite' aria-label='正在加载面板'>
    <span className='sr-only' data-i18n='正在加载…'>正在加载…</span>
    <div aria-hidden='true' className='startup-surface'>
      <div className='startup-topbar'><div className='flex items-center gap-4'><Skeleton className='size-5'/><Skeleton className='h-3 w-24'/><Skeleton className='h-3 w-12'/></div><div className='flex gap-3'>{Array.from({length:6},(_,i)=><Skeleton key={i} className='size-6'/>)}</div></div>
      <div className='startup-tabs'>{[64,94,116,100,110,100,120].map((width,i)=><Skeleton key={i} className='h-8 shrink-0' style={{width}}/>)}</div>
      <div className='startup-content'><div className='startup-content-inner'><ReportSkeleton/><TableSkeleton/><FormSkeleton/><ChatSkeleton/></div></div>
    </div>
  </div>
}

/** Separate from the React mount root so navigation cannot replace its placeholders early. */
export function DesktopSidebarSkeleton() {
  return <div id='desktop-startup-sidebar' aria-hidden='true'>
    <div className='startup-sidebar-brand'>
      <Skeleton className='size-8 shrink-0'/>
      <div className='startup-sidebar-label flex min-w-0 flex-col gap-2'><Skeleton className='h-3 w-24'/><Skeleton className='h-2 w-12'/></div>
    </div>
    <div className='startup-sidebar-menu'>
      <Skeleton className='startup-sidebar-label mb-3 h-3 w-12'/>
      {[1,4,5,4].map((count,group)=><div key={group} className='startup-sidebar-group'>
        <div className='startup-sidebar-group-title flex h-8 items-center gap-3'><Skeleton className='size-4 shrink-0'/><Skeleton className='startup-sidebar-label h-3 w-24'/></div>
        {Array.from({length:count},(_,row)=><div key={row} className='startup-sidebar-row'><Skeleton className='size-4 shrink-0'/><Skeleton className='startup-sidebar-label h-3 w-24'/></div>)}
      </div>)}
    </div>
    <div className='startup-sidebar-footer'>
      <div className='startup-sidebar-row'><Skeleton className='size-3 shrink-0 rounded-full'/><Skeleton className='startup-sidebar-label h-2 w-36'/></div>
      <Skeleton className='startup-sidebar-label h-7 w-full'/>
      <div className='startup-sidebar-user flex items-center gap-3'><Skeleton className='size-8 shrink-0 rounded-full'/><div className='startup-sidebar-label flex flex-col gap-2'><Skeleton className='h-3 w-20'/><Skeleton className='h-2 w-12'/></div></div>
    </div>
  </div>
}

export function PageLoadingError() {
  return <Alert variant='destructive'>
    <AlertTitle>页面加载时间过长</AlertTitle>
    <AlertDescription>请检查本地服务连接后重试。</AlertDescription>
    <Button variant='outline' className='mt-3 w-fit' data-loading-retry>重试</Button>
  </Alert>
}
