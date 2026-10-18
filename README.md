# AIBuddy Panel · 多提供商 AI 网关

基于 [agent2api](https://github.com/Agent2API/agent2api) 的定制版本。当前源码整合上游 **3.1.0**（`072e3c7`，beta 整合中），保留 AIBuddy Panel 品牌、账号池、任务中心、本地 AI 助手与数据策略。

**简体中文** | [English](docs/README.en.md) | [繁體中文](docs/README.zh-Hant.md) | [日本語](docs/README.ja.md) | [한국어](docs/README.ko.md) | [Português (BR)](docs/README.pt-BR.md)

将多家 AI 客户端账号及预置／自定义 API 提供商接入统一的 OpenAI 兼容网关，提供多账号池、模型路由、代理、余额与请求报表。

## 安装方式

- **Windows / macOS**：从[本仓库 Releases](https://github.com/sinner351sdf/AIBuddy-Panel/releases)下载对应安装包。macOS Universal 同时包含 Apple Silicon 与 Intel；未签名／公证状态以每次 Release 说明为准。
- **Linux 桌面端**：本次已接入 deb / AppImage 构建和更新识别。仅在对应 Release 附件实际出现后下载；macOS 源码检查不等于 Linux 实机安装验收。
- **服务器 / 容器**：沿用本仓库现有私有 GHCR 镜像及访问权限。Linux amd64 / arm64 服务端包用于无 GUI 部署与容器原地更新，和 deb / AppImage 用途不同。
- **源码运行**：安装 Rust、Node.js 和依赖后运行 `sh scripts/start-local.sh`，默认面板为 `http://127.0.0.1:3065`，运行数据位于 `data/local/`。

## 接入客户端

在面板的「网关 Key」中创建 Key，在客户端填写：

```text
Base URL: http://127.0.0.1:3065/v1
API Key: 面板创建的网关 Key
```

在「接入文档」查看 Chat Completions、Responses、Messages 端点和模型映射。账号池可添加桌面登录态、凭证文件、预置 API 或自定义提供商；具体登录方式与能力以提供商为准。

## 手机端与 Agent

- 移动网页 / PWA：访问网关的 `/m.html`，应用名称与图标使用 AIBuddy Panel。PWA 安装需要浏览器支持的安全上下文。
- Android：在 GitHub Actions 的 `android` 工作流生成测试 APK 和未签名 Release APK。本机保留独立正式签名，不上传私钥。debug 使用独立 `.debug` 包名，不能当作正式签名版本覆盖升级。
- Agent：读取网关所在机器的 AI 客户端配置；写入需管理员会话、明确选择网关 Key 和手动确认。备份失败停止写入，Gemini 配置与 `.env` 一起备份还原，预览隐藏凭据。
- 旅行和成长任务共用原有持久化队列，保留已有开关；批量签到后自动补签、兑换档位并使用已有抽奖次数。

## 已保留的 3.0.8 定制能力

- Accio ADK v2：补齐登录会话、SecurityGuard 桥接、ID 与上下文、工具历史恢复、图片解析、条件 gzip、完整 SSE event 与脱敏诊断。
- 小浣熊、CatPaw、Cline 凭据文件导入；KukuAI Cookies SQLite 文件导入。
- 智谱清言访客／令牌／桌面凭据接入，访客无积分和签到权益。
- OrcaTerm 官方 OAuth 扫码与自定义协议回调，CodeArts 可选内嵌窗口或系统浏览器授权。
- 开发者角色兼容开关、Cline Pass 预置模板、ZCode 上游端点映射。
- Antigravity 多轮工具签名与分窗口额度修复，Loomy 按模型图片能力适配。
- 报表窄列查询、缓存窗口 SQL 聚合、异步线程隔离和索引；代理监听器双向对账。
- 可选 beta 更新通道、Linux 桌面包和更新识别，预发布不移动正式镜像 latest。

## 文档与支持

[详细改动与验证](docs/aibuddy-port/CHANGE-SUMMARY-20261017.md) · [Accio SDK 配置](docs/aibuddy-port/ACCIO-SECURITY-GUARD.md) · [完整部署／升级／回滚说明](docs/README.zh-CN.md) · [本轮同步审查](docs/aibuddy-port/upstream-3.0.8/README.md) · [更新记录](CHANGELOG.md) · [任务中心](docs/workbuddy-task-center/README.zh-CN.md)

按用户选择保留[上游赞赏与社群入口](docs/SPONSOR.md)及代理页面的 ProxyLane 家庭宽带介绍；这些入口明确属于上游与赞助方。

升级前备份数据库与 `account.key`。本轮本地 schema 升至 17，仅新增报表索引，保留助手历史、账号归属和原有正文／保留策略；较旧程序不能读取新版数据库时应使用升级前备份。
