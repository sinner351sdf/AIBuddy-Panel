//! Private-copy audit. Never emits account data, credentials, or content hashes.
use agent2api_server::server::{
    config,
    core::{account_store::AccountStore, account_transfer},
    db::Db,
};
use serde_json::{json, Value};
use std::path::Path;
fn main() {
    assert_eq!(std::env::var("AIBUDDY_VALIDATION_MODE").as_deref(), Ok("1"));
    let home = config::config_dir();
    assert!(
        home.starts_with("/private/tmp/") || home.starts_with("/tmp/"),
        "audit requires an isolated copy"
    );
    let db = Db::open(&home.join("agent2api.db")).expect("copy opens");
    config::init(Some(db.clone()));
    let store = AccountStore::with_db(Some(db.clone()));
    let before = account_transfer::export_accounts(&store);
    let rows = before
        .get("accounts")
        .and_then(Value::as_array)
        .expect("export shape");
    let stored_count = db
        .with(|conn| {
            conn.query_row("SELECT count(*) FROM accounts", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
        })
        .unwrap();
    assert!(
        rows.len() as i64 == stored_count,
        "not every encrypted account could be read"
    );
    let mut mapped = 0;
    for row in rows {
        let id = row.get("id").and_then(Value::as_str).expect("id");
        let p = store
            .plugin_account(id)
            .expect("legacy credential readable");
        assert_eq!(p.get("id"), row.get("id"));
        assert_eq!(p.get("provider"), row.get("provider"));
        let secret = p.get("secret").expect("secret");
        assert!(secret.is_object());
        for key in [
            "accessToken",
            "refreshToken",
            "apiKey",
            "jwt",
            "workosRefreshToken",
        ] {
            if let Some(old) = row
                .get(key)
                .filter(|value| !value.is_null() && value.as_str() != Some(""))
            {
                assert!(
                    secret.get(key) == Some(old),
                    "credential projection changed"
                );
            }
        }
        let repeat = store.plugin_account(id).expect("repeat read");
        assert!(p == repeat, "repeat projection differs");
        mapped += 1;
    }
    assert!(store.plugin_account("fixture-missing").is_none());
    let after = account_transfer::export_accounts(&store);
    assert!(
        after.get("accounts") == before.get("accounts"),
        "read mapping rewrote records"
    );
    assert_eq!(after.get("customProviders"), before.get("customProviders"));
    let out = json!({"schema":db.with(|c|c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap()).unwrap(),"accounts":mapped,"credentialsReadable":true,"repeatProjectionIdentical":true,"missingProjectionPreservesOthers":true,"recordsUnchanged":true});
    let dest = std::env::args().nth(1).expect("report file");
    assert!(Path::new(&dest).starts_with("/private/tmp/"));
    std::fs::write(dest, serde_json::to_vec_pretty(&out).unwrap()).unwrap();
    println!("private data projection audit passed: {mapped} accounts");
}
