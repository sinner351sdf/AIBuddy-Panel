# Accio SDK 回退、恢复与流式诊断本地验证

本轮只改源码并做本地验证。没有使用账号向官方发送测试请求，没有加载或初始化官方原生 SDK，没有重启当前服务。参考的是此前提取的官方桌面端 **0.34.5 / ADK 0.3.32** `gateway-worker.js` 中 `uan → lan` 初始化路径；不是重新抓取官方实时推理流。

## 修复

1. 有 sgcookie 时先调用 `initUmidBySgCookie`。该调用异常后，除错误码 `1`、`already in progress` 外，只回退一次 `initUmid(6)`。无 cookie 时直接使用环境初始化。成功但没有 token 时仍视为未就绪；错误码 `1` 也必须读取到 token 才接受，不用旧 token 掩盖普通初始化错误。
2. 初始化失败或模块不可用后退出 worker。同一上下文退避 30 秒，期间复用脱敏诊断，不重复启动 SDK；到期重建 worker。上下文切换仍按账号、地区、设备、cookie 的绑定隔离。已有账号受限状态和会话刷新限制不变。
3. 保留 cookie 阶段和最终初始化阶段的数字错误码、受控原因、是否回退、是否处于退避期。原生错误消息不进入诊断；Rust 再次限制状态与原因标签。`auto` 保留显式 `x-sg-err` 失败放行，`required` 在失败时本地返回 503。
4. 在原始字节流外包装观测器，首帧预读交接时不重复统计。记录 `firstFrameType`（首个非空 SSE 行）、`firstDataType`、`firstContentType`，以及字节、chunk、data 帧、心跳、注释、元数据、内容、结束、错误、未知、无效 JSON、过大行和未完成行字节数。
5. 计数表示已经接收的数据，可能包含同一 chunk 内尚未消费的后续帧；不为补齐统计继续拉取结束标记之后的上游数据。SSE 注释按传输保活统计；JSON 的 `ping` / `heartbeat` / `keepalive` 也计入心跳。心跳和元数据不延长有效内容等待时间。
6. 诊断绑定原尝试序号，取消或超时 Drop 时保存最终计数，不覆盖后来重试的诊断。跨 UTF-8 分片按完整行解析，半行只记长度；不保存正文、工具参数、签名、cookie 或原始帧。

## 诊断位置

- SDK：运行日志 `[Accio SecurityGuard]` 的 JSON；`required` 失败的错误详情中也包含 `security_guard`。
- SSE：运行日志 `[Accio SSE]`；请求明细 JSON 的 `attemptDetails[].diagnostics.accioStream`。已有明细界面没有增加新的专用展示组件。
- 在途回写最多约每秒一次，收尾额外写入准确快照。字段复用现有明细 JSON，不新增数据库表或列，旧记录不补造计数。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `node scripts/test-accio-security-guard.mjs` | 18 个合成场景通过：包括回退、禁止回退、两条初始化均失败、非标准异常、脱敏与成功缓存 |
| 从官方提取的 `uan` / `lan` 与实际桥接脚本做合成对照 | cookie 错误码 42 时，双方均调用一次环境回退并成功；不加载真实 SDK |
| `local_sdk_recovery_regression` | 通过：失败 worker 被丢弃；退避期间保留 42 / 43 两阶段错误码且不重复初始化；模拟到期后重建成功 |
| `local_session_transport_regression` | 8 个本机 ADK 会话场景通过，假上游仅监听 127.0.0.1，使用合成凭据与模拟 SDK |
| server 全量库测试 | **785 passed, 0 failed, 14 ignored** |
| `cargo check -p agent2api-server --offline` | 通过；现有无关 warning 未作修改 |

流式用例覆盖首帧前心跳后取消、未知帧 / 无效 JSON / 业务错误、工具与思考类型、同 chunk 多帧、所有两段字节切分位置、无结束帧断流，以及诊断在途写入、收尾归一和落库保留。合成取消用例保留 3 次心跳、1 帧元数据和未完成行字节数，后续尝试的诊断不受影响。

第一次全量运行中，57 个假上游测试因沙箱禁止绑定本机监听端口失败；放开回环监听后全量通过。真实账号 / 原生 SDK 的显式忽略测试没有运行。

原始日志、源码修改前备份和合成对照位于 `/private/tmp/accio-sdk-stream-local-20261017/`。本地验证不能证明官方实际推理已经恢复，也不能确定前两次真实请求收到的具体帧或原生错误码；那些请求没有留存这些诊断。
