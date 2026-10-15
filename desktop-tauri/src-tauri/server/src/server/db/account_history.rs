//! Non-secret account identity snapshots, independent of credentials and log retention.
//! All account writes/deletes are covered by database triggers. Reports consume this
//! table instead of joining live accounts, so logout cannot change historical labels.

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::server::core::providers;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Identity {
    pub provider: String,
    pub provider_label: String,
    pub edition: String,
    pub edition_label: String,
}

/// Only region-specific provider IDs imply a region. Single-regionless providers
/// retain an empty edition, rather than acquiring an invented domestic edition.
fn provider_edition(provider: &str) -> &str {
    match provider {
        "accio" | "workbuddy-intl" | "qoder-intl" | "zcode-intl" | "autoclaw-intl"
        | "monkeycode-intl" => "intl",
        "accio-cn" | "workbuddy" | "qoder" | "zcode" | "autoclaw" | "monkeycode" => "cn",
        _ => "",
    }
}

fn label_of(conn: &Connection, provider: &str) -> rusqlite::Result<String> {
    // Do not call providers::label_of here: its custom-provider path reads the
    // global DB and would re-enter the same database mutex.
    if provider.starts_with("custom-") {
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM kv WHERE key = 'customProviders'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(list) = raw.and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            if let Some(name) = list
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row["id"] == provider))
                .and_then(|row| row["name"].as_str())
                .filter(|s| !s.trim().is_empty())
            {
                return Ok(name.to_string());
            }
        }
    }
    Ok(providers::kind_from_id(provider)
        .map(|kind| providers::meta(kind).label.to_string())
        .unwrap_or_else(|| provider.to_string()))
}

/// Fill missing facts only. An account rename, logout or edited live region must
/// not overwrite an already captured historical identity.
pub(crate) fn remember_provider(
    conn: &Connection,
    account_id: &str,
    provider: &str,
) -> rusqlite::Result<()> {
    if account_id.is_empty() || provider.is_empty() {
        return Ok(());
    }
    let label = label_of(conn, provider)?;
    let edition = provider_edition(provider);
    let edition_label = if provider == "qoder" {
        "中国版"
    } else {
        match edition {
            "intl" => "国际版",
            "cn" => "国内版",
            _ => "",
        }
    };
    conn.execute(
        "INSERT INTO account_history (account_id, provider, provider_label, edition, edition_label)
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(account_id) DO UPDATE SET
           provider = CASE WHEN account_history.provider = '' THEN excluded.provider ELSE account_history.provider END,
           provider_label = CASE WHEN account_history.provider_label IN ('', account_history.provider)
             THEN excluded.provider_label ELSE account_history.provider_label END,
           edition = CASE WHEN account_history.edition = '' THEN excluded.edition ELSE account_history.edition END,
           edition_label = CASE WHEN account_history.edition_label <> '' THEN account_history.edition_label
             WHEN account_history.edition = 'intl' THEN '国际版'
             WHEN account_history.edition = 'cn' THEN CASE WHEN excluded.provider = 'qoder' THEN '中国版' ELSE '国内版' END
             ELSE excluded.edition_label END
         WHERE account_history.provider IN ('', excluded.provider)
           AND (account_history.provider = '' OR account_history.provider_label IN ('', account_history.provider)
             OR (account_history.edition = '' AND excluded.edition <> '')
             OR (account_history.edition_label = '' AND (account_history.edition IN ('cn', 'intl') OR excluded.edition_label <> '')))",
        params![account_id, provider, label, edition, edition_label],
    )?;
    Ok(())
}

/// Called inside schema v13's transaction. Triggers cover individual removal,
/// bulk removal, imports, refreshes and logout, including a delete during a request.
pub(crate) fn install(conn: &Connection) -> rusqlite::Result<()> {
    for (name, event, record) in [
        ("insert", "AFTER INSERT", "NEW"),
        ("update_old", "BEFORE UPDATE OF provider, data", "OLD"),
        ("update_new", "AFTER UPDATE OF provider, data", "NEW"),
        ("delete", "BEFORE DELETE", "OLD"),
    ] {
        let data =
            format!("CASE WHEN json_valid({record}.data) THEN {record}.data ELSE '{{}}' END");
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS account_history_{name} {event} ON accounts BEGIN
             INSERT INTO account_history (account_id, provider, provider_label, edition, edition_label)
             VALUES ({record}.id, {record}.provider,
               COALESCE((SELECT json_extract(item.value, '$.name') FROM kv,
                 json_each(CASE WHEN json_valid(kv.value) THEN kv.value ELSE '[]' END) item
                 WHERE kv.key = 'customProviders' AND json_extract(item.value, '$.id') = {record}.provider LIMIT 1), ''),
               COALESCE(json_extract({data}, '$.edition'), ''), COALESCE(json_extract({data}, '$.editionLabel'), ''))
             ON CONFLICT(account_id) DO UPDATE SET
               provider = CASE WHEN account_history.provider = '' THEN excluded.provider ELSE account_history.provider END,
               provider_label = CASE WHEN account_history.provider_label = '' THEN excluded.provider_label ELSE account_history.provider_label END,
               edition = CASE WHEN account_history.edition = '' THEN excluded.edition ELSE account_history.edition END,
               edition_label = CASE WHEN account_history.edition_label = '' THEN excluded.edition_label ELSE account_history.edition_label END
             WHERE account_history.provider IN ('', excluded.provider) AND (
               account_history.provider = '' OR (account_history.provider_label = '' AND excluded.provider_label <> '')
               OR (account_history.edition = '' AND excluded.edition <> '')
               OR (account_history.edition_label = '' AND excluded.edition_label <> ''));
             END;"
        ))?;
    }
    backfill(conn)
}

/// Idempotent enrichment only: never rebuild counts or discard aggregate days.
/// Current accounts have the best region facts. Retained requests/checkins/tasks
/// recover deleted accounts; conflicting provider evidence is left unresolved.
pub(crate) fn backfill(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT id, provider, data FROM accounts")?;
    let accounts: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for (id, provider, raw) in accounts {
        let data: Value = serde_json::from_str(&raw).unwrap_or_default();
        // Preserve explicit account edition before falling back to provider IDs.
        conn.execute(
            "INSERT INTO account_history (account_id, provider, edition, edition_label) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id) DO UPDATE SET
               edition = CASE WHEN account_history.edition = '' THEN excluded.edition ELSE account_history.edition END,
               edition_label = CASE WHEN account_history.edition_label = '' THEN excluded.edition_label ELSE account_history.edition_label END
             WHERE account_history.provider = excluded.provider AND (account_history.edition = '' OR account_history.edition_label = '')",
            params![id, provider, data["edition"].as_str().unwrap_or(""), data["editionLabel"].as_str().unwrap_or("")],
        )?;
        remember_provider(conn, &id, &provider)?;
    }
    let mut stmt = conn.prepare(
        "SELECT account_id, MIN(provider) FROM (
           SELECT account_id, provider FROM requests
           UNION ALL SELECT account_id, provider FROM checkin_records
           UNION ALL SELECT account_id, provider FROM task_runs
         ) WHERE account_id <> '' AND provider <> ''
         GROUP BY account_id HAVING COUNT(DISTINCT provider) = 1",
    )?;
    let evidence: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for (id, provider) in evidence {
        remember_provider(conn, &id, &provider)?;
    }
    // Accio IDs have an explicit, backend-generated region even if all request
    // details were pruned. No inference from account display names.
    let mut stmt = conn.prepare("SELECT account_stats FROM request_daily")?;
    let groups: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for raw in groups {
        if let Ok(Value::Array(rows)) = serde_json::from_str::<Value>(&raw) {
            for row in rows {
                let id = row["accountId"].as_str().unwrap_or("");
                if let Some(provider) = accio_provider_from_id(id) {
                    remember_provider(conn, id, provider)?;
                }
            }
        }
    }
    // Existing trigger snapshots can still have blank labels/derived editions.
    let mut stmt = conn.prepare("SELECT account_id, provider FROM account_history")?;
    let stored: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for (id, provider) in stored {
        remember_provider(conn, &id, &provider)?;
    }
    Ok(())
}

fn accio_provider_from_id(id: &str) -> Option<&'static str> {
    let (provider, hash) = if let Some(hash) = id.strip_prefix("accio-intl-") {
        ("accio", hash)
    } else if let Some(hash) = id.strip_prefix("accio-cn-") {
        ("accio-cn", hash)
    } else {
        return None;
    };
    (hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
    .then_some(provider)
}

pub(crate) fn read_snapshots(conn: &Connection) -> rusqlite::Result<BTreeMap<String, Identity>> {
    let mut stmt = conn.prepare(
        "SELECT account_id, provider, provider_label, edition, edition_label FROM account_history",
    )?;
    let identities: BTreeMap<String, Identity> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                Identity {
                    provider: r.get(1)?,
                    provider_label: r.get(2)?,
                    edition: r.get(3)?,
                    edition_label: r.get(4)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(identities)
}

pub(crate) fn enrich_summary(identities: &BTreeMap<String, Identity>, summary: &mut Value) {
    if let Some(rows) = summary["accounts"].as_array_mut() {
        for row in rows {
            let id = row["id"].as_str().unwrap_or("");
            if let Some(identity) = identities.get(id) {
                if let (Some(row), Some(fields)) = (
                    row.as_object_mut(),
                    serde_json::to_value(identity)
                        .ok()
                        .and_then(|v| v.as_object().cloned()),
                ) {
                    row.extend(fields);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn enrich_summary(conn: &Connection, summary: &mut Value) -> rusqlite::Result<()> {
        super::enrich_summary(&read_snapshots(conn)?, summary);
        Ok(())
    }

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        super::super::schema::migrate(&conn).unwrap();
        conn
    }

    fn insert_account(conn: &Connection, id: &str, provider: &str, edition: &str) {
        conn.execute("INSERT INTO accounts (id, provider, priority, data) VALUES (?1, ?2, 0, ?3)",
            params![id, provider, json!({"id": id, "provider": provider, "edition": edition, "accessToken": "must-not-be-copied"}).to_string()]).unwrap();
    }

    #[test]
    fn all_providers_survive_logout_bulk_delete_and_request_retention() {
        let conn = database();
        let mut accounts = Vec::new();
        for item in providers::PROVIDERS {
            let id = format!("deleted-{}", item.id);
            insert_account(&conn, &id, item.id, "intl");
            remember_provider(&conn, &id, item.id).unwrap();
            accounts.push(json!({"id": id, "totalTokens": 42, "requests": 2}));
        }
        conn.execute("DELETE FROM accounts", []).unwrap();
        conn.execute("DELETE FROM requests", []).unwrap();
        backfill(&conn).unwrap();
        let mut summary = json!({"accounts": accounts, "overview": {"tokens": 100}});
        enrich_summary(&conn, &mut summary).unwrap();
        for (row, item) in summary["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .zip(providers::PROVIDERS)
        {
            assert_eq!(row["provider"], item.id);
            assert_eq!(row["providerLabel"], item.label);
            assert_eq!(row["edition"], "intl");
            assert_eq!(row["totalTokens"], 42);
        }
        assert_eq!(summary["overview"]["tokens"], 100);
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(account_history)")
            .unwrap()
            .query_map([], |r| r.get(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            columns,
            [
                "account_id",
                "provider",
                "provider_label",
                "edition",
                "edition_label"
            ]
        );
    }

    #[test]
    fn snapshot_keeps_region_and_custom_label_after_edits_and_provider_removal() {
        let conn = database();
        remember_provider(&conn, "regionless", "trae").unwrap();
        let changes = conn.total_changes();
        remember_provider(&conn, "regionless", "trae").unwrap();
        assert_eq!(
            conn.total_changes(),
            changes,
            "repeated traffic does not rewrite unchanged identity snapshots"
        );
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('customProviders', ?1)",
            [json!([{"id":"custom-gateway", "name":"自定义上游"}]).to_string()],
        )
        .unwrap();
        insert_account(&conn, "custom-account", "custom-gateway", "intl");
        conn.execute(
            "UPDATE accounts SET data = ?1 WHERE id = 'custom-account'",
            [json!({"edition":"cn", "accessToken":"another-secret"}).to_string()],
        )
        .unwrap();
        conn.execute("DELETE FROM kv WHERE key = 'customProviders'", [])
            .unwrap();
        conn.execute("DELETE FROM accounts", []).unwrap();
        backfill(&conn).unwrap();
        let mut summary = json!({"accounts": [{"id":"custom-account"}]});
        enrich_summary(&conn, &mut summary).unwrap();
        assert_eq!(summary["accounts"][0]["providerLabel"], "自定义上游");
        assert_eq!(summary["accounts"][0]["edition"], "intl");
        assert!(!summary.to_string().contains("secret"));
        assert!(!summary.to_string().contains("accessToken"));
    }

    #[test]
    fn migration_recovers_old_deleted_accounts_without_recomputing_counts() {
        let conn = database();
        // v13 only adds this table and its four triggers. Remove them to create
        // the exact prior schema, then seed pre-upgrade account/request data.
        for name in ["insert", "update_old", "update_new", "delete"] {
            conn.execute_batch(&format!("DROP TRIGGER account_history_{name}"))
                .unwrap();
        }
        conn.execute_batch("DROP TABLE account_history").unwrap();
        conn.pragma_update(None, "user_version", 12).unwrap();
        insert_account(&conn, "live-qoder", "qoder-intl", "intl");
        conn.execute("INSERT INTO requests (id, ts, model, provider, account_id) VALUES ('old', 1, 'test', 'workbuddy-intl', 'deleted-wb')", []).unwrap();
        conn.execute("INSERT INTO requests (id, ts, model, provider, account_id) VALUES ('conflict1', 2, 'test', 'qoder', 'conflict'), ('conflict2', 3, 'test', 'accio', 'conflict')", []).unwrap();
        let old_accio = format!("accio-intl-{}", "a".repeat(64));
        let groups = json!([
            {"accountId":old_accio,"accountName":"旧账号","requests":3,"tokens":99},
            {"accountId":"unknown","accountName":"Accio 国际版账号","requests":1,"tokens":1}
        ])
        .to_string();
        conn.execute("INSERT INTO request_daily (date, requests, tokens, account_stats) VALUES ('2026-01-01', 4, 100, ?1)", [&groups]).unwrap();
        super::super::schema::migrate(&conn).unwrap();
        backfill(&conn).unwrap();
        backfill(&conn).unwrap();
        let after: String = conn
            .query_row("SELECT account_stats FROM request_daily", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            after, groups,
            "migration never rewrites aggregate amounts or groups"
        );
        let mut summary = json!({"accounts": [{"id":"deleted-wb"}, {"id":"live-qoder"}, {"id":old_accio}, {"id":"unknown"}, {"id":"conflict"}]});
        enrich_summary(&conn, &mut summary).unwrap();
        assert_eq!(summary["accounts"][0]["provider"], "workbuddy-intl");
        assert_eq!(summary["accounts"][0]["edition"], "intl");
        assert_eq!(summary["accounts"][1]["providerLabel"], "Qoder 国际版");
        assert_eq!(summary["accounts"][1]["editionLabel"], "国际版");
        assert_eq!(summary["accounts"][2]["provider"], "accio");
        assert!(
            summary["accounts"][3].get("provider").is_none(),
            "names are not evidence"
        );
        assert!(
            summary["accounts"][4].get("provider").is_none(),
            "conflicting historical providers are not guessed"
        );
    }
}
