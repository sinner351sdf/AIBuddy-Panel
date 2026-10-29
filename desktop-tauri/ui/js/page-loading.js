/* Content-only navigation loading. Placeholders are pre-rendered shared shadcn components. */
(() => {
  const layouts = {overview:'report',credits:'report',agent:'form',plugins:'table',settings:'form',assistant:'chat',docs:'form',accounts:'table',checkin:'table',gateway:'table',proxies:'table',keys:'table',logs:'table',tasks:'table',requests:'table'}
  const settled = new WeakSet()
  let overlay, content, active, timer, failed = false
  function clear() {
    clearTimeout(timer)
    active?.removeAttribute('inert')
    active?.setAttribute('aria-busy','false')
    document.documentElement.removeAttribute('data-page-loading')
    if (overlay) overlay.hidden = true
  }
  function sync() {
    if (!content || !overlay) return
    const page = document.querySelector('.page.active')
    if (!page || !layouts[page.dataset.page]) { clear(); active = null; return }
    const changed = active !== page
    if (changed) { clear(); active = page; failed = false }
    if (page.dataset.pageReady === 'true') settled.add(page)
    if (settled.has(page)) { clear(); return }
    if (!changed && (!overlay.hidden || failed)) return
    const source = document.querySelector(`[data-startup-layout="${layouts[page.dataset.page]}"]`)
    if (!source) return
    const placeholder = source.cloneNode(true)
    placeholder.setAttribute('aria-hidden','true')
    overlay.replaceChildren(placeholder)
    overlay.hidden = false
    page.setAttribute('inert','')
    page.setAttribute('aria-busy','true')
    document.documentElement.setAttribute('data-page-loading',page.dataset.page)
    timer = setTimeout(() => {
      if (active !== page || settled.has(page)) return
      failed = true
      const error = document.getElementById('page-loading-error')
      if (error) {
        overlay.replaceChildren(error.content.cloneNode(true))
        overlay.querySelector('[data-loading-retry]')?.addEventListener('click',() => {
          failed = false; overlay.hidden = true; sync()
          void window.wbApp?.refresh?.()
          window.wbApp?.showPage?.(page.dataset.page)
        },{once:true})
      } else clear()
    },15000)
  }
  function mount() {
    content = document.querySelector('.content')
    if (!content) return
    overlay = document.createElement('div')
    overlay.id = 'page-transition-skeleton'
    overlay.hidden = true
    overlay.setAttribute('role','status')
    overlay.setAttribute('aria-label','正在加载页面')
    content.append(overlay)
    new MutationObserver(records => {
      if (records.some(record => record.target.matches?.('.page'))) sync()
    }).observe(document.querySelector('.content-inner'),{attributes:true,subtree:true,attributeFilter:['class','data-page-ready']})
    sync()
  }
  window.wbPageLoading = {sync}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true})
  else mount()
})()
