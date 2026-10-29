# Beta release readiness — 2026-10-30

Approved tags: `v3.3.0-aibuddy.1-beta.1` and `providers-v0.2.2-aibuddy.1-beta.1`. The user confirmed the complete release notes and authorized local commits, subsequent license/signing work, and publication after conditions pass. Initial local recovery commit: `4ab7563d77e18d5830baeb631530ae5fcab3ddf5` (local-only; not part of the public release ancestry).

## Source and license review

- Pinned application/plugin AGPL sources and local modifications are mapped in `license-inventory-20261030.json`. Exact content matches establish provenance, not ownership. The initial 2,129-file tree includes 710 exact upstream matches (10 at different paths), 647 modified upstream paths, 658 unchanged historical paths, 111 local/additional paths and 3 separate frozen-legacy records. Local additions were reviewed by path: adapters, task/history enhancements, scripts, notices, UI components, tests and docs. shadcn-derived components retain their MIT notice.
- The user's explicit authorization covers their original AIBuddy enhancements. It does not relicense dependency code or grant third-party/native SDK rights. `THIRD-PARTY-NOTICES.md` scopes the grant; the historical Android archive remains separate under its original terms. No new Android APK is built.
- `audit-release-licenses.py --strict` resolves every exact locked dependency license declaration. Missing Cargo packages were fetched through official static.crates.io URLs and validated against lockfile SHA256. All 251 frontend runtime package records match installed package versions. No dependency code was executed for the audit.
- `build-third-party-notices.py` collects notices for 800 unique package records, 446 distinct texts, exact source download URLs and preserved pinned upstream explanations. Where the package declares SPDX terms without shipping a separate text, the referenced canonical terms are reproduced and explicitly identified; no copyright holder is invented. MPL retains its original file-level terms and source references. The upstream objc2 licensing/Apple SDK discussion is retained. These records are not a legal opinion or a blanket AGPL relicensing of every file.
- Source paths exclude private data, credentials, databases, keys, caches and generated acceptance packages. The source-correspondence link points to this repository's exact release tags and lockfiles.

## Production signing

`provider-plugin/trusted-keys.json` and the compiled host table contain the same real Ed25519 public key, `aibuddy-providers-2026`. The private key was generated locally with exclusive creation and mode 0600 in an ignored 0700 signing directory. It is never sent to Actions and is not committed. Temporary fixture keys remain test-only.

CI builds unsigned native packages for five targets. `release-provider-plugin.sh --signing-key <private-file>` downloads only the matching successful tag build; `sign-provider-artifacts.mjs` validates all five original packages/checksums/manifests, signs copies offline, retains unchanged source/binary provenance, regenerates checksums, and verifies every signature before any GitHub mutation. Original artifacts are preserved. Published plugin releases always use latest=false. Production ZIPs must carry LICENSE, NOTICE-AIBUDDY.md and dependency notices.

The actual macOS arm64 native acceptance package was built and verified with the real public key. It is explicitly sourceDirty/acceptanceOnly and is excluded from public distribution. Public assets must come from clean successful tag CI builds.

## Verification

- Frontend complete TypeScript/Vite build: passed.
- Server unit suite: 388 passed, 1 ignored, 0 failed (389 total); loopback mock tests ran with local-port permission.
- Plugin-host suite: 45 passed.
- Five-target offline signing/package fixture suite: passed, including real keygen permissions, all-target signing, wrong key/source/permissions, output refusal and input preservation.
- Existing release script: 28 mocked scenarios passed.
- Frozen Android: exact 1,617 source hashes and archive verified; no new APK.
- No manual live inference, sign-in, reward claim or 3065 restart was performed for this release preparation.

## Publication gates

Before final upload, require successful exact-tag desktop/server builds and a successful five-target provider build, validate source SHA/platform/package version/checksums and all download URLs, sign the provider artifacts locally, and mark both Releases as prereleases without moving stable latest. CI success is not physical-device installation proof. Existing Accio WAF_BLOCK remains a known limitation pending user reauthorization.

Private key backup and recovery are the maintainer's responsibility. Code rollback preserves the existing runtime/database-key pair; this release preparation does not switch the active 3065 runtime.

## Final source hygiene

The migration imported upstream split OAuth constants. The plugin now uses the same AGENT2API_ANTIGRAVITY_CLIENT_ID / AGENT2API_ANTIGRAVITY_CLIENT_SECRET runtime configuration as the pre-migration AIBuddy host, with no bundled fallback. Four fixture-only configuration/authorization URL cases verify missing/blank inputs, trimmed values, encoded client IDs and secret exclusion. Public history is based on the previously published clean 4606d874 commit; the initial migration commit is retained only on a local recovery ref and must not be pushed. Source and frozen-archive pattern checks found no complete PEM keys, known Google secret/API key shapes, OpenAI key shapes or GitHub token shapes. This is a scoped pattern check, not a guarantee against every possible secret.

The new frontend entries were brought into the existing shared-component contracts (cn composition, SelectGroup and shared Button); UI behavior and callback payloads are unchanged. Docker cache/source stages now preserve the repository layout required by the shared provider protocol path; locked offline metadata of the cache-layer layout passed.

The user subsequently requested CI completion first and deferred GitHub Release upload authorization. No public Release is to be created in this phase.
