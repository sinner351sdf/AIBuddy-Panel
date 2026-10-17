# Accio ID 生命周期、上下文与 WAF 诊断修复

## 实现范围

依据本机官方 Accio 0.34.5 / ADK 0.3.32 的 ID helpers、Provider.buildRequestInit、le() 和 protobuf toJSON 的已提取源码。本轮不使用账号向官方发送测试请求，不加载官方原生 SDK做验证。完成本地验证后，使用原入口 `scripts/start-local.sh` 编译重启生产服务。

### ID 生命周期

- 新消息和用户轮次分别生成 `AI_AccioWork_<32hex>_<毫秒时间戳>`，不再拼接 `msg-<request_id>`。
- 单个本地 HTTP 请求通过 request-local telemetry 保留用户轮次、消息和默认会话；不同 HTTP 请求不按提示词猜测会话归属。
- 每个逻辑 LLM 调用分配独立 UUID 和 16hex span。401 续期后的同一次重放保留这组 ID，因此请求 URL 的 sg_k 与原调用一致；新逻辑调用分配新 LLM ID。
- wire `request_id` 使用 LLM 调用 ID，`user_request_id` 使用用户轮次 ID，`message_id` 使用消息 ID，`parent_span_id` 使用本次 ADK span。上层 parent span 只保留在本地调用诊断中，符合所核查官方转换路径的分层。
- 未显式指定轮次时，按最后一条 user 消息之后的 assistant 调用数推导轮次；同一个 HTTP 请求中的继续生成保留根 ID。跨 HTTP 工具调用通过下面的上下文契约承接。

### 会话上下文契约

支持在 `metadata.accio` 中提供 camelCase / snake_case 字段；也接受对应的顶层 snake_case 字段和 `x-accio-…` 请求头。字段冲突、非法类型、控制字符或超长 ID 在本地返回 400，不回显输入。轮次必须为 1–1000000 的整数。

```json
{
  "metadata": {
    "accio": {
      "conversation_id": "client-generated-conversation-uuid",
      "session_key": "agent:actual-agent-id:cid:client-generated-conversation-uuid",
      "message_id": "AI_AccioWork_<message-hex>_<timestamp>",
      "user_request_id": "AI_AccioWork_<turn-hex>_<timestamp>",
      "round_number": 2
    }
  }
}
```

字段均为按需提供：没有实际 Agent 时不发送 agent_id，也不为了齐字段生成官方 Agent 身份；不提供 conversation_id 时创建本地新 UUID 会话。session_key 以官方 `agent:…:cid:…` 形式提供时，按官方规则派生 agent_id；显式 agent_id 与其冲突会拒绝。conversation_name、parent_agent_id 和 parent_span_id 也可按实际上下文提供。

流式正文 chunk 和非流式完成响应新增可选 `accio_context`，包含 message_id、user_request_id、conversation_id、round_number 及实际提供的 session/agent 信息。工具后续请求可将它放回 `metadata.accio` 并更新 round_number；新用户轮次只沿用 conversation/session 信息，省略旧 message_id 与 user_request_id 以生成新值。通用 OpenAI 客户端仍可忽略这个扩展，作为独立请求调用。

显式 conversation/session 引用在进程内按账号与地区绑定，不允许自动切到另一账号复用；未显式指定的会话在账号回退时隔离。绑定缓存最多 2048 项、有效期一小时，属于运行期防混用保护，不是持久化授权机制；服务端账号授权检查保持独立。跨请求、跨重启需要客户端主动携带上下文。

### 实际字段与诊断

- 去掉这条官方转换路径会清空并省略的 tenant、iai_tag、empid。
- 未指定正数输出上限时使用官方 Provider 默认值 16384；客户端正数上限仍优先，不将此值写成模型目录的最大输出能力。
- `attemptDetails[].diagnostics` 保存 accioIdentity、accioSecurityGuard、accioTransport、accioStream。SDK 和 SSE 日志携带相同身份映射，国际版与国内版都支持。
- 调试请求体改为脱敏后的实际 ADK wire 形态，token 替换为 `[REDACTED]`，便于检查 ID 与上下文；不把 SDK 因子值放进诊断。
- WAF 的非空 bxpunish 响应标记按独立 WAF_BLOCK 类处理，记录标记存在与否及安全网关 request ID，不输出挑战内容。它不会触发令牌刷新，也不会自动把账号标记成已封禁。
- 重定向或最终响应 URL 改变按独立 transport 错误拒绝。这里增加的是响应诊断，不执行 WAF 挑战，也不尝试绕过上游拒绝。
- 错误体读取最多 32 KiB、总预算两秒；超限/超时/读取失败保留控制字段，不把 HTML 或未解析的响应正文直接写进错误。完整 JSON 业务鉴权错误仍保留原分类和一次恢复策略。

## 本地验证

- 全量 server 库测试：792 passed，0 failed，14 ignored。
- SDK 桥接：18 个模拟场景通过，没有初始化官方原生模块。
- `local_session_transport_regression` 扩展为 11 个本机假上游场景：检查实际 wire 字段、sg_k、ID 在 401 重放中保持一致、响应上下文、SDK 诊断，以及 WAF/重定向不续期。
- 新增纯本地测试覆盖 ID 格式及作用域、独立请求和账号隔离、跨请求工具续接、新用户轮次、上下文冲突、官方字段映射、默认输出上限、WAF 在读取正文前拒绝、错误体大小/时间上限与脱敏。
- 原有 UTF-8 任意字节切分、同 chunk 多帧、心跳超时、取消后计数和请求明细落库测试继续通过。

测试证据和修改前备份：`/private/tmp/accio-identity-fix-20261017/`。构建、数据库备份、重启和本地接口验收：`/private/tmp/accio-identity-restart-20261017/`。

## 部署验收

2026-10-17 14:07（北京时间）已通过原入口重启，PID 从 92913 更新为 98999。新二进制 SHA-256 为 `fa3163075dfcea6da200b299f8b87005907ef5bf31388ea392e5127589618717`，已核对监听进程和实际执行路径。

本地 `/health`、首页、`/api/panel/status`、`/api/endpoints` 均为 200；未登录的 `/api/config` 为预期 401。重启前无在途请求，SQLite Backup API 快照已保存，现有一个 Accio 账号及 SDK auto 模式保留。启动验收片段未观察到 Accio 上游 HTTP 调用，本轮未发账号测试请求或触发官方 SDK 初始化。

本轮不包含前次审查中工具结果缺失补全、媒体解析、条件 gzip 或完整 SSE event 口径等后续差异；也没有通过本地测试认定官方实际推理或账号风控状态已经恢复。
