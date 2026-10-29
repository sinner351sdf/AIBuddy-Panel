# AIBuddy plugin migration: isolated acceptance

This work starts from the customized `4606d87465b1d4164217405f5296a44bf29a6941` checkout including its saved uncommitted and untracked source, then integrates gateway `v3.3.0-beta.3` and provider plugin `v0.2.2-beta.2`. Development identities are `3.3.0-aibuddy.dev.1` and `aibuddy-providers` `0.2.2-aibuddy.dev.1`, protocol 1. They are not published versions.

## Source and data boundaries

- Implementation checkout: `/private/tmp/aibuddy-plugin-migration-20261025`, branch `codex/plugin-migration`. The complete reviewable source is also copied into the attached persistent checkout `/Users/zaxe/.codex/worktrees/aibuddy-plugin-migration/agent2api`; no source commit or push is made.
- Recoverable source snapshot: `/private/tmp/aibuddy-plugin-baseline-20261025-fb01ccop/source.tar.gz`; `snapshot.json` records all 1617 file hashes and the original dirty source state. Android's complete frozen source is also retained under `legacy/android-baseline/`.
- Original service and database: port 3065 and `/Users/zaxe/Documents/ChatGPT/agent2api/data/local`; neither is the validation service's write target.
- Validation service: **127.0.0.1:3165**, private data `/private/tmp/aibuddy-validation-20261025` (0700 directory / 0600 database and key). `baseline/` holds the consistent SQLite online backup and paired account key.
- `scripts/start-plugin-validation.py` refuses an occupied port; it creates an isolated fixture administrator/inference keys without exposing them in logs. Credentials are only in that directory's `test-credentials.json`.
- Validation disables startup account import, subscription autostart, cloud sync, automatic checks/downloads, automatic sign-in, travel, keepalive, usage sweeps and provider schedules. HTTP transports reject nonloopback targets, URL credentials, proxies and redirects. Tests use local fixtures and packet replay.

## Functional ownership

| Area | Final owner and preserved behavior | Evidence |
| --- | --- | --- |
| Provider inference, login, refresh, catalog, balance, sign-in and actions | Provider worker through RPC; general custom APIs stay in gateway | `provider-plugin/MIGRATION-INVENTORY.json`, `CONTROL-CONTRACT.json` |
| Accio | ADK v2 catalog/parser, SecurityGuard, restricted-session policy, pre-output retry, images, gzip, tool history and validated error metadata | Plugin implementation and local transport regressions |
| WorkBuddy | Whole task/action chains in worker; durable queue, account locks, run/step records, stop and recovery policy stay in gateway | Legacy action contract and host task RPC tests |
| Cline / ZCode / KukuAI | Key management; model-specific auto-channel balance/cooldown routing; native signing respectively | Plugin file inventory |
| Assistant | Existing AI SDK, confirmation/revocation, attachments/drafts/history; invalid model and empty-response handling | UI review and assistant scenarios |
| Database | Schema 17, encrypted account rows/paired key, primary keys/order/settings, account history, assistant revisions/deletion markers, persistent tasks | Private-copy audit and database regression results |
| Catalogs | Restore prior database cache on first init, per-plugin persistence; refresh/upgrade failure keeps prior catalog | Host RPC cache and plugin restoration code |
| Plugin lifecycle | Fixed package ID, administrator-only APIs, manifest/provider matching, signature/platform/protocol checks, crash backoff, transaction activation/rollback | Lifecycle fixture and transaction tests |
| Updates | Application `v…` and plugin `providers-v…`; own repository/index/fallback; independent stable/beta filtering | Channel tests and asset validator |
| Android | Frozen standalone gateway, JNI/Gradle/UI/application/signing lineage, separate source/target/dist | `ANDROID-FREEZE.md` and archive integrity test |

## Reproducible local checks

```sh
node scripts/test-provider-plugin-assets.mjs
node scripts/test-android-frozen.mjs
# Use explicit private paths; do not invoke scripts/start-local.sh for validation.
AIBUDDY_VALIDATION_MODE=1 AGENT2API_PROXY_HOME=/private/tmp/aibuddy-validation-20261025 \
  /private/tmp/aibuddy-plugin-target/debug/examples/data-audit \
  /private/tmp/aibuddy-validation-20261025/data-audit.json
python3 scripts/start-plugin-validation.py
python3 scripts/test-plugin-validation.py --allow-fixture-history
```

Compiler, unit, fixture, browser results and exact artifacts are recorded below and in the private evidence directory. Native five-platform build jobs exist; validating five synthetic binary/asset formats is not five successful native CI builds. Local mocks do not establish real-provider availability, sign-in success or reward delivery. No such provider action is part of this acceptance.

## Executed acceptance results (2026-10-25)

- Host server: **386 passed, 0 failed, 1 ignored**, plus successful server build and native macOS desktop `cargo check`. The ignored case requires an installed real mihomo engine; it was not downloaded or run.
- Plugin: **99 ordinary unit tests and 2 separately executed loopback transport regressions**, **28 real stdio/loopback RPC checks**, and **7 conversation-error classification RPC checks**. Accio gzip/SecurityGuard tests actually ran in separate processes.
- Management/API/data acceptance: **34 checks passed**, including administrator-only plugin APIs, restricted and full inference-Key denial, legacy routes, isolated balance refresh, schema and protected original tables.
- Actual HTTP gateway replay: **11 synthetic inference requests / 44 checks**, covering `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, streaming and aggregate output, leading SSE heartbeat comments, tool history, a data-URL image, and account selection by priority/enabled state. The fixture pack is removed and the main signed package/provider toggles restored afterward. The source signed package is never overwritten by the fixture signer.
- Plugin lifecycle: **60 real HTTP assertions passed**, including 8 invalid package classes, exact registry/binary rollback, same-version failed activation, enable/disable, per-provider flags and uninstall. Host tests also cover repeated crash backoff and catalog preservation.
- Updates/assets: application/plugin release namespaces and stable/beta filtering passed; five synthetic platform formats, store/deflate, CRC/expanded bounds, signature/UI tamper, binary identity, source/schema/checksum and rollback checks passed. The real five native platform builds remain future CI work.
- UI: built desktop/mobile assets and type checks passed; 19 authorization, 12 assistant-tool scenarios, four assistant modes, mobile feature/editor/settings coverage and 15 shell routes passed. The browser checked accounts, models, plugins, check-in/task center, durable tasks, assistant and settings. It confirmed package-disable reasons, restoration of 19 accounts, and an unsent draft surviving navigation. Browser screenshots and console evidence are retained under `browser-evidence/`; the final reload has **0 console errors**, displays the signed **29-provider** package running, and shows the neutral credit-refresh pause. The final 8 served static assets match the built source SHA-256 values.
- Schema **17**, SQLite `quick_check=ok`, all **19 original accounts** readable with their paired key; repeated legacy projections are identical. Original primary keys, order, encrypted account rows, notes/rules/proxies, **26 original account-history rows**, **1 assistant history row**, **350 durable runs / 339 run items**, **184 sign-in records**, and **19 cached balance records** match the initial copy. New demo history/request statistics from the isolated replay are reported separately. No real provider inference, sign-in or reward was performed.
- Original checkout: **1,617 / 1,617 source hashes unchanged**. Original port **3065** still reports `status=ok` from its original PID **66907**. The private review copy has separate cookies so a 3165 administrator login does not overwrite the 3065 browser session cookie.

The strict data checks found and repaired two acceptance defects: new-provider insertion unnecessarily renumbered other account groups; a blocked manual balance refresh wrote a failure into the review copy's cached result. The first now leaves a new tail group alone; the second returns an isolation-specific 503 before account resolution/RPC/history writes. ZCode status reads also suppress incidental config synchronization in validation mode. The original credit-package API route and Raccoon web callback were also restored; the latter reconstructs the canonical plugin callback and retains task-state validation. The read-only `/api/endpoints` diagnostic route remains compatible. The credit-package page uses its validation-only pause response to keep any existing page snapshot and explain why no refresh runs. The affected copied rows were restored from the initial backup after saving pre-restore copies. Original data was never the write target. The first replay failure, its recovery evidence, and the normalized JSON proof from the next run are retained rather than discarded.

The replay compares old business rows exactly while allowing new fixture history/statistics. Existing `apiKeys` JSON is compared as a complete JSON value: serialization whitespace may change, but no field, permission, provider scope, key, quota or enabled state may change. Runtime audit logs retain only the newest 500 entries, so fixture admin actions may evict the oldest runtime log lines. Those retention effects and request/token counters are reported separately; they are not described as an unchanged database file.

Evidence is local and private: `api-acceptance.json`, `data-audit-final.json`, `lifecycle-acceptance.json`, `gateway-protocol-replay.json`, `account-restore-evidence.json`, `balance-restore-evidence.json`, `source-boundary-final.json` and browser captures. The deliverable evidence bundle excludes the database, paired account key, administrator password and signing private key. Test trust is accepted only with `AIBUDDY_VALIDATION_MODE=1`; production trust has no fixture key.

## Switching and rollback

The 3165 service is a review environment. Switching 3065 is a separate human decision after reviewing the evidence and mixed-license notes. Do not point the original service at this validation database: it contains fixture administrator/key settings.

For an eventual approved switch, stop the original service gracefully, make a new online SQLite backup with the paired account key, retain its current runtime directory, install the reviewed application plus separately reviewed provider package, and only then start against the real data directory. Confirm health, administrator login, account identities/counts, catalog and assistant/task history before enabling any automatic action. Choose real credentials and production trust/signature separately; temporary validation keys must not be used.

To roll back an approved switch, stop the new process, restore the retained runtime and the matching database/key backup together, and restart using the original entrypoint. Do not restore just the key or just the database. For this isolated run, stopping the PID in `server.pid` and retaining its private evidence directory leaves 3065 untouched. A failed plugin activation restores the previous plugin directory and exact registry, then reloads the former worker.

Public tags, pushes, Releases, production signing secrets and 3065 replacement are excluded from this delivery. Mixed-license provenance and unresolved distribution permissions are described in `THIRD-PARTY-NOTICES.md`.

## Final local artifacts

The attached checkout stores a private, ignored deliverable folder at `data/plugin-validation-artifacts/20261025/`. It contains the macOS arm64 server binary, provider binary, signed development ZIP, build/checksum manifests, source inventory, test logs and browser evidence. `delivery-summary.json` records their hashes and local validation limits. It excludes database/key/admin credentials/signing private keys; those remain only in the 0700 validation home.

Final provider ZIP: **10,640,626 bytes**, SHA-256 `2e841088e0022c016fa9cacaf9a4b9631e63549d7a1a2ee9b281107e19da0777`. Provider executable: **30,973,936 bytes**, SHA-256 `6b6fe34f5d0d8fa83c54221e8063c23ac99aaf3be5a7d3ed8cf6d93a6515229b`. The Ed25519 signature is only a temporary local validation fixture. Final served desktop `islands/ui.js`: SHA-256 `b4c51fdc7bc713ba2a1a0a8ae7b234da3c67e084111afea5b67d78936c6692fe`.
