# Accio ADK 链路复核：2026-10-17

> 这是修复前的审查快照，保留当时的发现和运行证据。随后已修复的字段、恢复和隔离缺口，以及仅本地验证的范围，见[会话链路修复与本地验证](ACCIO-SESSION-LOCAL-VALIDATION-20261017.md)。本文的“缺失 / 不完整”描述对应审查时版本。

## 结论

当前实现接入了官方桌面版 ADK 的推理协议和 SecurityGuard 原生调用，但没有完整复现官方账号会话、授权上下文及错误恢复链路。原生模块加载、生成请求头、少量请求成功，不能证明客户端行为与官方一致，也不能证明风控放行或长期安全。

用户在本次审查中确认：同一账号在官方也不能正常回复，并明确显示账号限制、风控或封禁提示。这是用户提供的账号限制证据；本轮没有取得官方后台的具体处罚原因或触发规则，不能认定某个缺失字段或某次请求就是触发原因。

本轮只读检查源码、数据库记录、日志、重启前备份中的凭证元数据，以及官方已安装程序的静态代码。没有恢复已删除账号、使用已删除账号凭证发请求、继续对受限账号探测，或重启服务。

## 运行证据（北京时间）

| 时间 | 证据 | 可以得出的结论 |
| --- | --- | --- |
| 00:35–00:38 | 已存在 Accio `[402] unauthorized` 记录 | 部分账号的鉴权失败早于本轮 SDK 部署 |
| 11:58:22–11:58:33 | Gemini 四次正式网关请求均为 200；每次经过前三个账号 401，再由第四个账号成功承载 | 本轮验证确实成功，但四次网关请求产生了 16 次上游尝试，其中 12 次鉴权失败 |
| 12:01:18 | 同一个第四账号测试 Claude 代号 `1Orbit-Q5pN8xR6cP2m` 返回 `[402] unauthorized` | 之前成功的账号随后也失败，不能再只归因于原先三个坏凭证；同时模型发生变化，不能作为严格的同请求对照 |
| 12:01:25–12:01:32 | 另五条 Claude 测试也返回相同错误 | 失败具有持续性；SDK 日志仍为 `factors_generated`，六个字段并未保证授权成功 |
| 12:03:12–12:03:18 | 四个 Accio 账号均被删除 | 当前本地 Accio 账号数量为 0，无法继续用现存账号复现或刷新会话 |
| 12:05:29–12:06:39 | 一轮网页登录开始，随后取消，没有成功换码与落账号记录 | 当前网页显示已登录，不等于网关完成了新的 OAuth 授权 |

这里的 `[402]` 是上游业务错误码。保存的失败调试记录显示上游 HTTP 为 200，网关最终按鉴权错误映射为 HTTP 401，不能把三者混为一谈。失败调试记录没有保留上游响应正文，缺少可进一步区分原因的原始错误元数据。

只读检查重启前备份发现，四条账号记录均有 refreshToken，记录中的 expiresAt 位于 11 月，并非 12:01 自然到期。这不证明令牌仍有效：服务端可以提前使其失效或限制账号。

## 对照官方实现

参考本机官方 Accio 0.34.5 / ADK 0.3.32 安装包的 `gateway-worker.js` 和 `index.js`。当前选中网页公开资源版本为 phoenix-web 0.32.16；网页会话与桌面 ADK OAuth 会话不能直接等同。

| 环节 | 当前状态 | 说明 |
| --- | --- | --- |
| v2 模型目录 | 已接入 | `/api/llm/config/v2`，运行实例刷新成功 27 个模型；没有回落 v1 |
| 推理路径和请求结构 | 已接入 | `generateContent?sg_k=md5(requestId)`，body token、结构化消息、工具与 Gemini thought signature 等已接入 |
| SecurityGuard 原生调用 | 已接入部分链路 | 官方模块加载、环境初始化和逐 URL 因子调用已接入；本轮返回六个字段 |
| 登录返回的 sgcookie | 缺失 | 官方 OAuth 换码结果保留 sgcookie；本地 Credentials、换码解析与落盘均未保留该字段 |
| SecurityGuard 的会话初始化 | 不完整 | 官方有 sgcookie 时优先 `initUmidBySgCookie`，否则回落环境初始化；本地只有 `initUmid(6)` |
| 令牌可用性与恢复 | 不完整 | 有临期主动刷新和强制刷新函数，但会话式转发错误分支没有调用 401 强制刷新，实际直接顺延账号 |
| 业务 API 错误分类 | 不完整 | `auth::payload` 只判断 HTTP 成功和 JSON 对象，没有解析业务失败码；HTTP 200 的授权拒绝可能被后续层泛化为“缺少字段” |
| 授权路由上下文 | 不完整 | 官方按当前会话附加 team、route region，并按运行形态设置 timezone、来源信息；本地没有完整保存和传递这些条件字段 |
| HTTP 传输运行时 | 不同 | 官方 Node/Electron 与本地 Rust reqwest 的传输实现不同；原生 SDK 接入不会自动统一其余传输行为 |

v2 指模型目录版本；官方推理仍走 `/api/adk/llm/generateContent`，不能据此把推理 URL 随意改成一个 `/v2` 路径。

## 优先处理的问题

### P1：401 后的恢复分支实际未接通

`accio/mod.rs` 有 `refresh_access_token`，但 `provider_loop.rs` 的 is_stateful 分支只做分类、额度记账和账号顺延，没有进入无状态分支中的强制刷新动作。本次四次正式请求反复尝试同样三个拒绝鉴权的账号，说明本路径没有避免重复发送已知失败的凭证。

应区分可恢复的令牌失效与已明确账号受限：前者只在未输出内容、上游允许重放且刷新有授权时尝试一次；后者进入需要处理的状态，停止重复探测，不能用重试或换号掩盖限制。

源码：`desktop-tauri/src-tauri/server/src/server/core/upstream/provider_loop.rs:747`，`desktop-tauri/src-tauri/server/src/server/core/providers/accio/mod.rs:163`。

### P1：丢失官方登录颁发的安全会话信息

官方 `AuthService.exchangeCodeForToken` 保存 sgcookie，启动时优先交给 `initUmidBySgCookie`。本地换码只提取 accessToken、refreshToken、expiresAt，Credentials 没有 sgcookie；Node 桥接也仅走环境初始化。

环境初始化本身是官方支持的回落路径，因此不能声称缺少 sgcookie 就必然封禁；但现有实现不能称为完整对齐官方会话链路。后续应只保留合法授权响应实际颁发的字段，不填造值、不把旧会话上下文混给新会话。

源码：`desktop-tauri/src-tauri/server/src/server/core/providers/accio/oauth.rs:193`，`desktop-tauri/src-tauri/server/src/server/core/providers/accio/credentials.rs:37`，`desktop-tauri/src-tauri/server/src/server/core/providers/accio/security_guard.cjs:20`。

### P1：业务鉴权错误没有充分表达

`auth_http::send_raw` 的 ok 仅表示 HTTP 2xx；`accio/auth::payload` 未检查业务失败信封。登录资料查询失败又允许继续落账号，会造成账号已添加但授权状态未验证的情况。应保留并分类业务拒绝原因，明确显示需要重新登录、账号限制或其他失败，而不是统称额度结构缺失。

源码：`desktop-tauri/src-tauri/server/src/server/core/providers/accio/auth.rs:77`、`:153`，`desktop-tauri/src-tauri/server/src/server/core/providers/accio/oauth.rs:207`。

### P2：授权上下文和传输行为仍有差异

官方 `Gu()` 在有当前 team / route region 时注入对应请求头，ADK 还按运行环境处理 client timezone。本地没有完整承接这些授权响应和资料字段。它们是否与本次拒绝有关，没有直接证据，应按协议含义核实，不能把随意补头当作解决方案。

macOS 的普通 appKey `35298846` 与原生 SecurityGuard appkey `35337600` 在官方代码中本来就是两个用途不同的值，本轮未发现二者不同本身是错误。

## 归因边界

- 用户报告官方也明确限制账号，支持账号层面已有受限状态。
- 日志不能证明具体触发原因。模型切换、账号/会话状态、授权上下文和服务端策略都未被严格控制。
- 六个因子字段生成成功，不等于服务器认可整个会话或不会限制账号。
- 补齐 SDK / 会话协议不能保证解除已有账号限制；需先按官方渠道处理账号状态，再用合法恢复后的会话做低频、同账号、同模型验证。
