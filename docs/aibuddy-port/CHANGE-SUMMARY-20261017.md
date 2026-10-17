# 2026-10-17 源码更新：3.0.8 整合与 Accio ADK v2 修复

本次整理相对本仓库 `d3f9314` 的累积源码改动。版本号保持 3.0.8；包含上游正式版与选定 beta 功能、本地兼容修复、生成的 UI/语言资源、测试及审查文档。推送源码与创建安装包 Release 是两个步骤，本次不创建新 tag、不触发手动正式发布。

## 1. 上游 3.0.8 与 beta 整合

上游比较基线为 `a55e1eb`（3.0.7），正式版目标 `68d0a4e`，继续纳入 beta 至 `4f0040f`。279 个上游路径的逐项处理记录见 [整合说明](upstream-3.0.8/README.md)和 [文件清单](upstream-3.0.8/inventory.json)。

| 范围 | 改动与实际行为 | 主要文件 |
| --- | --- | --- |
| 凭据文件导入 | 小浣熊、CatPaw、Cline Pass 与 KukuAI 对应文件导入；区分文件副本与本机实时读取，临时敏感文件按权限约束清理 | `api/accounts.rs`、提供商 credentials、添加账号组件 |
| 智谱清言 | 新增访客及登录账号、目录、转发、余额和签到；访客不虚构积分权益，续期比较旧凭据后回写，账号代理保持一致 | `providers/chatglm/`、`account_store/chatglm_accounts.rs`、`protocol/chatglm_stream.rs` |
| 角色兼容 | 新增默认开启的 developer → system 出站转换开关，只修改发送副本，关闭后透传原角色 | `api/role_compat.rs`、`upstream/payload.rs`、设置页 |
| OrcaTerm、CodeArts、Cline、ZCode | 补齐 OAuth 扫码及回调、授权打开方式、Cline 模板、ZCode 端点映射；保留本地自动通道和独立冷却 | `providers/orcaterm/login.rs`、桌面 login、`zcode/endpoint_mapping.rs` 等 |
| Antigravity、Loomy | 工具思考签名缓存、额度窗口和请求兼容、模型图片能力处理 | `protocol/antigravity_signature_cache.rs`、对应提供商模块 |
| 报表与数据库 | 缩小查询列、补充索引和 SQL 聚合，避免数据相同时无意义重绘；schema 16 → 17 保留助手历史和既有数据策略 | `request_stats/`、`db/schema.rs`、`report-page.tsx` |
| 代理与账号池 | 监听器与引用对账，订阅／Clash 入口调整，保留禁用和手动停止语义；继续完善任务、补偿、积分和账号分组交互 | `proxy_pool.rs`、`billing/`、账号及代理组件 |
| 更新与平台 | beta 通道默认关闭；识别正式定制后缀，新增 Linux deb/AppImage 构建与更新支持，保留双架构服务端包 | `core/update/`、桌面 update、Linux Tauri 配置、工作流 |
| 文档与界面资源 | README 多语言分流到 docs，更新截图与上游支持入口，重建语言和 React 岛产物，修正 GFM 表格 | README、`docs/README.*`、i18n、`ui/islands/`、`ui/markdown.js` |

保持本仓库品牌、更新源、私有 GHCR 策略、AI SDK 助手及其历史/工具确认、任务中心、数据保留策略和管理权限。Antigravity OAuth 继续使用环境变量，不恢复旧的硬编码敏感信息。

## 2. Accio 目录、登录与授权会话

问题：旧目录和请求假设与本机官方 Accio 0.34.5 / ADK 0.3.32 存在差异，登录拒绝、会话失效、账号限制和流式错误容易混在一起。

- 模型目录统一使用 `/api/llm/config/v2`，独立维护国际／国内目录，按真实代号路由；不回落 v1，刷新失败保留已有 v2 快照。
- 保留目录提供的权限、图片能力、图片数量、默认思考档位及计费信息；目录未声明的最大输出保持未知。`16384` 仅为缺省生成参数。
- OAuth 两阶段记录脱敏诊断，按官方协议查询用户资料，完整解析 HTTP 与业务错误；失败不伪装成添加成功。
- 保存与当前账号绑定的 sgcookie、sid、团队、路由地区、设备及时区上下文。新授权不继承旧会话的安全状态。
- 会话恢复有条件、有次数上限；明确账号限制、WAF、已输出内容和不安全重放状态不会盲目刷新或重试。

涉及 `accio/models.rs`、`auth.rs`、`oauth.rs`、`credentials.rs`、`login_http.rs`、`session.rs`、`refresh.rs` 及账号存储。详见 [登录验证](ACCIO-LOGIN-LOCAL-VALIDATION-20261017.md)与 [会话验证](ACCIO-SESSION-LOCAL-VALIDATION-20261017.md)。

## 3. SecurityGuard 适配

- 通过独立 Node worker 加载部署环境提供的官方原生 `.node` 模块，执行加载、初始化与每次请求的因子生成。
- 支持 `auto`、`required`、`off`，保留初始化、cookie、原生错误码及受控回退信息；失败 worker 可退避恢复，串行生成因子，成功状态按绑定缓存。
- 因子绑定最终请求 URL，发送前生成；拒绝非法输出、请求头注入和凭据覆盖。SDK 日志与调用 ID 关联，避免记录 Cookie、token 或因子值。
- 仓库只包含桥接和配置逻辑，不复制官方原生 SDK、官方安装包、账号 Cookie 或本地 Node 二进制。

配置及依赖见 [SecurityGuard 部署说明](ACCIO-SECURITY-GUARD.md)，实现位于 `accio/security_guard.rs` 和 `security_guard.cjs`，合成桥接回归位于 `scripts/test-accio-security-guard.mjs`。

## 4. ID 生命周期、上下文与错误诊断

- 分离 message ID、用户轮次 ID、单次 LLM 调用 ID；普通任务 ID 使用官方客户端的 `AI_AccioWork_…` 规则。同次授权恢复重发保持标识稳定，新调用独立生成 LLM ID/span。
- 承接 conversation、session、round、agent、父 Agent 与调用 span，校验冲突和长度；隔离账号及地区上下文，避免跨账号复用。
- 请求转换省略当前官方 wire 路径不发送的旧 tenant/iai_tag/empid 值。
- 下游返回可用于工具后续调用的 `accio_context`，尝试明细保存脱敏的 identity、SDK、transport、stream、media 和 compression 诊断。
- 独立识别 WAF 响应头、跳转、账号限制、401、额度、业务码、传输和协议错误；错误体读取限制大小与时间，不输出原始挑战页。

涉及 `accio/identity.rs`、`transport.rs`、`adk_error.rs`、`chat.rs`，以及 `upstream/usage.rs`、请求明细持久化。详见 [ID 与上下文验证](ACCIO-ID-CONTEXT-LOCAL-VALIDATION-20261017.md)。ID 前缀或本地测试本身不能证明风控原因或账号已恢复。

## 5. 工具、图片、gzip 与完整 SSE

### 工具调用与中断历史

Gemini 工具参数按实际发送协议归一，保留思考签名、并行工具及分片参数。assistant 工具调用缺少连续结果时，补入明确的错误结果，说明结果因中断丢失、工具可能执行也可能未执行；已有结果不覆盖，不重新执行工具。

### 图片解析

发送前按模型能力和 `maxImages` 准备图片，解析 data URI 或下载公网 HTTPS 图片，依据内容识别和验证 MIME。支持 PNG/JPEG/WebP，BMP/ICO 转 PNG；设置下载时间、大小、累计数据和解码分配限制，大图缩放，请求内缓存重复图片。下载不携带 Accio 凭据/SDK 头；本地文件、内网、错误格式、下载失败或模型无图片能力时使用明确占位。

图片缓存没有复制官方跨请求 LRU；GIF、HEIC 等尚无等价转换器，返回明确错误占位。使用显式代理时目标 DNS 最终由该代理处理。

### 条件 gzip

默认关闭，通过 `ACCIO_REQUEST_GZIP=true` 或 `1` 显式启用。至少 4096 字节、压缩有收益且没有已有编码/内联图片时使用 gzip level 6。仅 415 且无 WAF/跳转拒绝时原文回退一次，保持 ID、上下文、SDK 因子和总响应头预算；之后本进程按网关 origin 停用压缩。401、403、429、500、WAF 和成功内容不触发此回退。

### SSE 与流式异常

原始字节先组装完整 event，支持 BOM、LF/CRLF/CR、多行 data、跨块 UTF-8、event/id/retry、注释心跳及真实 EOF 尾事件，再交给 ADK 帧解析。预读与后续消费共享规范化记录，修复同块后续数据丢失；有效内容后同块发生解析错误时保留已收到内容并报错。

只有明确结束且已有输出才成功收尾；心跳不延长有效内容等待，取消保存未完成 event 诊断。保留严格异常语义，不将提前断流、非法 JSON、非法 UTF-8 或未知业务数据包装成成功。`id/retry` 解析不等于自动重连或重放。

实现位于 `accio/protocol.rs`、`media.rs`、`compression.rs`、`sse.rs`、`stream_diagnostics.rs` 与 `chat.rs`。详见 [本地验证](ACCIO-TOOLS-MEDIA-SSE-LOCAL-VALIDATION-20261017.md)和 [部署验证](ACCIO-TOOLS-MEDIA-SSE-DEPLOYMENT-20261017.md)。

## 6. 验证与交付边界

最新 Accio 修复后的全量服务器回归为 **804 通过、0 失败、15 跳过**；独立本地回归覆盖 **8 个 gzip 场景、11 个会话场景、18 个 SDK 桥接场景**。测试仅使用隔离目录、合成凭据、localhost 上游及 SDK 替身，未运行真实账号探针。

此前 3.0.8 整合阶段还记录了 29 组前端专项回归、10 组既有隔离 API/安全回归、新增 56 项 HTTP 检查、23 项发布脚本夹具，以及生成文件确定性检查；这些是对应阶段的记录，详见原整合文档。本次提交整理会另记录当前复核结果，不把旧数字当作新执行结果。

现有 3065 服务已在上一轮用最新二进制重编译部署，健康、首页、面板状态、接口清单和未登录鉴权检查通过。该验证未触发官方账号请求或官方 SDK 初始化；gzip 仍保持默认关闭。本次提交整理不再次重启服务。

数据库、密钥、Cookie、日志、PID、备份、编译目录及临时验证文件不属于提交内容。上述验证不证明官方账号推理成功、账号限制解除、所有媒体格式等价、真实图片下载成功、跨平台安装包可用或新 Release 已发布。
