# AIBuddy-Panel → agent2api 移植报告

完成日期：2026-10-13。代码落在分支 `codex/merge-aibuddy-panel`，以 agent2api 3.0.1 为基础；提交记录见该分支 Git 历史，尚未推送或发布。本文与逐文件清单描述本次移植源码状态，源仓库文档中的“实测”“零警告”“已发布”等历史说法不代表本次验证结果。

后续发布修订：原分支保留为本地备份，清理 OAuth 硬编码凭据后的发布分支为 `codex/aibuddy-release`，来源、历史处理、环境变量配置及最新测试见 [RELEASE.zh-CN.md](RELEASE.zh-CN.md)。以下验证数字保留初次移植时的记录。

## 1. 对比范围与方法

| 来源 | 固定提交 | 版本 / 用途 |
|---|---|---|
| [agent2api](https://github.com/aimod-cc/agent2api) | `fd869a4610859f4690c307ad9e8b0e16d51e1058` | 上游 3.0.1，移植目标 |
| [AIBuddy-Panel](https://github.com/sinner351sdf/AIBuddy-Panel) | `31ec0379c827963330b4d8b58b729804fdae715c` | 分支 2.14.0，功能来源 |
| agent2api 推定基线 | `ea1cc0387edca31d5729cc9303c04cfe6bb1daa8` | 2.9.0，内容匹配基线 |
| AIBuddy-Panel 初始快照 | `13fee59fa520416a641809027d47ababa1de0a7c` | 2.10.0，分支根提交 |

两仓库历史没有共同 Git 祖先，不能把普通 `merge` 或逐提交 `cherry-pick` 当作可靠方案。遍历上游历史并比较文件 blob，推定基线与分支初始快照有 547 个相同路径、相同内容的文件，高于次优候选的 544 个。这是内容相似性证据，并非已证明的分叉关系。

对两个固定 HEAD 做完整树比较，共有 **671 个路径不同**（不折叠重命名），见 [head-comparison.tsv](head-comparison.tsv)。这包含上游后来新增的功能，不能全部当成 AIBuddy 改动。以推定基线提取分支净变化，共 **226 个路径**，逐一应用、适配、保留或归档，见 [FILES.zh-CN.md](FILES.zh-CN.md)。另核对了分支从根到 HEAD 的 **35 个提交**，见 [COMMITS.zh-CN.md](COMMITS.zh-CN.md)。历史中先改坏、后修复的同一处最终按分支 HEAD 状态处理。

实现采用“基线 / 新上游 / 分支”的三方内容合并，再适配新上游接口、模块布局、鉴权与桌面桥接。旧分支缺少的上游文件没有据此删除。CodeGraph 已按用户授权建立，用于结构定位；索引不进入版本控制。

可复核材料：

- [file-inventory.json](file-inventory.json)：226 条路径的三个源 blob、处理方式、落地路径及最终 SHA-256。
- [fork-from-baseline.patch.gz](fork-from-baseline.patch.gz)：完整原始差异，包含二进制素材和未默认启用的品牌变化；可解压审阅，不应直接覆盖当前工作区。
- [source-commits.txt](source-commits.txt)：原始提交编号、时间与标题。
- [AIBUDDY-CHANGELOG.md](AIBUDDY-CHANGELOG.md)、[AIBUDDY-PITFALLS.md](AIBUDDY-PITFALLS.md)：源文档原文归档。

## 2. 已应用的功能、修复与配置

路径在本节以 `desktop-tauri/` 为相对根；Rust 的 `server/` 指 `src-tauri/server/src/server/`。

| 类别 | 已应用的具体改动 | 主要落地位置 |
|---|---|---|
| 管理外壳 | 侧栏分组折叠、移动端抽屉、面包屑、页脚、内容区全屏、Lucide 风格图标 | `ui/index.html`、`ui/icons.js`、`ui/css/shell.css`、`mobile.css` |
| 偏好 | 深浅/跟随系统主题、主色与菜单样式、三档密度、Logo/面包屑/页脚开关、背景/高亮、偏好抽屉、浏览器本地锁屏 | `ui/js/prefs.js`、`ui/css/prefs.css`、`ui-kit/styles/theme.css` |
| 页签 | 多页签、拖拽排序、右键刷新、关闭其他/全部、当前页全屏、状态持久化 | `ui/js/tags-view.js`、`ui/css/tags-view.css` |
| 登录与用户菜单 | 登录主题切换、密码显隐、弹出式授权窗口、账号密码修改、退出登录 | `ui/login.html`、`ui/js/user-menu.js`、`src-tauri/src/bridge.rs`、`src-tauri/server/src/web_shim.rs`、`server/api/panel.rs` |
| 自定义品牌 | 可保存标题与 Logo；登录前公开读取外观；浏览器/桌面共用品牌加载；新增源品牌素材与生成脚本 | `server/api/branding.rs`、`ui/js/branding.js`、`ui/brand/`、根目录 `assets/brand/` |
| 账号池 | 汇总状态条、凭据临期提示、单账号连通性测试、Cline API Key 列表与删除 | `ui-islands/src/islands/accounts-*.tsx`、`server/api/account_test.rs`、`server/core/providers/cline/keys.rs` |
| 探活 | 周期检测、失败阈值、自动禁用与告警、手动运行 | `server/api/probe_api.rs`、`server/core/probe.rs` |
| Key 配额 | 每 Key Token 额度、有效期、已用/剩余量、重置、推理入口拦截、流式/非流式收尾计量 | `server/core/key_quota.rs`、`api/key_quota_api.rs`、`api/pipeline.rs`、`core/api_keys.rs`、`core/key_scope.rs` |
| Key 接入 | 接入二维码、复制快捷信息、客户端配置示例、Codex 状态检查及配置写入 | `ui-islands/src/islands/keys-page.tsx`、`docs-page.tsx`、`server/api/codex_api.rs` |
| 报表与日志 | CSV 导出、自动刷新、网关健康/运行时长、日志级别筛选、审计浏览、任务倒计时 | `ui-islands/src/islands/report-page.tsx`、`logs-panel.tsx`、`tasks-panel.tsx`、`server/api/health.rs`、`audit_api.rs` |
| 通知与告警 | 顶栏通知中心、已读/分类、渠道增删改/测试、账号异常告警、静默时段；105 种类型的前后端注册与 HTTP 发送实现 | `ui/js/notify-center.js`、`ui-islands/src/islands/settings-model.ts`、`server/api/notify_api.rs`、`core/notify.rs` |
| 会话 | 会话列表、撤销其他会话、禁止撤销当前会话、密码修改时清理其他会话 | `server/api/sessions_api.rs`、`api/panel.rs`、`access.rs` |
| 维护与退出 | 维护开关阻止新的网关请求、保持管理/健康入口可用；受保护的关闭进程入口及确认界面 | `server/api/maintenance_api.rs`、`shutdown_api.rs`、`http.rs` |
| 备份 | 配置及账号 JSON 导出/导入确认、整库 SQLite 快照、定时备份与保留份数 | `server/api/backup_api.rs`、`server/core/backup.rs` |
| 远程同步 | 远程面板连接及账号同步界面 | `ui-islands/src/islands/settings-remote-sync.tsx` |
| 积分构成 | 独立页面，按账号/积分包显示总额、已用、剩余、到期时间；改走逐包明细端点 | `ui-islands/src/islands/credits-page.tsx`、`server/api/accounts_usage.rs`、`core/usage_query.rs` |
| WorkBuddy 成长任务 | 任务查询/上报、GLM 对话、技能/专家/夜猫子等动作，串行任务间隔、并发队列、旅行任务、连登管家、礼包/补偿/试用、调度配置 | `server/api/growth_tasks.rs`、`core/growth_{actions,queue,schedule}.rs`、`core/billing/{growth,report,expert,travel,streak,gift,trial}.rs`、`core/providers/workbuddy/growth.rs` |
| 签到 | “今日已签到”按正常状态展示；保留新版对 HTTP 400/409 与错误正文的细分识别 | `server/core/billing/checkin.rs`、`request.rs`、账号页面 |
| Embeddings | `/v1/embeddings` 专用透传、Key 权限/额度校验、用量入账、鉴权失败刷新重试 | `server/api/embeddings.rs`、`http.rs` |
| 小修复 | 运行时长调用路径、通知埋点变量作用域、成长任务/旅行/embeddings 编译问题、未使用导入；CatPaw 注释与 ZCode 凭据路径说明、重复 Accept 头清理 | 相应 Rust 模块，逐文件及逐提交清单可定位 |
| 构建发布 | GHCR owner/repository 小写化；手动发布版本号；版本与 v 前缀双标签；版本号必须与检出源码一致 | `.github/workflows/docker.yml` |
| 依赖与构建产物 | 合并 `qrcode` 与 TypeScript 类型依赖和锁文件，保留新版依赖基线；重新构建 UI JS/CSS | `ui-islands/package*.json`、`ui/islands/ui.{js,css}` |

新增配置与持久化要点：

- Key 条目增加 `quotaTokens` / `expiresAt`；计量保存在保留 KV `keyQuotaUsage`。其他新增状态包括审计、品牌、通知、探活、维护和备份设置；保存普通配置不会清掉对应的保留状态。
- 成长调度默认全部关闭。配置中的缺省时点为成长任务 01:00、旅行 09:00/21:00、夜猫子补跑 23:00，连登处理接在签到之后；启用后按服务进程时区运行。
- 定时 SQLite 备份默认关闭、每日一次、默认留 7 份，可设 1–90 份。探活和通知需按部署实际配置；没有配置渠道时不会发送通知。
- 浏览器偏好沿用分支 `aibuddy-prefs` 等本地存储键，保留上游语言与主题兼容读取；它们不等于服务器配置。

## 3. 为保留上游功能所作的适配

1. **保留 3.0.1**：没有回退为分支 2.14.0；保留原 crate、二进制、Tauri 应用身份、环境变量、`agent2api.db` 及上游更新源。旧分支的纯改名、应用图标/旧截图替换记录在清单和原始补丁中；新增品牌素材可用于自定义。默认登录仍显示 Agent2API。
2. **保留新版能力**：现有提供商及国际区路由、多语言、签到中心、系统代理策略、诊断字段、`is_test`、登录多来源凭证和刷新机制、最后一把可用 Key 的删除保护均沿用新版实现。
3. **适配 WorkBuddy 模块拆分**：旧分支单文件里的增长相关实现迁入新目录中的 `growth.rs`，保留新版 `mod.rs` 与国际区处理。
4. **补齐鉴权**：源分支新增管理路由中有一部分挂在公开路由组，本次将审计、配额、通知、会话、备份、维护、密码修改、关机放入受保护路由组。仅品牌外观 GET 保持公开供登录页使用。
5. **统一桌面调用**：新增 `ui-islands/src/islands/local-api.ts`；配额、Codex、通知、备份等操作经桌面 `api_request` 桥接，浏览器沿用 Web shim 的登录刷新。修复直接同源 fetch 在 Tauri 自定义协议下失效的问题。为品牌增加原生桥接；修复网页更新结果被重复解包。
6. **兼容新接口契约**：配额 ID 贯穿各协议及记账路径；适配新增 `TransportRequest.system_proxy_when_unset`、`BillingSpec.base` 等字段；探活尊重适配器系统代理，并跳过缺少账号模型刷新能力的有状态提供商，避免误禁用。
7. **会话身份一致**：当前会话识别复用新版所有授权来源与有效期校验，修复仅通过 Header 登录时“撤销自己”保护失效。
8. **旧快照兼容**：JSON 导入同时接受 `agent2api-backup` 与 `aibuddy-panel-backup` 的格式版本 1；导入后重新加载配置、维护状态及认证相关状态。
9. **Codex 模板修复**：生成 `wire_api = "responses"`，配置 `requires_openai_auth = true` 配合 `auth.json`，并为 TOML 转义增加测试。依据 [OpenAI 官方配置参考](https://developers.openai.com/codex/config-reference/)；没有写入开发者真实的 Codex 配置。
10. **限制成长凭据范围**：礼包/试用入口先验证是 WorkBuddy 账号，再检查版本，阻止其他提供商凭据进入 WorkBuddy 请求。
11. **窄屏可用性**：375px 下 Key 表格采用容器内横向滚动和最小列宽，修复额度等多列互相覆盖；隐藏挤占顶栏的状态块。见 [移动端验证截图](mobile-key-review.png)。
12. **纠正文案**：额度说明改为请求准入与事后计量；备份显示“格式版本”；关机明确提示中断在途请求与容器重启策略，避免承诺没有实现的即时撤销/平滑退出。

这些是功能合并，不是逐字覆盖。身份替换、旧版本降级、旧文档覆盖和分支专用更新地址未作为默认行为应用；完整原始变更仍在归档内。`accounts-data.ts` 与 `page-accounts.css` 的相应变化已由新版上游覆盖。

## 4. 必须留意的兼容性与限制

| 事项 | 实际行为 / 影响 |
|---|---|
| 数据文件 | 继续使用 `agent2api.db`，不会自动寻找 `aibuddy-panel.db`。从 AIBuddy 搬迁可使用已兼容的 JSON 快照；整库恢复须停进程并使用一致 SQLite 备份，不要直接覆盖正在写入的 WAL 数据库。 |
| JSON 导入 | 是配置与账号整体替换，不是增量合并；包含账号凭据、管理认证状态等敏感信息。日志/请求记录不属于 JSON 导入范围，整库 SQLite 备份才包含全部表。跨版本导入后应重启并核对提供商、区域和任务设置。 |
| 配额 | 按实际返回 usage 事后累计；并发或最后一个大请求可超出上限，计量数据库不可用时源实现会放行。环境变量 Key 没有持久 ID，不参与逐 Key 计量。改额度不会终止已经开始的请求。它不能充当严格的预付费结算。 |
| 管理权限 | 延续上游管理 API 鉴权模型，网关 API Key 仍可能具有管理访问能力；新增额度不会把系统变成租户隔离平台。不要把普通 Key 当作受限管理账户。 |
| 成长/积分 | 分支主要面向 WorkBuddy 国内版，积分构成页仅处理相应账号；国际版仅适用明确支持的入口（如试用）。成长动作会真实写上游、可能消耗积分或改变权益，默认调度关闭。 |
| Embeddings | 仅按源实现分派到小浣熊/OpenClaw；不代表所有提供商均支持。没有聊天链路同等的 429 轮换、排队与退避预算；上游是否开放此接口仍需实际验证，不把源码注释视为服务端支持保证。 |
| 通知 | 105 种类型完成源码集成，不等于 105 个外部服务已联调。源分支未实现 SMTP/Web Push/Apprise/Nostr/aliyun-sms；渠道 URL、模板和认证仍须按相应服务配置，部分服务可能收费。 |
| 远程同步 | 需要目标面板地址和凭据，浏览器受 CORS 与 HTTPS→HTTP 混合内容限制；应先确认目标面板版本和数据合并行为。没有用真实远程账号测试。 |
| Codex 一键配置 | 写的是运行服务的主机用户目录；Docker 部署不会替浏览器所在电脑配置。会覆盖 `config.toml` / `auth.json` 并保存 `.bak`，反复写入只保留相应上一份备份；复杂 MCP/项目配置需先另存。 |
| 关机 | 实现为延迟约 500ms 后 `process::exit(0)`，没有排空在途请求；Docker/systemd 重启策略可能拉起进程。需要暂停接入时优先使用维护模式。 |
| 本地锁屏 | 只限制当前浏览器界面，可清本地存储解除，不是服务端认证或权限边界。 |
| 多语言与品牌 | 上游语言包保留；分支新增文案有未翻译的中文。分支默认横版字标、应用身份和旧截图没有替换上游默认标识；新增素材仍可手工选择。品牌生成脚本原有 Windows 字体路径，macOS/Linux 重新生成前须调整字体。 |
| 发布升级 | 保留上游更新源意味着未来官方安装包升级可能覆盖这些本地功能；发布自有发行版时应另行设置更新地址。没有推镜像/Release，也未移植文档声称但源工作流未实际实现的额外发布流程。 |
| 依赖 | npm 安装曾报告两个 UI 包依赖树各有 8 / 1 个 high 级审计项，可能重叠；未运行自动破坏性升级，未将本次移植等同于依赖漏洞已清零。Rust macOS 检查仍有 5 条既有 Kuku Windows 引擎 dead_code 警告。 |

## 5. 验证结果与复现

机器可读的结果摘要见 [validation.json](validation.json)；HTTP 回归实现见 [scripts/test-aibuddy-port.py](../../scripts/test-aibuddy-port.py)。

| 检查 | 结果 |
|---|---|
| Rust 服务端全套测试 | **397 通过，0 失败，6 忽略**；另 1 个文档测试忽略 |
| Tauri 桌面 `cargo check` | 通过；未启动真实桌面窗口，未制作安装包 |
| headless `cargo build` | 通过 |
| UI TypeScript + Vite 构建 | 通过，合并后的 JS/CSS 已生成 |
| 原生 JS、桥接脚本语法与 diff 空白检查 | 通过 |
| 新增隔离 HTTP 回归脚本 | **111 项断言通过**；仅本机临时数据库与 mock 上游 |
| 浏览器检查 | 登录、品牌标题、积分页、任务页、备份/会话设置、Key 配额弹层及 375×812 窄屏检查；移动端表格修复后复核 |

HTTP 回归覆盖：未注册/已注册两种状态的新增路由鉴权；Header 会话识别与撤销；旧 Key PATCH 与最后 Key 保护；额度字段更新原子性、有效期、多协议入口；维护模式；两种备份标识的导入、配置恢复及 SQLite `integrity_check`；新静态资源可访问；mock 上游非流式/流式响应、usage=5 的准确单次记账、达到配额后的拒绝且不请求上游；拒绝把其他提供商账号用于礼包/试用。

在仓库根运行：

```sh
cargo test --manifest-path desktop-tauri/src-tauri/server/Cargo.toml
cargo check --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo build --manifest-path desktop-tauri/src-tauri/server/Cargo.toml
npm run build --prefix desktop-tauri/ui-islands
python3 scripts/test-aibuddy-port.py
git diff --check
```

测试进程需要绑定本机回环端口。受限沙盒下的 socket 权限错误与业务回归不同；上述结果来自允许回环端口的本地运行。脚本设置临时数据目录，关闭计划任务，不读取真实账号库、不发送外部通知、不触碰真实 Codex 配置。

验证支持“本次已覆盖的原有行为未出现回归”，不能证明所有外部提供商长期可用。尚未做真实账号成长任务、105 种渠道发送、真实远程同步、Windows/Linux 安装包与容器多架构构建、生产数据导入或服务发布；这些应在对应环境使用测试账号完成验收。
