# 3.1.0 修复前审查记录（2026-10-18）

> 以下发现和测试表为修复前历史快照。F1–F8 已在本轮修复；当前实现、回归结果和验证边界见 [FIXES.md](FIXES.md)。contract-results.json、server-address-results.json、release-contract-results.json 已刷新为修复后的结果，旧失败输出保留在 contracts.log。

审查对象为 beta `c3f44e1dac951e77d17b61332e90b55457cfab80`；上游固定为 3.1.0 `072e3c71d253cd6dc265f3656d8cb481dd7c9f84`，比较起点 `4f0040f`。不把这次审查称为上游最新版本审查。

结论：整合仍存在遗漏和上游缺陷。现有回归全部通过，但新增合同测试复现 7 个失败点；地址解析另外有 3 个失败样例；Release 收集器有 2 项失败判据。APK 构建/签名通过不代表原生跨域登录可用。上一轮未覆盖这条路径，这次已用云端 APK 内实际网页资源复现。

## 路径与功能范围

391 条上游变更路径均已盘点（见 path-audit.json）。145 条与上游字节相同，246 条存在本地适配、产物重建或保留差异；该数字不代表 246 条都通过功能验收。文件缺失仅见有意不引入的 release-flow skill、上游 AGENTS、秘密扫描排除配置和重复的 assistant_sessions 后端模块。2171 个新增上游翻译键均存在，未发现缺键。

| 功能 | 审查结论 | 验证层级 |
|---|---|---|
| 移动网页/PWA | 同源登录、首页、更多、Agent 页面能打开；Agent DTO 有错 | 浏览器 + 隔离 API |
| Android APK | 云端 APK 构建、包名和签名已有验证；跨域登录失败 | APK 真实网页资源 + 原生标记模拟；无真机 |
| 多服务器管理 | HTTP LAN 地址归一正常，HTTPS/IPv6 处理错误 | 实际模块函数测试 |
| Agent 配置 | 管理员隔离、预览脱敏、有效 Key、Codex/Gemini 写入及双文件还原通过；WorkBuddy 提供商覆盖和恢复点问题复现 | 临时 HOME 与合成凭据 |
| 手机 Agent | 字段映射、还原参数不匹配 | 浏览器 + 实际 API |
| 旅行排程 | HH:MM 保存和共用队列已接；今日执行/结果摘要未接完 | 持久记录夹具 + API 合同 |
| 连登管家 | 保留批量签到后的上游自动补签/兑换/抽奖入口，解析单测通过 | 源码 + 单测；未消费真实卡/次数 |
| AI 助手思考等级 | 配置保存及既有流式 API 回归通过 | 隔离 API |
| 助手历史 | 保留本地 revision/软删除方案，未并行引入上游 sessions 表 | 历史/迁移/重启回归 |
| ChatGLM 任务/积分 | 新任务模块及积分/迁移代码存在，相关单测通过 | 单测/夹具；无真实登录调用 |
| 模型可见性、Qoder/Antigravity | 核心相关变更与上游一致，管理页面保留本地组件适配 | 源码 + 既有单测；未真实刷新提供商 |
| 昨日统计、日志 401 降噪 | 实现存在；只读接口可访问 | 源码 + API 冒烟 |
| Windows/Linux 服务端 | 构建作业和安装脚本已接；Windows Release 收集遗漏 | 源码 + 合成包收集测试；未安装系统服务 |
| 手机图标 | 当前资产存在，统一生成链缺口仍在 | 生成器源码审查 |

## 发现

### F1 [P1] APK 登录及续期的 CORS 请求头漏接

归类：整合遗漏。

OPTIONS /api/panel/login 返回 204，但 Access-Control-Allow-Headers 不含 x-panel-auth-mode。云端 APK 真实网页资源在跨域浏览器夹具中提交登录后停在 Failed to fetch。同源 /m 登录成功。

代码：[desktop-tauri/src-tauri/server/src/server/http.rs:55](/private/tmp/a2a-upstream-3.1.0/desktop-tauri/src-tauri/server/src/server/http.rs:55)

建议：合并 x-panel-auth-mode 与现有 x-agent2api-assistant 请求头；补跨域登录和刷新测试。

### F2 [P1] 服务器地址强制改为 HTTP，IPv6 也不被接受

归类：上游原有缺陷。

https://gateway.example:443 变成 http://gateway.example:443；https://gateway.example 变成 http://gateway.example:3065；http://[::1]:3065 变为空串。普通局域网 HTTP 地址正确。

代码：[desktop-tauri/mobile/src/lib/servers.ts:47](/private/tmp/a2a-upstream-3.1.0/desktop-tauri/mobile/src/lib/servers.ts:47)

建议：使用 URL 解析保留显式协议与端口，支持方括号 IPv6；只对缺省输入补协议和默认端口。

### F3 [P1] Agent 写入 WorkBuddy 时覆盖全部现有提供商

归类：上游原有缺陷。

临时 models.json 原有 keep-existing 提供商，应用网关 profile 后 providers 只剩 agent2api。other 字段保留。备份可以还原原始字节，但写入行为本身丢掉了其他提供商。

代码：[desktop-tauri/src-tauri/server/src/server/core/agents/apply.rs:202](/private/tmp/a2a-upstream-3.1.0/desktop-tauri/src-tauri/server/src/server/core/agents/apply.rs:202)

建议：按提供商 ID 合并/更新 agent2api 条目，保留其余提供商及原顺序。

### F4 [P2] 手机 Agent 的 DTO 与还原参数不匹配

归类：上游原有缺陷。

手机读取 path/applied/mode，服务端返回 configPath/viaGateway/configMode，因此路径显示 —、已接管的合成 Codex 仍显示未接管，且还原按钮不出现。手机还原提交 {id:codex}，实际 API 要 clientId，实测 404 未知客户端。

代码：[desktop-tauri/mobile/src/api/gateway.ts:407](/private/tmp/a2a-upstream-3.1.0/desktop-tauri/mobile/src/api/gateway.ts:407)

建议：统一 DTO 字段；还原请求发送 {clientId}；用真实后端快照做组件合同测试。

### F5 [P2] 旅行排程的执行状态和结果摘要没有接完

归类：适配未完成。

临时数据库写入当天已完成旅行记录后，接口 firedToday 仍为空、lastResult 仍为 null。run 接口只返回 summary.queued，前端却读取 actions/credit/failed，因此不能展示实际完成情况，还会把未返回的结果呈现成 0 动作、0 积分。

代码：[desktop-tauri/src-tauri/server/src/server/core/growth_scheduler.rs:8](/private/tmp/a2a-upstream-3.1.0/desktop-tauri/src-tauri/server/src/server/core/growth_scheduler.rs:8)

建议：从持久任务记录生成状态；将入队响应与完成摘要分开，前端轮询完成结果后再显示收益及失效缓存。

### F6 [P2] Windows 服务端没有接入 Release 附件收集和完整性校验

归类：整合遗漏。

合成完整 3.1 构建目录包含 Windows 服务端 ZIP 与 SHA256，collectAssets 仍只输出 9 项、不包含 Windows ZIP；validateRun 接受缺少 Windows 服务端的 3.1 构建。build.yml 已有 windows-server 作业。

代码：[scripts/release-assets.mjs:28](/private/tmp/a2a-upstream-3.1.0/scripts/release-assets.mjs:28)

建议：为 3.1 起的版本增加 Windows 服务端附件及 SHA256 校验，保留旧 tag 兼容。

### F7 [P2] 无效 Key 的失败应用会占据最近备份位置

归类：本次加固引入的恢复问题。

先成功应用 Codex，再用不存在的 gatewayKeyId 失败应用，最后点击按最近备份还原，得到的是第一次应用后的配置，而非首次应用前原文件。原因是创建备份早于 Key 校验，失败尝试也留下新的恢复点。更早备份仍在磁盘，不是永久丢失。

代码：[desktop-tauri/src-tauri/server/src/server/api/agents.rs:271](/private/tmp/a2a-upstream-3.1.0/desktop-tauri/src-tauri/server/src/server/api/agents.rs:271)

建议：在创建备份前完成所有可预检的 profile/Key 校验；失败尝试不覆盖最近成功应用对应的恢复入口，或允许选择恢复点。

### F8 [P3] 手机/PWA 图标的生成没有接入品牌脚本

归类：生成流程适配缺口。

当前 B 品牌图标文件已经存在，但 make-icon.mjs 只调用本地 generateRasters；该函数不生成 ui/assets/app-icon-180/192/512 和 maskable-512，也不生成 Android mipmap/splash。上游 rasterize/maskable 扩展没有移植到本地 B 品牌生成器。

代码：[assets/brand/generator/render.js:29](/private/tmp/a2a-upstream-3.1.0/assets/brand/generator/render.js:29)

建议：扩展现有品牌生成器统一输出手机、maskable 和 Android 图标，增加可复现检查。

另外，上游 c8ab7d6 的“Release 附件逐个上传”处理没有保留，本地仍整批上传。上游为规避其遇到的 422 冲突改为逐个上传；本次只确认代码差异，没有进行真实 Release 上传复测，因此不将其记成已复现的发布失败。

## 有意保留的差异

- 保留 AIBuddy 品牌、桌面安装标识和本 fork 更新仓库，不切回上游身份。
- 采用本地 schema 17 与带 revision 的助手会话历史，替代上游 schema 16 的 sessions 表。
- 旅行执行共用现有持久队列，避免第二个调度器；F5 是兼容视图没接完，而非要求恢复重复调度器。
- Agent 外部提供商配置暂时只读，自动写入限制为明确选择有效 Key 的本机网关配置。
- 不引入上游 secret_scanning 排除文件，继续使用本地环境变量凭据策略。
- 继续用本地 release 治理和组件库；窄屏筛选使用既有 Sheet。设置页保留本地分类导航，未采用上游二级返回布局。
- 手机助手保留上游的四项本地快捷查询范围，完整对话继续在桌面端使用。

## 本轮验证结果

| 检查 | 结果 |
|---|---|
| Rust 库 | 839 通过，0 失败，18 忽略 |
| Rust 服务端构建 | 通过 |
| Node UI 回归 | 31 个脚本通过 |
| shadcn 组件规范 | 通过 |
| 3.1 Agent/配置/历史 API 基线 | 通过（脚本计数包含启动轮询，数目会轻微变化） |
| 助手 API | 69 项通过 |
| 3.0.8 API 兼容 | 56 项通过 |
| 账号历史迁移/删除/重启 | 通过 |
| 任务中心 | 59 项通过 |
| WorkBuddy 成长 API | 69 项通过 |
| 既有 Release 模拟 | 23 场景通过 |
| 新增合同测试 | 3 通过，7 失败；失败即上述问题，脚本退出码 1 |
| 地址归一化 | HTTP 样例通过；2 个 HTTPS 和 1 个 IPv6 样例失败 |
| 新增 Release 收集验证 | Windows 包未收集、缺包被接受，两项均复现 |
| 浏览器 | 同源 PWA 登录成功；APK 网页资源跨域登录失败；手机 Agent 错误状态可见 |

任务测试最初因系统 Python 缺 cryptography 中断，改用已经安装该依赖的 Codex 工作区 Python 后，59/69 项均完成通过。没有为测试安装新的 Python 依赖。

## 复现与证据

从仓库根运行：

```sh
python3 docs/aibuddy-port/upstream-3.1.0/review/test-contracts.py
node docs/aibuddy-port/upstream-3.1.0/review/test-release-contract.mjs
node docs/aibuddy-port/upstream-3.1.0/review/test-server-address.mjs
```

- contract-results.json / contracts.log：新增接口及文件保留/恢复合同结果。
- server-address-results.json：实际 normalizeBase 输出。
- release-contract-results.json：合成构建附件收集结果；从未调用 gh 发布。
- path-audit.json：391 路径比较与缺失新增行候选（候选是审查索引，不等同于缺陷）。
- 各 *.log：本轮回归输出。
- apk-login-failure.png、mobile-agent-fields.png：隔离浏览器截图。

以上为修复前只读审查范围；随后已获用户授权修复、补齐、测试并推送 beta，详情见 FIXES.md。CodeGraph 经用户批准初始化，991 文件、26341 节点、99019 边。未使用真实客户端配置、账号凭据；未执行真实签到、补签、兑换、抽奖、模型转发或系统服务安装。原 3065 服务保留。
