//! 插件索引、发行版与下载。网络出口和 GitHub 令牌复用软件更新链路。

use serde_json::{json, Value};

use crate::server::core::update::client::{fetch_public, github_headers};
use crate::server::core::update::{api_base, compare_versions};

pub const INDEX_REPO: &str = "sinner351sdf/AIBuddy-Panel";
pub const FALLBACK_REPO: &str = INDEX_REPO;
pub const PACK_ID: &str = "aibuddy-providers";
const INDEX_ROOT: &str = "provider-plugin/index";
const TAG_TEMPLATE: &str = "providers-v{version}";
const ASSET_TEMPLATE: &str = "{id}-{version}-{target}.zip";
const TARGETS: &[&str] = &[
    "x86_64-pc-windows-msvc", "x86_64-apple-darwin", "aarch64-apple-darwin",
    "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu",
];
const QUERY_TIMEOUT_MS: u64 = 30_000;
const MAX_DOWNLOAD_BYTES: usize = 24 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct PackAsset {
    pub version: String,
    pub name: String,
    pub url: String,
    pub size: u64,
    pub page: String,
}

pub fn asset_name(pack_id: &str, version: &str, target: &str) -> String {
    format!("{pack_id}-{version}-{target}.zip")
}

pub(super) fn valid_asset_url(raw: &str, version: &str, target: &str) -> bool {
    asset_url_matches(raw, version, target, crate::server::core::validation::enabled())
}

fn asset_url_matches(raw: &str, version: &str, target: &str, validation: bool) -> bool {
    let Ok(url) = url::Url::parse(raw) else { return false; };
    if validation {
        return matches!(url.scheme(), "http" | "https")
            && url.username().is_empty() && url.password().is_none()
            && (matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
                || matches!(url.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback())
                || url.host_str() == Some("localhost"));
    }
    url.scheme() == "https" && url.host_str() == Some("github.com")
        && url.path() == format!("/{INDEX_REPO}/releases/download/providers-v{version}/{}", asset_name(PACK_ID, version, target))
        && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none()
}

#[derive(Clone, Debug)]
pub struct IndexEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub official: bool,
    pub manifest: String,
    pub icon: String,
    pub repo: String,
}

#[derive(Clone, Debug)]
pub struct PluginDetail {
    pub protocol: u32,
    pub repo: String,
    pub tag_template: String,
    pub asset_template: String,
    pub homepage: String,
}

#[derive(Clone, Debug)]
pub struct ReleaseAssets {
    pub version: String,
    pub page: String,
    pub notes: String,
    pub published_at: String,
    pub prerelease: bool,
    pub platforms: Vec<(String, String, u64)>,
}

impl ReleaseAssets {
    pub fn asset(&self, id: &str, target: &str) -> Option<PackAsset> {
        let (_, url, size) = self
            .platforms
            .iter()
            .find(|(platform, _, _)| platform == target)?;
        Some(PackAsset {
            version: self.version.clone(),
            name: asset_name(id, &self.version, target),
            url: url.clone(),
            size: *size,
            page: self.page.clone(),
        })
    }
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

pub(super) fn retry_key() -> String {
    format!("pluginGithub:{INDEX_REPO}")
}

pub fn clear_cooldown() {
    super::catalog::clear_cooldown();
    if let Err(error) = crate::server::core::task_state::clear_cooldown(&retry_key()) {
        crate::server::logging::verbose("[Plugin]", &error);
    }
}

async fn fetch(url: &str) -> Result<reqwest::Response, String> {
    let state = crate::server::core::task_state::read(&retry_key())?;
    if state.retry_at > crate::server::logging::now_ms() {
        return Err(state.waiting_message());
    }
    let response = fetch_public(url, &github_headers(), Some(QUERY_TIMEOUT_MS)).await?;
    let status = response.status().as_u16();
    if status == 403 || status == 429 {
        let now = crate::server::logging::now_ms();
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
        };
        let after = header("retry-after")
            .and_then(|value| {
                value
                    .parse::<i64>()
                    .ok()
                    .map(|seconds| now.saturating_add(seconds.max(0).saturating_mul(1000)))
                    .or_else(|| {
                        chrono::DateTime::parse_from_rfc2822(value)
                            .ok()
                            .map(|date| date.timestamp_millis())
                    })
            })
            .unwrap_or(0);
        let reset = if header("x-ratelimit-remaining") == Some("0") {
            header("x-ratelimit-reset")
                .and_then(|value| value.parse::<i64>().ok())
                .map(|value| value.saturating_mul(1000).saturating_add(1000))
                .unwrap_or(0)
        } else {
            0
        };
        if let Ok(crate::server::core::task_state::Claim::Acquired(guard)) =
            crate::server::core::task_state::claim(
                &retry_key(),
                60_000,
                true,
                crate::server::core::task_state::ManualBackoff::Respect,
                0,
            )
        {
            let _ = guard.finish(
                false,
                "GitHub 接口访问受限".to_string(),
                None,
                after.max(reset).max(now + 60_000),
                60_000,
            );
        }
        return Err("GitHub 接口访问受限，请稍后重试或配置 GitHub 令牌".to_string());
    }
    Ok(response)
}

pub async fn read_index_result() -> Result<Vec<IndexEntry>, String> {
    let url = index_path("index.json").ok_or_else(|| "插件索引地址无效".to_string())?;
    let response = fetch(&url).await?;
    if !response.status().is_success() {
        return Err(format!(
            "读取插件索引失败：HTTP {}",
            response.status().as_u16()
        ));
    }
    let document: Value = response
        .json()
        .await
        .map_err(|error| format!("插件索引不是合法 JSON：{error}"))?;
    let items = document
        .get("plugins")
        .and_then(Value::as_array)
        .ok_or_else(|| "插件索引缺少 plugins 数组".to_string())?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let id = text(item, "id");
            if id.is_empty()
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            {
                return None;
            }
            let name = text(item, "name");
            if id != PACK_ID { return None; }
            Some(IndexEntry {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                description: text(item, "description"),
                official: item.get("official").and_then(Value::as_bool) == Some(true),
                manifest: text(item, "manifest"),
                icon: text(item, "icon"),
                repo: item
                    .get("source")
                    .map(|source| text(source, "repo"))
                    .unwrap_or_default(),
            })
        })
        .collect())
}

pub async fn read_index() -> Vec<IndexEntry> {
    read_index_result().await.unwrap_or_default()
}

fn index_path(path: &str) -> Option<String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.split('/').any(|part| part == "..")
    {
        return None;
    }
    let root = std::env::var("AIBUDDY_PLUGIN_INDEX_URL").ok()
        .filter(|_| std::env::var("AIBUDDY_VALIDATION_MODE").ok().as_deref() == Some("1"))
        .unwrap_or_else(|| format!("https://raw.githubusercontent.com/{INDEX_REPO}/main/{INDEX_ROOT}/index.json"));
    let base = url::Url::parse(&root).ok()?;
    let resolved = base.join(path).ok()?;
    Some(resolved.to_string())
}

pub async fn read_detail(path: &str) -> Option<PluginDetail> {
    let response = fetch(&index_path(path)?).await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let document: Value = response.json().await.ok()?;
    let release = document.get("release");
    Some(PluginDetail {
        protocol: document
            .get("protocol")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        repo: release.map(|value| text(value, "repo")).unwrap_or_default(),
        tag_template: release
            .map(|value| text(value, "tag"))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| TAG_TEMPLATE.to_string()),
        asset_template: release
            .map(|value| text(value, "asset"))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| ASSET_TEMPLATE.to_string()),
        homepage: text(&document, "homepage"),
    })
}

pub async fn read_store_icon(path: &str) -> Option<String> {
    let response = fetch(&index_path(path)?).await.ok()?;
    if !response.status().is_success() || response.content_length().unwrap_or(0) > 2 * 1024 * 1024 {
        return None;
    }
    let mime = match path.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        _ => return None,
    };
    let bytes = response.bytes().await.ok()?;
    if bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    use base64::Engine;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn valid_repo(repo: &str) -> bool {
    let parts: Vec<_> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}

fn release_version(release: &Value, template: &str) -> Option<String> {
    let tag = text(release, "tag_name");
    let (prefix, suffix) = template.split_once("{version}")?;
    let version = tag.strip_prefix(prefix)?.strip_suffix(suffix)?;
    if !crate::server::core::update::version::strict_semver(version) { return None; }
    Some(version.to_string())
}

fn pick_release_assets(
    release: &Value,
    id: &str,
    detail: Option<&PluginDetail>,
) -> Option<ReleaseAssets> {
    if id != PACK_ID { return None; }
    let tag = detail
        .map(|detail| detail.tag_template.as_str())
        .unwrap_or(TAG_TEMPLATE);
    let version = release_version(release, tag)?;
    let template = detail
        .map(|detail| detail.asset_template.as_str())
        .unwrap_or(ASSET_TEMPLATE)
        .replace("{id}", id)
        .replace("{version}", &version);
    let (prefix, suffix) = template.split_once("{target}")?;
    let mut platforms: Vec<_> = release
        .get("assets")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            let name = item.get("name")?.as_str()?;
            let target = name.strip_prefix(prefix)?.strip_suffix(suffix)?;
            if !TARGETS.contains(&target) {
                return None;
            }
            let url = text(item, "browser_download_url");
            let size = item.get("size").and_then(Value::as_u64).unwrap_or(0);
            if !valid_asset_url(&url, &version, target) || size == 0 || size > MAX_DOWNLOAD_BYTES as u64 {
                return None;
            }
            Some((
                target.to_string(),
                url,
                size,
            ))
        })
        .collect();
    platforms.sort_by(|left, right| left.0.cmp(&right.0));
    if platforms.is_empty() || platforms.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return None;
    }
    Some(ReleaseAssets {
        prerelease: release.get("prerelease").and_then(Value::as_bool) == Some(true)
            || version.contains('-'),
        version,
        page: text(release, "html_url"),
        notes: text(release, "body").chars().take(32_000).collect(),
        published_at: text(release, "published_at"),
        platforms,
    })
}

pub async fn release_for(
    repo: &str,
    id: &str,
    detail: Option<&PluginDetail>,
    current: Option<&str>,
) -> Result<Option<ReleaseAssets>, String> {
    if !valid_repo(repo) || repo != INDEX_REPO || id != PACK_ID {
        return Err("提供商增强必须来自本项目维护的插件源".to_string());
    }
    let beta = super::settings::current().beta;
    if detail.is_some_and(|detail| detail.tag_template != TAG_TEMPLATE || detail.repo != INDEX_REPO
        || detail.asset_template != ASSET_TEMPLATE || detail.protocol != agent2api_provider_protocol::PROTOCOL_VERSION) {
        return Err("插件索引的发行版来源或标签模板不匹配".to_string());
    }
    let url = format!("{}/repos/{repo}/releases?per_page=100", api_base());
    let response = fetch(&url).await?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "查询插件更新失败：GitHub 返回 HTTP {}",
            response.status().as_u16()
        ));
    }
    let document: Value = response
        .json()
        .await
        .map_err(|error| format!("插件 Release 不是合法 JSON：{error}"))?;
    pick_plugin_release(&document, id, detail, beta, current, &super::host_target())
}

fn pick_plugin_release(
    document: &Value,
    id: &str,
    detail: Option<&PluginDetail>,
    beta: bool,
    current: Option<&str>,
    target: &str,
) -> Result<Option<ReleaseAssets>, String> {
    let list = document.as_array().ok_or_else(|| "插件 Release 列表格式错误".to_string())?;
    let only_beta = beta
        && current
            .map(|version| version.contains('-'))
            .unwrap_or(false);
    let mut best: Option<ReleaseAssets> = None;
    for release in list {
        if release.get("draft").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(assets) = pick_release_assets(release, id, detail) else {
            continue;
        };
        if (!beta && assets.prerelease) || (only_beta && !assets.prerelease) {
            continue;
        }
        if current.is_some()
            && !assets
                .platforms
                .iter()
                .any(|(platform, _, _)| platform == target)
        {
            continue;
        }
        if best
            .as_ref()
            .map(|item| compare_versions(&assets.version, &item.version) == Some(1))
            .unwrap_or(true)
        {
            best = Some(assets);
        }
    }
    Ok(best)
}

pub async fn latest(pack_id: &str, target: &str) -> Result<Option<PackAsset>, String> {
    latest_in(FALLBACK_REPO, pack_id, target).await
}

pub async fn latest_in(
    repo: &str,
    pack_id: &str,
    target: &str,
) -> Result<Option<PackAsset>, String> {
    Ok(release_for(repo, pack_id, None, None)
        .await?
        .and_then(|release| release.asset(pack_id, target)))
}

pub async fn release_assets_in(repo: &str, id: &str) -> Result<Option<ReleaseAssets>, String> {
    release_for(repo, id, None, None).await
}

pub async fn download(
    asset: &PackAsset,
    mut progress: impl FnMut(u64, u64),
) -> Result<Vec<u8>, String> {
    crate::server::core::update::assert_downloadable(&asset.url).map_err(|error| error.message)?;
    if asset.size > MAX_DOWNLOAD_BYTES as u64 {
        return Err("插件包超过 24 MB 上限".to_string());
    }
    let response = fetch_public(&asset.url, &github_headers(), None).await?;
    if !response.status().is_success() {
        return Err(format!(
            "下载插件包失败：HTTP {}",
            response.status().as_u16()
        ));
    }
    let total = response.content_length().unwrap_or(asset.size);
    if total > MAX_DOWNLOAD_BYTES as u64 {
        return Err("插件包超过 24 MB 上限".to_string());
    }
    use futures::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    progress(0, total);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("下载中断：{error}"))?;
        if buffer.len() + chunk.len() > MAX_DOWNLOAD_BYTES {
            return Err("插件包超过 24 MB 上限".to_string());
        }
        buffer.extend_from_slice(&chunk);
        progress(buffer.len() as u64, total);
    }
    if buffer.is_empty() {
        return Err("下载到的插件包是空的".to_string());
    }
    Ok(buffer)
}

pub fn check_result(
    id: &str,
    current: &str,
    release: Option<&ReleaseAssets>,
    error: Option<&str>,
) -> Value {
    let asset = release.and_then(|release| release.asset(id, &super::host_target()));
    let available = asset
        .as_ref()
        .is_some_and(|asset| compare_versions(&asset.version, current) == Some(1));
    json!({
        "id": id, "available": available, "checked": true, "current": current,
        "latest": release.map(|release| &release.version),
        "notes": release.map(|release| &release.notes),
        "publishedAt": release.map(|release| &release.published_at),
        "prerelease": release.map(|release| release.prerelease).unwrap_or(false),
        "page": release.map(|release| &release.page),
        "asset": asset.map(|asset| json!({ "name": asset.name, "url": asset.url, "size": asset.size, "page": asset.page })),
        "error": error.is_some(),
        "reason": error.map(str::to_string).or_else(|| {
            if available { None } else if release.is_some() { Some("已经是最新版本".to_string()) }
            else { Some("当前通道暂无可安装的版本".to_string()) }
        }),
    })
}

#[cfg(test)]
fn pick_asset(release: &Value, id: &str, target: &str) -> Option<PackAsset> {
    pick_release_assets(release, id, None)?.asset(id, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(tag: &str, id: &str, version: &str, target: &str) -> Value {
        let base = if crate::server::core::validation::enabled() { "http://127.0.0.1:3199".to_string() }
            else { format!("https://github.com/{INDEX_REPO}") };
        json!({"tag_name":tag,"assets":[{"name":asset_name(id,version,target),"size":100,"browser_download_url":format!("{base}/releases/download/providers-v{version}/{}",asset_name(id,version,target))}]})
    }
    #[test]
    fn plugin_release_namespace_is_strict() {
        let target = "x86_64-pc-windows-msvc";
        let release = fixture("providers-v0.2.2-aibuddy.1", PACK_ID, "0.2.2-aibuddy.1", target);
        let asset = pick_asset(&release, PACK_ID, target).unwrap();
        assert_eq!(asset.version, "0.2.2-aibuddy.1");
        for tag in ["v99.0.0", "providers-v0.2.2junk", "providers-v0.2.2.", "providers-v01.2.3", "providers-v0.2.2-beta.01"] {
            assert!(pick_asset(&fixture(tag, PACK_ID, "0.2.2-aibuddy.1", target),PACK_ID,target).is_none(), "{tag}");
        }
    }
    #[test]
    fn plugin_assets_require_exact_id_version_target_and_nonempty_body() {
        let target = "aarch64-apple-darwin";
        let good = fixture("providers-v0.2.2",PACK_ID,"0.2.2",target);
        assert!(pick_asset(&good,PACK_ID,"x86_64-pc-windows-msvc").is_none());
        assert!(pick_asset(&good,"agent2api-providers",target).is_none());
        assert!(pick_asset(&fixture("providers-v0.2.2",PACK_ID,"0.2.1",target),PACK_ID,target).is_none());
        let mut empty=good.clone(); empty["assets"][0]["size"]=json!(0);
        assert!(pick_asset(&empty,PACK_ID,target).is_none());
    }
    #[test]
    fn plugin_default_source_and_relative_manifest_paths_stay_in_this_project() {
        assert_eq!(INDEX_REPO,"sinner351sdf/AIBuddy-Panel");
        assert_eq!(FALLBACK_REPO,INDEX_REPO);
        assert!(index_path("../app.json").is_none());
        assert!(index_path("https://other.invalid/index.json").is_none());
        assert!(index_path("/absolute").is_none());
    }
    #[test]
    fn rejects_other_repository_and_target_download_urls() {
        let target = "aarch64-apple-darwin";
        assert!(!valid_asset_url("https://github.com/Agent2Builder/agent2api-providers-releases/releases/download/providers-v0.2.2/pack.zip", "0.2.2", target));
        let mut release = fixture("providers-v0.2.2", PACK_ID, "0.2.2", target);
        release["assets"][0]["browser_download_url"] = json!("https://github.com/other/repo/releases/download/providers-v0.2.2/pack.zip");
        assert!(pick_asset(&release, PACK_ID, target).is_none());
    }
    #[test]
    fn plugin_list_filters_latest_application_and_selects_its_own_channel() {
        let target = "aarch64-apple-darwin";
        let app = fixture("v99.0.0", PACK_ID, "99.0.0", target);
        let stable = fixture("providers-v0.2.2", PACK_ID, "0.2.2", target);
        let beta = fixture("providers-v0.3.0-beta.2", PACK_ID, "0.3.0-beta.2", target);
        let wrong_platform = fixture("providers-v9.0.0", PACK_ID, "9.0.0", "x86_64-pc-windows-msvc");
        let list = json!([app, wrong_platform, beta, stable]);
        let pick = |beta, current| pick_plugin_release(&list, PACK_ID, None, beta, Some(current), target).unwrap().unwrap().version;
        assert_eq!(pick(false, "0.2.1"), "0.2.2");
        assert_eq!(pick(true, "0.2.1"), "0.3.0-beta.2");
        assert_eq!(pick(true, "0.3.0-beta.1"), "0.3.0-beta.2");
        let only_app = json!([fixture("v99.0.0", PACK_ID, "99.0.0", target)]);
        assert!(pick_plugin_release(&only_app, PACK_ID, None, true, None, target).unwrap().is_none());
        assert!(pick_plugin_release(&json!({}), PACK_ID, None, true, None, target).is_err());
    }

    #[test]
    fn plugin_rejects_duplicate_platforms_oversized_assets_and_drafts() {
        let target = "aarch64-apple-darwin";
        let mut release = fixture("providers-v0.2.2", PACK_ID, "0.2.2", target);
        let duplicate = release["assets"][0].clone();
        release["assets"].as_array_mut().unwrap().push(duplicate);
        assert!(pick_asset(&release, PACK_ID, target).is_none());
        let mut release = fixture("providers-v0.2.2", PACK_ID, "0.2.2", target);
        release["assets"][0]["size"] = json!(MAX_DOWNLOAD_BYTES + 1);
        assert!(pick_asset(&release, PACK_ID, target).is_none());
        let mut release = fixture("providers-v0.2.2", PACK_ID, "0.2.2", target);
        release["draft"] = json!(true);
        assert!(pick_plugin_release(&json!([release]), PACK_ID, None, false, None, target).unwrap().is_none());
    }

    #[test]
    fn production_and_validation_url_policies_are_independent() {
        let target = "aarch64-apple-darwin";
        let good = format!("https://github.com/{INDEX_REPO}/releases/download/providers-v0.2.2/{}", asset_name(PACK_ID, "0.2.2", target));
        assert!(asset_url_matches(&good, "0.2.2", target, false));
        assert!(!asset_url_matches(&good, "0.2.2", target, true));
        assert!(!asset_url_matches(&good, "0.2.1", target, false));
        assert!(!asset_url_matches(&good, "0.2.2", "x86_64-apple-darwin", false));
        assert!(!asset_url_matches(&good.replace(INDEX_REPO, "other/repo"), "0.2.2", target, false));
        assert!(asset_url_matches("http://127.0.0.1:3199/fixture.zip", "0.2.2", target, true));
        assert!(!asset_url_matches("http://127.0.0.1:3199/fixture.zip", "0.2.2", target, false));
    }

}
