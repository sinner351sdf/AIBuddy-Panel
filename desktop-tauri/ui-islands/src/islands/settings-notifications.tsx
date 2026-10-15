import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle,
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle, Spinner,
} from '@ui'
import { RefreshCwIcon } from '@ui/navigation-icons'
import { InfoTip } from '../components/info-tip'
import { t } from '../i18n'
import { NOTES, TIPS, toast } from './settings-model'
import { notificationCenter, useNotificationsSnapshot } from './notifications-store'

/** 配置页与顶栏铃铛订阅同一个外部 store，打开、刷新、已读都由控制器发布。 */
export function NotificationSettingsCard() {
  const snapshot = useNotificationsSnapshot()
  const unread = snapshot?.unread ?? 0
  const message = !snapshot ? t('正在连接通知中心…')
    : snapshot.loading ? t('正在刷新最近事件…')
    : snapshot.open ? t('通知面板已打开，当前事件已标为已读')
    : unread > 0 ? t('有新的警告或错误事件') : t('暂无未读告警')

  function markAllRead(): void {
    const center = notificationCenter()
    if (!center) return
    center.markRead()
    toast(t('已全部标为已读，铃铛与此处已同步'))
  }

  return (
    <Card as='section' variant='panel' size='sm' className='panel' aria-label={t('通知状态')}>
      <CardHeader variant='panel' className='panel-head'>
        <CardTitle>{t('通知中心')}</CardTitle>
        <InfoTip label={t('通知中心说明')}>{TIPS.shellNotify}{' '}{NOTES.shellResetUnread}</InfoTip>
        <div className='head-actions'>
          <Button id='btn-shell-notify-refresh' variant='outline' disabled={!snapshot || snapshot.loading}
            aria-label={t('刷新通知状态')} onClick={() => notificationCenter()?.refresh()}>
            {snapshot?.loading ? <Spinner data-icon='inline-start' /> : <RefreshCwIcon data-icon='inline-start' />}
            {snapshot?.loading ? t('刷新中…') : t('刷新')}
          </Button>
        </div>
      </CardHeader>
      <CardContent variant='panel' className='panel-body'>
        <ItemGroup>
          <Item role='listitem' variant='muted' size='sm'>
            <ItemContent className='min-w-0'>
              <ItemTitle>
                {t('未读告警')}
                <InfoTip label={t('未读告警说明')}>{t('与右上角铃铛共用未读数，只统计最近事件中的 error / warn；打开通知中心或标为已读后，两边立即同步。')}</InfoTip>
              </ItemTitle>
              <ItemDescription aria-live='polite'>{message}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <output id='shell-notify-unread' aria-label={t('未读告警数量')} aria-live='polite'>
                <Badge variant={unread > 0 ? 'warning' : 'secondary'}>
                  {snapshot ? t('{count} 条', { count: unread }) : t('连接中')}
                </Badge>
              </output>
            </ItemActions>
          </Item>
        </ItemGroup>
        <div className='flex flex-wrap gap-2.5'>
          <Button id='btn-shell-notify-open' disabled={!snapshot} onClick={() => notificationCenter()?.open()}>
            {snapshot?.open ? t('通知中心已打开') : t('打开通知中心')}
          </Button>
          <Button id='btn-shell-notify-reset' variant='outline' disabled={!snapshot || unread === 0} onClick={markAllRead}>
            {t('全部标为已读')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
