# Accio SecurityGuard 接入

Accio 的 ADK 推理请求在发送前通过官方 `@phoenix-common/security-guard` 原生模块生成动态请求头。当前实现依据本机 Accio **0.34.5 / ADK 0.3.32** 的调用方式，使用常驻 Node 子进程调用用户安装的官方模块；原生二进制没有复制进仓库或发布包。

## 运行条件

- macOS 自动寻找 `/Applications/Accio.app` 和 `~/Applications/Accio.app` 内与当前架构匹配的 `security_guard.node`。
- 运行环境需要可执行的 Node。桌面程序的 `PATH` 可能与终端不同，此时应配置 `ACCIO_SECURITY_GUARD_NODE` 为 Node 的绝对路径。
- Windows 可用 `ACCIO_SECURITY_GUARD_MODULE` 指定官方对应架构的原生模块，模块加载兼容性需要在目标机器验证。本轮实测范围是 macOS ARM64 和 Node 24。
- 审核的官方包装层仅将 macOS / Windows 视为支持平台；没有据此提供 Linux / Docker 原生 SDK 支持。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ACCIO_SECURITY_GUARD` | `auto` | `auto` 尝试 SDK，失败时附带 `x-sg-err` 继续请求；`required` 在模块、初始化或因子生成失败时本地返回 503；`off` 完全关闭，用于对照或显式禁用 |
| `ACCIO_SECURITY_GUARD_NODE` | `node` | Node 可执行文件路径 |
| `ACCIO_SECURITY_GUARD_MODULE` | macOS 自动寻找 | 官方 `.node` 模块的绝对路径 |
| `ACCIO_SECURITY_GUARD_APPKEY` | macOS `35337600`，其他平台 `35336201` | 传给原生 SDK 的 appkey，与现有 ADK 请求头 `ACCIO_APP_KEY` 分开 |

例如，服务启动环境可以设置：

```sh
export ACCIO_SECURITY_GUARD=required
export ACCIO_SECURITY_GUARD_NODE=/absolute/path/to/node
export ACCIO_SECURITY_GUARD_MODULE=/absolute/path/to/security_guard.node
```

这些变量在服务进程启动时继承；修改源码或终端变量不会自动改变已运行服务。

## 调用过程

1. `chat::send` 在每次请求发送前将最终 URL 交给桥接层。账号 access token 和请求内容不传入 Node 子进程。
2. 子进程加载官方模块，拒绝 `isStub` 占位实现。有合法授权结果颁发的 `sgcookie` 时优先 `initUmidBySgCookie(sgcookie)`；没有时使用 `initUmid(6)`，对应官方 AREA_ONLINE 初始化。cookie 初始化异常时按官方 `uan → lan` 条件回退一次 `initUmid(6)`；错误码为 `1` 或原生提示 `already in progress` 时不回退。回退是否发生及两个阶段的错误码均显式记录。
3. 初始化返回错误码 `1` 时，只有随后读到非空 `getSecurityToken(6)`，才记录为 `already_initialized`；不会直接把错误当作初始化成功。初始化失败或未获得 token 时不调用因子生成。
4. 按官方平台规则调用 `getSecurityFactorsForWeb`：macOS 输入 appkey、主机名加路径，以及路径加查询串的 MD5；Windows 输入 appkey 和完整 URL。返回的标量值按 `encodeURIComponent` 编码。
5. Rust 验证头名、值和大小后附加到请求。当前接收 `x-bx-*`、`pctb-*`、`x-sg-*` 因子，禁止覆盖 Authorization、Host 或 HTTP framing 等字段。因子不缓存、不写盘、不写入日志。

初始化与因子调用共用一个常驻子进程，调用串行化。账号、地区、设备或 sgcookie 构成的安全上下文发生变化时，结束旧进程，再以新上下文初始化。cookie 只经私有 stdin 传递，不作为 HTTP 请求头、命令行参数或日志输出；账号记录沿用现有整行加密存储。

单次等待有上限；异常退出、超时或取消会丢弃子进程，避免半条响应被后续请求误用。初始化失败或模块不可用也会丢弃 worker，避免失败 Promise 永久缓存；同一上下文退避 30 秒后允许新 worker 重试，退避期间保留脱敏错误码，并标记 `recovery_backoff=true`。退避按上下文隔离，不阻塞另一安全上下文。

日志仅包含模式、初始化状态与路径、是否存在 token、因子头名和耗时，以及 `init_error_code`、`cookie_error_code`、固定原因标签、`fallback_attempted`、`recovery_backoff`。不输出原生错误文案、路径、cookie、token 或因子值。`required` 模式失败时返回 `accio_security_guard_unavailable`，并标记不可自动重放，避免轮换账号掩盖本地组件问题。

## 验证

无需账号或网络的桥接测试：

```sh
node scripts/test-accio-security-guard.mjs
```

Rust 测试在 `desktop-tauri/src-tauri` 运行：

```sh
ACCIO_SECURITY_GUARD=off cargo test -p agent2api-server --lib --offline accio::
```

`local_sdk_recovery_regression` 是单独启用的纯本地测试，使用临时 `.cjs` 模拟模块验证失败 worker 退出、退避诊断、到期重建，不加载官方原生 SDK。运行时使用隔离的 `AGENT2API_PROXY_HOME`，并单独指定测试名及 `-- --ignored --test-threads=1`。

本次 SDK 回退与流式诊断的本地验证见 [2026-10-17 修复记录](ACCIO-SDK-STREAM-LOCAL-VALIDATION-20261017.md)。

`live_security_guard_ab_comparison` 是显式忽略的真实请求测试。它只接受 `/private/tmp/accio-sg-*` 下的隔离数据库与密钥快照，固定账号、模型及出口，顺序比较小请求 ABBA 和约 8 KB 输入的一组 A/B；不会刷新 token、执行外部工具或重启服务。测试消耗实际账号额度，应仅在明确要求真实验证时运行。

接入成功表示请求使用了官方模块生成的因子。少量 A/B 成功不能证明长期风控概率下降，也不意味着 HTTP/TLS、应用运行环境等其他特征与官方客户端完全一致。

### 2026-10-17 较早的本机实测（历史记录）

下列结果发生在本次会话修复前，不能作为新增 sgcookie 链路已实测的证据。账号后来在官方也被明确限制；本次修复没有再次使用这些账号或重新初始化官方原生模块。新增代码的验证范围见[会话链路修复与本地验证](ACCIO-SESSION-LOCAL-VALIDATION-20261017.md)。

官方 macOS ARM64 原生模块在 Node **24.15.0** 中加载成功，`isStub=false`。初始化返回错误码 `1`，随后读到非空 token，按 `already_initialized` 处理；这验证的是已有初始化状态可用，没有宣称完成了一次全新的初始化。

使用 v2 目录中的 Gemini Flash 模型，同一账号直连，得到以下结果：

| 输入 | SDK 关闭 | SDK required | 上游风控差异 |
| --- | --- | --- | --- |
| 小请求，ABBA 顺序 | 2/2 HTTP 200，回复 OK | 2/2 HTTP 200，回复 OK | 此样本没有观察到拦截差异 |
| 输入 JSON 8,702 字节 | 1/1 HTTP 200，回复 OK | 1/1 HTTP 200，回复 OK | 此样本没有观察到拦截差异 |

开启时实际生成并加入 `x-bx-env`、`pctb-x-api`、`pctb-x-t`、`pctb-x-apiver`、`pctb-x-appkey`、`pctb-x-pv` 六个字段。桥接首次调用约 **85 ms**，后续约 **0–1 ms**。这些是本轮官方模块实际返回的字段，不代表额外取得了未返回的签名或设备证明。模型推理耗时有波动，本轮不据此比较性能。

真实验证没有刷新账号凭证或重启生产服务，完成后删除了临时数据库、WAL/SHM 和密钥副本。
