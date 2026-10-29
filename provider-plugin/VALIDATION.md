# AIBuddy provider plugin migration validation

本目录基线为提供商插件 `0.2.2-beta.2`，开发包 ID 为 `aibuddy-providers`，版本
`0.2.2-aibuddy.dev.1`，协议号仍为 `1`。这里只记录提供商子进程的证据；主程序、
数据库副本、3165 页面、管理员权限与正式切换由宿主验收报告记录。

## 已执行的验证

| 验证 | 结果 | 可重复入口 / 证据 |
| --- | --- | --- |
| 全插件离线类型检查 | 通过 | `cargo check --offline --target-dir target` |
| 协议与 SDK 单测 | 3 + 1 通过 | `/private/tmp/aibuddy-plugin-validation-guard-tests.log` |
| 提供商最终单测 | 95 通过、2 个独立运行项 | `/private/tmp/aibuddy-plugin-validation-guard-tests.log` |
| Accio gzip 本机传输 | 1 通过 | `local_gzip_transport_regression --ignored --test-threads=1`；`/private/tmp/aibuddy-plugin-gzip-final.log` |
| Accio SecurityGuard 本机合成 worker | 1 通过 | `local_sdk_recovery_regression --ignored --test-threads=1`；`/private/tmp/aibuddy-plugin-sg-final.log` |
| 独立 stdio / loopback RPC 生命周期 | 28/28 通过 | `node scripts/verify.mjs --binary <bin>`；`/private/tmp/aibuddy-plugin-rpc-verification-validation-guard.log` |
| 会话错误分类的实际 stdio RPC | 7/7 通过 | `node scripts/verify-conversation-errors.mjs --binary <bin>`；`/private/tmp/aibuddy-plugin-stateful-rpc-validation-guard.log` |
| CodeArts 旧目录重建 | 定向单测通过，已计入 95 | legacy source/benefit、visibility、倍率和上限均进入可执行 typed Catalog |
| Accio 会话状态公开视图 | 定向单测通过，已计入 95 | 受限的同一 issuance 显示原因；新授权 token 不被旧状态禁用 |
| ZCode 隔离读取视图 | 定向单测通过，已计入 95 | `maybe_sync` 返回前不读账号、不消耗同步周期、不启动后台拉取 |
| WorkBuddy 奖励子步骤 | 定向单测通过，已计入 95 | 真实 CONTROL/collector scope 返回 steps；免费奖励流程不使用补签卡或抽奖 |

协议、SDK、提供商合计 **99 个普通单测通过**，再加 **2 个独立本机传输回归**。
两个传输测试保留了本地基线的 `#[ignore]` 标记，因为它们临时改变进程级环境变量，
需各自在独立进程串行运行；它们本轮都已实际执行。gzip 测试需要绑定
`127.0.0.1` 随机端口，执行环境的普通 sandbox 拒绝 bind 后，已通过授权本机
bind 路径重新执行并通过。测试中没有供应商账号、真实推理或真实奖励领取。

`verify.mjs` 必须显式传入本轮二进制，强制子进程
`AIBUDDY_VALIDATION_MODE=1`，只绑定 `127.0.0.1` 模拟上游；账号回调全部是
synthetic fixture，数据目录为独立 `mkdtemp` 目录。它覆盖握手、模型、余额、
签到、凭据、登录、流式输出、背压、取消、未知方法和子进程崩溃重启。

会话分类保留原来的独立语义：CodeArts 仅明确的日池额度 403 冷却到下一个北京
零点，普通权限 403 保持 Fatal，429 保持分钟级限流；Accio 根据其机器错误码分类，
不会因为受限文案含有 rate-limit 单词而将其认成额度。

## 开发产物

最终开发二进制位于：

`target/development-v2/bin/agent2api-providers`

已执行完整 strip、macOS ad-hoc codesign、`codesign --verify --strict` 和
`--build-info`。本机 `aarch64-apple-darwin` 二进制 **30,973,936 字节**，SHA-256：

`6b6fe34f5d0d8fa83c54221e8063c23ac99aaf3be5a7d3ed8cf6d93a6515229b`

打包时的未签名 ZIP 位于：

`target/development-v2/dist/aibuddy-providers-0.2.2-aibuddy.dev.1-aarch64-apple-darwin.zip`

未签名时 **10,640,470 字节**，SHA-256：

`e5c92932ed74e5ee243cb1f3c508a59be6622632e9162be99582993194dda9d3`

宿主后续加入临时 Ed25519 fixture 签名时会改变 ZIP 哈希；应以宿主签名后的
校验和和 build record 为准。上面的二进制哈希不受 pack.json 签名改变影响。
旧已签名开发包保留在原 `target/development/dist` 路径，并额外备份为
`target/development-v2/previous-signed.zip`。加入最后的 ZCode 隔离护栏前、已完成 HTTP 回放的签名包另存为
`target/development-v2/pre-validation-guard-signed.zip`，SHA-256 为
`9c27c4e21c6db389530559c1329f75529d432ec9a00248c53b9bae8e2b35550a`。

本轮开发二进制显式启用了 `demo` 来复用同一次构建做 RPC fixture。生产
`pack.json` 不声明 demo，宿主只能注册 manifest 声明的真实 provider。
正常 `all` feature 已移除 demo；正式构建不会默认带入它。

`pack.mjs` 支持 `--skip-build --binary <path>`，以 store/deflate ZIP 保持可重复打包。
`sign.mjs` 同时支持读取和写回这两种压缩方式；签名覆盖的协议 v1 载荷没有改变。
没有创建生产密钥或将测试公钥加入生产信任表。

## 保留的边界

- 仅本机 macOS arm64 运行并验证，Windows DLL/其他四个平台由各自构建任务验证。
- 供应商真实登录、推理、签到、成长任务和奖励领取未执行。
- Android 旧基线不在此工作区构建，不生成或替换 APK。
- 宿主继续拥有数据库、加密凭据、账号顺序/限制规则、队列、lease、任务记录与
  自动调度。插件 task_execution 返回的 steps 必须由宿主写入现有 task_records。
- 协议 1 的 `WireError.details` 和 `classify_conversation` 都是可选扩展；旧插件
  对新增方法可返回 no_method，宿主应保留原错误并使用 Fatal 兜底。
