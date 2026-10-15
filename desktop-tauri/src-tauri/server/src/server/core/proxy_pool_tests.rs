use super::*;
use crate::server::db::test_temp::TempDb;
use std::sync::{Arc, Barrier};

#[test]
fn independent_connections_preserve_concurrent_updates_from_all_proxy_sources() {
    let (db, temp) = TempDb::open("proxy-pool-concurrent-sources");
    mutate_items_on(&db, |items| {
        items.push(json!({"id":"counter", "source":"manual", "count":0}));
        Ok(())
    })
    .unwrap();
    let workers = 8;
    let rounds = 16;
    let barrier = Arc::new(Barrier::new(workers));
    let connections: Vec<Db> = (0..workers)
        .map(|_| Db::open(temp.path()).unwrap())
        .collect();
    let handles: Vec<_> = connections
        .into_iter()
        .enumerate()
        .map(|(worker, connection)| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                for round in 0..rounds {
                    mutate_items_on(&connection, |items| {
                        let counter = items[0]["count"].as_u64().unwrap();
                        std::thread::sleep(std::time::Duration::from_millis(1));
                        items[0]["count"] = json!(counter + 1);
                        items.push(json!({
                            "id": format!("{worker}-{round}"),
                            "source": (["manual", "clash", "subscription"][worker % 3]),
                        }));
                        Ok(())
                    })
                    .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    let stored: String = db
        .with(|conn| {
            conn.query_row("SELECT value FROM kv WHERE key=?1", [KV_KEY], |row| {
                row.get(0)
            })
            .unwrap()
        })
        .unwrap();
    let parsed: Value = serde_json::from_str(&stored).unwrap();
    let items = parsed["items"].as_array().unwrap();
    assert_eq!(items[0]["count"], json!(workers * rounds));
    assert_eq!(items.len(), workers * rounds + 1);
    let ids: std::collections::HashSet<_> = items
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), items.len());
    assert_eq!(
        items
            .iter()
            .filter(|item| item["source"] == "clash")
            .count(),
        48
    );
    assert_eq!(
        items
            .iter()
            .filter(|item| item["source"] == "subscription")
            .count(),
        32
    );
}

#[test]
fn corrupt_storage_and_failed_mutations_preserve_the_original_pool() {
    let (db, _temp) = TempDb::open("proxy-pool-reject-corruption");
    db.with(|conn| {
        conn.execute(
            "INSERT INTO kv (key,value) VALUES (?1,?2)",
            [KV_KEY, "broken-json"],
        )
        .unwrap()
    })
    .unwrap();
    assert!(mutate_items_on(&db, |items| {
        items.clear();
        Ok(())
    })
    .is_err());
    let read = || {
        db.with(|conn| {
            conn.query_row("SELECT value FROM kv WHERE key=?1", [KV_KEY], |row| {
                row.get::<_, String>(0)
            })
            .unwrap()
        })
        .unwrap()
    };
    assert_eq!(read(), "broken-json");
    let original = r#"{"items":[{"id":"kept","source":"subscription"}]}"#;
    db.with(|conn| {
        conn.execute("UPDATE kv SET value=?1 WHERE key=?2", [original, KV_KEY])
            .unwrap()
    })
    .unwrap();
    let result: Result<(), String> = mutate_items_on(&db, |items| {
        items.clear();
        Err("fixture rejects this update".to_string())
    });
    assert!(result.is_err());
    assert_eq!(read(), original);
}
