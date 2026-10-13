/** Management requests share the existing desktop/web authentication bridge.
 * Tauri serves assets from its custom protocol, not from the HTTP gateway.
 * The web shim also owns header tokens and silent session refresh.
 */
export async function localApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (command: string, args: unknown) => Promise<unknown> }
  }).__TAURI_INTERNALS__
  if (!internals?.invoke) throw new Error('网关桥接未就绪，请刷新页面后重试')
  try {
    return await internals.invoke('api_request', {
      request: { method, path, body: body === undefined ? null : body },
    }) as T
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}
