# Accio 50 秒超时请求复核：2026-10-17

本轮只读检查两条具体测试请求、日志、持久化目录和官网现有页面，并运行一次虚构 SDK 的本地对照。没有再次登录、发送官网消息、测试真实 ADK、调用官方原生 SDK、修改生产代码 / 配置或重启服务。

## 已确认的请求过程

| 北京时间 | 请求 | 结果 |
| --- | --- | --- |
| 13:24:17 | 用户手动 OAuth 换码及 POST 用户资料查询 | 两阶段均为 HTTP 200、success=true，随后账号保存成功 |
| 13:24:47 | 用户手动刷新 Accio v2 目录 | 成功，27 个模型 |
| 13:25:27 | 请求 344 / `aff53e97-b9ca-446c-8f64-af5fae7b5e55` | 50,003 ms 后本地 504；1 次尝试，没有完成 first_content |
| 13:26:35 | 请求 345 / `54cac6a2-b314-4c5f-b960-2bf4479b6dc2` | 50,004 ms 后本地 504；1 次尝试，没有完成 first_content |

两次模型均为 `1Orbit-Q2XN3xR6cP2m`，当前 v2 缓存名称为 Claude Opus 4.8。请求体 475 字节，推理档位被映射为 max；目录声明默认档位为 low。两次均在约 30.1 秒收到上游响应头，记录的上游 HTTP 为 **200**，Content-Type 为 **text/event-stream;charset=UTF-8**，Transfer-Encoding 为 chunked；随后立即读到首字节。

剩余约 19.8 秒停留在 first_content，直到 50 秒测试预算取消。没有进入有效内容后的 stream_response 阶段。因此这里的 504 是本地测试预算结果；现有证据既不是连接完全不通，也不足以判定账号再次被限制。首字节可能是心跳或其它尚未解析为有效内容的数据，原始 SSE 帧没有留存，不能推断它具体是什么。

## SecurityGuard 的明确异常与差异

两条请求均记录：

`mode=auto outcome=sg_init_failed init=failed init_mode=sgcookie token_present=true header_count=0`

第一次 SDK 等待 58 ms，第二次 1 ms。token_present 表示读取到了已有 token，不表示本次 cookie 初始化成功。源码显示 auto 模式会附加 x-sg-err 并继续发送，而不是获得动态因子后才发送。

对照本机官方 Accio 0.34.5 / ADK 0.3.32 的 `gateway-worker.js`：

1. **P1：缺少官方条件回退。** 官方 cookie 初始化错误码为 1 时按 already_initialized 处理；其它错误在不含 already in progress 时回退 `initUmid(6)`。项目桥接仅记录 failed，没有这个恢复分支。前一轮“cookie 失败不回退”的实现和测试期望不完整。
2. **P1：失败初始化结果被持续复用。** `init ??= initialize(cookie)` 缓存了返回 failed 的 Promise。Rust 在收到合法桥接回复后保留 worker，所以同一安全上下文的后续请求不会再进入初始化。这与第二次仅耗时 1 ms 的日志一致，不能将该耗时解释为 SDK 已恢复。
3. **P2：原生初始化错误码丢失。** JS 回复中的 `init.errorCode` 未被 Rust 的 Init 结构接收；日志只保存 failed。当前无法确认真实错误是否满足官方回退条件，也不能确认 cookie 失败的原始原因。
4. **P2：等待阶段与数据结构证据不足。** 测试只展示“50 秒未拿到完整回答”，但本例实际尚未完成有效首帧识别。应先补充脱敏的帧类型 / 字节 / 心跳 / 未识别帧计数，保留 SDK 初始化状态，再决定是否调整测试预算。直接延长超时不能证明修好了协议。

本轮用**虚构错误码 42**执行官方 lan / uan 函数和项目实际嵌入桥接的对照：官方分支产生 failed → success，并调用一次环境初始化；当前桥接返回 sg_init_failed、token_present=true、动态因子字段为 0。这只证明恢复分支差异；42 不是本次真实账号的原生错误码。未加载官方原生模块或使用账号凭证。

## 官网对照

通过内置浏览器只读查看用户现有官网标签页。页面有已完成的编程助手回复，最近可见回复时间为 13:15:11；模型菜单当前勾选 Claude Opus 4.8，与本地测试目录中的模型名称一致。没有点击重试、发送或编辑并重发，也没有改变模型选择。

当前页面公开资源版本为 phoenix-web 0.32.16，公开引导脚本的 Web gateway 配置为 `/gateway`。官网页面中的已有任务成功，不能直接证明本地直连 `/api/adk/llm/generateContent` 的同一会话、推理档位和请求格式已通过。页面任务展示的处理时长还包含代理 / 工具工作，不能拿它与本地简单请求的首响应时间直接对比。

本轮没有发新消息，所以“此刻重新发送是否成功”未实测。现有记录也没有这两次推理的 401、403 或明确账号受限业务码。不能把 SDK 初始化失败、模型排队 / 思考、未识别的 SSE 数据或服务器策略中的任意一个单独认定为唯一原因。

## 建议处理顺序与证据

先按官方补齐 SDK 条件回退、失败状态恢复和原生错误码诊断，用本地模拟覆盖；再补首帧观测与分阶段测试提示，核对 max 档位与测试预算。生产代码本轮尚未改动。

本机证据位于 `/private/tmp/accio-timeout-audit-20261017/`：`evidence.json`、`sg-fallback-comparison.json`、`compare-sg.mjs` 及官网公开脚本。证据没有保存账号令牌、cookie 或新的推理响应正文。
