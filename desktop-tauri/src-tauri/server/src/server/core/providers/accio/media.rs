//! Resolve image references before wire capture and SDK generation. Downloads
//! use the account's egress, without any Accio headers/cookies. Failures become
//! explicit text placeholders, matching official ImageCache.resolveMessages.
use crate::server::core::proxies::ResolvedProxy;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOTAL: usize = 32 * 1024 * 1024;
const MAX_IMAGES: usize = 64;

#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Report {
    images: usize,
    resolved: usize,
    cache_hits: usize,
    replaced: usize,
    bytes: usize,
    failures: std::collections::BTreeMap<&'static str, usize>,
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || ip.octets()[0] == 0
                || ip.octets()[0] >= 240
                || ip.octets()[0..2] == [100, 64]
                || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
                || (ip.octets()[0] == 198 && matches!(ip.octets()[1], 18 | 19)))
        }
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(|v| public_ip(IpAddr::V4(v)))
            .unwrap_or_else(|| {
                // Only global-unicast 2000::/3, excluding documentation addresses.
                (ip.segments()[0] & 0xe000) == 0x2000 && ip.segments()[0..2] != [0x2001, 0x0db8]
            }),
    }
}

async fn validate_url(raw: &str) -> Result<(url::Url, Vec<std::net::SocketAddr>), &'static str> {
    let url = url::Url::parse(raw).map_err(|_| "unsupported_reference")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return Err("unsupported_reference");
    }
    let host = url.host_str().ok_or("unsupported_reference")?;
    let addresses = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|_| "download_failed")?;
    let addresses: Vec<_> = addresses.collect();
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("unsupported_reference");
    }
    Ok((url, addresses))
}

async fn download(raw: &str, proxy: Option<&ResolvedProxy>) -> Result<Vec<u8>, &'static str> {
    let mut next = raw.to_owned();
    for _ in 0..=3 {
        let (url, addresses) = validate_url(&next).await?;
        let host = url.host_str().ok_or("unsupported_reference")?;
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(30014))
            .connect_timeout(Duration::from_secs(10))
            .resolve_to_addrs(host, &addresses);
        if let Some(proxy) = proxy {
            let port = proxy.port.ok_or("download_failed")?;
            let host = if proxy.host.contains(':') && !proxy.host.starts_with('[') {
                format!("[{}]", proxy.host)
            } else {
                proxy.host.clone()
            };
            let scheme = if proxy.protocol == "socks5" {
                "socks5h"
            } else {
                &proxy.protocol
            };
            let mut configured = reqwest::Proxy::all(format!("{scheme}://{host}:{port}"))
                .map_err(|_| "download_failed")?;
            if !proxy.username.is_empty() {
                configured = configured.basic_auth(&proxy.username, &proxy.password);
            }
            builder = builder.proxy(configured);
        }
        let client = builder.build().map_err(|_| "download_failed")?;
        // No token, cookie, SDK factors, device or request ID are attached here.
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "download_failed")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("download_failed")?;
            next = url
                .join(location)
                .map_err(|_| "unsupported_reference")?
                .to_string();
            continue;
        }
        if !response.status().is_success() {
            return Err("download_failed");
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
        {
            return Err("image_too_large");
        }
        if let Some(mime) = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
        {
            let mime = mime.split(';').next().unwrap_or("").trim();
            if !mime.starts_with("image/") && mime != "application/octet-stream" {
                return Err("not_an_image");
            }
        }
        let mut data = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "download_failed")?;
            if data.len().saturating_add(chunk.len()) > MAX_BYTES {
                return Err("image_too_large");
            }
            data.extend_from_slice(&chunk);
        }
        return Ok(data);
    }
    Err("download_failed")
}

fn normalize(bytes: Vec<u8>) -> Result<Value, &'static str> {
    use image::{ImageFormat, ImageReader};
    if bytes.len() > MAX_BYTES {
        return Err("image_too_large");
    }
    let format = image::guess_format(&bytes).map_err(|_| "not_an_image")?;
    if !matches!(
        format,
        ImageFormat::Png
            | ImageFormat::Jpeg
            | ImageFormat::WebP
            | ImageFormat::Bmp
            | ImageFormat::Ico
    ) {
        return Err("mime_conversion_failed");
    }
    let mut reader = ImageReader::with_format(std::io::Cursor::new(&bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "image_corrupted")?;
    let (bytes, format) = if image.width() > 1600
        || image.height() > 1600
        || matches!(format, ImageFormat::Bmp | ImageFormat::Ico)
    {
        let resized = image.thumbnail(1600, 1600);
        let mut data = std::io::Cursor::new(Vec::new());
        resized
            .write_to(&mut data, ImageFormat::Png)
            .map_err(|_| "mime_conversion_failed")?;
        (data.into_inner(), ImageFormat::Png)
    } else {
        (bytes, format)
    };
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        _ => "image/webp",
    };
    Ok(json!({"inline_data":{"mime_type":mime,"data":STANDARD.encode(bytes)}}))
}

async fn resolve(part: &Value, proxy: Option<&ResolvedProxy>) -> Result<Value, &'static str> {
    let bytes = if let Some(inline) = part.get("inline_data") {
        let data = inline
            .get("data")
            .and_then(Value::as_str)
            .ok_or("base64_decode_failed")?;
        if data.len() > MAX_BYTES * 4 / 3 + 4 {
            return Err("image_too_large");
        }
        let compact: String = data.chars().filter(|c| !c.is_ascii_whitespace()).collect();
        STANDARD
            .decode(compact)
            .map_err(|_| "base64_decode_failed")?
    } else {
        let raw = part
            .pointer("/file_data/file_uri")
            .and_then(Value::as_str)
            .ok_or("unsupported_reference")?;
        tokio::time::timeout(Duration::from_millis(30014), download(raw, proxy))
            .await
            .map_err(|_| "download_timeout")??
    };
    tokio::task::spawn_blocking(move || normalize(bytes))
        .await
        .map_err(|_| "image_corrupted")?
}

pub(super) async fn prepare(
    body: &mut Value,
    vision: bool,
    max_images: Option<usize>,
    proxy: Option<&ResolvedProxy>,
) -> Report {
    let mut report = Report::default();
    let mut cache: HashMap<String, Result<Value, &'static str>> = HashMap::new();
    let Some(contents) = body.get_mut("contents").and_then(Value::as_array_mut) else {
        return report;
    };
    let deadline = tokio::time::Instant::now() + Duration::from_millis(30014);
    for content in contents {
        let Some(parts) = content.get_mut("parts").and_then(Value::as_array_mut) else {
            continue;
        };
        for part in parts {
            if part.get("inline_data").is_none() && part.get("file_data").is_none() {
                continue;
            }
            report.images += 1;
            let key = part.to_string();
            let result = if !vision {
                Err("model_has_no_vision")
            } else if report.images > max_images.unwrap_or(MAX_IMAGES).min(MAX_IMAGES) {
                Err("image_limit_exceeded")
            } else if report.bytes >= MAX_TOTAL {
                Err("image_too_large")
            } else if let Some(cached) = cache.get(&key) {
                report.cache_hits += 1;
                cached.clone()
            } else {
                let result = tokio::time::timeout_at(deadline, resolve(part, proxy))
                    .await
                    .unwrap_or(Err("download_timeout"));
                cache.insert(key, result.clone());
                result
            };
            match result {
                Ok(image) => {
                    let size = image
                        .pointer("/inline_data/data")
                        .and_then(Value::as_str)
                        .map_or(0, |s| s.len() * 3 / 4);
                    if report.bytes.saturating_add(size) <= MAX_TOTAL {
                        report.bytes += size;
                        report.resolved += 1;
                        *part = image;
                        continue;
                    }
                    report.replaced += 1;
                    *report.failures.entry("image_too_large").or_default() += 1;
                    *part = json!({"text":"[image unavailable: error_code=image_too_large]"});
                }
                Err(code) => {
                    report.replaced += 1;
                    *report.failures.entry(code).or_default() += 1;
                    *part = json!({"text":format!("[image unavailable: error_code={code}]")});
                }
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn capability_and_invalid_media_are_explicit_placeholders() {
        let mut body = json!({"contents":[{"parts":[{"file_data":{"file_uri":"file:///private/no-read"}},{"inline_data":{"mime_type":"image/png","data":"garbage"}}]}]});
        let report = prepare(&mut body, true, None, None).await;
        assert_eq!(report.replaced, 2);
        assert_eq!(report.failures["unsupported_reference"], 1);
        assert!(body.to_string().contains("base64_decode_failed"));
        let mut body = json!({"contents":[{"parts":[{"file_data":{"file_uri":"https://example.com/a.png"}}]}]});
        let report = prepare(&mut body, false, None, None).await;
        assert_eq!(report.failures["model_has_no_vision"], 1); // no DNS or HTTP
    }
    #[tokio::test]
    async fn magic_bytes_override_mime_and_duplicate_images_use_request_cache() {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 3)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let part = json!({"inline_data":{"mime_type":"image/jpeg","data":STANDARD.encode(bytes.into_inner())}});
        let mut body = json!({"contents":[{"parts":[part.clone(),part.clone(),part]}]});
        let report = prepare(&mut body, true, Some(2), None).await;
        assert_eq!(report.resolved, 2);
        assert_eq!(report.cache_hits, 1);
        assert_eq!(report.replaced, 1);
        assert_eq!(
            body["contents"][0]["parts"][0]["inline_data"]["mime_type"],
            "image/png"
        );
    }
    #[test]
    fn private_addresses_and_mapped_ipv6_are_not_media_targets() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.127.1.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
    }

    #[tokio::test]
    async fn private_https_and_unsupported_schemes_fail_without_http() {
        for url in [
            "https://127.0.0.1/a",
            "https://169.254.169.254/a",
            "http://example.com/a",
            "file:///a",
            "https://user:secret@example.com/a",
            "https://example.com:8443/a",
        ] {
            assert!(validate_url(url).await.is_err(), "{url}");
        }
    }

    #[test]
    fn bitmap_conversion_resize_and_corruption_are_checked() {
        let mut bmp = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 3)
            .write_to(&mut bmp, image::ImageFormat::Bmp)
            .unwrap();
        assert_eq!(
            normalize(bmp.into_inner()).unwrap()["inline_data"]["mime_type"],
            "image/png"
        );
        let mut large = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1700, 10)
            .write_to(&mut large, image::ImageFormat::Png)
            .unwrap();
        let result = normalize(large.into_inner()).unwrap();
        let data = STANDARD
            .decode(result["inline_data"]["data"].as_str().unwrap())
            .unwrap();
        let decoded = image::load_from_memory(&data).unwrap();
        assert!(decoded.width() <= 1600 && decoded.height() <= 1600);
        assert!(normalize(b"\x89PNG\r\n\x1a\ninvalid".to_vec()).is_err());
    }
}
