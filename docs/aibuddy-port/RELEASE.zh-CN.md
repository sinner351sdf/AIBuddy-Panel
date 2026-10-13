# 干净发布分支与 OAuth 环境配置

日期：2026-10-13。

## 发布来源与历史

- 本地备份分支：`codex/merge-aibuddy-panel`，保持 `d9b04c0723936b3c8a68047899ab6969927c36d6` 不变。该分支及其上游历史仍包含旧常量，仅留本机，不推送。
- 发布分支：`codex/aibuddy-release`。
- 发布父提交：AIBuddy-Panel `main` 的 `31ec0379c827963330b4d8b58b729804fdae715c`。
- 发布树：原移植后的完整工作区快照，加本页所述凭据修复、配置文档与测试。保留 agent2api 3.0.1 新版功能，而非只向旧分支复制增量文件。

推送原分支时，GitHub Push Protection 在上游历史中检出 Google OAuth Client ID 和 Client Secret；当前源代码也包含相同值。本次删除这些硬编码值，用目标仓库既有历史承载经过清理的最终文件树，不连接含敏感内容的 agent2api 历史父提交。原始移植来源、差异和测试仍由本目录记录。不会强制推送或覆盖目标 `main`，也不关闭 Push Protection。

## 运行配置

仅使用 Antigravity 网页登录、授权码换取令牌或刷新令牌时，需要服务进程同时设置：

```text
AGENT2API_ANTIGRAVITY_CLIENT_ID
AGENT2API_ANTIGRAVITY_CLIENT_SECRET
```

没有内置值或默认凭据。缺失、空白或不可解码的环境变量会被视为未配置；错误只显示需要设置的变量名，不输出已配置值。网页登录在创建任务/访问 Google 之前失败；令牌交换/刷新在网络请求前返回配置错误。未配置时仍可启动网关，其他提供商不受影响；已有未过期访问令牌可继续使用，后续刷新必须配置这些变量。

两项应是有权使用、且与账号 refresh token 对应的 OAuth 客户端配置。不能假定换用任意 Google OAuth 客户端就能访问 Antigravity 所需的权限和接口；本次没有真实 Google 账号联调，也不会从本地备份自动恢复旧值。

项目根目录 `.env.example` 保留原有示例并追加这两个空项。复制为被 Git 忽略的 `.env` 后，只在本机填写真实值：

- Docker Compose 会把 `.env` 中的两个变量传入容器；使用修改后的本地源码构建镜像后重新创建服务。
- 本机运行在同一终端导出变量，然后执行 `sh scripts/start-local.sh`。也可执行 `set -a; . ./.env; set +a`，但 `.env` 必须是可信的合法 shell 赋值文件，特殊字符需要加引号。
- 桌面程序需要从继承相应变量的环境启动；不要把秘密写进 UI、源码、启动脚本或提交信息。
- 配置修改后重启对应进程。本次验证使用隔离服务，没有替换正在运行的用户服务或其数据库。

## 验证

| 检查 | 结果 |
|---|---|
| OAuth 配置与授权地址单元测试 | 新增 4 项通过：去除两侧空白、缺失/空白配置错误、错误消息不包含配置值、URL 参数编码与 secret 不进入 URL |
| 全量 Rust 测试 | 401 通过、0 失败、6 忽略；另 1 个文档测试忽略 |
| 隔离 OAuth HTTP 回归 | 37 项断言通过：5 个独立进程覆盖未配置、部分配置、空白值、有效虚拟配置；校验错误、授权地址和日志不泄露 secret |
| 原有移植 HTTP 回归 | 111 项断言通过 |
| headless 构建 / 桌面编译检查 | 通过；保留 5 条既有平台相关 dead_code 警告 |
| 已知凭据残留检查 | 检查最终文件内容及 gzip 归档解压内容，没有旧 Client ID / Secret 的匹配；不是对任意凭据的完整安全审计 |

可重复运行：

```sh
cargo test --manifest-path desktop-tauri/src-tauri/server/Cargo.toml
cargo check --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo build --manifest-path desktop-tauri/src-tauri/server/Cargo.toml
python3 scripts/test-antigravity-oauth-env.py
python3 scripts/test-aibuddy-port.py
```

HTTP 脚本只使用本机临时数据、虚拟配置与 mock 上游；不会发起 Google 授权或调用真实账号。UI 源码和构建产物没有在本次凭据修复中变化，其构建结果见原移植报告。后续远程分支与提交状态以 GitHub 实际推送结果为准。
