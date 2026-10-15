/* 通知业务控制器。Popover / ScrollArea / Empty / Badge 由
   shell-notifications.tsx 渲染；本文件持有请求、未读水位、轮询及顶栏宿主。 */

(function () {
  'use strict';

  if (window.wbNotifyCenter && window.wbNotifyCenter.__shellNotificationsBridge) return;

  var READ_KEY = 'aibuddy-notify-read';   // 已读水位：{ id, ts }（localStorage JSON）
  var PREFS_KEY = 'aibuddy-prefs';        // 偏好键（prefs.js 持有，这里只读轮询间隔）
  var POLL_MIN = 1, POLL_MAX = 60;        // 轮询间隔允许范围（分钟）
  var FETCH_N = 8;                        // 面板最多展示条数
  var FETCH_TIMEOUT_MS = 8000;            // 单次请求兜底超时
  var PAGE_KEY = 'workbuddy-desktop-page';// 与 prefs.js / app.js 共用的当前页记忆键


  /* ── 响应与存档归一 ──────────────────────── */
  function numOf(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  /* 毫秒时间戳归一：秒（<1e12）×1000；字符串数字 / ISO 串都试着解析；解析不了给 0 */
  function normTs(v) {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? (v < 1e12 ? v * 1000 : v) : 0;
    if (typeof v === 'string') {
      if (/^\d+$/.test(v)) { var n = Number(v); return n < 1e12 ? n * 1000 : n; }
      var p = Date.parse(v);
      return isFinite(p) ? p : 0;
    }
    return 0;
  }
  /* ── 响应形态兼容：从信封里捞出事件数组 ───── */
  function pickList(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) return payload;
    var d = payload.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object') {
      if (Array.isArray(d.items)) return d.items;
      if (Array.isArray(d.entries)) return d.entries;
      if (Array.isArray(d.list)) return d.list;
    }
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.entries)) return payload.entries;
    if (Array.isArray(payload.list)) return payload.list;
    return [];
  }
  /* 单条归一：level 归一成 info/warn/error/debug，其余字段缺了给占位 */
  function normItem(raw) {
    raw = (raw && typeof raw === 'object') ? raw : {};
    var level = String(raw.level || raw.lvl || 'info').toLowerCase();
    if (level === 'warning') level = 'warn';
    else if (level === 'err') level = 'error';
    else if (['info', 'warn', 'error', 'debug'].indexOf(level) < 0) level = 'info';
    var msg = raw.message;
    if (msg === undefined || msg === null) msg = raw.text;
    if (msg === undefined || msg === null) msg = raw.msg;
    return {
      id: numOf(raw.id),
      ts: normTs(raw.ts !== undefined ? raw.ts : raw.time),
      level: level,
      category: String(raw.category || raw.cat || '').trim(),
      message: String(msg).trim()
    };
  }

  function readWatermark() {
    try {
      var raw = JSON.parse(localStorage.getItem(READ_KEY) || 'null');
      if (raw && typeof raw === 'object') return { id: numOf(raw.id), ts: numOf(raw.ts) };
    } catch (e) {}
    return null; // null = 从未记录（首轮）
  }
  function writeWatermark(id, ts) {
    try { localStorage.setItem(READ_KEY, JSON.stringify({ id: id || 0, ts: ts || 0 })); } catch (e) {}
  }
  function maxOf(list) {
    var id = 0, ts = 0;
    list.forEach(function (it) { if (it.id > id) id = it.id; if (it.ts > ts) ts = it.ts; });
    return { id: id, ts: ts };
  }

  /* ── 业务状态与 React 订阅 ────────────────── */
  var holder = null;
  var items = [];
  var openState = false;
  var inflight = false;
  var listeners = new Set();
  var snapshot = null;

  function unreadCount() {
    var wm = readWatermark();
    if (!wm) return 0; // 首轮水位未落盘前不报未读（firstRunSeed 落盘后才开始算）
    var n = 0;
    items.forEach(function (it) {
      if (it.level !== 'error' && it.level !== 'warn') return;
      var newer = (it.id > 0 && it.id > wm.id) || (it.id <= 0 && it.ts > wm.ts);
      if (newer) n++;
    });
    return n;
  }
  /** useSyncExternalStore 在未更新时读到同一个只读快照。 */
  function publish() {
    snapshot = Object.freeze({
      open: openState,
      loading: inflight,
      unread: unreadCount(),
      items: Object.freeze(items.map(function (item) { return Object.freeze(item); })),
    });
    listeners.forEach(function (listener) { listener(); });
  }

  /** 日志清空后 id 回落，已读水位也随之回落。 */
  function updateUnread() {
    var wm = readWatermark();
    var mx = maxOf(items);
    if (wm && mx.id > 0 && mx.id < wm.id) writeWatermark(mx.id, mx.ts);
    publish();
  }

  /** 空数据不抹掉水位；打开后拉到的新事件也沿用同一份已读规则。 */
  function markRead() {
    if (items.length) {
      var m = maxOf(items);
      var wm = readWatermark();
      if (!wm || m.id > wm.id || m.ts > wm.ts || m.id < wm.id) writeWatermark(m.id, m.ts);
    }
    publish();
  }

  function firstRunSeed() {
    if (readWatermark() !== null) return;
    var m = maxOf(items);
    writeWatermark(m.id, m.ts);
  }

  /* ── 拉取（保留桌面桥接、同源请求与静默失败）── */
  function fetchLogs() {
    if (inflight) return;
    inflight = true;
    publish();
    var timeout = null;
    var opts = { method: 'GET', headers: { 'Accept': 'application/json' } };
    try {
      if (typeof AbortController === 'function') {
        var ac = new AbortController();
        timeout = setTimeout(function () { try { ac.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS);
        opts.signal = ac.signal;
      }
    } catch (e) { /* 老环境没有 AbortController 时不设超时 */ }
    var request;
    try {
      var internals = window.__TAURI_INTERNALS__;
      request = internals && typeof internals.invoke === 'function'
        ? internals.invoke('api_request', { request: { method: 'GET', path: '/api/logs?limit=' + FETCH_N + '&offset=0' } })
        : fetch('/api/logs?limit=' + FETCH_N + '&offset=0', opts).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          });
    } catch (error) {
      request = Promise.reject(error);
    }
    Promise.resolve(request)
      .then(function (json) {
        items = pickList(json).map(normItem);
        items.sort(function (a, b) { return (b.ts - a.ts) || (b.id - a.id); });
        items = items.slice(0, FETCH_N);
        firstRunSeed();
        if (openState) markRead();
        else updateUnread();
      })
      .catch(function () {
        // 401 / 网络失败 / 超时不清空旧事件或已读水位，也不弹错误。
      })
      .then(function () {
        if (timeout !== null) clearTimeout(timeout);
        inflight = false;
        publish();
      });
  }

  function open() {
    if (openState) return;
    openState = true;
    markRead();
    fetchLogs();
  }

  function close() {
    if (!openState) return;
    openState = false;
    publish();
  }

  /** 兼容原有「查看全部」行为与页面记忆键。 */
  function viewAll() {
    close();
    try { localStorage.setItem(PAGE_KEY, 'logs'); } catch (e) {}
    var fn = (window.wbApp && window.wbApp.showPage) || window.showPage;
    if (typeof fn === 'function') { try { fn('logs'); } catch (e) {} }
  }

  /* ── 顶栏独立宿主：React 持有按钮与浮层 DOM ── */
  function mountIsland() {
    if (holder && window.wbShellNotifications) {
      window.wbShellNotifications.mount(holder, window.wbNotifyCenter);
    }
  }

  function ensureButton() {
    var bar = document.getElementById('topbar-status');
    if (!bar || !bar.parentNode) return;
    if (!holder) {
      holder = document.createElement('div');
      holder.className = 'nc-holder';
      holder.id = 'nc-buttons';
    }
    // 不插进会被 app.js 整体重写的 #topbar-status；宿主被摘下时原位复用。
    if (!holder.isConnected) bar.parentNode.insertBefore(holder, bar);
    mountIsland();
  }

  document.addEventListener('wb:shell-notifications-ready', ensureButton);

  /* ── 轮询 ─────────────────────────────────── */
  function tick() {
    if (document.hidden) return; // 页面不可见：跳过这一轮
    fetchLogs();
  }
  /* 轮询间隔（可配置）：读偏好里的分钟数并钳位，脏值 / 未设置一律默认 1 分钟 */
  function pollIntervalMs() {
    var mins = 1;
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      var n = Math.floor(Number(p && p.notifyInterval));
      if (isFinite(n) && n >= POLL_MIN && n <= POLL_MAX) mins = n;
    } catch (e) { /* 偏好存档损坏就按默认走 */ }
    return mins * 60000;
  }
  function startPolling() {
    if (startPolling._timer) clearInterval(startPolling._timer);
    startPolling._timer = setInterval(tick, pollIntervalMs());
    if (!startPolling._bound) {
      startPolling._bound = true;
      // 偏好抽屉任何一项保存都会派发 aibuddy-prefs-changed（prefs.js apply）：
      // 收到就重排计时器，「通知轮询间隔」改动立即生效
      document.addEventListener('aibuddy-prefs-changed', function () { startPolling(); });
      // 回到前台立即补拉一次（隐藏期间的轮询都被跳过了）
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) tick();
      });
    }
  }

  /* ── 启动与公共契约 ───────────────────────── */
  window.wbNotifyCenter = {
    __shellNotificationsBridge: true,
    refresh: function () { fetchLogs(); },
    open: open,
    close: close,
    unread: unreadCount,
    markRead: markRead,
    viewAll: viewAll,
    setOpen: function (next) { if (next) open(); else close(); },
    getSnapshot: function () { return snapshot; },
    subscribe: function (listener) {
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    },
  };
  publish();
  document.dispatchEvent(new Event('wb:notify-center-ready'));

  function boot() {
    ensureButton();
    if (!boot._observer && typeof MutationObserver === 'function') {
      boot._observer = new MutationObserver(ensureButton);
      boot._observer.observe(document.body, { childList: true, subtree: true });
    }
    startPolling();
    // 保留首拉延迟，给登录态和首屏请求让路。
    setTimeout(tick, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
