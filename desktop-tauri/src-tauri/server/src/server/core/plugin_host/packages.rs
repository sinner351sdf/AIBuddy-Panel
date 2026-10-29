//! 解包与验签先于停机；激活事务保留原目录和注册表，直到新宿主握手成功。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use agent2api_provider_protocol as proto;

use super::install::{self, InstalledPack, PackRegistry, PackSummary, SignatureState};

static SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub struct PreparedPack {
    staging: PathBuf,
    manifest: proto::PackManifest,
    entry: String,
    sha256: String,
    signed: bool,
}

impl Drop for PreparedPack {
    fn drop(&mut self) {
        if self.staging.exists() {
            let _ = std::fs::remove_dir_all(&self.staging);
        }
    }
}

pub(super) fn ensure_entry_executable(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("读取插件入口失败（{}）：{error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("插件入口不是普通文件：{}", path.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = metadata.permissions().mode();
        if mode & 0o100 == 0 {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode | 0o100))
                .map_err(|error| format!("设置插件入口执行权限失败（{}）：{error}", path.display()))?;
            let updated = std::fs::metadata(path)
                .map_err(|error| format!("读取插件入口权限失败（{}）：{error}", path.display()))?;
            if updated.permissions().mode() & 0o100 == 0 {
                return Err(format!(
                    "插件入口仍不可执行，请检查数据目录是否支持 Unix 执行权限：{}",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

pub fn prepare(
    bytes: &[u8],
    expected_id: Option<&str>,
    expected_version: Option<&str>,
    require_signed: bool,
) -> Result<PreparedPack, String> {
    if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
        return Err("插件包必须为非空且不超过 24 MB 的 zip".to_string());
    }
    let staging = install::plugins_dir().join(".staging").join(format!(
        "pack-{}-{}-{}",
        std::process::id(),
        crate::server::logging::now_ms(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed),
    ));
    std::fs::create_dir_all(&staging).map_err(|error| format!("创建临时目录失败：{error}"))?;
    let prepared = (|| {
        install::extract_zip(bytes, &staging)?;
        let manifest = install::read_manifest(&staging)?;
        install::validate_manifest(&manifest, proto::PROTOCOL_VERSION)?;
        if manifest.id.is_empty()
            || !manifest
                .id
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err("插件包 id 只能包含小写字母、数字和连字符".to_string());
        }
        if !crate::server::core::update::version::strict_semver(&manifest.version) {
            return Err("插件包版本号不是合法的语义化版本".to_string());
        }
        if expected_id.is_some_and(|id| id != manifest.id)
            || expected_version.is_some_and(|version| version != manifest.version)
        {
            return Err("下载包的 id 或版本与所选发行版不一致，已拒绝安装".to_string());
        }
        let mut provider_ids = std::collections::BTreeSet::new();
        if manifest.providers.iter().any(|provider| provider.id.as_str().is_empty()
            || !provider.id.as_str().bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || !provider_ids.insert(provider.id.as_str())) {
            return Err("插件清单的提供商 id 无效或重复".to_string());
        }
        let target = super::host_target();
        let entry = manifest
            .entry
            .get(&target)
            .cloned()
            .ok_or_else(|| format!("插件包没有为当前平台（{target}）提供入口"))?;
        if !staging.join(&entry).is_file() {
            return Err(format!("包里的入口二进制不存在：{entry}"));
        }
        let (signature, problem) = install::verify_signature(&staging, &manifest, &target);
        if signature == SignatureState::Invalid {
            return Err(format!("签名校验失败：{}", problem.unwrap_or_default()));
        }
        if require_signed && signature != SignatureState::Verified {
            return Err("自动安装只接受通过本项目签名校验的插件包，请手动安装未签名包".to_string());
        }
        ensure_entry_executable(&staging.join(&entry))?;
        Ok(PreparedPack {
            staging: staging.clone(),
            manifest,
            entry,
            sha256: install::sha256_hex(bytes),
            signed: signature.is_signed(),
        })
    })();
    if prepared.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    prepared
}

/// A reversible on-disk activation. Dropping it before commit restores the old
/// directory (including a same-version reinstall) and exact registry bytes.
pub struct StagedInstall {
    version_dir: PathBuf,
    backup: Option<PathBuf>,
    registry_path: PathBuf,
    previous_registry: Option<Vec<u8>>,
    registry_changed: bool,
    directory_reverted: bool,
    active: bool,
    record: InstalledPack,
}

fn restore_registry(path: &Path, bytes: Option<&[u8]>) -> Result<(), String> {
    match bytes {
        Some(bytes) => {
            let temporary = path.with_extension(format!("rollback-{}.tmp", SEQUENCE.fetch_add(1, Ordering::Relaxed)));
            std::fs::write(&temporary, bytes).map_err(|error| format!("写回旧插件注册表失败：{error}"))?;
            std::fs::rename(&temporary, path).map_err(|error| format!("恢复旧插件注册表失败：{error}"))
        }
        None if path.exists() => std::fs::remove_file(path).map_err(|error| format!("撤销新插件注册表失败：{error}")),
        None => Ok(()),
    }
}

impl StagedInstall {
    pub fn enabled(&self) -> bool { self.record.enabled }

    pub fn rollback(&mut self) -> Result<(), String> {
        if !self.active { return Ok(()); }
        if !self.directory_reverted {
            if self.version_dir.exists() {
                install::remove_dir_retrying(&self.version_dir).map_err(|error| format!("清理未激活插件失败：{error}"))?;
            }
            if let Some(backup) = &self.backup {
                install::move_dir_retrying(backup, &self.version_dir).map_err(|error| format!("恢复原插件目录失败（备份保留在 {}）：{error}", backup.display()))?;
            }
            self.directory_reverted = true;
        }
        if self.registry_changed {
            restore_registry(&self.registry_path, self.previous_registry.as_deref())?;
        }
        self.active = false;
        Ok(())
    }

    pub fn commit(&mut self) -> Result<PackSummary, String> {
        let summary = install::list_packs().into_iter().find(|pack| pack.id == self.record.id
            && pack.version == self.record.version).ok_or_else(|| "激活后读不到插件注册表条目".to_string())?;
        self.active = false;
        if let Some(backup) = &self.backup {
            if let Err(error) = install::remove_dir_retrying(backup) {
                crate::server::logging::verbose("[Plugin]", &format!("新插件已激活，旧目录清理延后：{error}"));
            }
        }
        crate::server::logging::log("[Plugin]", &format!("插件「{}」v{} 已激活", self.record.id, self.record.version));
        Ok(summary)
    }
}

impl Drop for StagedInstall {
    fn drop(&mut self) {
        if let Err(error) = self.rollback() {
            crate::server::logging::log("[Plugin]", &format!("插件激活事务回滚失败：{error}"));
        }
    }
}

impl PreparedPack {
    pub fn stage(self) -> Result<StagedInstall, String> {
        self.stage_with(&install::plugins_dir(), &install::registry_path(), |registry| registry.save())
    }

    // Legacy low-level API. Runtime installation must use operations::install_prepared
    // so commit happens only after a successful new-host handshake.
    pub fn install(self) -> Result<PackSummary, String> { self.stage()?.commit() }

    fn stage_with(self, root: &Path, registry_path: &Path, save: impl FnOnce(&PackRegistry) -> Result<(), String>) -> Result<StagedInstall, String> {
        let previous_registry = match std::fs::read(registry_path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("备份插件注册表失败：{error}")),
        };
        let mut registry: PackRegistry = match previous_registry.as_deref() {
            Some(bytes) => serde_json::from_slice(bytes).map_err(|error| format!("插件注册表损坏，已拒绝覆盖：{error}"))?,
            None => PackRegistry::default(),
        };
        let previous = registry.packs.iter().find(|pack| pack.id == self.manifest.id).cloned();
        let version_dir = root.join(&self.manifest.id).join(&self.manifest.version);
        let parent = version_dir.parent().ok_or_else(|| "插件目录无效".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| format!("创建包目录失败：{error}"))?;
        let backup = if version_dir.exists() {
            let backup = parent.join(format!(".previous-{}-{}", crate::server::logging::now_ms(), SEQUENCE.fetch_add(1, Ordering::Relaxed)));
            install::move_dir_retrying(&version_dir, &backup).map_err(|error| format!("备份旧版本失败：{error}"))?;
            Some(backup)
        } else { None };
        let providers: BTreeMap<String, bool> = self.manifest.providers.iter().map(|provider| {
            let id = provider.id.0.clone();
            let enabled = previous.as_ref().and_then(|pack| pack.providers.get(&id)).copied().unwrap_or(provider.default_enabled);
            (id, enabled)
        }).collect();
        let record = InstalledPack {
            id: self.manifest.id.clone(), version: self.manifest.version.clone(),
            enabled: previous.as_ref().map(|pack| pack.enabled).unwrap_or(true), providers,
            entry: self.entry.clone(), sha256: self.sha256.clone(), signed: self.signed,
            installed_at: crate::server::logging::now_ms(), manifest_providers: self.manifest.providers.clone(),
        };
        let mut transaction = StagedInstall {
            version_dir, backup, registry_path: registry_path.to_path_buf(), previous_registry,
            registry_changed: false, directory_reverted: false, active: true, record: record.clone(),
        };
        install::move_dir_retrying(&self.staging, &transaction.version_dir).map_err(|error| format!("落盘失败：{error}"))?;
        match registry.packs.iter_mut().find(|pack| pack.id == record.id) {
            Some(slot) => *slot = record,
            None => registry.packs.push(record),
        }
        save(&registry)?;
        transaction.registry_changed = true;
        Ok(transaction)
    }
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    struct Fixture { root: PathBuf, registry: PathBuf, previous: Vec<u8> }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("aibuddy-install-tx-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(root.join("aibuddy-providers/0.2.2")).unwrap();
            std::fs::write(root.join("aibuddy-providers/0.2.2/bin"), b"old-working-binary").unwrap();
            let registry = root.join("plugins.json");
            let previous = serde_json::json!({"packs":[{"id":"aibuddy-providers","version":"0.2.2","enabled":false,"providers":{"accio":false},"entry":"bin"}]}).to_string().into_bytes();
            std::fs::write(&registry, &previous).unwrap();
            Self {root, registry, previous}
        }
        fn prepared(&self, version: &str, contents: &[u8]) -> PreparedPack {
            let staging = self.root.join(format!("staging-{}", SEQUENCE.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(&staging).unwrap();
            std::fs::write(staging.join("bin"), contents).unwrap();
            let entries = BTreeMap::from([(super::super::host_target(), "bin")]);
            let manifest = serde_json::from_value(serde_json::json!({"id":"aibuddy-providers","name":"Fixture","version":version,"protocol":1,"providers":[{"id":"accio","label":"Accio","default_enabled":true}],"entry":entries})).unwrap();
            PreparedPack {staging, manifest, entry:"bin".into(), sha256:"fixture".into(), signed:false}
        }
        fn save(&self, registry: &PackRegistry) -> Result<(), String> { std::fs::write(&self.registry, serde_json::to_vec(registry).unwrap()).map_err(|error| error.to_string()) }
        fn assert_restored(&self) {
            assert_eq!(std::fs::read(&self.registry).unwrap(), self.previous);
            assert_eq!(std::fs::read(self.root.join("aibuddy-providers/0.2.2/bin")).unwrap(), b"old-working-binary");
        }
    }
    impl Drop for Fixture {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.root);}}
    #[test]
    fn same_version_failed_activation_restores_original_binary_and_exact_registry() {
        let f=Fixture::new();
        let mut tx=f.prepared("0.2.2",b"bad-handshake").stage_with(&f.root,&f.registry,|r|f.save(r)).unwrap();
        assert!(!tx.enabled(),"reinstall preserves disabled package");
        assert!(!tx.record.providers["accio"],"reinstall preserves disabled provider");
        assert_eq!(std::fs::read(f.root.join("aibuddy-providers/0.2.2/bin")).unwrap(),b"bad-handshake");
        tx.rollback().unwrap();tx.rollback().unwrap();f.assert_restored();
    }
    #[test]
    fn upgrade_failure_retains_old_version_and_removes_unactivated_version() {
        let f=Fixture::new();
        let mut tx=f.prepared("0.3.0-beta.1",b"invalid-executable").stage_with(&f.root,&f.registry,|r|f.save(r)).unwrap();
        tx.rollback().unwrap();f.assert_restored();assert!(!f.root.join("aibuddy-providers/0.3.0-beta.1").exists());
    }
    #[test]
    fn registry_save_failure_restores_same_version_directory() {
        let f=Fixture::new();
        assert!(f.prepared("0.2.2",b"replacement").stage_with(&f.root,&f.registry,|_|Err("synthetic registry save failure".into())).is_err());
        f.assert_restored();
    }
    #[test]
    fn abandoned_activation_rolls_back_and_first_install_leaves_no_registry() {
        let f=Fixture::new();
        {let _tx=f.prepared("0.2.2",b"replacement").stage_with(&f.root,&f.registry,|r|f.save(r)).unwrap();}
        f.assert_restored();
        std::fs::remove_file(&f.registry).unwrap();
        {let _tx=f.prepared("0.3.0",b"replacement").stage_with(&f.root,&f.registry,|r|f.save(r)).unwrap();}
        assert!(!f.registry.exists());assert!(!f.root.join("aibuddy-providers/0.3.0").exists());
    }
    #[test]
    fn retrying_registry_restore_does_not_delete_already_restored_binary() {
        let f=Fixture::new();
        let mut tx=f.prepared("0.2.2",b"replacement").stage_with(&f.root,&f.registry,|r|f.save(r)).unwrap();
        std::fs::remove_file(&f.registry).unwrap();std::fs::create_dir(&f.registry).unwrap();
        assert!(tx.rollback().is_err());
        assert_eq!(std::fs::read(f.root.join("aibuddy-providers/0.2.2/bin")).unwrap(),b"old-working-binary");
        std::fs::remove_dir(&f.registry).unwrap();
        tx.rollback().unwrap();f.assert_restored();
    }

}
