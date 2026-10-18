# 上游 3.1.0 集成记录（beta）

上游： https://github.com/Agent2API/agent2api 。来源提交 `072e3c71d253cd6dc265f3656d8cb481dd7c9f84`，内容比较基线 `4f0040f`；本地基线 `c2dbc847a714ab2436a284bf46a78a66d98c7cb0`。双方没有共同 Git 祖先，按文件进行三方内容适配，路径决策见 inventory.json。

## 本次范围

- 合入手机 Web/PWA、Capacitor Android 客户端、Agent 配置页、思考等级、昨日统计，以及 ChatGLM/Qoder/WorkBuddy 等上游改进。
- 保留 AIBuddy 图标、既有桌面安装标识、Accio、任务持久队列、SQLite schema 17 和带 revision 的助手会话历史。没有并行引入上游 assistant_sessions 表。
- 旅行新接口适配现有持久调度器，支持 HH:MM 时刻，不再启动第二个消费相同 growthSchedule 配置的调度器。
- 批量签到后复用上游连登管家：自动补签、兑换档位、用完已有抽奖次数；没有改为本地只读 rewards 任务。
- Agent 配置保存只存网关 Key ID。只有管理员能访问；推理 Key 无权访问。实际写入时验证启用、有效期、模型及提供商权限、本机地址和当前网关端口，才读取真实凭据。
- 写入前必须成功备份；失败中止。Gemini settings.json 与 .env 同时备份/还原，记录原先不存在的文件；写入失败回滚。备份和新配置使用私有权限，拒绝覆盖符号链接。预览清除现有及新增凭据。
- 当前 Agent 自动写入范围限定为本机网关配置。官方/中转等外部配置可查看，暂不支持凭据迁移与自动写入。

## Android

名称 AIBuddy Panel，正式包名 com.aibuddy.panel.mobile，调试包附加 .debug。图标使用本仓库 B 标识。版本 3.1.0。关闭 Android 系统备份，避免 WebView 内的连接状态进入系统备份。

.github/workflows/android.yml 在 beta 变更或手动触发时使用 JDK 21 / Android SDK 36 编译调试包和未签名正式包，仅授予 contents:read，产物 android-apks 保留七天。正式密钥不上传 GitHub。依用户要求，不在本机安装 SDK 或编译 APK；下载云端对齐的正式 APK 后，在本机签名。签名文件位于忽略的 data/local/android-signing，后续同包覆盖升级应继续使用该密钥。

## 验证与边界

- Rust 库回归、桌面/移动前端类型检查与构建、组件规范检查及现有 Node UI 回归。
- 新增 scripts/test-upstream-3.1.0.py：在临时 HOME、空账号、合成凭据下验证管理员隔离、预览脱敏、网关 Key、备份失败中止、Codex/Gemini 还原、共享调度与原会话 schema。
- 既有助手 API、3.0.8 API 和历史迁移回归仍运行。
- 浏览器以隔离服务验证手机登录、首页、助手及桌面 Agent 页；没有修改真实 AI 客户端配置或执行真实账号奖励操作。
- 手机助手遵循上游范围：四项本地快捷查询，完整流式会话继续在桌面端使用。
- 3.1.0 beta 集成与 APK 构建不等于正式 Release 发布；本次不创建 3.1 tag、不推进 main。现有 3065 服务保持原进程。
