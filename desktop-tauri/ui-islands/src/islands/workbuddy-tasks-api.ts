export type AccountGrowthTask = {
  code: string; label?: string; title?: string; description?: string; tag?: string
  current?: number; target?: number; rewardCredit?: number; rewardEnergy?: number
  accepted?: boolean; claimed?: boolean; claimable?: boolean; locked?: boolean; automatable?: boolean
}
export type AccountGrowthDetails = { accountId: string; queriedAt?: number; tasks?: AccountGrowthTask[] }
export type AccountGrowthClaim = { claimed: boolean; already?: boolean; message?: string }
export type CompensationStatus = { active: boolean; claimed: boolean; claimable: boolean; creditNum: number | null; endTime: string | null }
export type AccountCompensation = { accountId: string; queriedAt: number; status: CompensationStatus }
export type CompensationClaim = { claimed: boolean; already: boolean; credit: number | null; message: string }
export type GrowthQueueItem = { accountId: string; taskCode: string; status: string; message?: string }
export type AccountGrowthQueue = { running?: boolean; total?: number; done?: number; items?: GrowthQueueItem[] }
export type GrowthRequest = <T>(method: 'GET' | 'POST', path: string, body?: unknown) => Promise<T>

/** One client for native IPC and the web shim, with explicit account scope. */
export function createAccountGrowthClient(request: GrowthRequest) {
  const path = (id: string) => '/api/growth-tasks/accounts/' + encodeURIComponent(id)
  return {
    list: (id: string) => request<AccountGrowthDetails>('GET', path(id)),
    compensation: (id: string) => request<AccountCompensation>('GET', path(id) + '/compensation'),
    claimCompensation: (id: string) => request<CompensationClaim>('POST', '/api/growth-tasks/gift', { accountId: id, kind: 'compensation' }),
    accept: (id: string, code?: string) => request<{ accepted: number }>('POST', path(id) + '/accept',
      code === undefined ? { all: true } : { code }),
    claim: (id: string, code: string) => request<AccountGrowthClaim>('POST', path(id) + '/claim', { code }),
    run: (id: string) => request<{ started: boolean; total: number }>('POST', '/api/growth-tasks/run', { accountId: id }),
    runTask: (id: string, code: string) => request<{ started: boolean; total: number }>('POST', '/api/growth-tasks/run',
      { accountId: id, taskCode: code, taskKind: code === 'black_cat' ? 'night' : 'growth' }),
    queue: () => request<AccountGrowthQueue>('GET', '/api/growth-tasks/queue'),
  }
}

export function taskState(task: AccountGrowthTask): 'claimed' | 'locked' | 'claimable' | 'accepted' | 'pending' {
  if (task.claimed) return 'claimed'
  if (task.locked) return 'locked'
  if (task.claimable) return 'claimable'
  return task.accepted ? 'accepted' : 'pending'
}
export function canAcceptTask(task: AccountGrowthTask): boolean {
  return !task.claimed && !task.locked && !task.accepted
}
export function canAutomateTask(task: AccountGrowthTask): boolean {
  return task.automatable === true && !task.claimed && !task.locked
}

export const accountGrowthClient = createAccountGrowthClient(async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => {
  const runtime = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke(command: string, args: unknown): Promise<unknown> }
  }).__TAURI_INTERNALS__
  if (typeof runtime?.invoke !== 'function') throw new Error('后端桥不可用')
  return await runtime.invoke('api_request', { request: { method, path, body: body ?? null } }) as T
})
