# AIBuddy-Panel 逐文件处理清单

共 226 条基线到分支的差异。完整 blob 与最终 SHA-256 见 `file-inventory.json`。

| 分支路径 | 处理方式 | 落地路径（不同才标注） |
|---|---|---|
| `.github/workflows/docker.yml` | 移植手动版本与 v 前缀标签、owner 小写 | — |
| `CHANGELOG.md` | 原文归档 | `docs/aibuddy-port/AIBUDDY-CHANGELOG.md` |
| `Dockerfile` | 保持 agent2api 身份（仅改名差异） | — |
| `PITFALLS.md` | 原文归档 | `docs/aibuddy-port/AIBUDDY-PITFALLS.md` |
| `README.en.md` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `README.md` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `assets/brand/README.md` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/favicon.ico` | 导入新增素材 | — |
| `assets/brand/generator/gen.js` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/generator/package.json` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/generator/render.js` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/logo-horizontal-dark.svg` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/logo-horizontal.svg` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/logo-icon.svg` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/logo-stacked-dark.svg` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/logo-stacked.svg` | 应用（归一化 agent2api 身份） | — |
| `assets/brand/png/logo-horizontal-dark@2x.png` | 导入新增素材 | — |
| `assets/brand/png/logo-horizontal@2x.png` | 导入新增素材 | — |
| `assets/brand/png/logo-icon-128.png` | 导入新增素材 | — |
| `assets/brand/png/logo-icon-192.png` | 导入新增素材 | — |
| `assets/brand/png/logo-icon-32.png` | 导入新增素材 | — |
| `assets/brand/png/logo-icon-512.png` | 导入新增素材 | — |
| `assets/brand/png/logo-icon-64.png` | 导入新增素材 | — |
| `assets/brand/png/logo-stacked-dark@2x.png` | 导入新增素材 | — |
| `assets/brand/png/logo-stacked@2x.png` | 导入新增素材 | — |
| `assets/brand/preview.html` | 应用（归一化 agent2api 身份） | — |
| `assets/screenshots/accounts.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/add-account.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/docs.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/keys.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/overview.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/report-overview.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/report-trends.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/scheduled-tasks.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `assets/screenshots/settings-brand.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/package.json` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `desktop-tauri/src-tauri/Cargo.lock` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `desktop-tauri/src-tauri/Cargo.toml` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `desktop-tauri/src-tauri/icons/128x128.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/128x128@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/32x32.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/64x64.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square107x107Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square142x142Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square150x150Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square284x284Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square30x30Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square310x310Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square44x44Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square71x71Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/Square89x89Logo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/StoreLogo.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-hdpi/ic_launcher.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-hdpi/ic_launcher_foreground.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-hdpi/ic_launcher_round.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-mdpi/ic_launcher.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-mdpi/ic_launcher_foreground.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-mdpi/ic_launcher_round.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xhdpi/ic_launcher.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xhdpi/ic_launcher_foreground.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xhdpi/ic_launcher_round.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher_foreground.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher_round.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_round.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/android/values/ic_launcher_background.xml` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/icon.icns` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/icon.ico` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/icon.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-20x20@1x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-20x20@2x-1.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-20x20@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-20x20@3x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-29x29@1x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-29x29@2x-1.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-29x29@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-29x29@3x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-40x40@1x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-40x40@2x-1.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-40x40@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-40x40@3x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-512@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-60x60@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-60x60@3x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-76x76@1x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-76x76@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/icons/ios/AppIcon-83.5x83.5@2x.png` | 保留原图标/截图；源变更存于补丁归档 | — |
| `desktop-tauri/src-tauri/server/Cargo.toml` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `desktop-tauri/src-tauri/server/src/bin/agent2api-server.rs` | 保留 agent2api-server 二进制名 | — |
| `desktop-tauri/src-tauri/server/src/bin/aibuddy-panel-server.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/lib.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/access.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/account_test.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/accounts.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/accounts_usage.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/audit_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/backup_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/branding.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/chat.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/codex_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/debug_api.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/api/embeddings.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/growth_tasks.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/health.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/key_quota_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/keys_api.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/maintenance_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/mod.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/notify_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/panel.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/pipeline.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/probe_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/protocol.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/api/sessions_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/shutdown_api.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/api/storage_api.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/config/mod.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/account_store/codearts_accounts.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/account_store/mod.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/account_store/store.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/api_keys.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/auth.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/auto_checkin.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/backup.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/checkin.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/expert.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/gift.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/growth.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/mod.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/report.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/request.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/streak.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/travel.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/billing/trial.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/growth_actions.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/growth_queue.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/growth_schedule.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/key_quota.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/key_scope.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/login/codearts.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/mod.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/notify.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/probe.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/catpaw/adapter.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/cline/keys.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/cline/mod.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/codearts/mod.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/codearts/models.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/codearts/welfare.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/workbuddy.rs` | 迁入新版 WorkBuddy 模块目录 | `desktop-tauri/src-tauri/server/src/server/core/providers/workbuddy/growth.rs` |
| `desktop-tauri/src-tauri/server/src/server/core/providers/zcode/balance.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/providers/zcode/credentials.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/server/core/update/token.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/update/version.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/core/upstream/provider_loop.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/core/usage_query.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/server/src/server/db/mod.rs` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `desktop-tauri/src-tauri/server/src/server/db/schema.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/http.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/logs_store/mod.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/mod.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/server/src/server/request_stats.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/server/src/server/static_files.rs` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/src-tauri/server/src/web_shim.rs` | 冲突已适配并合并 | — |
| `desktop-tauri/src-tauri/src/bridge.rs` | 保留原 crate 名，补齐品牌桥接 | — |
| `desktop-tauri/src-tauri/src/gateway.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/src/lib.rs` | 三方合并 | — |
| `desktop-tauri/src-tauri/src/login.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/src/settings/mod.rs` | 保持 agent2api 身份（仅改名差异） | — |
| `desktop-tauri/src-tauri/tauri.conf.json` | 保留新版元数据/数据路径；见报告兼容说明 | — |
| `desktop-tauri/ui-islands/package-lock.json` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui-islands/package.json` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui-islands/src/islands/accounts-data.ts` | 新版实现已覆盖，无需回退 | — |
| `desktop-tauri/ui-islands/src/islands/accounts-domain.ts` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/accounts-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/accounts-panels.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/credits-page.tsx` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui-islands/src/islands/docs-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/keys-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/login-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/logs-panel.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/models-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/port-panel.tsx` | 三方合并 | — |
| `desktop-tauri/ui-islands/src/islands/report-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/settings-model.ts` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/settings-page.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-islands/src/islands/settings-remote-sync.tsx` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui-islands/src/islands/settings-state.ts` | 三方合并 | — |
| `desktop-tauri/ui-islands/src/islands/tasks-panel.tsx` | 冲突已适配并合并 | — |
| `desktop-tauri/ui-kit/styles/theme.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/app.js` | 冲突已适配并合并 | — |
| `desktop-tauri/ui/brand/favicon.ico` | 导入新增素材 | — |
| `desktop-tauri/ui/brand/logo-horizontal.svg` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/brand/logo-icon-128.png` | 导入新增素材 | — |
| `desktop-tauri/ui/brand/logo-icon-64.png` | 导入新增素材 | — |
| `desktop-tauri/ui/css/components.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/layout.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/login-extras.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/mobile.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/notify-center.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/page-accounts-providers.css` | 三方合并 | — |
| `desktop-tauri/ui/css/page-accounts-table.css` | 三方合并 | — |
| `desktop-tauri/ui/css/page-accounts.css` | 新版实现已覆盖，无需回退 | — |
| `desktop-tauri/ui/css/page-gateway.css` | 三方合并 | — |
| `desktop-tauri/ui/css/page-report.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/page-requests.css` | 三方合并 | — |
| `desktop-tauri/ui/css/page-settings.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/prefs.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/shell.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/tags-view.css` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/css/tokens.css` | 三方合并 | — |
| `desktop-tauri/ui/icons.js` | 冲突已适配并合并 | — |
| `desktop-tauri/ui/index.html` | 冲突已适配并合并 | — |
| `desktop-tauri/ui/islands/ui.css` | 从合并后源码重新构建 | — |
| `desktop-tauri/ui/islands/ui.js` | 从合并后源码重新构建 | — |
| `desktop-tauri/ui/js/login-extras.js` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/js/notify-center.js` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/js/prefs.js` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/js/shell.js` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/js/tags-view.js` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/js/user-menu.js` | 应用（归一化 agent2api 身份） | — |
| `desktop-tauri/ui/login.html` | 三方合并 | — |
| `docs/OPEN-SOURCE-REFERENCES.md` | 应用（归一化 agent2api 身份） | — |
| `package.json` | 保留新版元数据/数据路径；见报告兼容说明 | — |
