// Old mobile bookmarks now enter the same full panel as desktop. All assets and
// API requests stay same-origin; there is no parallel mobile account/model UI.
(() => {
  const routes = { home: 'overview', report: 'overview', accounts: 'accounts', assistant: 'assistant', more: 'settings', models: 'gateway', keys: 'keys', checkin: 'checkin', proxies: 'proxies', requests: 'requests', logs: 'logs', tasks: 'tasks', docs: 'docs', settings: 'settings', agent: 'agent' };
  const old = location.hash.slice(1).split('/')[0];
  const page = routes[old];
  if (page) { try { localStorage.setItem('workbuddy-desktop-page', page); } catch (_) {} }
  location.replace('/' + location.search + (page ? '#' + page : ''));
})();
