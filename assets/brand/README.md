# Agent2API · 品牌 Logo

黑白「B · 汇流」品牌资产，参见 [黑白版效果稿](concepts/2026-10-15-b-gateway-mono.png)，保留 [原 Logo 设计稿](concepts/2026-10-15-b-gateway-teal.png) 的图形。应用图标使用白底 **#FFFFFF** 与黑色图形 **#111111**，不使用渐变。

## 文件

| 文件 | 用途 |
|---|---|
| `logo-mark.svg` / `logo-mark-mono.svg` | 透明背景独立图形 / 白色单色图形 |
| `logo-icon.svg` / `png/logo-icon-{512,192,128,64,32}.png` | 应用图标、favicon、侧栏品牌区 |
| `favicon.ico`（16/32/48） | 浏览器标签页 |
| `logo-horizontal.svg` / `png/logo-horizontal@2x.png` | 横版字标，浅色背景（登录页、文档页） |
| `logo-horizontal-dark.svg` / `png/logo-horizontal-dark@2x.png` | 横版字标，深色背景 |
| `logo-stacked.svg`（dark 同理） | 竖版字标，图标在上文字在下 |
| `preview.html` | 深浅背景 + 侧栏/标签页场景预览（浏览器打开） |

## 用法

面板「设置 → 品牌」分区上传 `logo-icon-128.png`（侧栏/favicon）或 `logo-horizontal@2x.png`（登录页横幅）。
侧栏、登录页与标题栏共用 `desktop-tauri/ui/brand/logo-icon.svg`，浏览器图标使用 `brand/favicon.ico`。已保存的自定义品牌仍按设置生效。

Tauri 图标由同一份 SVG 生成 `src-tauri/icons/source.png`，再通过 `tauri icon` 派生。桌面程序的 Dock、托盘和安装包图标需重新打包后生效。

## 设计说明

- 图形：两条交织路径组成字母 B，留白表示多个 AI 服务汇聚到一个入口。生产 SVG 使用可编辑的 Bézier 路径。
- 应用图标：白色圆角方形搭配黑色图形；横版字标保留主标题与次级 Panel 两行文字，深底版本使用白色图形。
- 字标已转为矢量路径，交付文件不依赖设备字体；浅底文字 `#111111 / #666666`，深底文字 `#F7F7F7 / #BFBFBF`。

## 重新生成

```bash
npm --prefix assets/brand/generator ci
npm run build:icon
npm --prefix desktop-tauri ci
npm --prefix desktop-tauri run icon
```

依赖 `opentype.js`（文字转路径）与 `@resvg/resvg-js`（SVG 转 PNG）。生成器使用绝对路径，从任意目录运行均可；输出直接同步到品牌目录、网页目录和桌面图标源文件。

字标生成依次查找 `AIBUDDY_BRAND_FONT`、Windows Segoe UI Bold、macOS Arial Bold、Linux DejaVu Sans Bold。跨平台要求相同字形时，设置 `AIBUDDY_BRAND_FONT` 指向同一字体文件。所有 PNG、favicon 和桌面图标都从这套 SVG 派生。
