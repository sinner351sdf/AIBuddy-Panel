# Accio 登录协议与脱敏诊断修复：2026-10-17

本轮只修改源码并做本地验证，没有使用真实或受限账号、向 Accio 官方发起测试、加载官方原生 SDK，或重启运行中的服务。参考来源是本机已提取的官方 Accio 0.34.5 / ADK 0.3.32 静态代码。

## 协议对照与修改

官方 `AuthService.exchangeCodeForToken` 通过业务客户端 POST `/api/oauth/token`，保留 code、codeVerifier、clientId 和原始 redirectUri。`requestUserInfo` 同样通过业务客户端 **POST `/api/auth/userinfo`**，accessToken 放在 JSON body。项目此前对资料接口使用 GET 查询参数，是一个已确认的协议差异；这不能单独证明它就是此前登录被拒绝的全部原因。

新增 `accio/login_http.rs` 将这两个阶段收在同一个登录上下文中：

| 内容 | 本轮实现 |
| --- | --- |
| 用户资料查询 | 改为 POST JSON；令牌不再放在资料接口的 URL 中，手动添加凭证也使用相同路径 |
| 设备上下文 | 两个阶段和成功返回的凭证使用同一个设备标识；新 OAuth 登录使用本网关安装目录中的 `accio-device-id`，不读取或复制官方客户端身份 |
| body 公共字段 | 附加同一设备的 utdid 和当前 app version |
| 平台 | macOS 为 `pc-mac` / `darwin`，Windows 为 `pc-win` / `win32`，其余为 `pc-linux` / 本机 OS |
| 其他官方公共头 | `x-language: en`、`x-locale: en-US`、`x-utdid`、`x-app-version`、`x-package-region`、`x-deploy-target: desktop`、`x-source: ACCIO_DESKTOP` |
| Cookie | 未取得浏览器 cna 时 `x-cna` 为空；不填造 Cookie、浏览器因子或 Bearer 头 |
| PKCE 与回调 | 保留现有一次性 state / verifier 校验；原 redirectUri 原样发出，不记录值 |
| 成功条件 | HTTP 2xx、明确 success=true、data 为对象；换码还须有完整且有效的令牌字段，资料还须通过用户身份和路由字段校验 |
| 失败处理 | 不自动重试登录，不把资料拒绝判为登录成功，不保存未验证的账号 |

登录请求沿用现有账号代理解析和业务请求超时，响应读取限制为 1 MiB。新的登录 HTTP 封装独立于 ADK 推理和 SecurityGuard 因子生成。

## 两阶段诊断

日志前缀为 `[Accio Login]`，按 `token_exchange` 和 `userinfo` 记录开始、成功或失败。只保留本地 flow_id、固定接口路径、方法、地区、上游 HTTP 状态、响应类型 / 大小、success 标记、经过校验的业务码和请求标识，以及归一化失败原因。

错误提示直接包含阶段、上游 HTTP 状态、可用业务码和本地追踪号。未知错误仍明确表示“未取得可识别的具体原因”，不会把所有 403 解释为账号封禁。

解析支持顶层与嵌套 error 对象、OAuth error / error_description，以及 errorCode、error_code、code、message、msg、errorMessage、error_message、errorMsg。空或 null code 不再被当成字符串错误码。可区分 NOT_LOGIN、账号受限、invalid_grant、PKCE / 回调地址错误、invalid_client、限流、安全验证、连接失败、非 JSON / HTML 和不完整响应。

上游自由文本只在内存中用于分类，**不直接输出到日志或页面**。诊断不会保存原始响应、完整请求头、授权码、verifier、state、令牌、sgcookie、sid、回调 URL 或用户资料。业务码和请求标识还须通过形状校验及已知敏感值检查；无法安全识别时省略。此前失败的原始响应没有保存，无法用本次修改还原它们的确切原因。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Accio 定向单元测试 | 37 通过、0 失败；4 个显式测试未在该命令运行 |
| 服务端全量单元测试 | 782 通过、0 失败、13 显式忽略 |
| 新登录回环集成 | 通过；8 条 OAuth 分支及手动凭证资料查询 |
| 既有会话恢复回环集成 | 通过；维持之前 8 条续期、受限及部分输出分支 |
| 全 target 离线编译检查 | 通过；保留现有警告 |
| 日志敏感值扫描与差异检查 | 通过 |

新回环测试在随机 `127.0.0.1` 端口挂载 POST 换码与资料模拟接口，校验请求方法、body、平台头、版本 / 设备一致性和原始回调地址。覆盖正常登录、invalid_grant、资料 403、HTTP 200 内 NOT_LOGIN、安全验证 HTML、令牌不完整、身份不一致和资料缺少用户标识。每次换码最多发一次，换码失败不进入资料阶段。模拟的错误原文刻意包含授权码、verifier、令牌、cookie、邮箱和带 token 的 URL，断言这些值不出现在错误响应或日志中。

本轮证据位于 `/private/tmp/accio-login-local-20261017/`：`accio-tests.log`、`login-loopback.log`、`session-loopback.log`、`full-tests.log`、`check.log`、`validation.json`。隔离测试目录仅包含虚构数据；没有读取生产账号凭证来运行测试。

上述本地验证结束时，运行中的服务仍为 PID 79072，监听 `127.0.0.1:3065`，尚未加载新登录代码。本轮未验证真实 OAuth 成功、官方原生 SDK 的实际初始化或线上账号限制是否解除。

## 后续授权重启：2026-10-17 13:23（北京时间）

用户随后授权重新编译并重启，真实登录由用户手动操作。离线编译成功后，沿用现有 `scripts/start-local.sh` 启动，新 PID 为 86705，监听 `127.0.0.1:3065`。旧二进制和停机前的 SQLite 一致性快照已备份，数据目录及 SecurityGuard 的 auto / Node / 模块配置均保持原值。

已核对运行二进制路径和 SHA-256：`78671d982a7a9dc2b04339af54843b35c75b1101c7218dab424c71abc454927d`，确认包含本轮登录诊断代码。启动日志确认数据库正常打开。

本地检查 `/health` 返回 HTTP 200、`status=ok`；首页、`/api/panel/status` 和 `/api/endpoints` 均为 HTTP 200；未登录访问 `/api/config` 返回预期的 HTTP 401。没有调用登录、目录刷新或推理接口，未使用受限账号发送官方测试请求。

运行日志为 `logs/local-server.log`；编译、重启及本地接口证据保存在 `/private/tmp/accio-login-restart-20261017/` 的 `build.log`、`restart.json`、`startup.log`、`local-api-checks.json`、`verification.json`。真实 OAuth 登录与官方原生 SDK 初始化仍未测试。
