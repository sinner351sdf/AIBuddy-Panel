//! 插件模型目录的同步快照；成功刷新持久化，装配时恢复后再使用握手兜底。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use agent2api_provider_protocol as proto;
use serde_json::Value;

use crate::server::core::providers::catalog_cache;
use crate::server::logging;

pub const SETTING_MODEL_CATALOG: &str = "modelCatalog";

#[derive(Clone, Default)]
struct Entry {
    remote: Option<proto::ModelList>,
    fallback: Vec<Value>,
}

fn table() -> &'static Mutex<HashMap<String, Entry>> {
    static TABLE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn scope(provider: &str) -> String {
    format!("plugin:{provider}")
}

/// Stable names in the frozen pre-plugin database, retained for read-only projection.
fn legacy_scope(provider: &str) -> &str {
    match provider {
        "workbuddy-intl" => "workbuddyIntl",
        "cline" | "cline-free" | "cline-pass" => "cline",
        "accio" => "accioGlobal",
        "accio-cn" => "accioCn",
        "qoder" => "qoderGlobal",
        "qoder-cn" => "qoderCn",
        "autoclaw" | "autoclaw-cn" => "autoclawCn",
        "autoclaw-intl" => "autoclawIntl",
        "monkeycode" | "monkeycode-cn" => "monkeycodeCn",
        "monkeycode-intl" => "monkeycodeIntl",
        other => other,
    }
}
fn restore(provider: &str) -> Option<proto::ModelList> {
    let cached = catalog_cache::load(&scope(provider))
        .or_else(|| catalog_cache::load(legacy_scope(provider)))?;
    let models = valid_models(cached.models);
    (!models.is_empty()).then_some(proto::ModelList {
        models,
        meta: proto::CatalogMeta {
            remote: true,
            refreshed_at: cached.fetched_at,
        },
    })
}

fn valid_models(models: Vec<Value>) -> Vec<Value> {
    let mut claimed = HashSet::new();
    models
        .into_iter()
        .filter(|model| {
            model
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.trim().is_empty() && claimed.insert(id.to_ascii_lowercase()))
        })
        .collect()
}

pub fn set_defaults(provider: &str, models: Vec<Value>) {
    let restored = restore(provider);
    if let Ok(mut map) = table().lock() {
        let entry = map.entry(provider.to_string()).or_default();
        if entry.remote.is_none() {
            entry.remote = restored;
        }
        entry.fallback = valid_models(models);
    }
}

pub fn set_remote(provider: &str, mut list: proto::ModelList) -> usize {
    list.models = valid_models(list.models);
    if list.models.is_empty() {
        return 0;
    }
    list.meta.remote = true;
    if list.meta.refreshed_at <= 0 {
        list.meta.refreshed_at = logging::now_ms();
    }
    let count = list.models.len();
    catalog_cache::save(&scope(provider), &list.models, list.meta.refreshed_at);
    let Ok(mut map) = table().lock() else {
        return 0;
    };
    map.entry(provider.to_string()).or_default().remote = Some(list);
    count
}

pub fn snapshot(provider: &str) -> Option<proto::ModelList> {
    // Plugins may request their old catalog during init, before set_defaults.
    // Do not hold the process cache lock while reading the database.
    let cached = table()
        .lock()
        .ok()
        .and_then(|map| map.get(provider).cloned());
    if let Some(remote) = cached.as_ref().and_then(|entry| entry.remote.clone()) {
        return Some(remote);
    }
    if let Some(restored) = restore(provider) {
        if let Ok(mut map) = table().lock() {
            let entry = map.entry(provider.to_string()).or_default();
            if entry.remote.is_none() {
                entry.remote = Some(restored.clone());
            }
            return entry.remote.clone();
        }
        return Some(restored);
    }
    cached.and_then(|entry| {
        (!entry.fallback.is_empty()).then(|| proto::ModelList {
            models: entry.fallback,
            meta: proto::CatalogMeta::default(),
        })
    })
}

pub fn models_for(provider: &str) -> Option<Vec<Value>> {
    snapshot(provider).map(|list| list.models)
}

pub fn meta(provider: &str) -> proto::CatalogMeta {
    let Ok(map) = table().lock() else {
        return proto::CatalogMeta::default();
    };
    map.get(provider)
        .and_then(|entry| entry.remote.as_ref())
        .map(|list| list.meta.clone())
        .unwrap_or_default()
}

pub fn forget(provider: &str) {
    if let Ok(mut map) = table().lock() {
        map.remove(provider);
    }
}

pub fn clear_all() {
    if let Ok(mut map) = table().lock() {
        map.clear();
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    #[test]
    fn legacy_names_preserve_region_isolation() {
        for (provider, scope) in [
            ("accio", "accioGlobal"),
            ("accio-cn", "accioCn"),
            ("workbuddy-intl", "workbuddyIntl"),
            ("qoder-cn", "qoderCn"),
            ("trae", "trae"),
        ] {
            assert_eq!(legacy_scope(provider), scope);
        }
        assert_ne!(legacy_scope("accio"), legacy_scope("accio-cn"));
    }
    #[test]
    fn rejects_invalid_catalog_rows_without_discarding_valid_models() {
        let rows = valid_models(vec![
            serde_json::json!({"id":"good"}),
            serde_json::json!({"id":"GOOD"}),
            serde_json::json!({"id":""}),
            Value::Null,
        ]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "good");
    }
}
