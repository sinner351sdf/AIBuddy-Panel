//! Durable, credential-free task history. SQLite slot uniqueness is the
//! authority for scheduled deduplication; never log while holding the DB lock.
use crate::server::{db::Db, logging};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

static DB: OnceLock<Option<Db>> = OnceLock::new();
pub fn install(db: Option<Db>) {
    let _ = DB.set(db);
}
fn db() -> Result<&'static Db, String> {
    DB.get()
        .and_then(Option::as_ref)
        .ok_or_else(|| "任务记录数据库不可用".into())
}

pub struct AccountGuard {
    _local: tokio::sync::OwnedMutexGuard<()>,
    lease: Option<super::task_state::RunGuard>,
}
impl Drop for AccountGuard {
    fn drop(&mut self) {
        if let Some(lease) = self.lease.take() {
            let _ = lease.finish(true, "账号任务结束".into(), None, 0, 0);
        }
    }
}
pub async fn account_lock(id: &str) -> AccountGuard {
    static LOCKS: OnceLock<Mutex<HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>>> =
        OnceLock::new();
    let lock = {
        let mut locks = LOCKS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        locks.retain(|_, lock| lock.strong_count() > 0);
        let lock = locks
            .get(id)
            .and_then(std::sync::Weak::upgrade)
            .unwrap_or_else(|| Arc::new(tokio::sync::Mutex::new(())));
        locks.insert(id.into(), Arc::downgrade(&lock));
        lock
    };
    let local = lock.lock_owned().await;
    // Reuse the existing renewable database lease for two app instances sharing
    // one home. The local mutex keeps same-process requests in FIFO order.
    let key = format!("workbuddyAccount:{id}");
    let lease = loop {
        match super::task_state::claim(&key, 0, true, super::task_state::ManualBackoff::Bypass, 0) {
            Ok(super::task_state::Claim::Acquired(lease)) => break Some(lease),
            Ok(super::task_state::Claim::Deferred(_)) => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await
            }
            Err(_) => break None,
        }
    };
    AccountGuard {
        _local: local,
        lease,
    }
}

#[derive(Clone, Debug)]
pub struct ResultRow {
    pub outcome: &'static str,
    pub message: String,
    pub credit: Option<i64>,
    pub energy: Option<i64>,
}
impl ResultRow {
    pub fn new(outcome: &'static str, message: impl Into<String>) -> Self {
        Self {
            outcome,
            message: message.into(),
            credit: None,
            energy: None,
        }
    }
    pub fn reward(mut self, credit: i64, energy: i64) -> Self {
        self.credit = Some(credit);
        self.energy = Some(energy);
        self
    }
    pub fn json(&self) -> Value {
        json!({"outcome":self.outcome,"message":self.message,"credit":self.credit,"energy":self.energy})
    }
}

pub fn begin(
    batch: &str,
    account: &str,
    name: &str,
    provider: &str,
    kind: &str,
    source: &str,
    slot: Option<&str>,
) -> Result<Option<i64>, String> {
    let run=db()?.with(|conn| -> Result<Option<i64>,String> {
        let now=logging::now_ms();
        let changed = conn.execute("INSERT OR IGNORE INTO task_runs(batch_id,account_id,account_name,provider,kind,source,slot,started_at,lease_until) VALUES(?,?,?,?,?,?,?,?,?)",
            params![batch,account,name,provider,kind,source,slot,now,now+90_000]).map_err(|e| e.to_string())?;
        if changed>0 {return Ok(Some(conn.last_insert_rowid()));}
        let previous:Option<i64>=conn.query_row("SELECT id FROM task_runs WHERE account_id=? AND kind=? AND slot=? AND outcome='interrupted'",params![account,kind,slot],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        if let Some(id)=previous {let changed=conn.execute("UPDATE task_runs SET outcome='running',finished_at=NULL,lease_until=? WHERE id=? AND outcome='interrupted'",params![now+90_000,id]).map_err(|e|e.to_string())?;return Ok((changed>0).then_some(id));}Ok(None)
    }).ok_or("任务记录数据库不可用")??;
    if let Some(id) = run {
        crate::spawn_task(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                let alive=db().ok().and_then(|db|db.with(|c|c.execute("UPDATE task_runs SET lease_until=? WHERE id=? AND outcome='running'",params![logging::now_ms()+90_000,id]).unwrap_or(0))).unwrap_or(0)>0;
                if !alive {
                    break;
                }
            }
        });
    }
    Ok(run)
}

pub fn step(run: i64, code: &str, result: &ResultRow) -> Result<(), String> {
    db()?.with(|conn| {
        if result.outcome!="running" {
            let changed=conn.execute("UPDATE task_run_items SET outcome=?,message=?,credit=?,energy=?,reward_source=? WHERE id=(SELECT id FROM task_run_items WHERE run_id=? AND code=? AND outcome='running' ORDER BY id DESC LIMIT 1)",params![result.outcome,redact(&result.message),result.credit,result.energy,if result.credit.is_some()||result.energy.is_some(){Some("upstream")}else{None},run,code]).map_err(|e|e.to_string())?;
            if changed>0{return Ok(());}
        }
        conn.execute("INSERT INTO task_run_items(run_id,code,outcome,message,credit,energy,reward_source,created_at) VALUES(?,?,?,?,?,?,?,?)",
        params![run,code,result.outcome,redact(&result.message),result.credit,result.energy,
            if result.credit.is_some()||result.energy.is_some() { Some("upstream") } else { None },logging::now_ms()]).map(|_| ()).map_err(|e| e.to_string())
    }).ok_or("任务记录数据库不可用")?
}
pub fn finish(run: i64, outcome: &str, message: &str) -> Result<(), String> {
    db()?
        .with(|conn| {
            conn.execute(
                "UPDATE task_runs SET outcome=?,message=?,finished_at=? WHERE id=?",
                params![outcome, redact(message), logging::now_ms(), run],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        })
        .ok_or("任务记录数据库不可用")?
}
pub fn redact(message: &str) -> String {
    // Do not persist arbitrary upstream URLs, tokens or response bodies.
    let cleaned=regex::Regex::new(r"(?i)(bearer\s+[^\s,;]+|(?:access_?token|refresh_?token|authorization|api_?key)\s*[=:]\s*[^\s,;]+)").map(|re|re.replace_all(message,"[凭证已隐藏]").into_owned()).unwrap_or_else(|_|"任务结果（详细信息已隐藏）".into());
    cleaned
        .split_whitespace()
        .map(|word| {
            if word.contains("http://") || word.contains("https://") || word.len() > 160 {
                "[已隐藏]"
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(600)
        .collect()
}
pub fn recover() -> Result<(), String> {
    db()?.with(|conn| conn.execute("UPDATE task_runs SET outcome='interrupted',message='进程中断；下次执行先回读进度，不重放整轮',finished_at=? WHERE outcome='running' AND lease_until<?",params![logging::now_ms(),logging::now_ms()]).map(|_| ()).map_err(|e|e.to_string())).ok_or("任务记录数据库不可用")?
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"id":r.get::<_,i64>(0)?,"batchId":r.get::<_,String>(1)?,"accountId":r.get::<_,String>(2)?,"accountName":r.get::<_,String>(3)?,"provider":r.get::<_,String>(4)?,"kind":r.get::<_,String>(5)?,"source":r.get::<_,String>(6)?,"slot":r.get::<_,Option<String>>(7)?,"startedAt":r.get::<_,i64>(8)?,"finishedAt":r.get::<_,Option<i64>>(9)?,"outcome":r.get::<_,String>(10)?,"message":r.get::<_,String>(11)?}),
    )
}
const COLUMNS: &str="id,batch_id,account_id,account_name,provider,kind,source,slot,started_at,finished_at,outcome,message";
pub fn query(filters: &HashMap<String, String>) -> Result<Value, String> {
    let limit = filters
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(50)
        .clamp(1, 200);
    let offset = filters
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let mut clauses = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    for (key, column) in [
        ("accountId", "account_id"),
        ("provider", "provider"),
        ("kind", "kind"),
        ("source", "source"),
        ("outcome", "outcome"),
    ] {
        if let Some(v) = filters.get(key).filter(|s| !s.is_empty()) {
            clauses.push(format!("{column}=?"));
            values.push(v.clone().into());
        }
    }
    for (key, op) in [("from", ">="), ("to", "<=")] {
        if let Some(v) = filters.get(key) {
            let ms = v
                .parse::<i64>()
                .map_err(|_| format!("{key} 必须是毫秒时间戳"))?;
            clauses.push(format!("started_at{op}?"));
            values.push(ms.into());
        }
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    let retention = retention_days();
    db()?.with(|conn| {
        let total:i64=conn.query_row(&format!("SELECT count(*) FROM task_runs{where_sql}"),rusqlite::params_from_iter(&values),|r|r.get(0)).map_err(|e|e.to_string())?;
        values.push(limit.into());values.push(offset.into());
        let mut stmt=conn.prepare(&format!("SELECT {COLUMNS} FROM task_runs{where_sql} ORDER BY id DESC LIMIT ? OFFSET ?")).map_err(|e|e.to_string())?;
        let rows=stmt.query_map(rusqlite::params_from_iter(&values),row).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        Ok(json!({"items":rows,"total":total,"limit":limit,"offset":offset,"retentionDays":retention}))
    }).ok_or("任务记录数据库不可用")?
}
pub fn detail(id: i64) -> Result<Option<Value>, String> {
    db()?.with(|conn| {
        let mut result=conn.query_row(&format!("SELECT {COLUMNS} FROM task_runs WHERE id=?"),[id],row).optional().map_err(|e|e.to_string())?;
        if let Some(value)=&mut result {
            let mut stmt=conn.prepare("SELECT code,outcome,message,credit,energy,reward_source,attempt,created_at FROM task_run_items WHERE run_id=? ORDER BY id").map_err(|e|e.to_string())?;
            let items=stmt.query_map([id],|r|Ok(json!({"code":r.get::<_,String>(0)?,"outcome":r.get::<_,String>(1)?,"message":r.get::<_,String>(2)?,"credit":r.get::<_,Option<i64>>(3)?,"energy":r.get::<_,Option<i64>>(4)?,"rewardSource":r.get::<_,Option<String>>(5)?,"attempt":r.get::<_,i64>(6)?,"createdAt":r.get::<_,i64>(7)?}))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
            value["items"]=json!(items);
        } Ok(result)
    }).ok_or("任务记录数据库不可用")?
}
pub fn retention_days() -> i64 {
    crate::server::config::current()
        .raw()
        .get("taskRecordRetentionDays")
        .and_then(Value::as_i64)
        .unwrap_or(90)
        .clamp(1, 3650)
}
pub fn cleanup() -> Result<(), String> {
    let cutoff = logging::now_ms() - retention_days() * 86_400_000;
    db()?
        .with(|c| {
            c.execute(
                "DELETE FROM task_runs WHERE started_at<? AND outcome!='running'",
                [cutoff],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        })
        .ok_or("任务记录数据库不可用")?
}

/// A process died inside an action: only query/claim on automatic recovery,
/// never replay a potentially charged model request.
pub fn recovery_claim_only(run: i64) -> bool {
    db().ok().and_then(|db|db.with(|c|c.query_row("SELECT EXISTS(SELECT 1 FROM task_runs WHERE id=? AND message LIKE '进程中断%')",[run],|r|r.get::<_,bool>(0)).unwrap_or(false))).unwrap_or(false)
}
