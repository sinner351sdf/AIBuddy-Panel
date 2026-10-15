/* Sidebar interactions are owned by shell-navigation.tsx; window controls by shell-window-controls.tsx.
   Keep this entry point for cached/external HTML references. */
(function () {
  'use strict';
  function boot() { window.wbShell?.syncPage?.(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
