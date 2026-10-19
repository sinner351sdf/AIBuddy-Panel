/*
 * Shared panel Service Worker. Source copied to ui/sw.js by the Web build.
 * The complete panel and old /m aliases share one entry. API traffic is never cached.
 * A deterministic content hash versions the cache; activation removes only our caches.
 * Waiting updates require an explicit SKIP_WAITING message to preserve in-progress forms.
 */

const CACHE = 'agent2api-mobile-e72f51aedf93'

/** 预缓存的外壳文件（相对 SW 所在目录，即 `ui/` 根） */
const SHELL = [
  './index.html', './m.html', './web-mobile-entry.js',
  './islands/ui.js', './islands/ui.css', './css/mobile.css',
  './m/manifest.webmanifest', './assets/app-icon-192.png', './assets/app-icon-512.png',
]

/** 这个请求属不属于手机端（决定要不要拦） */
function isMobileAsset(pathname) {
  if (['/', '/index.html', '/m', '/m/', '/m.html'].includes(pathname)) return true
  return /^\/(css|islands|assets|brand|i18n|m)\//.test(pathname) || /^\/[^/]+\.(js|css)$/.test(pathname)
}

/** 是不是入口页导航（`/m` 或 `/m.html`，含 query / hash 之外的路径部分） */
function isEntryNavigation(request, url) {
  if (request.mode !== 'navigate') return false
  return ['/', '/index.html', '/m', '/m/', '/m.html'].includes(url.pathname)
}

/**
 * 预缓存一个文件。
 *
 * 不用 `cache.add` 是因为它会**跟随重定向**：未登录时 `/m.html` 会 302 到
 * `/login`，`cache.add` 会把那张登录页存成入口页 —— 之后离线打开就是登录页。
 * 这里显式取一次，跟随了重定向的响应直接丢弃（留给下次在线访问时再存）。
 */
async function precache(cache, item) {
  try {
    const response = await fetch(item, { cache: 'no-store' })
    if (response.ok && !response.redirected) await cache.put(item, response)
  } catch {
    /* 单个文件失败不影响其余（比如图标缺失） */
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 逐个而不是 addAll：任何一个文件缺失不该让整次预缓存失败
      .then(cache => Promise.all(SHELL.map(item => precache(cache, item))))
      .then(() => {
        // 不在这里 skipWaiting：等页面决定何时切换（见 message 分支）
      }),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('agent2api-mobile-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

/**
 * 页面发来的消息。
 *
 * `SKIP_WAITING`：用户点了「重启以更新」。新 SW 立刻接管，页面随后自己
 * reload 拿到新外壳。
 */
self.addEventListener('message', event => {
  const data = event.data
  if (data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // 仅处理面板静态资源，接口不进入缓存
  if (!isMobileAsset(url.pathname)) return

  // 入口页：network-first，离线回退缓存
  if (isEntryNavigation(request, url)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // 只缓存「直接命中」的响应。会话过期时服务器会 302 到 /login，
          // fetch 跟随重定向后拿到的是一张 200 的登录页 —— 存进入口页缓存
          // 的话，下次离线打开看到的就是登录页（而离线根本登不了）。
          if (response.ok && !response.redirected) {
            const copy = response.clone()
            void caches
              .open(CACHE)
              .then(cache => cache.put(url.pathname.startsWith('/m') ? './m.html' : './index.html', copy))
              .catch(() => undefined)
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(url.pathname.startsWith('/m') ? './m.html' : './index.html')
          if (cached) return cached
          // 连外壳都没有（首次访问就断网）：给一句可读的话，别让浏览器报网络错误
          return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<body style="font:15px/1.7 -apple-system,system-ui,sans-serif;padding:40px 24px;color:#333">' +
              '<h1 style="font-size:18px;margin:0 0 8px">离线</h1>' +
              '<p style="margin:0;color:#666">连不上网关。确认手机与网关在同一局域网，然后刷新。</p>' +
              '</body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }),
    )
    return
  }

  const isShell = SHELL.some(item => url.pathname.endsWith(item.slice(1)))
  if (isShell) {
    // 外壳：stale-while-revalidate —— 首屏秒开，后台拉新版留给下次
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request)
        const network = fetch(request)
          .then(response => {
            if (response.ok) void cache.put(request, response.clone())
            return response
          })
          .catch(() => cached)
        return cached || network
      }),
    )
    return
  }

  // 手机端其余资源：network-first，离线时回退缓存
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      throw new Error('offline')
    }),
  )
})
