# Accio 工具历史、图片、条件 gzip 与 SSE event 本地验证

本轮是在上一轮 ID、上下文与 WAF 修复之后继续补齐四项差异。只修改源码并进行隔离本地验证；未重启正在运行的服务，未使用真实账号调用官方登录、模型目录、推理或初始化官方原生 SDK。

## 对照来源

本机 `/Applications/Accio.app/Contents/Info.plist` 本轮确认版本为 0.34.5。对照此前提取的 ADK 0.3.32 `gateway-worker.js`，SHA-256 为 `b42bb8d4c524600d78592a1cdf1c4472e961fa1ae3144f23f3f41bf14db8853d`。静态摘录保存在本轮证据目录的 `official-excerpts.json`。

| 项目 | 官方路径 | 本轮实现 |
| --- | --- | --- |
| 工具结果完整性 | `lat()` 在连续 tool 结果之后插入缺失结果 | `protocol::complete_tool_results()`，在转换/角色归组之前补齐，已有结果和顺序保留 |
| 图片解析 | `Lot / zot / ImageCache.resolveMessages / normalize` | `media::prepare()`，能力判定、下载/内联、内容识别与解码、尺寸限制、请求内重复解析缓存、失败占位 |
| 条件 gzip | `zat / Hat / Qt / Xt / maybeDowngradeCompression` | `compression` 与 `chat::send_inner()`，显式开关、4096 字节阈值、level 6、有效压缩、仅 415 降级 |
| SSE event | `zr / Br` 按 event 边界、多行 data 拼接及 EOF 尾事件处理 | `sse::Decoder` 在诊断观察层统一组装原始字节，规范化成 ADK data 记录后供预读及响应消费共用 |

## 实际行为

工具中断结果用 `is_error=true` 和官方的明确说明：`The tool may or may not have executed.` 不重新执行工具，不将“不知道结果”误写成“工具未执行”。只检查当前 assistant 工具调用后连续的结果块；后续其他轮次的同名工具结果不能替代当前缺失项。

媒体在请求捕获和发送前准备。PNG/JPEG/WebP 根据内容识别并验证；BMP/ICO 转 PNG。大图最长边收敛至 1600，单张下载 16 MiB、累计图片数据 32 MiB，最多 64 张，并尊重目录声明的更小 `maxImages`。下载和本次图片准备均有 30014 毫秒上限；解码有尺寸/分配限制。媒体请求使用账号所选出口，但不携带 Accio token、Cookie、SDK 因子、设备头或调用 ID。解析失败以带错误码的文本占位，不再把 URL 一律标作 PNG。

gzip 默认关闭，对应官方灰度开关默认 false。本网关没有官方 feature-flag 服务，使用部署环境 `ACCIO_REQUEST_GZIP=true` 或 `1` 显式启用。小于 4096 字节、已经指定编码、含内联图片或压缩不划算时保持原文。压缩请求收到 HTTP 415 且不存在 WAF/重定向拒绝时，最多以原文重发一次；保留相同 URL、ID、span 和 SDK 因子，两个发送共用一个响应头时间预算。同时在本进程按网关 origin 停用压缩，后续请求记录 `runtime_disabled`。401/403/429/500、WAF、成功内容均不触发压缩降级。

SSE 解析支持 BOM、LF/CRLF/CR、任意传输字节拆分、UTF-8、多行 `data`、`event`、注释、`id`、`retry`、空字段，以及真实 EOF 时最后一个未结束的 event。`id/retry` 仅按协议解析和计数，本轮没有增加自动重连或重放。收到明确完成标记且已有内容后，仍立即结束；心跳不能延长有效内容等待，提前 EOF、非法 JSON、未知 ADK 数据或非法 UTF-8 仍报错。取消时保留未完成 event 的字节数，不虚构一个已接收事件。有效内容后同一 chunk 内出现非法 UTF-8 时，先保留已生成内容，再输出错误。

诊断新增 `accioMedia`、`accioCompression`，流式新增 event、有效 id/retry 事件计数及 clean EOF 标志。只保存计数、受控错误码和已有调用关联，不记录图片 URL、正文、事件名称、Cookie 或签名。`dataFrames` 现在按拼接后的 data event 计数，不再把每个物理 data 行算成独立帧。

## 与官方仍有意保留的范围差异

- 图片缓存只在单次请求内复用；没有照搬官方跨请求的 200 MiB/500 条 LRU。
- 远程图片限定公网 HTTPS/443，每次跳转重新校验目标。直连固定已校验的 DNS 地址；使用显式代理时，目标 DNS 最终仍由所配置代理处理。HTTP、内网、带用户密码、文件及其他本地引用被替换为明确占位。不会读取任意本地文件。
- 当前支持 PNG/JPEG/WebP/BMP/ICO；GIF、HEIC 等尚无官方 sharp 等价转换器，返回 `mime_conversion_failed` 占位。不能称为官方所有格式转换能力已完整复现。
- SSE 非法数据沿用网关严格失败语义；官方 transport 某些 JSON 解析错误会计数后继续。本轮不把异常流降格成成功。
- 压缩停用作用域为本进程的网关 origin；官方作用域是 transport 实例。

## 验证结果

证据目录：`/private/tmp/accio-tools-media-sse-local-20261017/`，测试使用该目录下的独立 `AGENT2API_PROXY_HOME`，SDK 关闭或使用已有合成 worker。

- `cargo test --offline -p agent2api-server --lib --no-fail-fast`：**804 passed, 0 failed, 15 ignored**。未运行被忽略的真实账号探针。
- 单独运行 `local_gzip_transport_regression`：**1 passed**，涵盖 8 个 HTTP/媒体场景，并验证 415 后后续请求停用压缩、原文与压缩请求全部 JSON 字段一致。仅 localhost 合成服务。
- 单独运行 `local_session_transport_regression`：**1 passed**，原有 11 个会话、SDK 替身、WAF 和重定向场景继续通过。
- `node scripts/test-accio-security-guard.mjs`：**18 scenarios passed**。
- 新增工具缺失结果顺序和不覆盖已有结果、SSE 任意字节拆分/多行/尾事件/非法 UTF-8/未完成 event 等待、非法多行 JSON 不转成有效内容、图片内容 MIME/缓存/能力/限制/BMP 转换/缩放/私网目标拒绝等测试。
- `git diff --check` 通过。

上述结果不等于真实公网图片下载、官方网关压缩接受情况或真实账号推理已验证。本轮没有更新服务二进制或重启进程；当前服务尚未加载这些新增代码。
