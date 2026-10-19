import { useSyncExternalStore } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  Button,
  AlertDialogBody,
} from '@ui'
import { t } from '../i18n'
let pending: { message: string; resolve: (answer: boolean) => void } | null =
  null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
export function confirmAction(message: string): Promise<boolean> {
  // Never overwrite an unresolved confirmation with another action.
  if (pending) return Promise.resolve(false)
  return new Promise((resolve) => {
    pending = { message, resolve }
    emit()
  })
}
export function ConfirmHost() {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pending,
  )
  const finish = (answer: boolean) => {
    const current = pending
    pending = null
    emit()
    current?.resolve(answer)
  }
  return (
    <AlertDialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && pending) finish(false)
      }}
    >
      <AlertDialogContent layer="above-drawer">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('确认操作')}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>{request?.message}</AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            {t('取消')}
          </Button>
          <Button onClick={() => finish(true)}>{t('确认')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
