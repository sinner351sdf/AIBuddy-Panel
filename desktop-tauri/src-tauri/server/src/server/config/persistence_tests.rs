//! Exercise the production globals in a separate test process so parallel unit
//! tests cannot replace their database or observe their configuration.
use super::*;
use serde_json::json;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CHILD_TEST: &str = "AGENT2API_CONFIG_TEST";
const RESTART: &str = "AGENT2API_CONFIG_TEST_RESTART";
static NEXT_DIRECTORY: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn isolated(test_name: &str) -> bool {
    if std::env::var(CHILD_TEST).as_deref() == Ok(test_name) {
        return true;
    }
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "agent2api-config-test-{}-{unique}-{}",
        std::process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", test_name, "--nocapture"])
        .env(CHILD_TEST, test_name)
        .env("AGENT2API_PROXY_HOME", &directory)
        .env_remove(RESTART)
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(directory);
    assert!(
        output.status.success(),
        "isolated test failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    false
}

pub(crate) fn open_database() -> Db {
    let database = Db::open(&config_dir().join("config-test.db")).unwrap();
    database
        .with(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO kv(key,value) VALUES ('configMigrated','true')",
                [],
            )
        })
        .unwrap()
        .unwrap();
    init(Some(database.clone()));
    // Failed writes also exercise logging's configuration reads: holding the
    // CONFIG write lock over persistence/logging would deadlock this path.
    crate::server::logging::init_store(Some(database.clone()), false);
    database
}

pub(crate) fn is_restart() -> bool {
    std::env::var_os(RESTART).is_some()
}

pub(crate) fn assert_restart(test_name: &str) {
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", test_name, "--nocapture"])
        .env(RESTART, "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "restart readback failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn concurrent_writers_and_reload_keep_persisted_changes() {
    const NAME: &str =
        "server::config::persistence_tests::concurrent_writers_and_reload_keep_persisted_changes";
    if !isolated(NAME) {
        return;
    }
    let database = open_database();
    if is_restart() {
        assert_eq!(current().raw()["auditField"], json!(4));
        assert_eq!(current().raw()["locale"], json!("en"));
        assert_eq!(current().raw()["lastRequestModel"], json!("test-model"));
        assert_eq!(
            current().raw()["checkinWebConversationEnabled"],
            json!(false)
        );
        return;
    }
    assert!(set_checkin_web_conversation(true).is_ok());
    for operation in 0..5 {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = std::thread::spawn(move || {
            update(|snapshot| {
                snapshot.raw.insert("auditField".into(), json!(operation));
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (attempt_tx, attempt_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let other_database = database.clone();
        let second = std::thread::spawn(move || {
            attempt_tx.send(()).unwrap();
            match operation {
                0 => assert!(set_locale("en")),
                1 => {
                    remember_request_model("test-model");
                }
                2 => {
                    reload();
                }
                3 => {
                    init(Some(other_database));
                }
                4 => assert!(set_checkin_web_conversation(false).is_ok()),
                _ => unreachable!(),
            }
            done_tx.send(()).unwrap();
        });
        attempt_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let completed_early = done_rx.recv_timeout(Duration::from_millis(100)).is_ok();
        release_tx.send(()).unwrap();
        assert!(first.join().unwrap());
        second.join().unwrap();
        assert!(
            !completed_early,
            "operation {operation} bypassed the read/mutate/persist gate"
        );
        let stored = sql::read_snapshot(&database).unwrap().0;
        assert_eq!(current().raw(), &stored);
        assert_eq!(stored["auditField"], json!(operation));
    }
    assert_restart(NAME);
}

#[test]
fn assistant_failed_transaction_keeps_memory_and_restart_state() {
    const NAME: &str = "server::config::persistence_tests::assistant_failed_transaction_keeps_memory_and_restart_state";
    if !isolated(NAME) {
        return;
    }
    let database = open_database();
    if is_restart() {
        assert!(!assistant_config().tool_enabled("set_account_enabled"));
        assert_eq!(assistant_config().model.as_deref(), Some("saved-model"));
        return;
    }
    let mut saved = AssistantConfig::default();
    saved.model = Some("saved-model".into());
    assert!(set_assistant_config(saved.clone()));
    database
        .with(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER reject_assistant BEFORE INSERT ON kv
         WHEN NEW.key = 'assistantConfig'
         BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;",
            )
        })
        .unwrap()
        .unwrap();
    let before = current();
    let mut changed = saved.clone();
    changed.tools.insert("set_account_enabled".into(), true);
    assert!(!set_assistant_config(changed));
    assert_eq!(assistant_config(), saved);
    assert_eq!(current().raw(), before.raw());
    assert_eq!(sql::read_snapshot(&database).unwrap().0, *before.raw());
    assert_eq!(reload().raw(), before.raw());
    assert_restart(NAME);
    database
        .with(|conn| conn.execute_batch("DROP TRIGGER reject_assistant;"))
        .unwrap()
        .unwrap();
    assert!(set_assistant_config(saved));
}

#[test]
fn persisted_replacement_serializes_until_reload_and_preserves_failed_or_noop_state() {
    const NAME: &str = "server::config::persistence_tests::persisted_replacement_serializes_until_reload_and_preserves_failed_or_noop_state";
    if !isolated(NAME) {
        return;
    }
    let database = open_database();
    if is_restart() {
        assert_eq!(current().raw()["importedOnly"], json!(true));
        assert_eq!(current().raw()["locale"], json!("after-import"));
        return;
    }
    assert!(set_locale("on-disk"));
    database
        .with(|conn| conn.execute_batch("PRAGMA query_only=ON;"))
        .unwrap()
        .unwrap();
    assert!(!set_locale("volatile"));
    database
        .with(|conn| conn.execute_batch("PRAGMA query_only=OFF;"))
        .unwrap()
        .unwrap();
    let before = current();
    let failure: Result<(), String> = update_persisted_and_reload(|| Err("import failed".into()));
    assert!(failure.is_err());
    assert_eq!(
        current().raw(),
        before.raw(),
        "failure must not discard volatile settings"
    );
    update_persisted_and_reload(|| Ok(((), false))).unwrap();
    assert_eq!(
        current().raw(),
        before.raw(),
        "no-op must not reload unrelated settings"
    );

    let (committed_tx, committed_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let import_database = database.clone();
    let importing = std::thread::spawn(move || {
        update_persisted_and_reload(|| {
            let raw =
                serde_json::from_value(json!({"locale":"imported", "importedOnly":true})).unwrap();
            sql::write_all(&import_database, &raw)?;
            committed_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(((), true))
        })
        .unwrap();
    });
    committed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    // The database is available after commit; setters must still wait for the
    // replacement snapshot instead of writing the pre-import snapshot over it.
    assert_eq!(
        sql::read_snapshot(&database).unwrap().0["importedOnly"],
        json!(true)
    );
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let setter = std::thread::spawn(move || {
        attempt_tx.send(()).unwrap();
        assert!(set_locale("after-import"));
        done_tx.send(()).unwrap();
    });
    attempt_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let completed_early = done_rx.recv_timeout(Duration::from_millis(100)).is_ok();
    release_tx.send(()).unwrap();
    importing.join().unwrap();
    setter.join().unwrap();
    assert!(
        !completed_early,
        "setter ran between database replacement and reload"
    );
    assert_eq!(current().raw()["importedOnly"], json!(true));
    assert_eq!(current().raw(), &sql::read_snapshot(&database).unwrap().0);
    assert_restart(NAME);
}
