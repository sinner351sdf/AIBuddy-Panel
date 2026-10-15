/* 账户控制器：保留网关/会话/校验，DropdownMenu、Avatar 与 Dialog 由 shell-account 渲染。 */
(() => {
  'use strict';
  if (window.wbAccountMenu) return;

  var holder = null;
  var listeners = new Set();
  var snapshot = Object.freeze({
    username: currentUser().trim(),
    menuOpen: false,
    dialogOpen: false,
    dialogEpoch: 0,
    busy: false,
    error: '',
    invalidFields: Object.freeze([]),
    inSidebar: false,
  });

  function currentUser() {
    try { return String(localStorage.getItem('agent2api-user') || ''); }
    catch (error) { return ''; }
  }

  function rememberUser(name) {
    try { if (name) localStorage.setItem('agent2api-user', String(name)); }
    catch (error) { /* 缓存不可用时不影响当前会话 */ }
  }

  function update(patch) {
    var changed = Object.keys(patch).some(function (key) { return snapshot[key] !== patch[key]; });
    if (!changed) return;
    snapshot = Object.freeze(Object.assign({}, snapshot, patch));
    listeners.forEach(function (listener) { listener(); });
  }

  function paintName(name) {
    update({ username: String(name || '').trim() });
  }

  // /status 的账号名用于显示；读取失败保持原缓存，接口与会话行为不变。
  function refreshUserName() {
    var invoke = (window.__TAURI_INTERNALS__ || {}).invoke;
    var request = invoke
      ? invoke('api_request', { request: { method: 'GET', path: '/api/panel/status' } })
      : fetch('/api/panel/status', { headers: { 'Accept': 'application/json' } }).then(function (response) { return response.json(); });
    return Promise.resolve(request).then(function (result) {
      var data = (result && result.data) || result || {};
      var name = data.username || data.user || '';
      if (name) { rememberUser(name); paintName(name); }
    }).catch(function () { /* 未登录 / 未注册：保留现状 */ });
  }

  function toast(message, kind) {
    if (window.wbApp && typeof window.wbApp.toast === 'function') {
      window.wbApp.toast(message, kind === 'err' ? 'err' : 'ok');
    } else if (kind === 'err') window.alert(message);
  }

  function describeError(error) {
    if (error instanceof Error && error.message) return error.message;
    return String(error || '').trim() || '未知错误';
  }

  function gatewayCall(method, path, body) {
    var internals = window.__TAURI_INTERNALS__ || {};
    if (internals.invoke) {
      return internals.invoke('api_request', {
        request: { method: method, path: path, body: body === undefined ? null : body },
      });
    }
    return fetch(path, {
      method: method,
      headers: body === undefined ? { 'Accept': 'application/json' } : { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (response) { return response.text().then(function (text) {
      var payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (error) { /* 非 JSON */ }
      return { httpOk: response.ok !== false, payload: payload, text: text };
    }); }).then(function (result) {
      var payload = result.payload || {};
      if (!result.httpOk || payload.success === false) {
        var detail = payload.error || payload.message || payload.msg || ('HTTP ' + (result.payload ? 200 : 0));
        if (detail && detail.message) detail = detail.message;
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      return Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
    });
  }

  function setMenuOpen(open) {
    update({ menuOpen: Boolean(open) });
    if (open) refreshUserName();
  }

  function openChangeDialog() {
    update({ menuOpen: false, dialogOpen: true, dialogEpoch: snapshot.dialogEpoch + 1, busy: false, error: '', invalidFields: Object.freeze([]) });
  }

  function closeChangeDialog() { update({ dialogOpen: false }); }

  function validationError(message, fields) {
    update({ error: message, invalidFields: Object.freeze(fields) });
    return Promise.resolve(false);
  }

  function save(draft) {
    if (snapshot.busy || !snapshot.dialogOpen) return Promise.resolve(false);
    var name = String(draft.oldUser || '').trim();
    var oldPassword = String(draft.oldPassword || '');
    var newUsername = String(draft.newUsername || '').trim();
    var newPassword = String(draft.newPassword || '');
    if (!name || !oldPassword) {
      return validationError('请填当前账号与当前密码', [!name && 'oldUser', !oldPassword && 'oldPassword'].filter(Boolean));
    }
    if (!newUsername && !newPassword) return validationError('新账号与新密码至少填一项', ['newUsername', 'newPassword']);
    if (newPassword && newPassword.length < 8) return validationError('新密码至少 8 位', ['newPassword']);
    var epoch = snapshot.dialogEpoch;
    update({ busy: true, error: '', invalidFields: Object.freeze([]) });
    return Promise.resolve().then(function () {
      return gatewayCall('POST', '/api/panel/password', {
        username: name, oldPassword: oldPassword,
        newUsername: newUsername || undefined, newPassword: newPassword || undefined,
      });
    }).then(function (result) {
      // 已提交的请求仍完成；它不能关闭后来新开的表单或覆盖那一轮错误。
      if (snapshot.dialogEpoch === epoch) update({ dialogOpen: false, busy: false });
      rememberUser(newUsername || name);
      paintName(newUsername || name);
      var revoked = result && result.revokedSessions;
      toast('✅ 账号密码已修改' + (revoked ? '（已下线其他 ' + revoked + ' 台设备的会话）' : ''));
      return true;
    }).catch(function (error) {
      if (snapshot.dialogEpoch === epoch) update({ busy: false, error: '修改失败：' + describeError(error) });
      return false;
    });
  }

  function doLogout() {
    update({ menuOpen: false });
    return Promise.resolve().then(function () { return gatewayCall('POST', '/api/panel/logout', {}); }).then(function () {
      window.location.href = '/login';
    }, function () {
      // 与旧控制器一致，后端兜底已清 cookie / 已撤会话的分支。
      window.location.href = '/login';
    });
  }

  function mountIsland() {
    if (holder && window.wbShellAccount) window.wbShellAccount.mount(holder, window.wbAccountMenu);
  }

  function ensureHolder() {
    var sidebarHost = document.getElementById('sidebar-user');
    var bar = document.getElementById('topbar-status');
    if (!sidebarHost && (!bar || !bar.parentNode)) return;
    holder = document.getElementById('um-holder') || holder;
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'um-holder';
    }
    if (sidebarHost) {
      if (holder.parentNode !== sidebarHost) sidebarHost.appendChild(holder);
    } else if (holder.nextElementSibling !== bar) bar.parentNode.insertBefore(holder, bar);
    var patch = { inSidebar: Boolean(sidebarHost) };
    if ((holder.closest('[inert]') || holder.closest('[hidden]')) && snapshot.menuOpen) patch.menuOpen = false;
    update(patch);
    mountIsland();
  }

  function boot() {
    ensureHolder();
    if (!window.__umObserver) window.__umObserver = new MutationObserver(ensureHolder);
    // Sidebar/Sheet 可替换整棵侧栏，不能只观察已脱离文档的旧 sidebar。
    window.__umObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert', 'hidden'] });
    refreshUserName();
  }

  window.wbAccountMenu = {
    getSnapshot: function () { return snapshot; },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
    setMenuOpen: setMenuOpen,
    openChangeDialog: openChangeDialog,
    closeChangeDialog: closeChangeDialog,
    save: save,
    logout: doLogout,
    refreshUserName: refreshUserName,
  };
  document.addEventListener('wb:shell-account-ready', mountIsland);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
