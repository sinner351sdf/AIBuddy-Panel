# 3.1.0 beta 修复与补齐

针对修复前审查 F1–F8 逐项处理，继续以固定上游 072e3c71 为整合目标。

| 编号 | 最终行为 | 验证 |
|---|---|---|
| F1 | CORS 允许 x-panel-auth-mode，保留刷新及助手请求头 | 登录/刷新预检、真实令牌轮换、浏览器跨域登录 |
| F2 | 保留 HTTPS 和显式端口，支持方括号 IPv6；仅裸主机补 HTTP/3065 | 实际 normalizeBase 四类样例 |
| F3 | WorkBuddy 按 id 合并 agent2api，保留其他提供商、顺序和扩展字段 | 临时 HOME 真文件应用及逐字节还原 |
| F4 | 手机 DTO 使用 configPath/viaGateway/configMode/hasBackup；还原 body 使用 clientId | 真实接口、React 组件操作、浏览器路径/状态/按钮 |
| F5 | 从持久任务记录读取当天时刻、按批次生成结果/失败数/已声明收益，展示下次时间；入队后等待对应批次完成 | 合成持久记录 + 真 API；React 状态函数验证不会接受其他批次或伪造零收益 |
| F6 | 3.1+ 强制 Windows 服务端 ZIP 与 SHA256，继续兼容旧版本；附件逐个上传 | 28 个发布模拟场景，缺包/错校验不发布 |
| F7 | 只读预检与有效 Key 校验先于备份；失败并成功回滚后清理失败尝试的备份 | 无效 Key 不遮住成功应用前恢复点；错误配置不留备份 |
| F8 | 同一 B 品牌源生成 PWA/maskable、Android launcher/adaptive/splash 共 31 个产物；CI 字节比对 | --check-mobile 通过，Android 与前端 CI 接入 |

最终 APK 复测另发现首页登录前的请求错误缓存会残留到下一分钟；首页轮询现在随会话快照变化立即刷新，真实 HomePage 组件补测登录后清除错误。

新文案补齐 en/ja/ko/pt-BR，zh-Hant 由既有构建生成。品牌和前端产物均从源码重建。

验证通过：839 Rust 库测试（18 忽略）、桌面 cargo check、服务端构建、桌面/手机 TypeScript + Vite、32 Node 脚本、18 问题合同探针、4 地址样例、28 Release 模拟场景、3.1 API、69 助手 API、56 旧版 API、历史迁移、59 任务中心及 69 成长 API 断言。可变的 3.1 脚本计数包含启动轮询，不以该数字做覆盖率承诺。

运行回归：

```sh
python3 docs/aibuddy-port/upstream-3.1.0/review/test-contracts.py
node scripts/test-upstream-3.1.0-ui.mjs
node docs/aibuddy-port/upstream-3.1.0/review/test-server-address.mjs
node docs/aibuddy-port/upstream-3.1.0/review/test-release-contract.mjs
python3 scripts/test-release-script.py
node assets/brand/generator/render.js --check-mobile
```

隔离浏览器使用空账号、临时 HOME、合成凭据；跨域网关与网页使用不同端口，原生标记由测试夹具模拟。手机 Agent 截图 mobile-agent-fixed.png。组件测试实际触发还原并验证请求体，文件合同验证真实恢复；浏览器确认框未作为成功还原证据。没有真机验收、真实提供商调用或真实奖励消费。

保留本地 schema 17、助手历史 revision、持久队列、客户端标识/品牌以及外部配置只读边界。原 3065 服务保留，APK 对应的修复需要配套本轮 beta 网关。APK 只交由 GitHub Actions 编译；不运行本地 Android SDK/Gradle，不创建正式 tag/Release、不推进 main。云端运行和 APK 验证结果在本次交付说明中提供。
