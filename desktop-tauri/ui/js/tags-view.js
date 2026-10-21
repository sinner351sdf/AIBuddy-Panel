/* 页签状态与经典脚本接线。Tabs / ScrollArea / ContextMenu 由 shell-tabs.tsx
   渲染；这里保留存档、页面切换、内容全屏与 pointer 排序。 */

(function () {
  'use strict';

  // bundle 或经典脚本重复装载时保留已有订阅、DOM 与 showPage 包装。
  if (window.wbTagsView && window.wbTagsView.__shellTabsBridge) return;

  var STORAGE_KEY = 'aibuddy-tags';        // 页签清单（数组 of page id）
  var PAGE_KEY = 'workbuddy-desktop-page'; // app.js 记忆的当前页
  var HOME = 'overview';                   // 首页页签固定不可关

  // 与 app.js 的 PAGES 保持一致（那边是脚本内常量读不到，改动时两处同步）
  var PAGES = ['agent', 'assistant', 'overview', 'accounts', 'checkin', 'credits', 'gateway', 'proxies', 'keys', 'docs', 'logs', 'tasks', 'requests', 'settings'];
  // 与 app.js 的 PAGE_LABELS 保持一致；优先取侧栏导航上的现成文案，取不到才退回这张表
  var LABELS = {
    agent: 'Agent',
    assistant: 'AI 助手',
    overview: '用量',
    accounts: '账号池',
    checkin: '任务中心',
    credits: '积分构成',
    gateway: '模型与档位',
    proxies: '网络代理',
    keys: '网关 Key',
    docs: '接入文档',
    logs: '系统日志',
    tasks: '系统维护',
    requests: '运行日志',
    settings: '配置',
  };
  // 页签图标键：与 index.html 侧栏 <button class="nav-item" data-page data-icon>
  // 的 data-icon 逐字一致（docs 侧栏给的就是 logs 键，照抄不另造）。
  // 键不存在时 wbIcons.icon 返回空串，页签自动退回纯文字，不会留空壳。
  var PAGE_ICONS = {
    agent: 'gateway',
    assistant: 'spark',
    overview: 'overview',
    accounts: 'accounts',
    checkin: 'checkin',
    credits: 'packages',
    gateway: 'gateway',
    proxies: 'proxies',
    keys: 'key',
    docs: 'logs',
    requests: 'requests',
    logs: 'logs',
    tasks: 'tasks',
    settings: 'settings',
  };

  var tags = loadTags(); // 页签 id 有序清单，overview 恒在其中（位置可变）
  var current = HOME;    // 当前激活页签
  var root = null;       // .tags-view 容器
  var scrollEl = null;   // 左侧页签滚动区
  var installed = false; // showPage 包装是否已装上
  // 被包装的原 showPage；wbApp.showPage / window.showPage 被重新赋值时更新到这里
  var rawHolder = { fn: null };
  var listeners = new Set();
  var snapshot = null;
  var pageIds = Object.freeze(PAGES.slice());

  /* ── 存取 ─────────────────────────────────── */

  /** 读存档：非法 id 丢弃、去重、保序；overview 恒在数组中（缺了补最前，
   *  在则尊重拖拽存下来的位置 —— 顺序即页签顺序） */
  function loadTags() {
    var out = [];
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(raw)) {
        raw.forEach(function (id) {
          if (typeof id === 'string' && PAGES.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
        });
      }
    } catch (e) { /* 存档坏了就回到默认：只剩首页 */ }
    if (out.indexOf(HOME) === -1) out.unshift(HOME);
    return out;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tags)); } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  /** 非法页名归一到 overview（与 app.js 的 showPage 同一取向） */
  function normalize(name) {
    return typeof name === 'string' && PAGES.indexOf(name) !== -1 ? name : HOME;
  }

  /** 页签文案：优先侧栏导航的 label（与界面天然同步），退回内置表 */
  function labelOf(page) {
    var item = document.querySelector('.nav-item[data-page="' + page + '"] .label');
    var text = item && item.textContent && item.textContent.trim();
    return text || LABELS[page] || page;
  }

  /* ── DOM ──────────────────────────────────── */

  /** 只创建 React 宿主；点击、键盘与菜单交给官方组件。 */
  function buildDom() {
    if (root) return true;
    var main = document.querySelector('.main');
    var content = main && main.querySelector('.content');
    if (!main || !content) return false;
    root = document.getElementById('shell-tags-host');
    if (!root) {
      root = document.createElement('div');
      root.id = 'shell-tags-host';
      root.className = 'tags-view';
      main.insertBefore(root, content);
    }
    root.addEventListener('pointerdown', onRootPointerdown);
    root.addEventListener('dragstart', function (event) {
      if (event.target.closest && event.target.closest('.tag')) event.preventDefault();
    });
    // capture 早于 React 的点击处理，拖拽后的合成 click 不会误切页。
    root.addEventListener('click', function (event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
    return true;
  }

  /** useSyncExternalStore 要求未更新时返回同一快照。 */
  function render() {
    snapshot = Object.freeze({
      home: HOME,
      current: current,
      pages: pageIds,
      contentMax: document.body.classList.contains('pref-content-max'),
      tags: Object.freeze(tags.map(function (page) {
        return Object.freeze({
          page: page,
          label: labelOf(page),
          iconSvg: PAGE_ICONS[page] && window.wbIcons
            ? window.wbIcons.icon(PAGE_ICONS[page], 16) : '',
        });
      })),
    });
    listeners.forEach(function (listener) { listener(); });
  }

  function mountIsland() {
    if (root && window.wbShellTabs) window.wbShellTabs.mount(root, window.wbTagsView);
  }
  // 兼容 module 延后于经典脚本加载。
  document.addEventListener('wb:shell-tabs-ready', mountIsland);

  /** 用 viewport 坐标计算，避免 ScrollArea 内层布局改变 offsetParent。 */
  function revealTag(el) {
    if (!scrollEl) return;
    var viewport = scrollEl.getBoundingClientRect();
    var rect = el.getBoundingClientRect();
    if (rect.left < viewport.left) {
      scrollEl.scrollLeft += rect.left - viewport.left;
    } else if (rect.right > viewport.right) {
      scrollEl.scrollLeft += rect.right - viewport.right;
    }
  }

  function revealCurrent() {
    var active = scrollEl && scrollEl.querySelector('.tag[data-page="' + current + '"]');
    if (active) revealTag(active);
  }

  /* ── 行为 ─────────────────────────────────── */

  /** 记录一次页面切换（包装器与导航兜底都会调；同页重复调用无副作用） */
  function record(name) {
    var page = normalize(name);
    if (current === page && tags.indexOf(page) !== -1 && snapshot) return;
    if (tags.indexOf(page) === -1) tags.push(page);
    current = page;
    persist();
    render();
  }

  /** 切页：正常路径全走 showPage（已是包装器）；实在不可用才手工兜底 */
  function go(page) {
    if (typeof window.showPage === 'function') {
      window.showPage(page);
      return;
    }
    record(page);
    manualSwitch(page);
  }

  /** 仅当 showPage 完全不可用时才用的兜底切换（正常路径永远不会走到） */
  function manualSwitch(page) {
    page = normalize(page);
    document.querySelectorAll('.page').forEach(function (el) {
      el.classList.toggle('active', el.dataset.page === page);
    });
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.page === page);
    });
    var crumb = document.getElementById('crumb-page');
    if (crumb) crumb.textContent = labelOf(page);
    try { localStorage.setItem(PAGE_KEY, page); } catch (e) { /* 忽略 */ }
    current = page;
  }

  /** 关一个页签：首页拒关；关当前页 → 跳相邻（优先右邻，没有就左邻）；关别的页不动当前 */
  function close(page) {
    page = normalize(page);
    if (page === HOME) return;
    var idx = tags.indexOf(page);
    if (idx === -1) return;
    tags.splice(idx, 1);
    if (page === current) {
      var next = tags[idx] || tags[idx - 1] || HOME;
      current = next;
      persist();
      render();
      go(next);
      return;
    }
    persist();
    render();
  }

  /** 全部关闭：回到只剩首页，并跳回首页。 */
  function closeAll() {
    var shouldGoHome = current !== HOME;
    tags = [HOME];
    current = HOME;
    persist();
    render();
    if (shouldGoHome) go(HOME);
  }

  /** 关闭其它时，若当前页也被关闭，就激活保留下来的目标页签。 */
  function closeOthers(name) {
    var page = normalize(name);
    tags = tags.filter(function (tag) { return tag === page || tag === HOME; });
    if (tags.indexOf(page) === -1) tags.push(page);
    var shouldGo = tags.indexOf(current) === -1;
    if (shouldGo) current = page;
    persist();
    render();
    if (shouldGo) go(page);
  }

  /** 内容区全屏：藏侧栏 / 顶栏 / 页签栏，Esc 或再触发一次退出 */
  function toggleContentMax() {
    var on = document.body.classList.toggle('pref-content-max');
    try { localStorage.setItem('aibuddy-content-max', on ? '1' : '0'); } catch (e) {}
    render();
  }
  (function restoreContentMax() {
    try { if (localStorage.getItem('aibuddy-content-max') === '1') document.body.classList.add('pref-content-max'); } catch (e) {}
  })();
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('pref-content-max')) toggleContentMax();
  });

  /* ── 页签拖拽换位 ──
     按下后位移超过 6px 阈值才进拖拽；没超过就不打断原生 click（交给
     TabsTrigger 切页）。拖拽经过的目标页签显示插入侧色条
     （.drop-before / .drop-after，样式在 tags-view.css，全 tokens 变量）。
     松手按新顺序重排 tags 并 persist()；overview 也在可拖之列
     （恒在数组中、位置可变）。触屏不启用，保留原生滚动/点按。 */
  var DRAG_THRESHOLD_SQ = 36; // 6px 的平方：位移平方 ≥ 它才算拖拽
  var dragState = null;       // { tag, page, x, y, active, target, before }
  var suppressClick = false;  // 真拖拽结束后吞一次 click，防误切页

  function onRootPointerdown(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (event.pointerType === 'touch') return; // 触屏：保留原生滚动/点按
    suppressClick = false;
    var tag = event.target.closest && event.target.closest('.tag');
    if (!tag) return;
    if (event.target.closest && event.target.closest('.tag-close')) return; // 关闭钮照常点关
    dragState = {
      tag: tag,
      page: tag.dataset.page,
      x: event.clientX,
      y: event.clientY,
      active: false,
      target: null,
      before: false,
    };
    window.addEventListener('pointermove', onDragPointermove);
    window.addEventListener('pointerup', onDragPointerup);
    window.addEventListener('pointercancel', onDragPointercancel);
  }

  function unbindDragEvents() {
    window.removeEventListener('pointermove', onDragPointermove);
    window.removeEventListener('pointerup', onDragPointerup);
    window.removeEventListener('pointercancel', onDragPointercancel);
  }

  /** 清掉所有插入指示（整表重建前 / 换目标时都要先清） */
  function clearDropMark() {
    if (!scrollEl) return;
    scrollEl.querySelectorAll('.drop-before, .drop-after').forEach(function (el) {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  function onDragPointermove(event) {
    var d = dragState;
    if (!d) return;
    if (!d.active) {
      var dx = event.clientX - d.x;
      var dy = event.clientY - d.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return; // 阈值内：还算点击
      d.active = true;
      // 仅真拖拽时 capture；普通点击仍落在内部 TabsTrigger 按钮上。
      try { d.tag.setPointerCapture(event.pointerId); } catch (e) { /* window 监听兜底 */ }
      document.body.classList.add('tags-dragging');
      d.tag.classList.add('dragging');
    }
    event.preventDefault(); // 拖拽中不给默认行为（选字、原生拖放等）
    var under = document.elementFromPoint(event.clientX, event.clientY);
    var target = under && under.closest ? under.closest('.tag') : null;
    clearDropMark();
    if (target && target !== d.tag) {
      var rect = target.getBoundingClientRect();
      d.before = event.clientX < rect.left + rect.width / 2; // 左半插入其前、右半插其后
      d.target = target;
      target.classList.add(d.before ? 'drop-before' : 'drop-after');
    } else {
      d.target = null;
    }
  }

  /** 收尾：解绑窗口事件、去拖拽态，返回拖拽上下文（可能为 null） */
  function finishDrag() {
    unbindDragEvents();
    document.body.classList.remove('tags-dragging');
    clearDropMark();
    var d = dragState;
    dragState = null;
    return d;
  }

  function onDragPointerup() {
    var d = finishDrag();
    if (!d) return;
    d.tag.classList.remove('dragging');
    if (!d.active) return; // 未超阈值：不吞 click，让 TabsTrigger 正常切页
    suppressClick = true;  // 真拖拽：吞掉紧随的合成 click
    var from = tags.indexOf(d.page);
    var to = d.target ? tags.indexOf(d.target.dataset.page) : -1;
    if (from === -1 || to === -1) return; // 没落在别的页签上：顺序不变
    var insertAt = d.before ? to : to + 1;
    if (insertAt > from) insertAt -= 1; // 先删后插的下标修正
    if (insertAt === from) return;      // 原地放下：顺序不变
    tags.splice(from, 1);
    tags.splice(insertAt, 0, d.page);
    persist(); // 新顺序落盘，刷新后保留
    render();
  }

  function onDragPointercancel() {
    var d = finishDrag();
    if (d && d.active) d.tag.classList.remove('dragging');
    // pointercancel 不会跟合成 click，无需吞
  }

  /* ── 包装 window.showPage ─────────────────── */

  /**
   * 把包装器装到 window.showPage 与 wbApp.showPage 上。
   * app.js 是经典脚本，顶层 function 声明的全局绑定可以用 defineProperty
   * 无缝替换成访问器：app.js 里的裸调用 showPage(...) 与别处读
   * wbApp.showPage（搜索跳转等）从此拿到的都是包装器；对两者直接赋值
   * 也会被 setter 接住，当成新的原函数继续包 —— 谁都绕不出去。
   */
  function installWrapper() {
    if (installed) return true;
    var raw = typeof window.showPage === 'function' ? window.showPage
      : (window.wbApp && typeof window.wbApp.showPage === 'function' ? window.wbApp.showPage : null);
    if (!raw) return false; // app.js 还没跑（正常接线顺序不会发生），交给轮询重试
    rawHolder.fn = raw;

    function wrapped(name) {
      if (typeof name === 'string') record(name); // 先记页签，再调原函数
      if (typeof rawHolder.fn === 'function') return rawHolder.fn.apply(this, arguments);
    }

    try {
      Object.defineProperty(window, 'showPage', {
        configurable: true,
        enumerable: true,
        get: function () { return wrapped; },
        set: function (fn) { if (typeof fn === 'function' && fn !== wrapped) rawHolder.fn = fn; },
      });
    } catch (e) {
      window.showPage = wrapped; // 极老引擎退回普通赋值，至少 window 路径生效
    }

    if (window.wbApp) {
      try {
        Object.defineProperty(window.wbApp, 'showPage', {
          configurable: true,
          enumerable: true,
          get: function () { return wrapped; },
          set: function (fn) { if (typeof fn === 'function' && fn !== wrapped) rawHolder.fn = fn; },
        });
      } catch (e) {
        try { window.wbApp.showPage = wrapped; } catch (e2) { /* 忽略 */ }
      }
    }
    installed = true;
    return true;
  }

  /** 装包装器；若 app.js 未就绪则短轮询等它（最多约 8 秒） */
  function tryInstall() {
    if (installWrapper()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (installed || !installWrapper() && ++tries <= 80) return;
      clearInterval(timer);
    }, 100);
  }

  // 兜底：万一哪条路径绕过了包装器（比如别的脚本缓存了原函数引用），
  // 在捕获阶段记下侧栏导航点击。record 幂等，与包装器双触发无副作用。
  document.addEventListener('click', function (event) {
    var item = event.target.closest && event.target.closest('.nav-item[data-page]');
    if (item) record(item.dataset.page);
  }, true);

  /* ── 启动 ─────────────────────────────────── */

  /** 初始页签对齐：启动时的 showPage(…, {persist:false}) 发生在本脚本之前、
   *  包装器捕获不到，这里按「当前激活区块 > app.js 记忆」补记当前页 */
  function syncCurrent() {
    var stored = null;
    try { stored = localStorage.getItem(PAGE_KEY); } catch (e) { /* 忽略 */ }
    var activeEl = document.querySelector('.page.active[data-page]');
    current = normalize((activeEl && activeEl.dataset.page) || stored || HOME);
    if (tags.indexOf(current) === -1) tags.push(current);
    persist();
  }

  function start() {
    if (!buildDom()) {
      // .main 还不在（极端时序）：DOMContentLoaded 再试一次
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      }
      return;
    }
    syncCurrent();
    render();
    tryInstall();
    mountIsland();
  }

  // 兼容旧公共接口，并向 React 暴露同一份状态与动作。
  window.wbTagsView = {
    __shellTabsBridge: true,
    open: function (page) { page = normalize(page); record(page); go(page); },
    close: close,
    closeAll: closeAll,
    closeOthers: closeOthers,
    refresh: function (page) { go(normalize(page)); },
    toggleContentMax: toggleContentMax,
    list: function () { return tags.slice(); },
    getSnapshot: function () { return snapshot; },
    subscribe: function (listener) {
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    },
    setViewport: function (viewport) { scrollEl = viewport; },
    revealCurrent: revealCurrent,
  };

  start();
})();
