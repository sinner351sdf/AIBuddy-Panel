/** 侧栏账户菜单与账号密码表单，业务及会话契约由 user-menu.js 控制器持有。 */
import { useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  Alert, AlertDescription, Avatar, AvatarFallback, Button,
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Field, FieldGroup, FieldLabel, Input, Spinner,
} from '@ui'

interface AccountSnapshot {
  readonly username: string
  readonly menuOpen: boolean
  readonly dialogOpen: boolean
  readonly dialogEpoch: number
  readonly busy: boolean
  readonly error: string
  readonly invalidFields: readonly string[]
  readonly inSidebar: boolean
}
interface AccountDraft {
  oldUser: string
  oldPassword: string
  newUsername: string
  newPassword: string
}
interface AccountBridge {
  getSnapshot(): AccountSnapshot
  subscribe(listener: () => void): () => void
  setMenuOpen(open: boolean): void
  openChangeDialog(): void
  closeChangeDialog(): void
  save(draft: AccountDraft): Promise<boolean>
  logout(): Promise<void>
}

declare global {
  interface Window {
    wbShellAccount?: { mount(host: HTMLElement, bridge: AccountBridge): void }
  }
}

function AccountIcon({ kind, button = false }: { kind: 'chevrons' | 'key' | 'logout'; button?: boolean }) {
  return <svg data-icon={button ? 'inline-end' : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'chevrons' ? <path d="m7 9 5-5 5 5m-10 6 5 5 5-5" /> : kind === 'key' ? <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m11 12 10-10m-5 5 3 3" /></> : <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9" /></>}
  </svg>
}

function AccountAvatar({ username }: { username: string }) {
  const initial = username ? Array.from(username)[0].toLocaleUpperCase() : 'A'
  return <Avatar aria-hidden="true"><AvatarFallback>{initial}</AvatarFallback></Avatar>
}

function PasswordForm({ bridge, snapshot, oldUserRef, oldPasswordRef }: {
  bridge: AccountBridge
  snapshot: AccountSnapshot
  oldUserRef: RefObject<HTMLInputElement | null>
  oldPasswordRef: RefObject<HTMLInputElement | null>
}) {
  const [draft, setDraft] = useState<AccountDraft>({ oldUser: snapshot.username, oldPassword: '', newUsername: '', newPassword: '' })
  const invalid = (field: keyof AccountDraft) => snapshot.invalidFields.includes(field)
  const change = (field: keyof AccountDraft, value: string) => setDraft((previous) => ({ ...previous, [field]: value }))
  return <form onSubmit={(event) => { event.preventDefault(); void bridge.save(draft) }} className="flex min-h-0 flex-col">
    <DialogBody>
      <FieldGroup>
        <Field data-invalid={invalid('oldUser')} data-disabled={snapshot.busy}>
          <FieldLabel htmlFor="um-old-user">当前账号</FieldLabel>
          <Input id="um-old-user" ref={oldUserRef} autoComplete="username" placeholder="当前管理员账号" value={draft.oldUser} onChange={(event) => change('oldUser', event.target.value)} disabled={snapshot.busy} aria-invalid={invalid('oldUser')} aria-describedby={invalid('oldUser') ? 'um-error' : undefined} />
        </Field>
        <Field data-invalid={invalid('oldPassword')} data-disabled={snapshot.busy}>
          <FieldLabel htmlFor="um-old-pass">当前密码</FieldLabel>
          <Input id="um-old-pass" ref={oldPasswordRef} type="password" autoComplete="current-password" placeholder="当前密码" value={draft.oldPassword} onChange={(event) => change('oldPassword', event.target.value)} disabled={snapshot.busy} aria-invalid={invalid('oldPassword')} aria-describedby={invalid('oldPassword') ? 'um-error' : undefined} />
        </Field>
        <Field data-invalid={invalid('newUsername')} data-disabled={snapshot.busy}>
          <FieldLabel htmlFor="um-new-user">新账号（选填，留空不改）</FieldLabel>
          <Input id="um-new-user" autoComplete="username" placeholder="新的管理员账号" value={draft.newUsername} onChange={(event) => change('newUsername', event.target.value)} disabled={snapshot.busy} aria-invalid={invalid('newUsername')} aria-describedby={invalid('newUsername') ? 'um-error' : undefined} />
        </Field>
        <Field data-invalid={invalid('newPassword')} data-disabled={snapshot.busy}>
          <FieldLabel htmlFor="um-new-pass">新密码（选填，留空不改，至少 8 位）</FieldLabel>
          <Input id="um-new-pass" type="password" autoComplete="new-password" placeholder="新的密码" value={draft.newPassword} onChange={(event) => change('newPassword', event.target.value)} disabled={snapshot.busy} aria-invalid={invalid('newPassword')} aria-describedby={invalid('newPassword') ? 'um-error' : undefined} />
        </Field>
      </FieldGroup>
      <Alert role="note"><AlertDescription>改密码后其他设备会全部退出登录（当前设备保持在线）。</AlertDescription></Alert>
      {snapshot.error && <Alert id="um-error" variant="destructive"><AlertDescription>{snapshot.error}</AlertDescription></Alert>}
    </DialogBody>
    <DialogFooter className="justify-end">
      <Button id="um-cancel" type="button" variant="outline" onClick={bridge.closeChangeDialog}>取消</Button>
      <Button id="um-ok" type="submit" disabled={snapshot.busy}>{snapshot.busy && <Spinner data-icon="inline-start" />}{snapshot.busy ? '保存中…' : '保存'}</Button>
    </DialogFooter>
  </form>
}

function ShellAccount({ bridge, host }: { bridge: AccountBridge; host: HTMLElement }) {
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot)
  const oldUserRef = useRef<HTMLInputElement>(null)
  const oldPasswordRef = useRef<HTMLInputElement>(null)
  const display = snapshot.username || '管理员'
  function focusTarget() {
    return document.getElementById(host.closest('[inert],[hidden]') ? 'shell-sidebar-trigger' : 'um-btn')
  }
  return <>
    <DropdownMenu open={snapshot.menuOpen} onOpenChange={bridge.setMenuOpen}>
      <DropdownMenuTrigger render={<Button id="um-btn" variant="ghost" className="h-auto w-full min-w-0 justify-start gap-3 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0" aria-label={`账号 · ${display}`} title={`账号 · ${display}`} />}>
        <AccountAvatar username={snapshot.username} />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 group-data-[collapsible=icon]:hidden"><span id="um-btn-name" className="max-w-full truncate">{display}</span><span>管理员</span></span>
        <span className="inline-flex group-data-[collapsible=icon]:hidden"><AccountIcon kind="chevrons" button /></span>
      </DropdownMenuTrigger>
      <DropdownMenuContent id="um-menu" side={snapshot.inSidebar ? 'right' : 'bottom'} align={snapshot.inSidebar ? 'end' : 'start'} sideOffset={8} className="w-64 max-w-[calc(100vw-24px)]" finalFocus={() => bridge.getSnapshot().dialogOpen ? false : focusTarget()}>
        <DropdownMenuGroup>
          <DropdownMenuLabel><span className="flex min-w-0 items-center gap-3"><AccountAvatar username={snapshot.username} /><span className="flex min-w-0 flex-col gap-0.5"><span id="um-name" className="truncate">{display}</span><span>管理员</span></span></span></DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem id="um-change" onClick={bridge.openChangeDialog}><AccountIcon kind="key" />修改账号密码</DropdownMenuItem>
          <DropdownMenuItem id="um-logout" variant="destructive" onClick={() => { void bridge.logout() }}><AccountIcon kind="logout" />退出登录</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={snapshot.dialogOpen} onOpenChange={(open) => { if (!open) bridge.closeChangeDialog() }}>
      <DialogContent id="um-dialog-mask" layer="above-drawer" className="w-[min(420px,calc(100vw-32px))]" initialFocus={() => oldUserRef.current?.value ? oldPasswordRef.current : oldUserRef.current} finalFocus={focusTarget}>
        <DialogHeader><DialogTitle>修改账号密码</DialogTitle></DialogHeader>
        <PasswordForm key={snapshot.dialogEpoch} bridge={bridge} snapshot={snapshot} oldUserRef={oldUserRef} oldPasswordRef={oldPasswordRef} />
      </DialogContent>
    </Dialog>
  </>
}

const mountedHosts = new WeakSet<HTMLElement>()
window.wbShellAccount = {
  mount(host, bridge) {
    if (mountedHosts.has(host)) return
    mountedHosts.add(host)
    flushSync(() => createRoot(host).render(<ShellAccount bridge={bridge} host={host} />))
  },
}
document.dispatchEvent(new Event('wb:shell-account-ready'))
