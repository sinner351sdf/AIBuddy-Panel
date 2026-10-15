/* 动态 data-tip 锚点的兼容控制器。
   保留图表节点、延迟/键盘/click-pin；气泡由 legacy-tooltips.tsx 的
   Tooltip / Popover 渲染与定位，不再创建手写浮层。 */
(() => {
  if (window.wbTooltip && window.wbTooltip.__componentBridge) return;
  /** 悬停进入 / 离开的延迟（ms）：进入慢一点防误触，离开快一点跟着走 */
  const SHOW_DELAY = 150;
  const HIDE_DELAY = 80;
  const BUBBLE_ID = 'wb-tip-bubble';

  /** 触摸设备没有悬停：只保留点击切换。判断一次即可，不必每次事件都查 */
  const CAN_HOVER = window.matchMedia('(hover: hover)').matches;

  /**
   * 内核是否支持 :focus-visible（用来区分键盘聚焦与鼠标点出的聚焦）。
   * 桌面端是 WebView2，支持是常态；这里仍做一次探测，
   * 万一不支持就退回「一律按键盘聚焦处理」，不至于因为选择器报错而整个组件失效。
   */
  const HAS_FOCUS_VISIBLE = (() => {
    try {
      document.createDocumentFragment().querySelector(':focus-visible');
      return true;
    } catch {
      return false;
    }
  })();

  /** 已增强的触发元素（避免重复绑定） */
  const registry = new WeakSet();

  let anchor = null;
  let pinned = false;
  let showTimer = 0;
  let hideTimer = 0;
  let host = null;
  const listeners = new Set();
  let snapshot = Object.freeze({ anchor: null, text: '', pinned: false, bubbleId: BUBBLE_ID });
  const sizeWatcher = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    if (anchor && entries.some(entry => entry.target === anchor && !entry.contentRect.width && !entry.contentRect.height)) close();
  }) : null;

  function publish() {
    snapshot = Object.freeze({ anchor, pinned, text: (anchor?.dataset.tip || '').trim(), bubbleId: BUBBLE_ID });
    listeners.forEach(listener => listener());
  }

  function describe(el, add) {
    const tokens = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(token => token && token !== BUBBLE_ID);
    if (add) tokens.push(BUBBLE_ID);
    if (tokens.length) el.setAttribute('aria-describedby', tokens.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  function mountIsland() {
    if (host && window.wbLegacyTooltips) window.wbLegacyTooltips.mount(host, window.wbTooltip);
  }
  document.addEventListener('wb:legacy-tooltips-ready', mountIsland);

  function cancelTimers() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = 0;
    hideTimer = 0;
  }

  /** 只发布同一个真实锚点；组件 Positioner 负责滚动追随、翻向与贴边。 */
  function open(el, pin = false) {
    if (!el?.isConnected || !(el.dataset.tip || '').trim()) return;
    cancelTimers();
    if (anchor && anchor !== el) close();
    anchor = el;
    pinned = pin;
    el.classList.add('active');
    describe(el, true);
    sizeWatcher?.disconnect();
    sizeWatcher?.observe(el);
    publish();
  }

  function close() {
    cancelTimers();
    if (!anchor) return;
    anchor.classList.remove('active');
    describe(anchor, false);
    anchor = null;
    pinned = false;
    sizeWatcher?.disconnect();
    publish();
  }

  /** 悬停进入：已经开着别的气泡时立即切换（用户显然在连着看说明），否则等满延迟 */
  function scheduleShow(el) {
    cancelTimers();
    if (anchor === el) return;
    const delay = anchor ? 0 : SHOW_DELAY;
    if (anchor) close();
    showTimer = setTimeout(() => { showTimer = 0; open(el); }, delay);
  }

  function scheduleHide(el) {
    clearTimeout(showTimer);
    showTimer = 0;
    // 点开的气泡是「读长说明」用的，鼠标移开不该把它弄没
    if (pinned) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      if (anchor === el && !pinned) close();
    }, HIDE_DELAY);
  }

  function bind(el) {
    el.addEventListener('pointerenter', () => { if (CAN_HOVER) scheduleShow(el); });
    el.addEventListener('pointerleave', () => { if (CAN_HOVER) scheduleHide(el); });

    el.addEventListener('focus', () => {
      // 鼠标 / 触摸点出来的聚焦不在这里展开：那一下紧接着会走 click 分支，
      // 两处都开会让「点一次」变成开-关-开。:focus-visible 正是
      // 「这次聚焦来自键盘」的语义，用它把指针路径让给 click。
      if (HAS_FOCUS_VISIBLE && !el.matches(':focus-visible')) return;
      cancelTimers();
      open(el);
    });

    // 焦点离开就收起：点开的常驻气泡也一样 —— 用户已经转移到别的控件上了
    el.addEventListener('blur', () => { if (anchor === el) close(); });

    el.addEventListener('click', () => {
      // 已经是「点开」状态就取消；否则切换过来（open 内部会先收掉上一个气泡，
      // 而收气泡会复位 pinned，所以 pinned 必须等 open 之后再立）
      if (anchor === el && pinned) { close(); return; }
      open(el, true);
    });

    el.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || anchor !== el) return;
      close();
      // 只掐掉默认行为（部分内核 Esc 会取消激活），不拦冒泡：
      // 弹窗自己也要用 Esc 关闭，这里吞掉会让用户以为卡住了
      event.preventDefault();
    });
  }

  function enhance(el) {
    if (registry.has(el)) return;
    if (!(el.dataset.tip || '').trim()) return;
    registry.add(el);
    // 小问号的「?」由组件补上，页面里只写空的 .tip-q 即可（与「业务 JS 零感知」一致）。
    // 用真实文本而不是 CSS content：读屏软件能把「?」连同 tooltip 语义一起念出来，
    // 字号与居中则由 css/tooltip.css 控制。
    if (el.classList.contains('tip-q') && !el.textContent.trim()) el.textContent = '?';
    // 键盘可达：本身能聚焦的元素（按钮 / 输入框 / 已带 tabindex 的）不重复补
    if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) el.tabIndex = 0;
    bind(el);


  }

  function bindGlobal() {
    // 点气泡与问号之外的地方收起。用捕获阶段，先于业务自己的 click 处理，
    // 保证「关提示」不会影响页面本来的点击行为。
    document.addEventListener('click', event => {
      if (!anchor) return;
      if (event.target === anchor || anchor.contains(event.target)) return;
      close();
    }, true);

    // 气泡是 fixed 定位、不跟随滚动。与下拉浮层不同，这里不关闭而是重新定位：
    // 读说明时滚动内容不该把气泡弄没；锚点被滚出视口才收起。
    const follow = () => {
      if (!anchor) return;
      if (!anchor.isConnected) { close(); return; }
      const rect = anchor.getBoundingClientRect();
      if (rect.width && rect.height && rect.bottom > 0 && rect.top < window.innerHeight) publish();
      else close();
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
  }

  /** 扫描一棵子树（含自身）里的 [data-tip] 并增强；批量插入时只调用一次 */
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches?.('[data-tip]')) enhance(root);
    root.querySelectorAll?.('[data-tip]').forEach(enhance);
  }

  function boot() {
    host = document.createElement('div');
    host.id = 'legacy-tooltips-host';
    document.body.appendChild(host);
    scan(document.body);
    bindGlobal();
    // 动态插入的 [data-tip]（弹窗、重新渲染的面板）由这个 observer 接住。
    // 与 select.js 一样按微任务合并：一次 innerHTML 里的多个节点只扫一遍。
    let queued = false;
    const pending = [];
    const observer = new MutationObserver(records => {
      // 锚点被整体移除时气泡得跟着收：它挂在 body 上，不会随宿主消失
      if (anchor && !anchor.isConnected) close();
      for (const record of records) {
        if (record.type === 'attributes') {
          enhance(record.target);
          if (record.target === anchor) {
            if ((anchor.dataset.tip || '').trim()) publish();
            else close();
          }
        }
        for (const node of record.addedNodes || []) {
          if (node.nodeType === 1) pending.push(node);
        }
      }
      if (!pending.length || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const batch = pending.splice(0, pending.length);
        for (const node of batch) scan(node);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tip'] });

    mountIsland();
  }

  window.wbTooltip = {
    __componentBridge: true,
    open, close,
    enhanced: el => registry.has(el),
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };

  // 与 select.js 同理：排在各业务模块之前时 DOM 可能还没解析完，按下 readyState 决定何时启动
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
