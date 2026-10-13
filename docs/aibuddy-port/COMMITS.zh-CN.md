# AIBuddy-Panel 逐提交处理索引

覆盖源分支从根提交到 `31ec037` 的 35 个提交。以最终内容移植，不宣称逐条 cherry-pick。文档提交的原文可在本目录归档及原始补丁查看。

| 提交 | 原始标题 | 处理结果 |
|---|---|---|
| [13fee59](https://github.com/sinner351sdf/AIBuddy-Panel/commit/13fee59fa520416a641809027d47ababa1de0a7c) | AIBuddy Panel v2.10.0 · 多提供商 AI 网关（首个发布版） | 初始快照中的全部净变化由 226 条文件清单覆盖；保留上游身份与新版能力。 |
| [1a1d898](https://github.com/sinner351sdf/AIBuddy-Panel/commit/1a1d898ba8e91ff58e2fdabc2ebf46e554f71862) | docs: PITFALLS 新增 GHCR 镜像发布小节（owner 小写笔误的隐晦报错、Actions 推包默认公开、VM 无 curl 用 docker exec 验证） | 源文档原文归档；历史发布/实测声明不当作本次验证结果。 |
| [3da6e05](https://github.com/sinner351sdf/AIBuddy-Panel/commit/3da6e05d0f6b6899c1584302c18584790cb8f72f) | docs: CHANGELOG 修正 GHCR 可见性描述——Actions 从公开仓库推送的包实测自动公开 | 源文档原文归档；历史发布/实测声明不当作本次验证结果。 |
| [2c4aa84](https://github.com/sinner351sdf/AIBuddy-Panel/commit/2c4aa842730401cef3c9458f935371b90c20250f) | v2.11.0（预览版）：偏好设置抽屉 / 全站主题切换 / 登录页主题化 / 品牌 Logo 接入 / 手机端抽屉式适配 | 主题、品牌自定义与移动外壳已合并；默认应用身份保留 Agent2API。 |
| [bb7f40b](https://github.com/sinner351sdf/AIBuddy-Panel/commit/bb7f40b0072e01da85d4f298c5216371a54bb6d4) | style: 按 vue-next-admin 规范对齐外壳（侧栏 220px / 菜单行高 / 深色底色 #1f1f1f 系） | 外壳布局及颜色令牌已合并。 |
| [bf4e7d0](https://github.com/sinner351sdf/AIBuddy-Panel/commit/bf4e7d07a8a9e2557489f602ad6d0ae413e1aefe) | feat(ui): vue-next-admin 化外壳二期——偏好抽屉完整版 / TagsView 页签栏 / 通知中心 / 登录页增强 / 手机端抽屉化 | 偏好、页签、通知中心和登录/手机增强已合并。 |
| [e15ed43](https://github.com/sinner351sdf/AIBuddy-Panel/commit/e15ed433f8871b465a512ed1d4efbc05751cde42) | feat(ui): TagsView 右键菜单 v2（刷新/当前页全屏/关闭其它/全部关闭）+ 内容区全屏模式 | 页签右键菜单与全屏已合并。 |
| [00503b3](https://github.com/sinner351sdf/AIBuddy-Panel/commit/00503b31cdbea48d321b64d36b598cb6b047a8a0) | feat(prefs): 补完 vue-next-admin themeConfig 全部偏好功能——锁屏/面包屑/页脚/Logo/渐变/高亮 | 偏好、锁屏、面包屑/页脚/Logo 等已合并。 |
| [244cda2](https://github.com/sinner351sdf/AIBuddy-Panel/commit/244cda230c841e8479da2e232d39c16a58272ecc) | docs: CHANGELOG 2.11.0 小节对齐最终形态（偏好四页签/锁屏/右键菜单/通知中心/侧栏折叠） | 源文档原文归档；历史发布/实测声明不当作本次验证结果。 |
| [7d54ce9](https://github.com/sinner351sdf/AIBuddy-Panel/commit/7d54ce90a58e4459c0d66833527e974b9fe073a1) | feat(ui): 设置页接入偏好/通知/页签后台项 + 全站图标排版审计优化 | 设置入口与图标排版已合并。 |
| [16dac3b](https://github.com/sinner351sdf/AIBuddy-Panel/commit/16dac3b1f927c07eea7aa4b8ab8b8b563d795eb6) | feat(icons): 全站图标换代 Lucide 现代圆角风格 | 图标实现已合并；应用安装图标保持上游。 |
| [656f191](https://github.com/sinner351sdf/AIBuddy-Panel/commit/656f191514c523ef2ce2955fc370ca9eedd68e0a) | feat: v2.11.0 最终集成——账号池状态条 / 网关健康面板 / 报表自动刷新 / Key 快速接入 / 日志级别 chips / 任务倒计时 / 页签拖拽+密码显隐 / 深色与可访问性审计 | 状态条、健康、自动刷新、Key 接入、日志与任务倒计时等已合并。 |
| [49eefd6](https://github.com/sinner351sdf/AIBuddy-Panel/commit/49eefd677b1756464656aadada7eb37b550fd348) | fix: health.rs 运行时长函数路径修正（本模块内调用，v2.11.0 标签构建失败的根因） | 使用合并后可编译的运行时长调用。 |
| [31628bc](https://github.com/sinner351sdf/AIBuddy-Panel/commit/31628bc0827ec2f4a322b33bf49078fdf8b1be76) | fix: 桌面 crate 残留 agent2api_server 引用改名收尾（bridge/state/commands 等） | 分支 crate 改名修复不照搬；agent2api_server 原名保持有效。 |
| [bf09595](https://github.com/sinner351sdf/AIBuddy-Panel/commit/bf0959580f78c428f2934edc999151101edacdca) | fix(web): 登录授权窗口改为带尺寸的独立弹出小窗（对齐桌面端内置窗口形态） | 网页授权独立窗口与尺寸已合并。 |
| [0fbe36c](https://github.com/sinner351sdf/AIBuddy-Panel/commit/0fbe36cba8b0d5344a4149423d74586c148d07b5) | docs: 新增开源参考项目与文档全清单（功能设计依据与待做路线） | 源文档原文归档；历史发布/实测声明不当作本次验证结果。 |
| [49634a9](https://github.com/sinner351sdf/AIBuddy-Panel/commit/49634a9b181c0d795a9c2853d304af8c6edb2b2f) | feat(wave1): 报表 CSV 导出 / 界面密度三档 / 凭据临期预警 / Key 接入二维码 | CSV、密度、临期预警、二维码已合并。 |
| [af138f9](https://github.com/sinner351sdf/AIBuddy-Panel/commit/af138f99e0c500f5009988db77be77a4a068cee0) | feat(update): 检查更新指向本仓库 Releases + 网页端真实版本比对 | 网页版本比对已合并并修复重复解包；更新源保留 agent2api。 |
| [48e4ca4](https://github.com/sinner351sdf/AIBuddy-Panel/commit/48e4ca4e25a1034f927d3803006334c7331ef87f) | feat(wave2-5): 后端功能集成——连通性测试/探活/审计/会话/维护/备份 + 通知中心管理界面（N2） | 探活/审计/会话/维护/备份/通知已合并，并补齐路由鉴权。 |
| [27a0ec5](https://github.com/sinner351sdf/AIBuddy-Panel/commit/27a0ec559e40fadc412263f37e46170f4a125d3b) | fix(spike): 通知埋点变量名对齐实际作用域（provider/attempt_account/provider_id/model） | 通知埋点按新版作用域适配，编译与原测试通过。 |
| [adc8f95](https://github.com/sinner351sdf/AIBuddy-Panel/commit/adc8f95e02f179eb724ca86a035bcaa7f78ca52e) | docs: 参考清单补 WorkBuddy 签到工具两仓库 | 源文档原文归档；历史发布/实测声明不当作本次验证结果。 |
| [fb52546](https://github.com/sinner351sdf/AIBuddy-Panel/commit/fb525460a41b4555a18dd9411929a0d250fbc8a6) | feat: 审计埋点（登录成功/失败）+ shutdown 路由接线 + api/mod 声明收尾 | 登录审计和关机路由接线已合并，关机受鉴权保护。 |
| [6f7caba](https://github.com/sinner351sdf/AIBuddy-Panel/commit/6f7caba46fb234781402e915b975312fb40e6cd5) | feat(brand): 数据文件改名 aibuddy-panel.db（自动迁移旧文件）+ 全品牌清扫 | 纯品牌替换与数据库改名不启用；保持 agent2api.db，原差异归档。 |
| [17dad0f](https://github.com/sinner351sdf/AIBuddy-Panel/commit/17dad0fe6997fdd63dbb1020f4f54f6312cf3a1a) | fix(db): LEGACY_FILE_NAME 恢复为 agent2api.db（品牌清扫误伤迁移源常量，已修复并实测迁移成功） | 不引入导致此修复的数据库改名；支持分支 JSON 备份导入。 |
| [b5cdefb](https://github.com/sinner351sdf/AIBuddy-Panel/commit/b5cdefb7dc7341b4579b49fe5b59378a45f4a792) | v2.12.0: 签到 UX 优化（已签到不再显示为失败）+ 后端新功能全量（探活/审计/会话/维护/备份/Key额度/16渠道通知/告警）+ 版本 2.11.0 → 2.12.0 | 签到、后端管理功能与额度/通知已合并；版本保持 3.0.1。 |
| [5de1670](https://github.com/sinner351sdf/AIBuddy-Panel/commit/5de16704e04a1dd75f0ee973fa00d4de97844f8e) | fix: 移除未使用的 delete 路由助手导入（消除构建警告） | 按最终编译需求保留使用中的路由导入。 |
| [89ecde5](https://github.com/sinner351sdf/AIBuddy-Panel/commit/89ecde500d9fe564f171090fcd64b489f268691d) | fix(checkin): 「今日已签到」全链路归类为正常状态（后端 billing HTTP 400 分支 + 前端 outcome 归一） | 正常已签到 UX 合并；保留上游更细的 400/409 分类。 |
| [4a922cb](https://github.com/sinner351sdf/AIBuddy-Panel/commit/4a922cb17c5198ad0aa969f770e0d262b0314a05) | feat(ui): 侧栏分组手风琴——点击分组标题折叠/展开子菜单，状态持久化 | 侧栏折叠持久化已合并，并将上游签到中心放入正确分组。 |
| [c104003](https://github.com/sinner351sdf/AIBuddy-Panel/commit/c10400362d594cc261ac0e6a1b0d133ccd267bc9) | fix(icons): 补充 bell 图标（通知中心分类用） | bell 图标已合并。 |
| [2fa0a3d](https://github.com/sinner351sdf/AIBuddy-Panel/commit/2fa0a3d8b9cd2fdce757278aaee745e7da8925cf) | feat: v2.13.0 一键绑定远程面板 + 积分构成页 + 通知渠道收口 | 远程同步、积分构成与 105 种通知注册已合并。 |
| [4fc8862](https://github.com/sinner351sdf/AIBuddy-Panel/commit/4fc88627aaafc05a11499fa3235618c4cacf2a9d) | fix(notify): send_brevo 未使用参数改 _title，消掉最后一个编译警告 | send_brevo 参数修复随最终实现合并。 |
| [9d53912](https://github.com/sinner351sdf/AIBuddy-Panel/commit/9d53912ab48ee2eaa543de37f1ebda675fe1f8f1) | feat: v2.13.1 顶栏用户菜单（改账号密码+退出登录）+ 积分包专用端点修复积分构成页 | 用户菜单、修改密码、退出和积分专用查询已合并。 |
| [8511cd1](https://github.com/sinner351sdf/AIBuddy-Panel/commit/8511cd10a262396eb3e5378999b7f6e13bea4c52) | docs(providers): 余额接入核查后的文档修正（catpaw 适配器注释对齐实测端点；zcode 凭证落盘位置注释修正、去重复 Accept 头） | CatPaw/ZCode 注释修正和请求头清理已合并。 |
| [e5aa3e4](https://github.com/sinner351sdf/AIBuddy-Panel/commit/e5aa3e4df224a5d86b5fb8fd5c4ee93bfec7a2df) | feat: v2.14.0 成长任务一键完成 + Cline API Key 管理 + /v1/embeddings + 积分构成对照美化 | 成长任务、Cline Key、embeddings、积分页已合并并适配新版结构。 |
| [31ec037](https://github.com/sinner351sdf/AIBuddy-Panel/commit/31ec0379c827963330b4d8b58b729804fdae715c) | fix: v2.14.0 编译修复（growth_actions/queue/travel/workbuddy/embeddings 共 27 处）+ 零警告收敛 | 最终编译修复随源实现合并；本次并非零警告，保留 5 条上游平台警告。 |
