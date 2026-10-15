//! WorkBuddy account queues share the canonical task execution service.
//! Real-time progress stays in memory; task runs and steps are durable in SQLite.
//! Account mutexes and renewable database leases serialize manual and scheduled writes.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::Semaphore;

use crate::server::core::account_store::AccountStore;
use crate::server::core::billing::growth::{self, ACTION_ORDER};
use crate::server::core::billing::BillingService;

use super::{task_execution, task_records};
use crate::server::core::providers::DEFAULT_PROVIDER_ID;
use crate::server::logging;

#[derive(Clone, Debug)]
pub struct RunOptions {
    pub kind: String,
    pub mode: String,
    pub source: String,
    pub slot: Option<String>,
}
impl Default for RunOptions {
    fn default() -> Self {
        Self {
            kind: "growth".into(),
            mode: "full".into(),
            source: "manual".into(),
            slot: None,
        }
    }
}

/// 并发上限（1-4，默认 1；协调者契约）。默认 1 = 全部账号串行，
/// 与签到/旅行的「串行防风」口径一致。
pub const DEFAULT_CONCURRENCY: usize = 1;
pub const MAX_CONCURRENCY: usize = 4;

/// 账号执行前的错峰间隔（refs scheduler/travel.go:26 的 800ms 口径；
/// 并发 >1 时给每个账号组按序错开，避免同瞬齐发）。
const ACCOUNT_STAGGER_MS: u64 = 800;

/// 队列里的一个执行单元（对照 refs taskcenter.go:119-126 queueItem）。
#[derive(Debug, Clone)]
struct QueueItem {
    account_id: String,
    account_name: String,
    run_id: i64,
    kind: String,
    task_code: String,
    /// pending | running | ok | failed | skipped
    status: &'static str,
    message: String,
}

/// 一个账号的执行计划（同一账号的待办 + 会话）。
struct AccountPlan {
    account_id: String,
    run_id: i64,
    options: RunOptions,
    account_name: String,
    session: Option<Value>,
    /// (items 下标, 任务码) —— 下标用于状态回写
    items: Vec<(usize, String)>,
    /// 阶段 0 待接受清单（扫描时按 accept_status 过滤，对照 refs
    /// autotask.go:1124 `!Claimed && !Locked && status 不在 accepted/completed`）
    accept_default: Vec<String>,
    accept_mp: Vec<String>,
}

/// 服务句柄：全局一把锁 + Clone（与 auto_checkin 同构）。
/// 锁只用来读写队列状态这类微秒级操作；执行全程在锁外（持锁不 await）。
#[derive(Clone)]
pub struct GrowthQueue {
    store: AccountStore,
    billing: BillingService,
    inner: Arc<Mutex<Inner>>,
    control: Arc<std::sync::atomic::AtomicBool>,
    run_controls: Arc<Mutex<std::collections::HashMap<i64, Arc<std::sync::atomic::AtomicBool>>>>,
}

struct Inner {
    /// 是否已有一轮在执行（RunningGuard 模式）
    running: bool,
    /// 尽力取消标记：置位后，每个账号在**当前项完成后**停止
    stop: bool,
    total: usize,
    done: usize,
    started_at: i64,
    concurrency: usize,
    last_error: Option<String>,
    items: Vec<QueueItem>,
}

impl GrowthQueue {
    pub fn new(store: AccountStore, billing: BillingService) -> Self {
        Self {
            store,
            billing,
            run_controls: Arc::new(Mutex::new(std::collections::HashMap::new())),
            control: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            inner: Arc::new(Mutex::new(Inner {
                running: false,
                stop: false,
                total: 0,
                done: 0,
                started_at: 0,
                concurrency: DEFAULT_CONCURRENCY,
                last_error: None,
                items: Vec::new(),
            })),
        }
    }

    /// 取锁；锁中毒（持锁 panic）不致命，接管内部数据继续用
    /// （与账号存储、auto_checkin 同一策略）
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    // ─── 扫描（只读，/api/growth-tasks/scan 与 run 共用）────────

    /// 有资格参与 CN 成长体系的账号才拉会话（见模块头「账号范围」）。
    fn growth_eligible(account: &Value) -> bool {
        let provider = account
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_PROVIDER_ID);
        if provider != DEFAULT_PROVIDER_ID {
            return false;
        }
        // D4 门控：国际版账号无 CN 成长任务体系，不发起任何上游调用
        // （refs taskcenter.go:76-79）
        account.get("edition").and_then(Value::as_str) != Some("intl")
    }

    fn is_available(account: &Value) -> bool {
        account
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true)
            && account
                .get("available")
                .and_then(Value::as_bool)
                .unwrap_or(true)
    }

    /// 收集待扫描账号（id、显示名、会话）。同步段：账号存储的快照与
    /// 会话派生都是内存/本地操作。pub(crate)：travel 巡检（growth_schedule）
    /// 复用同一份「CN 成长体系账号」过滤口径，不另抄一份。
    pub(crate) fn collect_accounts(&self) -> Vec<(String, String, Option<Value>)> {
        self.store
            .list_accounts()
            .get("accounts")
            .and_then(Value::as_array)
            .map(|accounts| {
                accounts
                    .iter()
                    .filter(|account| Self::growth_eligible(account) && Self::is_available(account))
                    .filter_map(|account| {
                        let id = account.get("id").and_then(Value::as_str)?.to_string();
                        let name = account
                            .get("name")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .unwrap_or(&id)
                            .to_string();
                        let session = self.store.get_session_by_id(&id).map(|entry| entry.session);
                        Some((id, name, session))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 并发拉取每个账号的合并任务列表（默认 + mp 口径；refs taskcenter.go:59-104
    /// 的并发扫描同款）。返回 (账号 id, 显示名, 会话, 任务列表或错误)。
    async fn scan_accounts(
        &self,
        account_id: Option<&str>,
    ) -> Vec<(
        String,
        String,
        Option<Value>,
        Result<Vec<growth::Task>, String>,
    )> {
        // Scope before loading tasks: a row action must never scan other accounts.
        let accounts: Vec<_> = self
            .collect_accounts()
            .into_iter()
            .filter(|(id, _, _)| account_id.is_none_or(|selected| id == selected))
            .collect();
        let billing = self.billing.clone();
        let handles: Vec<_> = accounts
            .into_iter()
            .map(|(id, name, session)| {
                let billing = billing.clone();
                crate::spawn_task(async move {
                    let result = match &session {
                        Some(session) => growth::list_tasks_merged(&billing, session)
                            .await
                            .map_err(|error| error.message),
                        None => Err("没有可用凭证".to_string()),
                    };
                    (id, name, session, result)
                })
            })
            .collect();
        let mut out = Vec::with_capacity(handles.len());
        for handle in handles {
            // 任务自身不返回 Err（结果装在元组里）；JoinError 只在 panic 时出现，
            // release 是 panic=abort —— 到这里进程已经没了，这个分支实际不可达
            if let Ok(row) = handle.await {
                out.push(row);
            }
        }
        out
    }

    /// 扫描结果 → /api/growth-tasks/scan 的 data（全部任务带状态，供展示）。
    pub async fn scan(&self) -> Value {
        let scanned_at = logging::now_ms();
        let mut results = Vec::new();
        let mut pending = 0usize;
        for (id, name, _session, tasks) in self.scan_accounts(None).await {
            match tasks {
                Ok(tasks) => {
                    // filter 的谓词拿到的是 &&Task，这里用闭包做一层解引用
                    pending += tasks
                        .iter()
                        .filter(|task| growth::growth_pending(task))
                        .count();
                    results.push(json!({
                        "id": id,
                        "name": name,
                        "error": Value::Null,
                        "tasks": tasks.iter().map(growth::task_scan_json).collect::<Vec<_>>(),
                    }));
                }
                Err(message) => {
                    results.push(json!({
                        "id": id,
                        "name": name,
                        "error": message,
                        "tasks": [],
                    }));
                }
            }
        }
        logging::log(
            "[Growth]",
            &format!("任务扫描完成：{pending} 项待办（{} 个账号）", results.len()),
        );
        json!({ "results": results, "scannedAt": scanned_at })
    }

    // ─── 入队与执行 ─────────────────────────────────────────

    /// 扫描待办并组队（写 items、返回账号组）。已在 RunningGuard 持有期调用。
    async fn plan_pending(
        &self,
        concurrency: usize,
        account_id: Option<&str>,
        options: &RunOptions,
    ) -> Vec<AccountPlan> {
        let batch = format!("task-{}", logging::now_ms());
        let accounts = self.store.list_accounts();
        let mut items = Vec::new();
        let mut plans = Vec::new();
        for account in accounts
            .get("accounts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let provider = account
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or("");
            if !matches!(provider, "workbuddy" | "workbuddy-intl") || !Self::is_available(account) {
                continue;
            }
            if options.kind != "activity" && !Self::growth_eligible(account) {
                continue;
            }
            let Some(id) = account.get("id").and_then(Value::as_str) else {
                continue;
            };
            if account_id.is_some_and(|selected| selected != id) {
                continue;
            }
            let Some(entry) = self.store.get_session_by_id(id) else {
                continue;
            };
            let session = entry.session;
            let name = account.get("name").and_then(Value::as_str).unwrap_or(id);
            let run_id = match task_records::begin(
                &batch,
                id,
                name,
                provider,
                &options.kind,
                &options.source,
                options.slot.as_deref(),
            ) {
                Ok(Some(id)) => id,
                Ok(None) => continue,
                Err(error) => {
                    self.lock().last_error = Some(format!("无法登记任务，未执行：{error}"));
                    logging::log("[Growth]", &format!("无法登记任务，未执行：{error}"));
                    continue;
                }
            };
            self.run_controls
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(run_id, Arc::new(std::sync::atomic::AtomicBool::new(false)));
            let codes = if matches!(options.kind.as_str(), "travel" | "activity" | "rewards") {
                vec![format!("@{}", options.kind)]
            } else {
                match growth::list_tasks_merged(&self.billing, &session).await {
                    Ok(mut tasks) => {
                        tasks.sort_by_key(|t| growth::action_order(&t.task_code));
                        tasks
                            .into_iter()
                            .filter(|task| {
                                if options.kind == "night" {
                                    task.task_code == "black_cat"
                                } else {
                                    task.task_code != "black_cat"
                                }
                            })
                            .filter(|task| {
                                !task.claimed
                                    && !task.locked
                                    && (task.claimable
                                        || (options.mode != "claim"
                                            && growth::is_actionable(&task.task_code)))
                            })
                            .map(|task| task.task_code)
                            .collect()
                    }
                    Err(error) => {
                        let result = task_records::ResultRow::new("failed", error.message);
                        let _ = task_records::step(run_id, "scan", &result);
                        let _ = task_records::finish(run_id, "failed", &result.message);
                        continue;
                    }
                }
            };
            if codes.is_empty() {
                let _ = task_records::finish(run_id, "skipped", "本轮没有可执行任务");
                continue;
            }
            let entries = codes
                .into_iter()
                .map(|code| {
                    let i = items.len();
                    items.push(QueueItem {
                        account_id: id.into(),
                        account_name: name.into(),
                        run_id,
                        kind: options.kind.clone(),
                        task_code: code.clone(),
                        status: "pending",
                        message: String::new(),
                    });
                    (i, code)
                })
                .collect();
            plans.push(AccountPlan {
                account_id: id.into(),
                run_id,
                options: options.clone(),
                account_name: name.into(),
                session: Some(session),
                items: entries,
                accept_default: Vec::new(),
                accept_mp: Vec::new(),
            });
        }
        let mut inner = self.lock();
        inner.total = items.len();
        inner.items = items;
        inner.done = 0;
        inner.concurrency = concurrency;
        inner.started_at = logging::now_ms();
        plans
    }

    /// 启动一轮执行。已有轮次在跑时返回 Err（api 层翻成 409）。
    /// 返回 Ok(本轮入队的待办总数)。
    pub async fn run(&self, concurrency: usize) -> Result<usize, ()> {
        self.run_selected(concurrency, None, RunOptions::default())
            .await
    }

    /// Row action: share the global queue and exclusion guard, but scan one account only.
    pub async fn run_for_account(&self, account_id: &str) -> Result<usize, ()> {
        self.run_selected(1, Some(account_id), RunOptions::default())
            .await
    }

    pub async fn run_selected(
        &self,
        concurrency: usize,
        account_id: Option<&str>,
        options: RunOptions,
    ) -> Result<usize, ()> {
        let concurrency = concurrency.clamp(DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
        // ① CAS 抢「执行中」标记（RunningGuard 模式，auto_checkin.rs:349-360）
        let guard = {
            let mut inner = self.lock();
            if inner.running {
                return Err(());
            }
            self.control
                .store(false, std::sync::atomic::Ordering::Relaxed);
            self.run_controls
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
            inner.running = true;
            inner.stop = false;
            inner.last_error = None;
            RunningGuard {
                inner: self.inner.clone(),
            }
        };
        // ② 扫描待办并组队（异步段在锁外）
        let plans = self.plan_pending(concurrency, account_id, &options).await;
        let total = self.lock().total;
        if total == 0 {
            logging::log("[Growth]", "没有待执行的成长任务，本轮结束");
            drop(guard); // Drop 复位 running
            return Ok(0);
        }
        logging::log(
            "[Growth]",
            &format!("成长任务队列启动：{total} 项待办，并发 {concurrency}"),
        );
        // ③ 账号组并发执行（Semaphore 限并发；账号内串行）
        let queue = self.clone();
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let mut handles = Vec::new();
        for (group_index, plan) in plans.into_iter().enumerate() {
            let queue = queue.clone();
            let semaphore = semaphore.clone();
            handles.push(crate::spawn_task(async move {
                // 并发 >1 时按组序错峰，避免所有账号同瞬齐发
                if group_index > 0 {
                    tokio::time::sleep(Duration::from_millis(ACCOUNT_STAGGER_MS)).await;
                }
                // Semaphore 永不 close，acquire 只在关闭时 Err —— 不会发生
                if let Ok(_permit) = semaphore.acquire_owned().await {
                    queue.run_account_group(plan).await;
                }
            }));
        }
        // ④ 收尾：等全部账号组结束 → 汇总日志 + 审计；guard 随任务结束 Drop
        // （running 复位），期间重复触发 run 会被 409 挡住
        crate::spawn_task(async move {
            for handle in handles {
                let _ = handle.await;
            }
            let inner = queue.lock();
            let summary = format!(
                "队列完成: ok {} / failed {} / skipped {} / 共 {}",
                inner
                    .items
                    .iter()
                    .filter(|item| item.status == "ok")
                    .count(),
                inner
                    .items
                    .iter()
                    .filter(|item| item.status == "failed")
                    .count(),
                inner
                    .items
                    .iter()
                    .filter(|item| item.status == "skipped")
                    .count(),
                inner.total,
            );
            drop(inner);
            logging::log("[Growth]", &format!("成长任务{summary}"));
            // 审计埋点（完成时）。audit_api::audit 只是 logging 的标签封装
            //（不依赖 axum），core 引用它仅为复用 `[Audit]` 前缀与事件格式。
            crate::server::api::audit_api::audit("growth.complete", &summary);
            drop(guard); // 最后才放 running
        });
        Ok(total)
    }

    /// 尽力取消：置位后每个账号在当前项完成后停止（剩余项标 skipped）。
    pub fn stop(&self) {
        let mut inner = self.lock();
        inner.stop = true;
        self.control
            .store(true, std::sync::atomic::Ordering::Relaxed);
        for flag in self
            .run_controls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
        {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    pub fn stop_run(&self, id: i64) -> bool {
        let controls = self.run_controls.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(flag) = controls.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
            true
        } else {
            false
        }
    }
    fn run_control(&self, id: i64) -> Arc<std::sync::atomic::AtomicBool> {
        self.run_controls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
            .unwrap_or_else(|| self.control.clone())
    }
    /// 队列状态（前端 3s 轮询 /api/growth-tasks/queue）。
    pub fn state(&self) -> Value {
        let inner = self.lock();
        json!({
            "running": inner.running,
            "total": inner.total,
            "done": inner.done,
            "lastError": inner.last_error,
            "concurrency": inner.concurrency,
            "startedAt": if inner.started_at > 0 { Value::from(inner.started_at) } else { Value::Null },
            "items": inner
                .items
                .iter()
                .map(|item| {
                    json!({
                        "accountId": item.account_id,
                        "accountName": item.account_name,
                        "runId":item.run_id, "kind":item.kind,
                        "taskCode": item.task_code,
                        "status": item.status,
                        "message": item.message,
                    })
                })
                .collect::<Vec<_>>(),
        })
    }

    fn stop_requested(&self) -> bool {
        self.lock().stop
    }

    /// 回写一个队列项的状态；终态计入 done。
    fn set_item(&self, index: usize, status: &'static str, message: String) {
        let mut inner = self.lock();
        // 终态判定与「该项还开放」判定都要在可变借用前算好：items 与 done 都经
        // MutexGuard 的 Deref 访问，字段间互斥对借用检查器不可见，必须顺序化
        let reached_final = matches!(
            status,
            "ok" | "success"
                | "already"
                | "failed"
                | "skipped"
                | "cancelled"
                | "pending_verification"
        );
        let was_open = inner
            .items
            .get(index)
            .is_some_and(|item| item.status == "pending" || item.status == "running");
        if was_open {
            if reached_final {
                inner.done += 1;
            }
            if let Some(item) = inner.items.get_mut(index) {
                item.status = status;
                item.message = message;
            }
        }
    }

    /// 单账号组：阶段 0 批量接受 → 串行执行全部待办（stop 在项间检查 ——
    /// 当前项完成后停；429/11128/登录态失效则整账号冷却，剩余项跳过）。
    async fn run_account_group(self, plan: AccountPlan) {
        let AccountPlan {
            account_id,
            run_id,
            options,
            account_name,
            session,
            items,
            accept_default,
            accept_mp,
        } = plan;
        let Some(mut session) = session else {
            for (index, _code) in items {
                self.set_item(index, "skipped", "没有可用凭证".to_string());
            }
            return;
        };
        let _account_guard = task_records::account_lock(&account_id).await;
        let current = self.store.list_accounts();
        let available = current["accounts"].as_array().is_some_and(|accounts| {
            accounts
                .iter()
                .any(|a| a["id"] == account_id && Self::is_available(a))
        });
        if !available || self.store.get_session_by_id(&account_id).is_none() {
            for (index, code) in items {
                let result =
                    task_records::ResultRow::new("skipped", "账号已禁用、删除或凭证不可用");
                let _ = task_records::step(run_id, &code, &result);
                self.set_item(index, "skipped", result.message);
            }
            let _ = task_records::finish(run_id, "skipped", "执行前账号状态已变化");
            return;
        }
        if let Some(entry) = self.store.get_session_by_id(&account_id) {
            session = entry.session;
        }

        // 阶段 0：批量接受「尚未接受」的待办（对照 refs autotask.go:1117-1166
        // runAutoAll 的阶段 0/0b，清单在扫描时已按 accept_status 过滤；accept 是
        // 「报名」不产生进度且幂等，失败不阻塞 —— 行为事件才是进度唯一判据）。
        // 拆默认 / mp 两个口径：mp 专属任务的 accept 要求
        // X-Client-Platform: miniprogram（refs tasks.go:104-109）。
        if !accept_default.is_empty() {
            match growth::accept_tasks_batched(&self.billing, &session, &accept_default, false)
                .await
            {
                Ok(()) => {
                    // 批量接受后等 1.05s（refs autotask.go:1139 time.Sleep(reportGap)）
                    tokio::time::sleep(Duration::from_millis(growth::REPORT_GAP_MS)).await;
                }
                Err(error) => {
                    logging::log(
                        "[Growth]",
                        &format!("批量接受任务失败（不阻塞后续）: {}", error.message),
                    );
                }
            }
        }
        if !accept_mp.is_empty() {
            match growth::accept_tasks(&self.billing, &session, &accept_mp, true).await {
                Ok(()) => {
                    // mp 写动作间隔 2s（refs autotask.go:318 mpActionGap）
                    tokio::time::sleep(Duration::from_millis(growth::MP_ACTION_GAP_MS)).await;
                }
                Err(error) => {
                    logging::log(
                        "[Growth]",
                        &format!("批量接受 mp 任务失败（不阻塞后续）: {}", error.message),
                    );
                }
            }
        }
        let mut final_outcome = "skipped";
        for position in 0..items.len() {
            let (index, code) = items[position].clone();
            let disabled =
                options.source != "manual" && !super::growth_schedule::kind_enabled(&options.kind);
            if self.stop_requested()
                || self
                    .run_control(run_id)
                    .load(std::sync::atomic::Ordering::Relaxed)
                || disabled
            {
                let result = task_records::ResultRow::new("cancelled", "已停止，未启动后续步骤");
                let _ = task_records::step(run_id, &code, &result);
                self.set_item(index, "cancelled", result.message);
                final_outcome = "cancelled";
                continue;
            }
            self.set_item(index, "running", String::new());
            let recover_claim_only =
                options.source != "manual" && task_records::recovery_claim_only(run_id);
            let mode = if recover_claim_only {
                "claim"
            } else {
                &options.mode
            };
            let _ = task_records::step(
                run_id,
                &code,
                &task_records::ResultRow::new("running", "动作开始；进程中断时先回读，不盲目重发"),
            );
            let result = task_execution::CONTROL
                .scope(
                    task_execution::Control {
                        stop: self.run_control(run_id),
                        kind: options.kind.clone(),
                        automatic: options.source != "manual",
                        run_id,
                    },
                    task_execution::execute_refreshed(
                        &self.store,
                        &self.billing,
                        &account_id,
                        &session,
                        &code,
                        mode,
                    ),
                )
                .await;
            final_outcome = combined_outcome(final_outcome, result.outcome);
            if let Err(error) = task_records::step(run_id, &code, &result) {
                logging::log("[Growth]", &format!("结果已执行，记录保存失败：{error}"));
            }
            let status = if result.outcome == "pending" {
                "pending_verification"
            } else {
                result.outcome
            };
            let message = result.message;
            // 风控判定要在 message 被 set_item 消耗（move）之前做
            let risk_hit = Self::account_risk_hit(&message);
            logging::log(
                "[Growth]",
                &format!("账号 {account_name} · {code}: [{status}] {message}"),
            );
            self.set_item(index, status, message);
            // 风控纪律：429 / 11128 / 登录态失效命中后**整账号冷却**——
            // 剩余项本轮跳过，不重试轰炸（换号重试是转发层的事，任务域不适用）
            if risk_hit {
                logging::log(
                    "[Growth]",
                    &format!(
                        "账号 {account_name} 命中上游风控/登录态失效，剩余 {} 项本轮冷却跳过",
                        items.len() - position - 1
                    ),
                );
                for (rest_index, rest_code) in &items[position + 1..] {
                    let _ = task_records::step(
                        run_id,
                        rest_code,
                        &task_records::ResultRow::new(
                            "skipped",
                            "同账号风控或认证失败，剩余任务冷却",
                        ),
                    );
                    self.set_item(
                        *rest_index,
                        "skipped",
                        "同账号命中上游风控/登录态失效（429/11128），本轮冷却跳过".to_string(),
                    );
                }
                break;
            }
        }
        if matches!(options.kind.as_str(), "growth" | "night" | "activity")
            && super::growth_schedule::kind_enabled("rewards")
            && !self.stop_requested()
            && !matches!(final_outcome, "failed" | "cancelled")
            && !self
                .run_control(run_id)
                .load(std::sync::atomic::Ordering::Relaxed)
            && (options.kind != "activity" || final_outcome == "success")
        {
            let result = task_execution::CONTROL
                .scope(
                    task_execution::Control {
                        stop: self.run_control(run_id),
                        kind: "rewards".into(),
                        automatic: options.source != "manual",
                        run_id,
                    },
                    task_execution::rewards_run(&self.billing, &session),
                )
                .await;
            final_outcome = combined_outcome(final_outcome, result.outcome);
            let _ = task_records::step(run_id, "@rewards", &result);
        }
        if let Err(error) =
            task_records::finish(run_id, final_outcome, "本轮执行结束；点击查看步骤明细")
        {
            self.lock().last_error = Some(format!("结果已执行，记录保存失败：{error}"));
            logging::log("[Growth]", "结果已执行，记录保存失败；未重做上游动作");
        }
    }

    /// 「整账号冷却」信号判定：429（限额）/ 11128（风控拦截）/ 401（登录态
    /// 已过期）—— 出现在动作或领奖的错误文案里即视为该账号本轮不可用。
    fn account_risk_hit(message: &str) -> bool {
        message.contains("429") || message.contains("11128") || message.contains("登录态已过期")
    }
}

// ─── RunningGuard（复用 auto_checkin.rs:349-360 的模式）────────

/// 抢到「执行中」标记的守卫：无论正常结束还是任务被 abort，
/// Drop 时都会把 running 复位，避免 abort 把 running 永久卡在 true。
struct RunningGuard {
    inner: Arc<Mutex<Inner>>,
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        match self.inner.lock() {
            Ok(mut guard) => guard.running = false,
            Err(poisoned) => poisoned.into_inner().running = false,
        }
    }
}

// ─── 进程级句柄（api 层懒初始化；不进 ServerState，见交付说明）────

static GLOBAL: OnceLock<GrowthQueue> = OnceLock::new();

/// 取全局队列句柄（首次调用用传入的 store/billing 初始化，此后返回同一实例 ——
/// 两份句柄本来就是同一底层服务的克隆）。
pub fn global(store: AccountStore, billing: BillingService) -> GrowthQueue {
    let service = GrowthQueue::new(store, billing);
    match GLOBAL.set(service.clone()) {
        Ok(()) => service,
        Err(_) => GLOBAL.get().cloned().unwrap_or(service),
    }
}

/// ACTION_ORDER 的只读再导出（api 层文档/前端提示用，暂无调用点）。
#[allow(dead_code)]
pub fn action_order() -> &'static [&'static str] {
    ACTION_ORDER
}

pub fn kind_running(kind: &str) -> bool {
    GLOBAL.get().is_some_and(|q| {
        let s = q.state();
        s["running"] == true
            && s["items"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["kind"] == kind))
    })
}

fn combined_outcome(current: &'static str, next: &'static str) -> &'static str {
    for state in ["failed", "cancelled", "pending", "success", "already"] {
        if current == state || next == state {
            return state;
        }
    }
    "skipped"
}
#[cfg(test)]
mod outcome_tests {
    #[test]
    fn neutral_skips_do_not_look_like_success() {
        assert_eq!(super::combined_outcome("skipped", "skipped"), "skipped");
        assert_eq!(super::combined_outcome("already", "skipped"), "already");
        assert_eq!(super::combined_outcome("success", "pending"), "pending");
        assert_eq!(super::combined_outcome("failed", "success"), "failed");
    }
}
