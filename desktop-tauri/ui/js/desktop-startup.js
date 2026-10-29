/* Keep the first desktop frame coherent while its independent islands settle.
 * The dedicated /m document never loads this coordinator. No timers delay a ready UI. */
(() => {
  const root = document.documentElement
  root.setAttribute('data-desktop-startup', '')
  let layout = 'report'
  try {
    const page = localStorage.getItem('workbuddy-desktop-page')
    if (page === 'settings') layout = 'form'
    else if (page === 'assistant') layout = 'chat'
    else if (page && page !== 'overview') layout = 'table'
  } catch { /* Keep the default report layout when storage is unavailable. */ }
  root.setAttribute('data-desktop-startup-layout', layout)
  let parsed = false, frame = 0, done = false
  function finish() {
    if (done) return
    done = true
    observer.disconnect()
    cancelAnimationFrame(frame)
    clearTimeout(fallback)
    root.removeAttribute('data-desktop-startup')
    root.removeAttribute('data-desktop-startup-layout')
    document.querySelector('.content')?.setAttribute('aria-busy', 'false')
  }
  function check() {
    frame = 0
    if (!parsed || done) return
    const page = document.querySelector('.page.active')
    if (!page?.children.length || page.getAttribute('data-page-ready') === 'false') return
    const pageKey = page.dataset.page === '__plugin__' ? page.querySelector('iframe')?.dataset.pluginPage : page.dataset.page
    const tags = document.getElementById('shell-tags-host')
    if (root.getAttribute('data-pref-tags') !== 'off' && !tags?.querySelector('[role="tablist"]')) return
    // Every independent header island must commit before exposing its first frame.
    const controls = ['shell-sidebar-trigger','shell-btn-fullscreen','nc-btn-bell',
      'pref-btn-search','pref-btn-link','pref-btn-theme','pref-btn-prefs']
    if (controls.some(id => !document.getElementById(id))) return
    const activeNavigation = document.querySelector('#nav .nav-item.active')
    if (activeNavigation) {
      if (activeNavigation.getAttribute('data-page') !== pageKey) return
    } else if (window.innerWidth > 1000) return // A closed narrow-screen Sheet has no mounted navigation.
    if (root.getAttribute('data-pref-crumb') !== 'off') {
      const label = activeNavigation?.querySelector('.label')?.textContent?.trim()
        || document.getElementById('crumb-page')?.textContent?.trim()
      const breadcrumb = document.querySelector('#shell-breadcrumb [data-slot="breadcrumb-page"]')?.textContent?.trim()
      if (!label || breadcrumb !== label) return
    }
    if (root.getAttribute('data-pref-tags') !== 'off') {
      const selected = tags?.querySelector('[role="tab"][aria-selected="true"]')
      if (selected?.closest('[data-page]')?.getAttribute('data-page') !== pageKey) return
    }
    if (page.getAttribute('data-page') === 'overview') {
      if (page.getAttribute('data-initial-ready') !== 'true') return
      if (!page.querySelector('#welcome-banner-title')) return
    }
    finish()
  }
  function schedule() {
    if (!frame && !done) frame = requestAnimationFrame(check)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['class','data-initial-ready','data-pref-tags','data-page-ready']})
  // Fail open if an island fails to load: keep available controls and its error state usable.
  const fallback = setTimeout(finish, 10000)
  function ready() {
    parsed = true
    document.querySelector('.content')?.setAttribute('aria-busy', 'true')
    schedule()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true})
  else ready()
})()
