# AIBuddy 提供商增强 0.2.2-aibuddy.1-beta.2

1. 更新：基于 Agent2Providers 0.2.2-beta.2，使用 aibuddy-providers 包 ID 与协议 1。
2. 新增：AtomCode、LobsterAI、ModelScope；统一提供商执行和管理动作的 RPC 边界。
3. 保留：Accio ADK v2、SecurityGuard 与工具历史恢复；保留本地提供商增强及 WorkBuddy 持久任务执行动作。
4. 修复：Accio 安全组件初始化与旧会话恢复；WAF_BLOCK 仍需重新授权后的真实链路确认，不宣称完全修复。
5. 优化：独立更新与五平台附件检查、失败回滚、平台/协议/版本/签名错误诊断，不覆盖主程序 latest。
6. 修复：RPC 验收使用独立 Demo 构建，生产包拒绝示例二进制，避免测试产物与正式产物混用。
7. 版本：本地 0.2.2-aibuddy.dev.3 → 拟发布 0.2.2-aibuddy.1-beta.2。

主程序和插件分别发布，插件不移动主程序 latest；公开附件仅使用通过源码来源校验及生产签名验证的五平台 CI 包。
