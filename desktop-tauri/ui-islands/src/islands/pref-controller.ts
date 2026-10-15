import type { ShellPrefs } from './settings-model'

export type Preferences = ShellPrefs & {
  density: 'compact' | 'default' | 'relaxed'
  layout: 'vertical' | 'classic' | 'mix' | 'horizontal'
  watermarkText: string
  isTagsview: boolean
  notifyInterval: number
}
export type PreferencePatch = Omit<Partial<Preferences>, 'lockScreen'> & {
  lockScreen?: Partial<Preferences['lockScreen']>
}
export type PreferencesSnapshot = {
  prefs: Preferences
  palette: Array<[string, string]>
  drawerOpen: boolean
  searchOpen: boolean
  locked: boolean
  lockError: string
  lockAttempt: number
  clockTime: string
  clockDate: string
  progress: number
  progressVisible: boolean
  footerBusy: boolean
  greeting: string
  date: string
  pool: { accounts: number; requests: number } | null
  topbarHost: HTMLElement | null
  footerHost: HTMLElement | null
  bannerHost: HTMLElement | null
}
export type PreferencesController = {
  get(): Preferences
  set(patch: PreferencePatch, options?: { apply?: boolean }): Preferences
  open(): void
  close(): void
  reset(): void
  search(): void
  closeSearch(): void
  go(page: string): void
  cycleTheme(): void
  changeTheme(theme: Preferences['theme']): void
  selectLayout(layout: Preferences['layout']): boolean
  copyGatewayLink(): void
  copy(): void | Promise<void>
  paste(): Promise<boolean>
  importPreferences(text: string): boolean
  checkUpdate(): void
  lock(persist?: boolean): void
  unlock(): void
  tryUnlock(value: string): boolean
  isLocked(): boolean
  subscribe(listener: () => void): () => void
  getSnapshot(): PreferencesSnapshot
}

declare global {
  interface Window {
    wbPrefs?: PreferencesController
    wbPrefsUi?: { connect(controller: PreferencesController): void }
  }
}
