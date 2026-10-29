# Independent application and provider-plugin releases

The customized application and provider plugin share `sinner351sdf/AIBuddy-Panel`, but have independent tag namespaces and release assets:

| Channel | Tags | Assets |
| --- | --- | --- |
| Application | `v{semver}` | Existing desktop installers and server bundles |
| Provider plugin | `providers-v{semver}` | `aibuddy-providers-{version}-{target}.zip`, checksum and build manifest |

Both update clients list releases and reject the other namespace. They do not trust GitHub's `latest` pointer as a product identifier. Stable and beta choices are independent. Plugin releases must always use `--latest=false`; otherwise already-installed older application clients could see the wrong release.

The plugin index lives in `provider-plugin/index/`. Its package ID is `aibuddy-providers`; index, detail manifest, download source, expected package ID, target, and downloaded version are checked together. Failure preserves existing installed packages and cached data, marks it stale, and does not fall back to an official package that could overwrite local enhancements.

`provider-plugin-build.yml` builds five targets and uploads workflow artifacts only. It neither publishes a Release nor consumes a production signing key. `scripts/provider-plugin-assets.mjs` validates package metadata, checksums, protocol and workflow provenance. Unsigned artifacts are development artifacts; production publication requires an explicitly trusted signing key and a reviewed version and release note.

`scripts/release-provider-plugin.sh` is a manual publication tool. It verifies the exact tag/build SHA and all five target artifacts, refuses an existing published release, and creates a draft first. Only the explicit `--publish` option makes the draft public, with `latest=false`. This task does not run it, create a tag, configure a Secret or alter GitHub state.

During isolated verification `AIBUDDY_VALIDATION_MODE=1` disables plugin automatic checking/installing/updating and blocks non-loopback update traffic, proxies, redirects and credential forwarding. `AIBUDDY_PLUGIN_INDEX_URL` may point to a loopback fixture only in this mode. Production uses the repository index above.

The existing application publication workflow, GHCR policy, Android workflow, source-SHA checks and schema manifest remain in place. The frozen Android baseline is built separately from its recorded source and assets; new plugin outputs never overwrite its UI or binary output.

Local regression commands:

```sh
node scripts/test-provider-plugin-assets.mjs
node scripts/test-android-frozen.mjs
cargo test --manifest-path desktop-tauri/src-tauri/Cargo.toml -p agent2api-server fork_channel_regressions
cargo test --manifest-path desktop-tauri/src-tauri/Cargo.toml -p agent2api-server plugin_host::update::tests
cargo test --manifest-path desktop-tauri/src-tauri/Cargo.toml -p agent2api-server validation::tests
```

The package fixture checks all five native binary formats, protocol/package/version/target, ZIP CRC and path safety, executable modes, temporary trusted Ed25519 signatures, UI tampering, unsigned publication refusal, workflow/tag/SHA provenance, schema 17 build metadata and companion checksums. Fixture trust keys exist only in the temporary test process and are not added to the host production trust list. Cross-platform fixture validation does not prove that five native CI builds or installers have run; those remain separately reported acceptance results.

License provenance is recorded in `THIRD-PARTY-NOTICES.md`. The root AGPL text applies to the identified new upstream source; the mixed repository also retains historical contributions with additional noncommercial restrictions. Their compatibility and rightsholder authorization still require classification before a public distribution. The isolated local acceptance run makes no whole-repository relicensing claim.

## Approved release preparation (2026-10-30)

The earlier exclusions above describe the isolated migration acceptance phase. The user subsequently approved both Beta versions, the release notes, local commits, and production signing. See RELEASE-READINESS-20261030.md for current source/license evidence and the offline signing flow. CI still never receives the private key; publication signs verified downloaded artifacts locally.
