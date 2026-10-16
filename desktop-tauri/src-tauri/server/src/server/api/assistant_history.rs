//! Admin-only local chat history. Saving/restoring UI messages never executes tools.
//! Optimistic revisions prevent stale tabs from overwriting newer messages or titles.
use crate::server::{
    access, errors,
    http::{ok_json, parse_body},
    logging, ServerState,
};
use axum::{
    body::Bytes,
    extract::{Path, State},
    response::Response,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

// UI file parts retain base64 text and metadata; leave headroom over the 24 MB wire budget.
const MAX_BYTES: usize = 31 * 1024 * 1024;
const MAX_TOTAL: i64 = 256 * 1024 * 1024;
type Failure = (i32, String);
fn fail(message: impl ToString) -> Failure {
    (500, message.to_string())
}
fn with_db(
    state: &ServerState,
    action: impl FnOnce(&Connection) -> Result<Value, Failure>,
) -> Response {
    let result = state
        .db()
        .and_then(|db| db.with(action))
        .unwrap_or_else(|| Err((503, "对话数据库不可用".into())));
    match result {
        Ok(data) => ok_json(data),
        Err((code, message)) => errors::management_error(code, message),
    }
}
fn read(conn: &Connection, id: &str) -> Result<Value, Failure> {
    conn.query_row("SELECT id,title,messages,revision,created_at,updated_at FROM assistant_conversations WHERE id=?1 AND deleted=0", [id], |row| {
        let messages: String = row.get(2)?;
        Ok(json!({"id":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?,"messages":serde_json::from_str::<Value>(&messages).unwrap_or(json!([])),"revision":row.get::<_,i64>(3)?,"createdAt":row.get::<_,i64>(4)?,"updatedAt":row.get::<_,i64>(5)?}))
    }).optional().map_err(fail)?.ok_or((404, "对话不存在或已删除".into()))
}
fn payload(body: &Bytes) -> Result<Value, Failure> {
    if body.len() > MAX_BYTES {
        return Err((413, "对话与附件总量过大".into()));
    }
    parse_body(body).map_err(|error| (400, error.message))
}
fn title(value: &Value) -> Result<String, Failure> {
    let text = value.as_str().unwrap_or("").trim();
    if text.is_empty() || text.chars().count() > 120 {
        return Err((400, "对话标题需为 1–120 个字符".into()));
    }
    Ok(text.into())
}
fn revision(value: &Value) -> Result<i64, Failure> {
    value["revision"]
        .as_i64()
        .filter(|n| *n >= 0)
        .ok_or((400, "缺少有效的对话版本".into()))
}
fn check_updated(count: usize) -> Result<(), Failure> {
    if count == 0 {
        Err((
            409,
            "对话已在另一窗口更新或删除，请重新打开后再试；当前内容仍保留在页面中。".into(),
        ))
    } else {
        Ok(())
    }
}
fn validate_messages(messages: &Value) -> Result<(), Failure> {
    let rows = messages
        .as_array()
        .filter(|rows| rows.len() <= 200)
        .ok_or((400, "对话最多保存 200 条消息".into()))?;
    let mut ids = std::collections::HashSet::new();
    for row in rows {
        let id = row["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 256)
            .ok_or((400, "消息标识无效".into()))?;
        if !ids.insert(id) {
            return Err((400, "消息标识重复".into()));
        }
        if !matches!(row["role"].as_str(), Some("user" | "assistant")) {
            return Err((400, "历史记录只接受用户与助手消息".into()));
        }
        let parts = row["parts"]
            .as_array()
            .filter(|parts| parts.len() <= 512)
            .ok_or((400, "消息内容无效".into()))?;
        for part in parts {
            match part["type"].as_str() {
                Some("text" | "reasoning") if part["text"].is_string() => {}
                Some("step-start" | "dynamic-tool") => {}
                Some("file") if row["role"] == "user" => {
                    let url = part["url"].as_str().unwrap_or("");
                    let media = part["mediaType"].as_str().unwrap_or("");
                    if !matches!(
                        media,
                        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "text/plain"
                    ) || !url.starts_with(&format!("data:{media};base64,"))
                    {
                        return Err((400, "历史附件必须是支持的内嵌图片或文本文件".into()));
                    }
                }
                _ => return Err((400, "不支持的历史消息内容".into())),
            }
        }
    }
    Ok(())
}
pub async fn list(State(state): State<ServerState>) -> Response {
    with_db(&state, |conn| {
        let mut statement=conn.prepare("SELECT id,title,revision,created_at,updated_at FROM assistant_conversations WHERE deleted=0 ORDER BY updated_at DESC,id DESC").map_err(fail)?;
        let items=statement.query_map([], |row| Ok(json!({"id":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?,"revision":row.get::<_,i64>(2)?,"createdAt":row.get::<_,i64>(3)?,"updatedAt":row.get::<_,i64>(4)?}))).map_err(fail)?.collect::<rusqlite::Result<Vec<_>>>().map_err(fail)?;
        Ok(json!({"items":items}))
    })
}
pub async fn create(State(state): State<ServerState>) -> Response {
    with_db(&state, |conn| {
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM assistant_conversations WHERE deleted=0",
                [],
                |r| r.get(0),
            )
            .map_err(fail)?;
        if count >= 1000 {
            return Err((409, "已达到 1000 个对话，请整理历史对话后再试".into()));
        }
        let id = access::random_hex(16);
        let now = logging::now_ms();
        conn.execute("INSERT INTO assistant_conversations(id,title,created_at,updated_at) VALUES(?1,'新对话',?2,?2)",params![id,now]).map_err(fail)?;
        Ok(json!({"conversation":read(conn,&id)?}))
    })
}
pub async fn get(State(state): State<ServerState>, Path(id): Path<String>) -> Response {
    with_db(&state, |conn| Ok(json!({"conversation":read(conn,&id)?})))
}
pub async fn save(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let value = match payload(&body) {
        Ok(v) => v,
        Err((c, m)) => return errors::management_error(c, m),
    };
    let rev = match revision(&value) {
        Ok(v) => v,
        Err((c, m)) => return errors::management_error(c, m),
    };
    if let Err((c, m)) = validate_messages(&value["messages"]) {
        return errors::management_error(c, m);
    }
    let text = value["messages"].to_string();
    with_db(&state, |conn| {
        let total:i64=conn.query_row("SELECT coalesce(sum(bytes),0) FROM assistant_conversations WHERE deleted=0 AND id<>?1",[&id],|r|r.get(0)).map_err(fail)?;
        if total + text.len() as i64 > MAX_TOTAL {
            return Err((413, "历史对话占用已达 256 MB，请整理附件或历史对话".into()));
        }
        check_updated(conn.execute("UPDATE assistant_conversations SET messages=?1,bytes=?5,revision=revision+1,updated_at=?2 WHERE id=?3 AND revision=?4 AND deleted=0",params![text,logging::now_ms(),id,rev,text.len() as i64]).map_err(fail)?)?;
        Ok(json!({"conversation":read(conn,&id)?}))
    })
}
pub async fn rename(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let value = match payload(&body) {
        Ok(v) => v,
        Err((c, m)) => return errors::management_error(c, m),
    };
    let (name, rev) = match title(&value["title"]).and_then(|t| revision(&value).map(|r| (t, r))) {
        Ok(v) => v,
        Err((c, m)) => return errors::management_error(c, m),
    };
    with_db(&state, |conn| {
        check_updated(conn.execute("UPDATE assistant_conversations SET title=?1,revision=revision+1 WHERE id=?2 AND revision=?3 AND deleted=0",params![name,id,rev]).map_err(fail)?)?;
        Ok(json!({"conversation":read(conn,&id)?}))
    })
}
pub async fn remove(State(state): State<ServerState>, Path(id): Path<String>) -> Response {
    with_db(&state, |conn| {
        conn.execute("UPDATE assistant_conversations SET deleted=1,messages='[]',bytes=2,revision=revision+1 WHERE id=?1",[id]).map_err(fail)?;
        Ok(json!({"deleted":true}))
    })
}
/// Delete the explicitly confirmed list, never a conversation created in another tab later.
pub async fn remove_many(State(state): State<ServerState>, body: Bytes) -> Response {
    let value = match payload(&body) {
        Ok(value) => value,
        Err((code, message)) => return errors::management_error(code, message),
    };
    let Some(ids) = value["ids"]
        .as_array()
        .filter(|ids| !ids.is_empty() && ids.len() <= 1000)
    else {
        return errors::management_error(400, "请选择要删除的聊天记录");
    };
    let ids: Vec<&str> = match ids
        .iter()
        .map(|id| id.as_str().filter(|id| !id.is_empty() && id.len() <= 256))
        .collect::<Option<Vec<_>>>()
    {
        Some(ids) => ids,
        None => return errors::management_error(400, "聊天记录标识无效"),
    };
    with_db(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(fail)?;
        let mut deleted = 0;
        for id in ids {
            deleted += tx.execute("UPDATE assistant_conversations SET deleted=1,messages='[]',bytes=2,revision=revision+1 WHERE id=?1 AND deleted=0", [id]).map_err(fail)?;
        }
        tx.commit().map_err(fail)?;
        Ok(json!({ "deleted": deleted }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_history_without_executing_tools() {
        assert!(validate_messages(&json!([{"id":"x","role":"assistant","parts":[{"type":"dynamic-tool","toolCallId":"x","toolName":"set_account_enabled","state":"input-available","input":{}}]}])).is_ok());
        assert!(validate_messages(&json!([{"id":"x","role":"system","parts":[]}])).is_err());
        assert!(validate_messages(&json!([{"id":"x","role":"user","parts":[{"type":"file","mediaType":"image/png","url":"https://example.com/a.png"}]}])).is_err());
    }
    #[test]
    fn migration_preserves_existing_data_and_is_repeatable() {
        let conn = Connection::open_in_memory().unwrap();
        crate::server::db::schema::migrate(&conn).unwrap();
        conn.execute("INSERT INTO assistant_conversations(id,title,messages,revision,created_at,updated_at,deleted) VALUES('a','title','[]',0,1,1,0)",[]).unwrap();
        conn.pragma_update(None, "user_version", 15).unwrap();
        crate::server::db::schema::migrate(&conn).unwrap();
        crate::server::db::schema::migrate(&conn).unwrap();
        assert_eq!(read(&conn, "a").unwrap()["title"], "title");
    }
}
