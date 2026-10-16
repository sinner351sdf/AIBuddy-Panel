//! The assistant accepts text and inline raster images. Reject unsupported attachments
//! before routing, rather than let an adapter silently discard an unknown content block.
use base64::Engine;
use serde_json::Value;

pub(super) fn validate(messages: &[Value]) -> Result<(), String> {
    for message in messages {
        if !message.is_object() { return Err("每条消息必须是对象".into()); }
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        if !matches!(role, "user" | "assistant" | "system" | "developer" | "tool") { return Err("消息角色无效".into()); }
        match message.get("content") {
            Some(Value::String(_)) => (),
            None | Some(Value::Null) if role == "assistant" && message.get("tool_calls").is_some() => (),
            Some(Value::Array(parts)) => {
                let mut images = 0;
                for part in parts {
                    match part.get("type").and_then(Value::as_str) {
                        Some("text") if part.get("text").is_some_and(Value::is_string) => (),
                        Some("image_url") if role == "user" => {
                            images += 1;
                            if images > 6 { return Err("每条消息最多 6 张图片".into()); }
                            let url = part.pointer("/image_url/url").and_then(Value::as_str).unwrap_or("");
                            let (header, encoded) = url.split_once(',').ok_or("图片必须使用内联 data URL")?;
                            if !matches!(header, "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/gif;base64" | "data:image/webp;base64") { return Err("仅支持 PNG、JPEG、GIF、WebP 内联图片".into()); }
                            if encoded.len() > 4 * 1024 * 1024 * 4 / 3 + 4 { return Err("单张图片不能超过 4 MB".into()); }
                            let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "图片 base64 无效")?;
                            if bytes.len() > 4 * 1024 * 1024 { return Err("单张图片不能超过 4 MB".into()); }
                            let signature = match header {
                                "data:image/png;base64" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                                "data:image/jpeg;base64" => bytes.starts_with(&[255, 216, 255]),
                                "data:image/gif;base64" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
                                _ => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
                            };
                            if !signature { return Err("图片内容与声明格式不符".into()); }
                        }
                        _ => return Err("不支持的消息内容或附件类型；文件请先转换为文本或图片".into()),
                    }
                }
            }
            _ => return Err("消息内容必须是文本或内容数组".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn keeps_text_images_and_tool_history_valid() {
        let image = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture");
        assert!(validate(&[json!({"role":"user","content":[{"type":"text","text":"附件代码"},{"type":"image_url","image_url":{"url":format!("data:image/png;base64,{image}")}}]}), json!({"role":"assistant","content":null,"tool_calls":[]}), json!({"role":"tool","tool_call_id":"x","content":"result"})]).is_ok());
    }
    #[test]
    fn rejects_unknown_binary_remote_and_forged_images() {
        for part in [json!({"type":"file","file":{"file_data":"secret"}}), json!({"type":"image_url","image_url":{"url":"https://example.com/private.png"}}), json!({"type":"image_url","image_url":{"url":"data:image/png;base64,ZXhl"}}), json!({"type":"text"})] {
            assert!(validate(&[json!({"role":"user","content":[part]})]).is_err());
        }
    }
}
