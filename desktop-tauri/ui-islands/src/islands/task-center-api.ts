/** One authenticated transport for desktop IPC and the headless web shim. */
export async function taskRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const runtime = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
  if (!runtime?.invoke) throw new Error('管理端连接尚未就绪')
  return await runtime.invoke('api_request', { request: { method, path, body: body ?? null } }) as T
}

let selectedAccount = ''
export const taskAccount = () => selectedAccount
export function openTaskCenter(id: string) {
  selectedAccount = id
  ;(window as unknown as {wbApp?:{showPage?:(page:string)=>void}}).wbApp?.showPage?.('tasks')
  window.dispatchEvent(new CustomEvent('wb:task-account', {detail:id}))
}
