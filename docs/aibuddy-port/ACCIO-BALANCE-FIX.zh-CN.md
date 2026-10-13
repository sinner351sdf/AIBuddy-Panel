# Accio 百分比额度显示修复

账号页原先显示绿色「可用 — %」。Accio 查询结果的 `available` 为 null，表示没有积分绝对数；实际周期用量保存在 `wallets[].usedPercent` 和 `balance` 中。账号页只识别 `remainingPercent`，因此没有显示已有的剩余比例。

本次修改：

- 后端返回 `remainingPercent = 100 - usagePercent`，用于现有额度进度条。
- 前端兼容旧快照里的百分比 `balance` / `usedPercent`，无需清理数据库即可显示读数。
- 百分比摘要显示「剩余 N%」，悬停提示包含重置时间；其他单位的余额不能套用百分比换算。
- 上游缺失或返回无效的 `usagePercent` 时报告查询失败，取消原先默认 0 已用的行为。前端缺失比例时显示中性的「无数据」，不冒充 0% 或 100%。
- 保留套餐的 `remainQuota / totalQuota` 原始口径。它与周期剩余百分比不同，不相加，也不把套餐数值当成百分比。

验证：前端构建及类型检查通过；`node scripts/test-accio-balance.mjs` 覆盖 24 个旧快照、零值、未知值、其他提供商和错误场景；后端 Accio 余额测试 3 项通过；已有 HTTP 回归 113 项及排序回归 27 项通过。

本地实际额度查询验证了周期已用 0%、剩余 100% 的展示。查询只读取额度，没有发送模型推理请求。
