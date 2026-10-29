/** Plugin-declared provider operations, with the existing durable WorkBuddy task and schedule flows. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Tabs, TabsList, TabsTrigger, TabsContent, Alert, AlertDescription, Button, Card, CardHeader, CardTitle, CardContent } from '@ui'
import { SectionSkeleton } from '../components/section-skeleton'
import { usePageReady } from '../components/use-page-ready'
import { shared } from './accounts-shared'
import { getCheckinStore, loadCheckinCenter, setCheckinTab, subscribeCheckinStore, type CheckinTab } from './checkin-state'
import { ScheduleTab } from './checkin-schedule-tab'
import { RecordsTab } from './checkin-records-tab'
import { CenterTab as ProviderCenterTab } from './checkin-center-tab'
import { store as pluginCheckinStore, subscribe as subscribePluginCheckin, loadCenter as loadPluginCheckin } from './checkin-store'
import { WorkbuddyTaskCenter } from './workbuddy-task-center'
import { t } from '../i18n'

const CHECKIN_TAB_OPTIONS = [
  { value: 'center', label: t('签到与福利') },
  { value: 'workbuddy', label: t('WorkBuddy任务') },
  { value: 'schedule', label: t('定时签到') },
  { value: 'records', label: t('签到记录') },
] as const

function useCheckinStore() {
  return React.useSyncExternalStore(subscribeCheckinStore, getCheckinStore)
}

export function CheckinPage() {
  const store = useCheckinStore()
  usePageReady('checkin', store.loaded)
  const [taskOpened, setTaskOpened] = React.useState(store.tab === 'workbuddy')
  React.useEffect(() => { if (store.tab === 'workbuddy') setTaskOpened(true) }, [store.tab])

  // 挂载即拉一次（app.js 切页钩子是主要入口，这里兜「直接刷新落在本页」的场景）
  React.useEffect(() => { void loadCheckinCenter() }, [])
  React.useEffect(() => { if (store.tab === 'center') void loadPluginCheckin() }, [store.tab])

  return (
    <Tabs value={store.tab} onValueChange={next => setCheckinTab(String(next) as CheckinTab)}>
      <Card as='section' variant='panel' size='sm' className='panel'>
        <CardHeader variant='panel' className='panel-head'>
          <CardTitle>{t('任务中心')}</CardTitle>
          <span className='panel-sub'>{t('签到、福利与账号任务')}</span>
        </CardHeader>
        <CardContent variant='panel' className='panel-body'>
          {store.loadError ? (
            <Alert variant='destructive'>
              <AlertDescription>{t('读取签到数据失败：{error}', { error: store.loadError })}</AlertDescription>
              <Button size='sm' variant='outline' className='mt-2 w-fit' onClick={() => void loadCheckinCenter()}>{t('重试')}</Button>
            </Alert>
          ) : null}

          <div className='flex flex-wrap items-center gap-3'>
            <TabsList aria-label={t('任务中心分区')} className='grid w-full grid-cols-2 gap-1 group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-fit sm:group-data-horizontal/tabs:h-8'>
              {CHECKIN_TAB_OPTIONS.map(tab => <TabsTrigger key={tab.value} value={tab.value} className='h-7 sm:h-[calc(100%-1px)]'>{tab.label}</TabsTrigger>)}
            </TabsList>
          </div>

        </CardContent>
      </Card>
      <TabsContent value='center' keepMounted><PluginCenter /></TabsContent>
      <TabsContent value='workbuddy' keepMounted>{taskOpened || store.tab === 'workbuddy' ? <WorkbuddyTaskCenter active={store.tab === 'workbuddy'} /> : null}</TabsContent>
      <TabsContent value='schedule' keepMounted><ScheduleTab active={store.tab === 'schedule'} /></TabsContent>
      <TabsContent value='records' keepMounted><RecordsTab active={store.tab === 'records'} /></TabsContent>
    </Tabs>
  )
}

/* ─── 挂载：接管 index.html 里既有的页面区块 ─────── */

const PAGE_SELECTOR = '.page[data-page="checkin"]'

let mounted = false

/** 把 React root 直接建在页面区块上（不套宿主 div，理由见文件头） */
function mount(): void {
  if (mounted) return
  const section = document.querySelector<HTMLElement>(PAGE_SELECTOR)
  if (!section) return
  mounted = true
  section.replaceChildren()
  createRoot(section).render(<CheckinPage />)
}

declare global {
  interface Window {
    /** 账号任务中心页（app.js 切页时调 load；数据自持，不随主状态轮询） */
    wbCheckinPanel?: { load(): Promise<void> }
  }
}

// 对外契约：app.js 切到本页时调 load（保证「切入这次刷新一定落地」）
const load = (): Promise<void> => {
  window.dispatchEvent(new Event('wb:task-center-refresh'))
  return Promise.all([loadCheckinCenter(), loadPluginCheckin()]).then(() => {})
}
window.wbCheckinPanel = { load }

// 脚本排在页面骨架之后（islands/ui.js 在各 section 之后），正常直接挂；
// 万一将来被挪到前面，退化成等 DOM 解析完再挂。
if (document.querySelector(PAGE_SELECTOR)) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })

// 首屏自持加载：app.js 的 showPage 在本脚本加载前就执行过（那时 wbCheckinPanel
// 还不存在，切页那次调用落空），用户上次若停在本页，这里补一次 —— 与 tasks-panel 同款
if (shared().wbApp?.currentPage === 'checkin') void load()

/** Plugin-declared capabilities drive provider UI; the local durable task and schedule tabs stay intact. */
function PluginCenter() {
  const [, redraw] = React.useReducer(value => value + 1, 0)
  React.useEffect(() => subscribePluginCheckin(redraw), [])
  return pluginCheckinStore.center ? <ProviderCenterTab center={pluginCheckinStore.center} /> : pluginCheckinStore.loadError ? <Alert variant='destructive'><AlertDescription>{pluginCheckinStore.loadError}</AlertDescription><Button variant='outline' onClick={() => void loadPluginCheckin()}>{t('重试')}</Button></Alert> : <SectionSkeleton />
}
