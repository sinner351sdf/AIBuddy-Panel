/* Agent2API · 自定义标题栏（桌面端） */
/* global workbuddyDesktop, wbIcons, wbI18n */

/**
 * 主窗口的自绘标题条（32px 高，与界面同一套配色 —— 由本脚本动态创建）。
 * 两种形态按平台走：
 *   · Windows / Linux —— 系统装饰在建窗处去掉（decorations(false)），
 *     标题条自带左侧品牌 + 右侧最小化 / 最大化(还原) / 关闭三键；
 *   · macOS —— 系统装饰保留、标题栏设为透明叠加（TitleBarStyle: Overlay，
 *     见 lib.rs 建窗处），红/黄/绿三颗圆点由 AppKit 画在左上角并盖在本条
 *     之上，所以本条**不画三键**，只在左边让出它们占的那一段（左边距里
 *     还包着「让标题紧挨红绿灯右侧」这件事，见 layout.css 的 .is-macos）。
 * 形态参考 OmniProxy 的 TitleBar.tsx（Electron + antd 版）。
 *
 * ── 平台形态（见下面 isMac）──────────────────────────────
 * 平台取桥接层注入的 platform（壳的编译目标，bridge.rs 文件头有为什么
 * 不嗅探 UA），判断口径只有这一处。macOS 分支只落在「让位 + 少了三键」
 * 上，CSS 侧每条规则都带 .is-macos 前缀（见 layout.css），Windows /
 * Linux 的 DOM 与样式逐字不变。
 *
 * macOS 上这些能力是系统的，不是我们画的：长按绿灯进分屏、全屏 Space、
 * 窗口圆角与投影、**失焦自动变灰**、按住 Option 的绿灯缩放，以及「双击
 * 标题栏」跟随系统偏好（那一项可设成最小化 / 缩放 / 不响应）。代价是
 * 三键的视觉不受我们控制，且拖动仍要靠 data-tauri-drag-region —— Overlay
 * 下系统标题栏不接管拖动（见文件末「拖动 / 双击最大化」）。
 *
 * ── 为什么由脚本动态创建，而不是写死在 index.html 里 ─────────
 * 网页版（headless 托管面板）没有应用窗口，标题栏不该出现。动态创建
 * 让网页版零痕迹（连 DOM 都不建），body 布局也不用为它预留占位 ——
 * 桌面端创建时才给 body 挂 .has-titlebar，.shell 的高度随之少一行标题栏
 * （见 layout.css）；网页端没有这个 class，布局保持 100vh 不变。
 *
 * ── 渲染守卫（两层，缺一不渲染）───────────────────────────
 * 1. 平台：桥接层注入的 platform 是壳的编译目标（'windows' / 'macos' /
 *    'linux'），网页 shim 注入 'web' —— 与 settings-panel.js 裁剪
 *    「面板登录」的判断同一口径；缺字段（桥未就绪的异常形态）同样不动。
 * 2. 方法：三键方法在桥里缺失（旧壳）时不渲染，避免摆出一排点了没反应
 *    的按钮。**只对 Windows / Linux 成立**：macOS 的三键是系统的，不依赖
 *    桥里这几个方法；反过来那边更不能不渲染 —— 系统红绿灯总会画在窗口
 *    左上角，少了这条让位的标题条，它们就会压在侧栏内容上。
 *
 * ── 三键的调用路径（Windows / Linux）──────────────────────
 * 全部走 window.workbuddyDesktop（bridge.rs → commands.rs 的四个窗口命令），
 * 与其余功能同一封装。其中「关闭」发出 CloseRequested，与点系统关闭按钮
 * 同语义：「关闭到托盘」开启时被壳拦成隐藏（托盘继续转发），否则正常退出。
 *
 * ── 最大化状态如何保持同步（Windows / Linux）──────────────
 * 初始化查一次 windowIsMaximized；此后订阅 onWindowResize（Tauri 的内置
 * 事件 tauri://resize，最大化 / 还原 / 拖拽缩放都会发出）重查 —— 双击标题栏
 * 切最大化走的是 Tauri 的原生行为（不经按钮），靠这条也能追上。
 * 这套在 macOS 上不接：那边没有自绘的图标要同步（系统红绿灯不表达缩放
 * 状态）。
 *
 * ── 拖动 / 双击最大化 ─────────────────────────────────────
 * 标题条上声明 data-tauri-drag-region 即可（Tauri 2 内建，无需 JS）：core
 * 脚本监听 mousedown，目标元素带该属性才拖动（子元素不带不拖），双击切
 * 最大化。品牌区整体 pointer-events:none（layout.css），让按下时的 target
 * 始终落回标题条本身。macOS 同样靠这条拖动（Overlay 下系统标题栏不接管）；
 * 双击的语义 Tauri 在 mac 上特意做成「抬手才算，中途移开就取消」，贴近
 * 系统的交互习惯（见 tauri 的 window/scripts/drag.js）。
 */
(() => {
  const bridge = window.workbuddyDesktop;
  if (!bridge) return;
  // 守卫一：平台标识（见文件头「渲染守卫」）
  if (!bridge.platform || bridge.platform === 'web') return;
  const isMac = bridge.platform === 'macos';
  // 守卫二：三键方法齐备才渲染（只对 Windows / Linux，理由见文件头）
  if (!isMac && (typeof bridge.windowMinimize !== 'function'
    || typeof bridge.windowToggleMaximize !== 'function'
    || typeof bridge.windowClose !== 'function')) return;

  // ── 组装 DOM：header 挂在 body 最顶部，sidebar / main 之外整宽一条 ──
  const bar = document.createElement('header');
  // macOS 那条形态（左边让出系统红绿灯占位）挂在 is-macos 上
  bar.className = isMac ? 'titlebar is-macos' : 'titlebar';
  // 拖动与双击最大化：Tauri 2 内建支持，声明属性即可（见文件头说明）
  bar.setAttribute('data-tauri-drag-region', '');

  // 品牌区（图标复用 icons.js 的 brand，与侧栏品牌区 / 应用图标同一造型）：
  // 在 Windows / Linux 上是标题条的最左侧，在 macOS 上落在系统红绿灯右侧
  // （那条左内边距就是为它们留的）。
  // 文案取自桥接层注入的 title —— 与窗口标题、托盘提示同一份（开发版带
  // "Dev" 标记，两个实例同时跑时一眼能分清）；旧壳没注入时回落到发布版文案。
  const appTitle = bridge.title || wbI18n.t('Agent2API · 多提供商本地网关');
  const brand = document.createElement('div');
  brand.className = 'titlebar-brand';
  brand.innerHTML =
    (window.wbIcons ? wbIcons.icon('brand', 16) : '')
    + `<span class="txt">${appTitle}</span>`;
  // document.title 也跟上（窗口标题由壳设置，这条只影响网页语义：
  // 任务栏悬停预览、无障碍，以及将来可能有的网页版）
  document.title = appTitle;

  // macOS 到此为止：三键是系统的（见文件头「平台形态」），本条只有品牌区
  if (isMac) {
    bar.append(brand);
  } else {
    // React owns all three Buttons and their Tooltip/maximum-state content.
    const actions = document.createElement('div');
    actions.id = 'titlebar-window-controls';
    actions.className = 'titlebar-actions';
    bar.append(brand, actions);
    window.wbWindowControls?.mountTitlebar(actions);
  }

  document.body.insertBefore(bar, document.body.firstChild);
  // 布局随标题栏让位（.shell 高度少一行，见 layout.css）
  document.body.classList.add('has-titlebar');
})();
