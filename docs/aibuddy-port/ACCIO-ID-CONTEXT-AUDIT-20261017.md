# Accio 消息 ID 与官方请求链路差异审查

审查基准：本机官方 Accio 0.34.5（本轮读取 Info.plist 核实）及已提取的 ADK 0.3.32 `gateway-worker.js`。截图是官网用量记录，存在 `msg-…` 与 `AI_AccioWork_…` 两种消息 ID。本轮不使用账号发请求，不加载官方原生 SDK，不修改业务源码、配置或重启服务。

## 直接结论

`protocol.rs:430–453` 当前主动创建随机 UUID，把 `request_id` 和 `user_request_id` 设为同一个值，并将 `message_id` 写为 `msg-<该 UUID>`。注释保留了“2026-09 实测非空即可、形态不限”的旧假设。这解释了本地调用为何会产生这种消息 ID；此前 v2 目录、授权、SDK 和流式修复没有更换这段逻辑。

官方普通任务 ID 的一条明确生成路径为：

```text
d1e() -> UUID 去连字符（或生成 16 字节随机标识）
p1e(id, timestamp = Date.now()) -> AI_AccioWork_<id>_<timestamp>
O_() -> p1e(d1e())
```

另有针对已有标识、定时任务等来源的变体。不能把一种随机生成路径说成所有入口唯一的规则，也不能直接复制官网历史消息 ID。

这些 ID 在官方也由客户端生成；本地问题是没有复现其生成规则和上下文传递。截图的前缀不能独立证明账号受限的原因，也不能建立某个前缀与风控概率的因果关系。

## 官方 ID 分层

官方 Provider 的 `buildRequestInit()` 从上层上下文承接 `requestId`、`messageId`、`llmRequestId`、会话与轮次字段。ADK `le()` 转换到 protobuf 请求时：

| wire 字段 | 官方来源 | 当前本地 |
| --- | --- | --- |
| `request_id` | `llmRequestId ?? requestId`，单次 LLM 调用标识可与用户轮次分开 | 每次构造新 UUID |
| `user_request_id` | 上层用户请求 `requestId` | 直接等于 `request_id` |
| `message_id` | 上层消息 `messageId` 原样传递 | `msg-<request_id>` |
| `session_key` / `conversation_id` | 上层会话上下文，有值才传 | 未承接 |
| `conversation_name` / `round_number` | 上层会话名称和轮次，有值才传 | 未承接 |
| `agent_id` / `parent_agent_id` | 实际 Agent 上下文；部分路径可从 sessionKey 派生 agentId | 未承接 |
| `parent_span_id` | ADK 此次调用的 spanId | 未生成或传递 |

不能因为 protobuf schema 支持 `trace_id`、`team_id` 等字段，就宣称官方本次 `le()` 一定会输出它们；必须区分 schema 能力、Provider 上下文和实际 wire 转换。

## 优先修复或核实项

### P1：消息 ID 与请求 ID 的作用域、生成和恢复

应先明确用户轮次、消息、单次 LLM 调用的边界，再按官方生成方式实现。重试、刷新和工具后续轮次不能无条件全部重建，也不能无条件复用一个 ID。当前 `build_upstream_body()` 每次构造都创建 UUID，调用方没有提供稳定上下文的通道。

### P1：会话与调用关联上下文未接通

当前已经补齐的是账号授权会话，包括 sgcookie、team、route region 等；这与 Agent 任务会话是两个层次。后者的 session、conversation、round、agent、span 并未完整实现。

有实际上下文时应一致传递，没有实际 Agent 身份或会话时应按接口约定处理，不能为了字段齐全编造已有的官方任务、Agent 或会话。单次 OpenAI API 请求与官方多轮 Agent Runtime 的产品行为也并不等价。

### P1：硬编码的 tenant / iai_tag 与当前官方 wire 转换不一致

当前本地总是发送 `tenant=accio-agent`、`iai_tag=phoenix-desktop`、`empid=""`。官方 ADK 0.3.32 的 `le()` 明确将这三项设为 `""`，随后 `qe.toJSON()` 省略空串，因此所核对的这条推理路径不会把这些旧值写入最终请求。

官方 Provider 内部仍有 iaiTag 属性，不能据此推断它最终被发送。是否有其他入口或版本不同，需要另行核实；本轮只确认这条具体转换链。

### P1：WAF / 响应异常诊断与错误体读取仍不完整

官方 transport 独立识别 `bxpunish` / `bxuuid` 并产生 `WAF_BLOCK`，记录最终响应 URL、是否重定向、内容类型及网关请求 ID。本地 Accio 路径没有对应的 WAF 响应头判断。

`chat::http_error()` 仍直接 `response.text().await`，没有该错误体专用的大小或读取时间上限。官方使用有上限的错误预览读取。现有全局超时不能替代这个更细的约束；遇到错误页或不收尾的响应体时，错误分类可能被拖到外层测试预算耗尽。

### P2：工具中断后的历史完整性处理不同

官方 `lat()` 会检查 assistant 工具调用是否缺少相应 tool result，并插入明确说明“结果因中断丢失，工具可能已执行也可能未执行”的错误结果。本地目前转换和归组已收到的消息，没有等价的缺失结果补全步骤。这里需要保持不重新执行工具的边界。

### P2：默认生成参数、媒体处理和传输策略存在差异

- 官方 Provider 在未指定输出上限时使用 `16384`；本地仅在客户端提供正数时发 `max_output_tokens`，因此请求的默认参数不相同。该值是客户端默认生成上限，不是模型目录声明的最大输出能力，不能填成目录能力值。
- 官方有图片解析/缓存、能力判定和按情况内联的步骤；本地远程图片直接映射 `file_data`，还将 MIME 默认写为 `image/png`。这在多模态请求中需要独立验证。
- 官方 gzip 是条件启用且可因网关不支持而降级的策略；本地直接发送未压缩 JSON。这是传输策略差异，未压缩不等于协议错误，也不能据此认定风控触发。

### P2：新流式诊断已经补上，但与官方完整 summary 不等价

本地现在记录接收字节、chunk、首行 / data / 内容类型、心跳、未知 / 错误帧及取消时计数。官方另外记录网关 request ID、最终 URL、SSE event 计数、clean EOF、结束原因、协议异常等信息。本地按行解释 `data:`，与官方 SSE event 解析和统计口径也有差异。

SDK JSON 日志目前没有挂上 `plan.request_id`；新 SSE 日志使用本地 telemetry ID。请求 ID 分层未接通时，并发场景下无法稳定串起“本地请求 → SDK → ADK → 官方用量消息”。此次检查的 debug_traffic 请求体仍是标准 messages/model/stream 形态，不能当作已保存的最终 ADK wire 请求来推导缺失的 ID。

## 已实现、无需按旧审查重复认定为缺失的部分

- v2 模型目录及代号路由；不回落 v1。
- OAuth 两阶段诊断、userinfo POST、sgcookie 保存与账号会话拒绝状态。
- SDK cookie 初始化、条件环境回退、失败 worker 退避恢复、脱敏错误码。
- Gemini 工具参数、thought signature、流式有效内容超时及明确结束校验。

这些功能已经有本地测试或部署证据，但不能因此称整个官方 Agent Runtime 已完整复现。

## 本地证据与范围

在 `/private/tmp/accio-id-context-audit-20261017/` 保存了官方函数摘录、纯合成执行脚本和 `identity-comparison.json`。对提取出的 `O_ / p1e / d1e`、`le()` 及 protobuf `toJSON()` 使用合成输入执行，验证了：

- 普通消息 ID 格式为 `AI_AccioWork_<32hex>_<毫秒时间戳>`。
- `request_id` 可取 LLM 调用 ID，`user_request_id` 保留用户轮次 ID，messageId 原样传递。
- 会话、轮次、Agent、parent span 在有上下文时会输出。
- `empid / tenant / iaiTag` 在这条转换链被清空并省略。

上述是本机官方版本源码与合成执行证据，不是新发出的官方真实请求抓包；没有通过本轮验证新的账号风控状态。修复顺序建议先 ID 与上下文、再实际 wire 字段与 WAF 诊断，最后处理工具恢复、媒体及传输差异。
