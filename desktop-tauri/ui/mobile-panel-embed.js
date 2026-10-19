(() => {
  try {
    if (window.parent === window || window.parent.location.origin !== location.origin) return;
    const query = new URLSearchParams(location.search);
    const page = query.get('mobile-panel');
    const pages = ['accounts','gateway','keys','agent','proxies','checkin','settings','assistant','overview','requests','logs','tasks','docs','credits'];
    if (!pages.includes(page)) return;
    window.wbMobileEmbed = { page };
    document.documentElement.classList.add('mobile-panel-embed');
    const style = document.createElement('style');
    style.textContent = `
      .mobile-panel-embed #shell-sidebar-root, .mobile-panel-embed .topbar,
      .mobile-panel-embed .tags-view, .mobile-panel-embed #tags-view,
      .mobile-panel-embed .titlebar, .mobile-panel-embed .sidebar-mask {display:none!important}
      .mobile-panel-embed .shell {display:flex!important;height:100dvh!important;background:var(--background)}
      .mobile-panel-embed .main {flex:1;width:100%;min-width:0}
      .mobile-panel-embed .content {padding:12px 16px 0!important}
      .mobile-panel-embed .content-inner {max-width:100%}
      .mobile-panel-embed .page.active {padding-bottom:16px}
      .mobile-panel-embed [data-slot="dialog-content"] {max-height:calc(100dvh - 24px)}
    `;
    document.head.appendChild(style);
    document.addEventListener('DOMContentLoaded', () => {
      const action = query.get('mobile-action');
      if (page !== 'accounts' || !['add','edit'].includes(action)) return;
      let tries = 0;
      const timer = setInterval(() => {
        const ready = window.wbApp?.getState?.()?.accounts;
        const handler = action === 'add' ? window.wbAddAccountModal : window.wbAccountPanel;
        if (ready && handler?.open) {clearInterval(timer);handler.open(action === 'edit' ? query.get('account') || '' : undefined)}
        else if (++tries >= 100) clearInterval(timer);
      }, 100);
    }, {once:true});
  } catch (_) { /* A cross-origin parent never activates embedded mode. */ }
})();
