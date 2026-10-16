# 3.0.5 + beta 整合验收记录

日期：2026-10-15。实施分支：`codex/sync-upstream-3.0.5-beta`。

本页记录隔离验收阶段的结果。随后单独授权的当前项目合入、实际 3065 重启、会话及数据核对，见 [deployment.md](deployment.md)。

本地基线 `95a647a`；正式版来源 `f8da217`；beta 来源 `5eadcf0`。来源与逐路径决定见 [README.md](README.md)、[inventory.md](inventory.md)。本记录区分自动化夹具、真实内核、浏览器检查与尚未执行的真实环境验证。

## 已执行结果

| 检查 | 结果 | 主要覆盖内容 |
|---|---|---|
| Rust 服务端 lib 测试 | 654 通过、0 失败、7 忽略 | 协议转换、终帧与用量解析、工具签名、路由、413/404、会话、续写、存储及更新安全 |
| 升级专项接口验收 | 148 项通过 | 两条 schema 谱系、迁移故障恢复、加密、JSON 备份往返/旧格式、缺失及错误密钥、会话重启恢复、自定义日期、历史与清理配置 |
| Linux 容器更新 | 65 项通过 | amd64/arm64 架构、默认关闭、管理员边界、下载/校验失败不替换、成套安装/重启/回滚、会话恢复及 schema 不兼容保护 |
| 前端 JavaScript 回归 | 22 个脚本全部通过 | 表单、余额显示、日期受控输入和桥接参数、图表、分页、复制、提示、通知双入口、任务、登录及页签 |
| TypeScript/Vite | 类型检查与构建通过 | 从组件源码重新生成前端 |
| 前端产物一致性 | 88 个生成文件逐字节一致 | 组件产物和全部语言词典重建可复现；不是手工拼接压缩产物 |
| shadcn/Base UI 约束 | 自检及实际源文件通过 | 72 个 React 岛、11 个外壳源文件，控件/组合/语义样式和旧 DOM 契约 |
| 多语言 | 缺失键检查通过 | 5 种语言、17 个词典域；扫描器的已有空翻译/动态表达式提示仍保留 |
| 桌面端编译检查 | `workbuddy-proxy-desktop` 通过 | macOS 当前工具链下 cargo check；不等同于 DMG/Windows 安装验收 |
| 同名订阅节点真实内核测试 | 1 项通过 | 使用已安装 mihomo、两个本地合成上游和临时监听，确认同名节点分别进入各自订阅的出口 |
| 历史归属专项 | 通过 | 23 个内置提供商及自定义提供商，删除 API、旧记录补齐、重启、请求清理和自定义提供商移除后保留标签，统计总量不变 |
| 任务中心 API/schema | 59 项通过 | 独立目录，任务记录、保留期、计划和重新登录保留用户配置 |
| 既有移植回归 | 113 项通过 | 临时数据库，现有功能与权限边界 |
| 3.0.3 兼容回归 | 134 项通过 | 授权、订阅、并发、模型元数据、持久化、快照和二维码 |
| OAuth 环境凭据 | 37 项通过 | 5 个隔离服务，不向 Google 发送请求 |
| 成长任务 API | 53 项通过 | 合成账号，无凭据和提供商请求 |
| 安全回归 | 通过 | 受限 Key 不能导出管理数据、备份保留、URL 校验、beta 路由鉴权与本地 SQL 边界 |
| 工作流/补丁检查 | 通过 | 三个工作流 YAML 可解析，`git diff --check`，252 个清单路径唯一且存在，无未处理冲突标记 |

### 数据验证的具体边界

副本矩阵涵盖本地 v11/v12/v13 与上游 v12/v13/v14。分别构造实际表、触发器及列的差异，升级到 v15，再次启动验证幂等。检查旧正文、任务、请求 Token 总量、历史地区、原保留天数及升级前一致性快照；旧请求 `client` 留空。

迁移故障测试在 v14 的 DDL 后、事务提交前通过 SQLite 触发器注入 `RAISE(ABORT)`：版本仍为 v13，`requests.client` 未部分提交，正文与任务不变；移除注入后升级成功。此项验证 SQL 中途失败与重启恢复，没有模拟硬件断电或文件系统损坏。

JSON 备份覆盖当前加密格式与历史明文格式，包括历史 `priorityScope` 裸字符串。缺失/错误密钥时账号密文仍在、密文鉴权失败、恢复要求原密钥。SQL 暂存恢复由 Rust 回归覆盖，验证旧明文凭据在激活前加密、历史身份及 Key 限额保留；SQL 恢复文件按原权限模型只允许本地桌面管理路径。

自动续写的默认关闭、参数验证、工具轮停止、截断判断、轮数和多轮用量累加由接口及 Rust 夹具覆盖。没有启用真实账号做续写或计费调用。

## 浏览器检查

独立夹具运行于 `127.0.0.1:13075`，合成账号、合成任务记录，不读取生产账号。检查了任务记录及数字分页/行数、代理列表及设置对话框、浅色手机布局和深色报表自定义日期。

- 390px 手机视口发现并修复代理操作按钮溢出；修复后内容滚动宽度与可用宽度相同，操作均在视口内。[手机代理截图](screenshots/mobile-proxy.png)。
- 深色模式实际修改日期并应用后，区间显示 37 天；日期接口的合成数据另验证单日 111、单日 222 和两日合计 333 Token。[深色日期筛选截图](screenshots/dark-report.png)。截图中无真实用量，图表为空是合成夹具预期。
- 图表继续使用本地 Charts 和配色，热力图保留。图表数据转换、Token 口径和提示由既有图表脚本回归。

## Linux 更新包

两种架构均实际构建并在本机 Docker 中启动；包内 ELF 的机器类型分别为 x86-64/AArch64。容器测试通过本地合成 Release 服务下载，测试专用包仅增加界面标记，用以证明程序与界面一起安装/回滚。没有连接正式 Release 下载接口，也没有发布镜像或附件。

另外导出了不含测试标记的干净包，存放于 `/private/tmp/agent2api-305-acceptance-assets/`；包含程序、完整 `ui/`、`update-manifest.json`（版本 3.0.5/schema 15）以及对应 `.sha256`。

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| agent2api-server-linux-amd64.tar.gz | 8795824 | `566feca439f6712a80b09f972c883c92bef9831e2d9c8bef86746ada8718554a` |
| agent2api-server-linux-arm64.tar.gz | 8414538 | `106b547a643c4140761d40a22e3db908b5001eb5013d6c6fa25e7bc089fb082c` |

这两个包属于本次未提交工作区的本地验收输出，正式发布时应从最终提交重新构建。容器测试全部使用自行创建的临时卷，结束后删除测试容器；未挂载生产数据目录。

## 复现与日志

主要命令在 [整合说明](README.md#验收与复现) 中。新增专项命令：

```sh
node scripts/test-report-custom-range.mjs
python3 scripts/test-upstream-3.0.5.py
python3 scripts/test-container-update.py --bundles /private/tmp/agent2api-305-linux-bundles-verified
```

容器脚本需要本地测试镜像 `aibuddy-panel-305-qa:amd64` 和 `:arm64`。Python 加密测试依赖 `cryptography`；Node 测试使用锁定的 UI 包依赖。所有脚本均需从隔离工作树执行。

机器可读结果见 [acceptance-summary.json](acceptance-summary.json)。本机完整日志：

- Rust：`/private/tmp/agent2api-305-rust-tests-final.log`
- 升级专项：`/private/tmp/agent2api-305-integration-acceptance-final.log`
- Linux 容器：`/private/tmp/agent2api-305-container-test.log`
- JavaScript：`/private/tmp/305-last-test-*.mjs.log`
- 前端构建/一致性：`/private/tmp/agent2api-305-front-final.log`、`/private/tmp/agent2api-305-artifact-check.log`
- 桌面编译：`/private/tmp/agent2api-305-desktop-check-final.log`
- 真实内核夹具：`/private/tmp/agent2api-305-real-kernel.log`

临时日志和产物可能被系统清理，关键结论、清单及截图已随本次源代码保存在 docs 中。

## 未执行与交付状态

- 7 项 Rust 忽略测试保持忽略；不将其计为通过。
- 没有在 Windows 实机执行覆盖安装/黑框验证，也没有打出本次 macOS universal DMG；Windows/macOS 构建工作流保留并检查了 YAML，尚未运行 GitHub Actions。
- 没有真实提供商账号任务、外部计费、真实公网代理下载或完整移动端 PWA 安装验收。下载线路、取消及监听器逻辑由源码/夹具覆盖，真实网络环境仍应在启用前验证。
- 没有创建提交、推送、替换 3065 程序、重启生产服务、发布 Release 或启用自动续写/容器自更新。
- 原工作区仍为 `95a647a`，原有两个工作流修改及 3.0.3 发布说明草稿保持原样。最终只读 `/health` 检查返回 `{"status":"ok"}`。

源码整合和上述本地验收已完成。生产部署与正式发布应基于最终审查提交单独执行。
