# 上游逐文件整合清单

基线 `95a647a9c8f801b93805050551326e3568ac5250`；上游正式版 `f8da217e5730d0c6063915898de6c8837ff491e5`；beta `5eadcf0d2f24c68a0c79645d29dcdffc8a83bd6e`。

初始合并分类仅表示文本可合并性；最终处理以「处理」和原因列为准。验收状态见 README.md。

| 路径 | 来源 | 处理 | 原因 |
|---|---|---|---|
| `.env.example` | 3.0.5 | 适配 | 保留本地 OAuth 与更新源；补齐库外密钥和默认关闭的自更新说明 |
| `.github/workflows/build.yml` | 3.0.5 | 适配 | 构建双架构资产与一致性检查，保留本仓库与默认关闭自更新 |
| `.github/workflows/frontend-artifacts.yml` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `Dockerfile` | 3.0.5 | 适配 | 构建双架构资产与一致性检查，保留本仓库与默认关闭自更新 |
| `README.en.md` | 3.0.5 | 保留 | 保留本地英文品牌与部署说明；不引入上游公开镜像配置 |
| `README.md` | 3.0.5 | 保留 | 保留本地部署、身份与私有镜像说明；新功能详见本次整合说明 |
| `agent.md` | 3.0.5 + beta | 保留 | 保留本地项目约定，不用上游开发指令覆盖 |
| `desktop-tauri/i18n/i18n-src/en/accounts.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/checkin.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/models.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/proxies.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/report.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/requests.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/settings.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/en/update.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/i18n/i18n-src/ja/accounts.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/checkin.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/models.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/proxies.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/report.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/requests.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/settings.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ja/update.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/i18n/i18n-src/ko/accounts.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/checkin.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/models.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/proxies.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/report.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/requests.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/settings.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/ko/update.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/i18n/i18n-src/pt-BR/accounts.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/checkin.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/models.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/proxies.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/report.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/requests.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/settings.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/pt-BR/update.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/accounts.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/checkin.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/models.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/proxies.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/report.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/requests.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/settings.json` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/i18n/i18n-src/zh-Hant/update.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/i18n/scan.mjs` | 3.0.5 | 适配 | 合并新增词条，保留定制界面词义，词典由构建生成 |
| `desktop-tauri/package.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/Cargo.lock` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/Cargo.toml` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/nsis-hooks.nsh` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/Cargo.toml` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/bin/agent2api-server.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/access.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/account_bootstrap.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/accounts.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/auto_continue.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/billing.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/chat.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/checkin_center.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/config_api.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/model_test.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/panel.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/pipeline.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/protocol.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/proxies.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/routing_api.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/stats_api.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/api/subscriptions.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/api/update.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/config/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/config/parse.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/config/types.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/account_store/sql.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/account_store/store_admin.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/account_store/store_view.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/api_keys.rs` | 3.0.5 | 适配 | 整合加密与历史格式，保留额度、有效期、限制及错误密钥拒绝鉴权 |
| `desktop-tauri/src-tauri/server/src/server/core/billing/activity.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/billing/checkin.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/billing/commodity.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/billing/request.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/billing/usage.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/checkin_records.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/client.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/crypto.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/custom_providers.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/debug_traffic.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/egress.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/legacy_api_key.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/protocol/antigravity_outbound.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/protocol/antigravity_stream.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/autoclaw/balance.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/codearts/balance.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/custom/emulation.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/custom/forward.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/loomy/balance.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/officeace/subscription.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/qoder/balance.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/raccoon/balance.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/trae/credentials.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/trae/refresh.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/workbuddy/adapter.rs` | 3.0.5 + beta | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/zcode/activation.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/zcode/balance.rs` | 3.0.5 + beta | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/providers/zcode/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/proxy_pool.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/proxy_settings.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/routing.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/sub_kernel/download.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/sub_kernel/mod.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/sub_kernel/runtime.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/subscriptions.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/update/check.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/update/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/update/selfupdate.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/update/token.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/update/version.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/aggregate.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/continuation.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/payload.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/provider_loop.rs` | 3.0.5 + beta | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/provider_loop/tests.rs` | 3.0.5 + beta | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/refusal.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/rotate.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/route_state.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/sse.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/usage.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/db/backup.rs` | 3.0.5 | 适配 | 保留任务/历史身份迁移、正文及清理策略，追加版本并适配加密恢复 |
| `desktop-tauri/src-tauri/server/src/server/db/migrate/requests.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/db/mod.rs` | 3.0.5 | 适配 | 保留任务/历史身份迁移、正文及清理策略，追加版本并适配加密恢复 |
| `desktop-tauri/src-tauri/server/src/server/db/schema.rs` | 3.0.5 | 适配 | 保留任务/历史身份迁移、正文及清理策略，追加版本并适配加密恢复 |
| `desktop-tauri/src-tauri/server/src/server/errors.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/http.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/logs_store/mod.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/mod.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/request_stats.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/aggregate.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/backfill.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/clock.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/daily.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/legacy.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/maintenance.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/record.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/report.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/server/src/server/request_stats/sql.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/server/static_files.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/server/src/web_shim.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/src/backend.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/src/bridge.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/src/commands.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/src/legacy_install.rs` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/src-tauri/src/lib.rs` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `desktop-tauri/src-tauri/tauri.conf.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui-islands/src/islands/accounts-credit-detail.tsx` | 3.0.5 + beta | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/accounts-domain.ts` | 3.0.5 + beta | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/accounts-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/accounts-panels.tsx` | 3.0.5 + beta | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/accounts-queue-drag.ts` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/accounts-shared.ts` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/checkin-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/checkin-records-tab.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/checkin-state.ts` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui-islands/src/islands/model-test-dialog.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/models-custom-source.ts` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui-islands/src/islands/models-fetch-modal.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/models-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/models-panel-state.ts` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui-islands/src/islands/proxies-columns.ts` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui-islands/src/islands/proxies-dialogs.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/proxies-kernel-dialog.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/proxies-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/proxies-state.ts` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/proxies-sub-state.ts` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui-islands/src/islands/proxies-sub-view.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/report-charts.ts` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/report-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/request-detail.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/requests-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/settings-model.ts` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/settings-page.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/settings-state.ts` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/update-modal.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/update-panel.tsx` | 3.0.5 | 适配 | 整合新增行为，保留 Base UI/shadcn 组件及现有交互 |
| `desktop-tauri/ui-islands/src/islands/update-shared.ts` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui/app.js` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/assets/app-icon-180.png` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/assets/app-icon-192.png` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/assets/app-icon-512.png` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/conversation-preview.js` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/layout.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/mobile.css` | 3.0.5 | 适配 | 保留本地 shadcn 抽屉/外壳，按需适配上游内容区响应式规则 |
| `desktop-tauri/ui/css/page-gateway.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/page-report.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/page-requests.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/page-settings.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/tokens.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/css/tooltip.css` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/i18n/en/accounts.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/checkin.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/models.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/proxies.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/report.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/requests.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/settings.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/en/update.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/accounts.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/checkin.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/models.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/proxies.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/report.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/requests.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ja/settings.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/accounts.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/checkin.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/models.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/proxies.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/report.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/requests.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/ko/settings.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/accounts.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/checkin.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/models.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/proxies.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/report.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/requests.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/pt-BR/settings.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/accounts.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/checkin.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/models.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/proxies.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/report.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/requests.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/settings.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/i18n/zh-Hant/update.js` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/icons.js` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/index.html` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/islands/ui.css` | 3.0.5 | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/islands/ui.js` | 3.0.5 + beta | 重新生成 | 从整合后的组件及多语言源码构建，禁止拼接压缩产物 |
| `desktop-tauri/ui/login.html` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/manifest.webmanifest` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui/mobile-columns.js` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui/preset-providers.js` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui/table-columns.js` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `desktop-tauri/ui/tooltip.js` | 3.0.5 | 适配 | 保留本地界面外壳、品牌及主题，适配新增能力 |
| `desktop-tauri/ui/units.js` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `docker-compose.yml` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
| `package.json` | 3.0.5 | 直接应用 | 固定快照内容；无本地业务差异 |
| `scripts/release.sh` | 3.0.5 | 适配 | 三方内容整合；保留本地鉴权、历史归属、记账及运行行为 |
