import { t } from '../i18n'

/** Prefer a machine code; legacy servers only provide the visible error string. */
export function modelTestErrorHint(status: number, code?: string | null, message?: string | null): string | undefined {
  if (code === 'accio_waf_block' || (!code && /\bWAF_BLOCK\b/.test(message || ''))) {
    return t('Accio 安全网关拦截了本次请求，不代表账号失效。请保留账号；先确认官方客户端可用，再检查网关的安全会话与接入环境，避免连续重试。')
  }
  if (code === 'accio_security_guard_unavailable') {
    return t('网关未完成 Accio 安全组件初始化。请检查官方客户端组件与安全会话；账号仍然保留，不要删除账号。')
  }
  if (status === 401) return t('上游未接受当前登录凭证。可为原账号重新授权；保留账号记录后再检查续期结果。')
  if (status === 403) return t('上游拒绝了本次访问，可能涉及模型权限或安全校验；仅凭 403 无法判断登录失效。请查看具体错误，保留账号。')
  if (status === 429) return t('该账号对这个模型正在限额冷却，等一会儿自己会好；也可以先测别的账号。')
  if (status === 404) return t('上游不认识这个模型名：先点「获取模型」刷新清单，或核对默认绑定指向的上游模型。')
  if (status === 504) return t('上游没在预算内给完回答。可以只勾一个账号再测一次，看是普遍慢还是某一个账号慢。')
  if (status >= 500) return t('上游或接入链路暂时不可用，请查看具体错误。同一个错误出现在所有账号上时，先查模型目录与接入配置。')
  return undefined
}
