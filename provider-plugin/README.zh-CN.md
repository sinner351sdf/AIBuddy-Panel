# AIBuddy provider enhancement pack

`aibuddy-providers` is the independently built provider pack maintained in
[AIBuddy-Panel](https://github.com/sinner351sdf/AIBuddy-Panel). It vendors the
`0.2.2-beta.2` provider implementation and restores the saved local enhancements.
See [NOTICE-AIBUDDY.md](NOTICE-AIBUDDY.md), [MIGRATION-INVENTORY.json](MIGRATION-INVENTORY.json),
and the retained [upstream documentation](UPSTREAM-README.md) for provenance.

The current development version is `0.2.2-aibuddy.dev.1`, using wire protocol `1`.
The host compiles the same local protocol crate at `crates/provider-protocol`.
The main program and plugin use separate tags and assets: main `v…`, pack
`providers-v{version}` and `aibuddy-providers-{version}-{target}.zip`.

Build from this independent workspace using `cargo build --offline`. The normal
`all` feature contains the production providers. `demo` is an explicit fixture
feature and is not declared in the production pack manifest. Main-host
integration tests may use `cargo build --offline --features demo` and explicitly
point `AIBUDDY_TEST_PLUGIN_EXE` at the resulting test executable.

Run synthetic tests with `AIBUDDY_VALIDATION_MODE=1 cargo test --offline --workspace
-- --test-threads=1`. The ignored Accio gzip transport and SecurityGuard worker
regressions use only generated local fixtures and can be run individually.
No real provider credentials or public inference/reward endpoints are required.

Provider state uses SDK `store.*`, `ledger.*`, and `settings.*` callbacks. The
host retains the database, credential encryption, task queue/leases/results and
schedulers. WorkBuddy compatibility actions are documented in
`crates/providers/src/providers/workbuddy/legacy_workbuddy/CONTROL-CONTRACT.json`.
`aibuddy.school.run_all` preserves the old `only`/`lottery` and `results` contract.

`node scripts/pack.mjs --skip-build` packages the binary without publishing.
`node scripts/sign.mjs keygen --key <path> --key-id <id>` is an explicit production
key creation operation; this migration does not run it. Test trust is supplied
only through the host's isolated validation fixture and never enters production
`TRUSTED_PUBKEYS`. Retained original copyright and third-party licenses apply.
