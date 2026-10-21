/* Agent2API · 偏好状态与业务控制器。
 * 存储、主题/布局副作用、锁屏校验与计时器保留在这里；可见 UI 由
 * ui-islands/src/islands/shell-preferences.tsx 使用 shadcn/Base UI 渲染。
 */
(function () {
  'use strict';

  // Return a fetch-like envelope while letting both runtimes handle credentials.
  function gatewayFetch(path, options) {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== 'function') return fetch(path, options);
    return internals.invoke('api_request', { request: { method: 'GET', path: path } })
      .then(function(data) { return {ok:true, json:function(){return Promise.resolve({success:true,data:data});}}; });
  }


  /* ── 偏好存取 ─────────────────────────────── */
  var KEY = 'aibuddy-prefs';
  var DEFAULTS = {
    theme: 'system',          // light | dark | system（与应用主题共用一个值）
    darkSidebar: false,
    darkTopbar: false,
    primary: '',              // 空 = 用共享主题的中性主色
    contentWidth: 'fluid',    // fluid | boxed
    density: 'default',       // 界面密度：compact | default | relaxed（default = 现状）
    dynamicTitle: true,
    progressbar: true,
    layout: 'vertical',       // 布局模式：当前只有 vertical 真实生效
    filter: '',               // 灰色 / 色弱滤镜：'' | gray | weak（互斥）
    watermark: false,         // 平铺水印
    watermarkText: '',        // 水印文字（空 = 品牌名+日期）
    pageAnim: 'none',         // 页面切换动画：none | fade | slide
    isBreadcrumb: true,       // 顶栏面包屑（vue-next-admin isBreadcrumb）
    isFooter: false,          // 内容区底部版权页脚（vue-next-admin isFooter）
    isShowLogo: true,         // 侧栏 Logo（vue-next-admin isShowLogo）
    isGroupLabel: true,       // 开=折叠时隐藏分组标题；关=折叠/抽屉模式也显示
    topbarGradient: false,    // 顶栏渐变背景（vue-next-admin isTopBarColorGradual）
    menuHighlight: false,     // 选中菜单左侧主色竖条（vue-next-admin 菜单高亮形态）
    isTagsview: true,         // 内容区顶部页签栏（vue-next-admin isTagsview）
    notifyInterval: 1,        // 通知中心轮询间隔（分钟，1–60，notify-center.js 读取）
    lockScreen: null          // 占位：sanitize 一律重建为 {enabled,password,minutes}
  };
  function sanitize(p) {
    // 越界值一律拉回合法档位，防止脏数据把界面锁死
    if (['light', 'dark', 'system'].indexOf(p.theme) < 0) p.theme = 'system';
    if (['fluid', 'boxed'].indexOf(p.contentWidth) < 0) p.contentWidth = 'fluid';
    if (['compact', 'default', 'relaxed'].indexOf(p.density) < 0) p.density = 'default';
    if (p.layout !== 'vertical') p.layout = 'vertical'; // 其余形态尚未支持
    if (['', 'gray', 'weak'].indexOf(p.filter) < 0) p.filter = '';
    if (['none', 'fade', 'slide'].indexOf(p.pageAnim) < 0) p.pageAnim = 'none';
    p.darkSidebar = !!p.darkSidebar;
    p.darkTopbar = !!p.darkTopbar;
    p.dynamicTitle = !!p.dynamicTitle;
    p.progressbar = !!p.progressbar;
    p.watermark = !!p.watermark;
    if (typeof p.primary !== 'string') p.primary = '';
    // 新键：缺省按「关/默认开」补齐，旧 localStorage 数据加载后自动有默认值
    p.isBreadcrumb = (p.isBreadcrumb === undefined || p.isBreadcrumb === null) ? true : !!p.isBreadcrumb;
    p.isFooter = !!p.isFooter;
    p.isShowLogo = (p.isShowLogo === undefined || p.isShowLogo === null) ? true : !!p.isShowLogo;
    p.isGroupLabel = (p.isGroupLabel === undefined || p.isGroupLabel === null) ? true : !!p.isGroupLabel;
    p.topbarGradient = !!p.topbarGradient;
    p.menuHighlight = !!p.menuHighlight;
    p.isTagsview = (p.isTagsview === undefined || p.isTagsview === null) ? true : !!p.isTagsview;
    // 通知轮询间隔：分钟数钳位在 1–60，脏值（NaN / 0 / 越界）一律拉回默认 1
    var ni = Math.floor(Number(p.notifyInterval));
    p.notifyInterval = (isFinite(ni) && ni >= 1) ? Math.min(ni, 60) : 1;
    // lockScreen 单独重建（旧数据可能是任意脏值，且避免与 DEFAULTS 共用引用）
    var ls = (p.lockScreen && typeof p.lockScreen === 'object') ? p.lockScreen : {};
    var mins = Math.floor(Number(ls.minutes));
    p.lockScreen = {
      enabled: !!ls.enabled,
      password: typeof ls.password === 'string' ? ls.password : '',
      minutes: (isFinite(mins) && mins > 0) ? Math.min(mins, 1440) : 0 // 0 = 不自动锁屏
    };
    return p;
  }
  function load() {
    var p;
    try { p = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { p = Object.assign({}, DEFAULTS); }
    return sanitize(p);
  }
  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }
  var prefs = load();

  /* ── 12 色内置主题板（圆点 + 名称）────────── */
  var PRIMARY_PRESETS = [
    ['#2563eb', '默认蓝'], ['#7c5cfc', '紫罗兰'], ['#ec4899', '樱花粉'],
    ['#eab308', '柠檬黄'], ['#3b82f6', '天蓝'], ['#10b981', '浅绿'],
    ['#3f3f46', '锌灰'], ['#0d9488', '深绿'], ['#1d4ed8', '深蓝'],
    ['#f97316', '橙黄'], ['#e11d48', '玫红'], ['#27272a', '中性']
  ];


  var listeners = new Set();
  var snapshot = null;
  var applying = false;
  var ui = {
    drawerOpen: false, searchOpen: false, locked: false, lockError: '', lockAttempt: 0,
    clockTime: '', clockDate: '', progress: 0, progressVisible: false, footerBusy: false,
    greeting: '', date: '', pool: null
  };
  var topbarHost = null, footerHost = null, bannerHost = null;
  var LOCK_KEY = 'aibuddy-lockscreen-active';
  var lockClockTimer = null, idleTimer = null, lastIdleReset = 0;
  var progressTimers = [];

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  function getPrefs() { return JSON.parse(JSON.stringify(prefs)); }
  function publish() {
    snapshot = Object.assign({}, ui, {
      prefs: getPrefs(), palette: PRIMARY_PRESETS, topbarHost: topbarHost,
      footerHost: footerHost, bannerHost: bannerHost
    });
    listeners.forEach(function (listener) { listener(); });
  }
  function set(patch, options) {
    var base = load();
    prefs = sanitize(Object.assign({}, base, patch, {
      lockScreen: Object.assign({}, base.lockScreen, patch.lockScreen || {})
    }));
    save(prefs);
    if (options && options.apply === false) publish();
    else apply();
    return getPrefs();
  }
  function applyRootAttributes() {
    var root = document.documentElement;
    root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-pref-sidebar', prefs.darkSidebar ? 'dark' : 'light');
    root.setAttribute('data-pref-topbar', prefs.darkTopbar ? 'dark' : 'light');
    root.setAttribute('data-pref-width', prefs.contentWidth);
    root.setAttribute('data-pref-density', prefs.density);
    root.setAttribute('data-pref-layout', prefs.layout);
    root.setAttribute('data-pref-filter', prefs.filter || '');
    root.setAttribute('data-pref-anim', prefs.pageAnim || 'none');
    root.setAttribute('data-pref-crumb', prefs.isBreadcrumb ? 'on' : 'off');
    root.setAttribute('data-pref-logo', prefs.isShowLogo ? 'on' : 'off');
    root.setAttribute('data-pref-grouplabel', prefs.isGroupLabel ? 'on' : 'off');
    root.setAttribute('data-pref-topbar-grad', prefs.topbarGradient ? 'on' : 'off');
    root.setAttribute('data-pref-navhl', prefs.menuHighlight ? 'on' : 'off');
    root.setAttribute('data-pref-tags', prefs.isTagsview ? 'on' : 'off');
  }
  // Layout/theme preferences must be known before CSS paints the desktop shell.
  if (document.documentElement.dataset.mobileUi !== 'true') applyRootAttributes();
  function apply() {
    applying = true;
    var root = document.documentElement;
    applyRootAttributes();
    // 与设置页共用主题唯一入口，也同步桌面原生窗口和 color-scheme。
    window.wbApp?.applyTheme?.(prefs.theme);
    window.wbTheme?.applyPrimaryColor(prefs.primary);
    if (window.__aibuddyTitleBase && document.documentElement.dataset.mobileUi !== 'true') {
      document.title = prefs.dynamicTitle
        ? (window.__aibuddyTitleBase.currentPage
          ? window.__aibuddyTitleBase.currentPage + ' · ' + window.__aibuddyTitleBase.brand
          : window.__aibuddyTitleBase.brand)
        : window.__aibuddyTitleBase.brand;
    }
    applyWatermark();
    ensureFooter();
    syncLockScreen();
    applying = false;
    publish();
    document.dispatchEvent(new CustomEvent('aibuddy-prefs-changed', { detail: prefs }));
  }

  // 宿主只承载 Portal，不创建按钮或其他可见交互。
  function ensureTopbarButtons() {
    var bar = document.getElementById('topbar-status');
    if (!bar || !bar.parentNode) return;
    var existing = document.getElementById('pref-buttons');
    var changed = !existing || existing !== topbarHost;
    topbarHost = existing || topbarHost || el('div', 'pref-buttons');
    topbarHost.id = 'pref-buttons';
    if (!topbarHost.isConnected) bar.parentNode.insertBefore(topbarHost, bar);
    if (changed) publish();
    if (!ensureTopbarButtons._mo) {
      ensureTopbarButtons._mo = new MutationObserver(function () {
        if (topbarHost && topbarHost.isConnected) return;
        ensureTopbarButtons();
      });
      ensureTopbarButtons._mo.observe(bar.parentNode, { childList: true });
    }
  }
  function ensureFooter() {
    var old = document.getElementById('pref-footer');
    if (!prefs.isFooter) {
      if (old) old.remove();
      footerHost = null;
      return;
    }
    var host = document.querySelector('.content-inner');
    if (!host) return;
    footerHost = old || footerHost || el('div', 'pref-footer');
    footerHost.id = 'pref-footer';
    if (!footerHost.isConnected) host.appendChild(footerHost);
  }

  function checkUpdate() {
    if (ui.footerBusy) return;
    ui.footerBusy = true; publish();
    var done = function () { ui.footerBusy = false; publish(); };
    var current = '';
    var bv = document.querySelector('.brand-version');
    if (bv && bv.textContent) {
      var m = bv.textContent.trim().match(/^v?([0-9][0-9A-Za-z.\-+]*)$/i);
      if (m) current = m[1];
    }
    var ask = function () {
      gatewayFetch('/api/update/check' + (current ? '?current=' + encodeURIComponent(current) : ''),
        { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (env) {
          done();
          var d = env && env.data;
          if (d && d.hasUpdate === true) {
            var v = String(d.latestVersion || '');
            if (v && v.charAt(0) !== 'v' && v.charAt(0) !== 'V') v = 'v' + v;
            toast('发现新版本 ' + v + '，可在 设置→更新 下载');
          } else if (d && d.hasUpdate === false) {
            toast('已是最新版本');
          } else {
            toast('检查失败', 'err'); // 未登录 / 无法比较版本 / 空响应都归到这里
          }
        })
        .catch(function () { done(); toast('检查失败', 'err'); });
    };
    if (current) { ask(); return; }
    // 品牌区没有版本号（未登录或后端没返回）：退而求其次问 /api/update/status
    gatewayFetch('/api/update/status', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (env) {
        var v = env && env.data && env.data.currentVersion;
        if (typeof v === 'string' && v && v !== 'web') current = v;
      })
      .catch(function () {})
      .then(function () { ask(); });
  }


  function isLocked() { return ui.locked; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function tickLockClock() {
    var date = new Date();
    ui.clockTime = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    ui.clockDate = date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    publish();
  }
  function lockNow(persist) {
    if (isLocked()) return;
    ui.locked = true; ui.lockError = '';
    if (persist !== false) { try { localStorage.setItem(LOCK_KEY, '1'); } catch (e) {} }
    tickLockClock();
    if (lockClockTimer) clearInterval(lockClockTimer);
    lockClockTimer = setInterval(tickLockClock, 1000);
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }
  function unlock() {
    ui.locked = false; ui.lockError = '';
    if (lockClockTimer) { clearInterval(lockClockTimer); lockClockTimer = null; }
    try { localStorage.removeItem(LOCK_KEY); } catch (e) {}
    restartIdleTimer();
    publish();
  }
  function tryUnlock(value) {
    var password = prefs.lockScreen ? prefs.lockScreen.password : '';
    if (password && value !== password) {
      ui.lockError = '密码不正确，请重试';
      ui.lockAttempt += 1;
      publish();
      return false;
    }
    unlock();
    return true;
  }
  function restartIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (isLocked() || !(prefs.lockScreen && prefs.lockScreen.enabled)) return;
    var minutes = prefs.lockScreen.minutes;
    if (!minutes || minutes <= 0) return;
    idleTimer = setTimeout(function () { lockNow(); }, minutes * 60 * 1000);
  }
  function syncLockScreen() {
    var flag = false;
    try { flag = localStorage.getItem(LOCK_KEY) === '1'; } catch (e) {}
    if (flag && !isLocked()) lockNow(false);
    restartIdleTimer();
  }
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (event) {
    document.addEventListener(event, function () {
      var now = Date.now();
      if (now - lastIdleReset < 10000) return;
      lastIdleReset = now;
      restartIdleTimer();
    });
  });

  function applyWatermark() {
    var old = document.getElementById('pref-watermark');
    if (!prefs.watermark) { if (old && old.parentNode) old.parentNode.removeChild(old); return; }
    var brand = 'Agent2API';
    var h1 = document.querySelector('.brand-text h1');
    if (h1 && h1.textContent.trim()) brand = h1.textContent.trim();
    var d = new Date();
    var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var custom = (typeof prefs.watermarkText === 'string' && prefs.watermarkText.trim());
    var text = custom ? prefs.watermarkText.trim() : brand + ' · ' + ds;
    var w = 280, h = 170;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-20 * Math.PI / 180);
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(127,127,127,0.18)'; // 中性灰：浅色 / 深色主题下都低调可见
    ctx.fillText(text, 0, 0);
    var url = canvas.toDataURL('image/png');
    var node = old || el('div');
    node.id = 'pref-watermark';
    node.setAttribute('aria-hidden', 'true');
    node.style.backgroundImage = 'url(' + url + ')';
    if (!old) document.body.appendChild(node);
  }

  function copyGatewayLink() {
    var url = location.origin + '/v1';
    var ok = function () { toast('已复制 Base URL：' + url); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, function () { if (legacyCopy(url)) ok(); });
    } else {
      if (legacyCopy(url)) ok();
    }
  }
  /* 剪贴板降级：隐藏 textarea + execCommand（老内核 / 非安全上下文用） */
  function legacyCopy(text, failureMessage) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    if (!done) toast(failureMessage || '复制失败，请手动复制：' + text, 'err');
    return done;
  }


  function toast(message, type) {
    if (window.wbToast?.show?.(message, type || 'ok')) return;
    window.wbApp?.toast?.(message, type || 'ok');
  }
  function openSearchDialog() {
    if (isLocked()) return;
    ui.searchOpen = true; publish();
  }
  function closeSearch() { ui.searchOpen = false; publish(); }
  function openDrawer() {
    if (isLocked()) return;
    prefs = load(); ui.drawerOpen = true; publish();
  }
  function closeDrawer() { ui.drawerOpen = false; publish(); }
  function cycleTheme() {
    var order = ['light', 'dark', 'system'];
    changeTheme(order[(order.indexOf(prefs.theme) + 1) % order.length]);
  }
  function changeTheme(theme) {
    set({ theme: theme });
    toast('主题：' + (prefs.theme === 'light' ? '浅色' : prefs.theme === 'dark' ? '深色' : '跟随系统'));
  }
  function selectLayout(layout) {
    if (layout !== 'vertical') { toast('该布局形态即将支持'); return false; }
    set({ layout: 'vertical' }); return true;
  }
  function go(page) {
    closeSearch();
    try { localStorage.setItem('workbuddy-desktop-page', page); } catch (e) {}
    var fn = (window.wbApp && window.wbApp.showPage) || window.showPage;
    if (typeof fn === 'function') fn(page);
  }
  function copyPreferences() {
    var text = JSON.stringify(prefs, null, 2);
    var fallback = function () { if (legacyCopy(text, '复制失败')) toast('偏好已复制'); };
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(function () { toast('偏好已复制到剪贴板'); }, fallback);
    fallback();
  }
  function importPreferences(text) {
    try {
      var imported = JSON.parse(text);
      prefs = sanitize(Object.assign({}, DEFAULTS, imported));
      save(prefs); apply(); toast('偏好已导入并应用'); return true;
    } catch (e) { toast('剪贴板内容不是有效的偏好 JSON', 'err'); return false; }
  }
  function pastePreferences() {
    if (!navigator.clipboard?.readText) { toast('此浏览器不支持读取剪贴板', 'err'); return Promise.resolve(false); }
    return navigator.clipboard.readText().then(importPreferences, function () { toast('读取剪贴板失败', 'err'); return false; });
  }
  function reset() {
    prefs = sanitize(Object.assign({}, DEFAULTS));
    try { localStorage.removeItem(KEY); } catch (e) {}
    save(prefs); apply(); toast('已恢复默认偏好');
  }

  // 保留原切页时序，重复点击时只让最后一轮计时器更新同一条 Progress。
  function showProgress() {
    progressTimers.forEach(clearTimeout); progressTimers = [];
    ui.progress = 30; ui.progressVisible = true; publish();
    progressTimers.push(setTimeout(function () { ui.progress = 82; publish(); }, 80));
    progressTimers.push(setTimeout(function () {
      ui.progress = 100; publish();
      progressTimers.push(setTimeout(function () { ui.progress = 0; ui.progressVisible = false; publish(); }, 260));
    }, 300));
  }
  document.addEventListener('click', function (event) {
    var item = event.target.closest && event.target.closest('.nav-item[data-page]');
    if (item && load().progressbar) showProgress();
  });

  function ensureBanner() {
    var page = document.querySelector('.page[data-page="overview"]');
    if (!page || page.children.length === 0) return false;
    var existing = page.querySelector('.aibuddy-banner');
    if (existing) return true;
    bannerHost = el('div', 'aibuddy-banner');
    bannerHost.id = 'pref-welcome-banner';
    var now = new Date(), hour = now.getHours();
    ui.greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    ui.date = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    ui.pool = null;
    page.insertBefore(bannerHost, page.firstChild);
    publish(); fetchPool(bannerHost);
    return true;
  }
  function fetchPool(banner, retried) {
    var retry = function () { if (!retried && banner.parentNode) setTimeout(function () { fetchPool(banner, true); }, 8000); };
    gatewayFetch('/api/storage', { headers: { 'Accept': 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (env) {
        var data = env && env.data && env.data.database;
        if (data && data.available === true && banner.parentNode) {
          ui.pool = { accounts: numOfChips(data.accounts), requests: numOfChips(data.requests) }; publish();
        } else retry();
      }).catch(retry);
  }
  function numOfChips(value) { var n = Math.floor(Number(value)); return isFinite(n) && n >= 0 ? n : 0; }
  // 报表岛可在其他页面停留期间挂载。只等它首次有正文，不依赖当前页，
  // 也不让启动后30秒的轮询截止时间决定用户以后能否看见欢迎横幅。
  function watchBanner() {
    var page = document.querySelector('.page[data-page="overview"]');
    if (!page || ensureBanner()) return;
    var observer = new MutationObserver(function () {
      if (ensureBanner()) observer.disconnect();
    });
    observer.observe(page, { childList: true });
  }

  var controller = {
    get: getPrefs, set: set, open: openDrawer, close: closeDrawer, reset: reset,
    search: openSearchDialog, closeSearch: closeSearch, go: go,
    cycleTheme: cycleTheme, changeTheme: changeTheme, selectLayout: selectLayout,
    copyGatewayLink: copyGatewayLink, copy: copyPreferences, paste: pastePreferences,
    importPreferences: importPreferences, checkUpdate: checkUpdate,
    lock: lockNow, unlock: unlock, tryUnlock: tryUnlock, isLocked: isLocked,
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
    getSnapshot: function () { if (!snapshot) publish(); return snapshot; }
  };
  window.wbPrefs = controller;
  window.__aibuddyPrefs = { get: getPrefs, lock: lockNow, tryUnlock: tryUnlock, unlock: unlock, isLocked: isLocked };
  // 设置页是另一个入口；它已应用 DOM 副作用，这里只更新同源快照，避免二次应用。
  document.addEventListener('aibuddy-prefs-changed', function (event) {
    if (event.detail === prefs || applying) return;
    prefs = load(); publish();
  });
  window.addEventListener('wb:theme', function (event) {
    if (applying || ['light', 'dark', 'system'].indexOf(event.detail) < 0) return;
    prefs = load(); prefs.theme = event.detail; save(prefs); publish();
  });

  function boot() {
    // 品牌名与页面名给动态标题 / 水印用
    var brandEl = document.querySelector('.brand-text h1');
    window.__aibuddyTitleBase = {
      brand: (brandEl ? brandEl.textContent.trim() : 'Agent2API') || 'Agent2API',
      currentPage: ''
    };
    // 侧栏品牌区换用新 Logo（assets/brand 的图标）
    var logoBox = document.querySelector('.brand-logo');
    if (logoBox && !logoBox.querySelector('img')) {
      logoBox.textContent = '';
      var img = document.createElement('img');
      img.src = 'brand/logo-icon.svg?v=b-mono-1';
      img.alt = 'logo';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
      logoBox.appendChild(img);
    }
    // 品牌区版本号：读后端真实版本（未登录/失败就不显示，不留假值）
    var brandText = document.querySelector('.brand-text');
    if (brandText && !brandText.querySelector('.brand-version')) {
      var ver = document.createElement('div');
      ver.className = 'brand-version';
      brandText.appendChild(ver);
      gatewayFetch('/api/update/status').then(function (r) { return r.ok ? r.json() : null; }).then(function (env) {
        var v = env && env.data && env.data.currentVersion;
        if (v && v !== 'web' && ver.parentNode) ver.textContent = 'v' + v;
        else if (ver.parentNode) ver.remove();
      }).catch(function () { if (ver.parentNode) ver.remove(); });
    }
    // 动态标题随切页更新
    document.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.nav-item[data-page]');
      if (!item) return;
      var label = item.querySelector('.label');
      window.__aibuddyTitleBase.currentPage = label ? label.textContent : '';
      var p = load();
      if (p.dynamicTitle && window.__aibuddyTitleBase) {
        document.title = window.__aibuddyTitleBase.currentPage
          ? window.__aibuddyTitleBase.currentPage + ' · ' + window.__aibuddyTitleBase.brand
          : window.__aibuddyTitleBase.brand;
      }
    });
    if (document.documentElement.dataset.mobileUi === 'true') {
      var mobileTheme = document.documentElement.dataset.theme;
      if (['system', 'light', 'dark'].indexOf(mobileTheme) >= 0) { prefs.theme = mobileTheme; save(prefs); }
    }
    apply();
    ensureTopbarButtons();
    watchBanner();
    window.wbPrefsUi?.connect?.(controller);
    publish();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
