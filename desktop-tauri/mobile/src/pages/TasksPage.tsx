import {
  Switch,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
  Field,
  FieldLabel,
  Input,
} from '@ui'
import { Surface, MobileButton } from '../components/primitives'
import { useState } from 'react'
import {
  PageIntro,
  IconButton,
  Empty,
  ErrorNote,
  SkeletonList,
} from '../components/ui'

import { Icon } from '../components/Icon'
import { store } from '../state/store'
import {
  fetchScheduledTasks,
  patchScheduledTask,
  runScheduledTask,
  type ScheduledTask,
} from '../api/gateway'
import { formatRelative, formatStamp } from '../lib/format'
import { usePolling } from '../lib/usePolling'
import { t } from '../i18n'

/** Compact mobile view; complete editors open within the mobile navigation shell. */
export function TasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const [draft, setDraft] = useState('')

  const load = async () => {
    try {
      const data = await fetchScheduledTasks()
      setTasks(data.tasks || [])
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  usePolling(load, 30_000)

  const list = tasks || []
  const backend = list.filter((item) => item.runner === 'backend')
  const frontend = list.filter((item) => item.runner === 'frontend')
  const enabledCount = list.filter((item) => item.enabled).length

  const toggle = async (task: ScheduledTask, next: boolean) => {
    if (!task.id) return
    setBusy(task.id)
    try {
      const data = await patchScheduledTask(task.id, { enabled: next })
      setTasks(data.tasks || [])
      store.toast(
        t('已{action}「{name}」', {
          action: next ? t('开启') : t('关闭'),
          name: task.label || task.id,
        }),
      )
    } catch (failure) {
      store.toast(
        failure instanceof Error ? failure.message : String(failure),
        'err',
      )
    } finally {
      setBusy('')
    }
  }

  const run = async (task: ScheduledTask) => {
    if (!task.id) return
    setBusy(task.id)
    try {
      await runScheduledTask(task.id)
      store.toast(t('「{name}」已执行', { name: task.label || task.id }))
      await load()
    } catch (failure) {
      store.toast(
        failure instanceof Error ? failure.message : String(failure),
        'err',
      )
    } finally {
      setBusy('')
    }
  }

  const saveInterval = async () => {
    if (!editing?.id) return
    const value = Number(draft)
    if (
      !Number.isInteger(value) ||
      value < (editing.min || 1) ||
      value > (editing.max || 9999)
    ) {
      store.toast(
        t('间隔必须是 {min}–{max} 的整数', {
          min: editing.min || 1,
          max: editing.max || 9999,
        }),
        'err',
      )
      return
    }
    setBusy(editing.id)
    try {
      const data = await patchScheduledTask(editing.id, { interval: value })
      setTasks(data.tasks || [])
      store.toast(t('已更新间隔'))
      setEditing(null)
    } catch (failure) {
      store.toast(
        failure instanceof Error ? failure.message : String(failure),
        'err',
      )
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="m-page">
      <PageIntro
        actions={
          <IconButton
            name="refresh"
            label={t('刷新')}
            onClick={() => void load()}
          />
        }
      />

      {error ? <ErrorNote text={error} /> : null}
      {!tasks && !error ? <SkeletonList rows={4} height={64} /> : null}

      {tasks ? (
        <>
          <div className="m-section" style={{ marginTop: 0 }}>
            <div className="m-section-head">
              <h2>{t('后台任务')}</h2>
            </div>
            <Surface className="m-card">
              {backend.length ? (
                backend.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    busy={busy === task.id}
                    onToggle={(next) => void toggle(task, next)}
                    onRun={() => void run(task)}
                    onEdit={() => {
                      setEditing(task)
                      setDraft(String(task.interval ?? ''))
                    }}
                  />
                ))
              ) : (
                <Empty text={t('没有后台任务')} />
              )}
            </Surface>
          </div>

          {frontend.length ? (
            <div className="m-section">
              <div className="m-section-head">
                <h2>{t('页面自动刷新')}</h2>
              </div>
              <Surface className="m-card">
                {frontend.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    busy={busy === task.id}
                    onToggle={(next) => void toggle(task, next)}
                  />
                ))}
              </Surface>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  color: 'var(--m-text-3)',
                  padding: '0 2px',
                }}
              >
                {t('页面刷新由浏览器执行，只在页面打开时生效')}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <Sheet
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <SheetContent side="bottom" className="max-h-[85dvh]">
          <SheetHeader>
            <SheetTitle>{editing?.label || t('修改间隔')}</SheetTitle>
            <SheetDescription>
              {editing
                ? t('可填 {min}–{max} {unit}', {
                    min: editing.min || 1,
                    max: editing.max || 9999,
                    unit: editing.unit === 'seconds' ? t('秒') : t('分钟'),
                  })
                : ''}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <Field>
              <FieldLabel htmlFor="task-interval">{t('间隔')}</FieldLabel>
              <Input
                id="task-interval"
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value.replace(/[^\d]/g, ''))
                }
                inputMode="numeric"
                className="min-h-11 text-base"
              />
            </Field>
          </SheetBody>
          <SheetFooter className="flex-row">
            <MobileButton
              className="m-btn m-ghost"
              disabled={Boolean(busy)}
              onClick={() => setEditing(null)}
            >
              {t('取消')}
            </MobileButton>
            <MobileButton
              className="m-btn"
              disabled={Boolean(busy)}
              onClick={() => void saveInterval()}
            >
              {busy ? t('保存中…') : t('保存')}
            </MobileButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TaskRow({
  task,
  busy,
  onToggle,
  onRun,
  onEdit,
}: {
  task: ScheduledTask
  busy: boolean
  onToggle: (next: boolean) => void
  onRun?: () => void
  onEdit?: () => void
}) {
  const intervalText =
    task.interval && task.unit
      ? t('每 {n} {unit}', {
          n: task.interval,
          unit: task.unit === 'seconds' ? t('秒') : t('分钟'),
        })
      : '—'
  const next = task.nextRunAt ? formatRelative(task.nextRunAt) : ''
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '13px 14px',
        borderBottom: '1px solid var(--m-line)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 550 }}>{task.label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 3 }}>
          {intervalText}
          {task.lastRunAt ? ` · ${formatStamp(task.lastRunAt)}` : ''}
          {next ? ` · ${next}` : ''}
        </div>
        {task.lastError ? (
          <div style={{ fontSize: 11, color: 'var(--m-danger)', marginTop: 3 }}>
            {task.lastError}
          </div>
        ) : task.lastResult ? (
          <div style={{ fontSize: 11, color: 'var(--m-text-3)', marginTop: 3 }}>
            {task.lastResult}
          </div>
        ) : null}
        {task.canRun && onRun ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <MobileButton
              type="button"
              className="m-btn m-sm m-ghost"
              disabled={busy || task.running}
              onClick={onRun}
              style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
            >
              <Icon name="play" style={{ width: 12, height: 12 }} />
              {task.running ? t('执行中…') : t('立即执行')}
            </MobileButton>
            {onEdit ? (
              <MobileButton
                type="button"
                className="m-btn m-sm m-ghost"
                disabled={busy}
                onClick={onEdit}
                style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
              >
                <Icon name="edit" style={{ width: 12, height: 12 }} />
                {t('改间隔')}
              </MobileButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <SwitchSmall
        checked={Boolean(task.enabled)}
        disabled={busy}
        label={task.label || ''}
        onChange={onToggle}
      />
    </div>
  )
}

function SwitchSmall({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
    />
  )
}
