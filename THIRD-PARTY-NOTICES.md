# Source, copyright and license provenance

The new desktop/server application and provider implementation use the pinned AGPL upstream source plus AIBuddy original modifications authorized under AGPL-3.0-only. **Third-party components retain their own licenses; this is not a whole-repository relicensing of dependencies or frozen Android source.**

## Recorded sources

| Source | Exact baseline | Terms retained |
| --- | --- | --- |
| Agent2API gateway | aimod-cc/Agent2API v3.3.0-beta.3, f093612f68eb3ab0e32533b4f9b4040ba53a904d | Upstream AGPL-3.0-only offering and copyright notices |
| Agent2Providers, SDK and protocol | ProvidersPlugin/Agent2Providers v0.2.2-beta.2, 5a1ddd5f0d137f0349ee0bb3ae2f59a2bd0fb045 | Upstream AGPL-3.0-only offering and notices |
| Original AIBuddy enhancements | Saved 4606d874 baseline and subsequent local modifications | Maintainer's explicit 2026-10-30 authorization under AGPL, limited to owned original enhancements |
| Frozen Android | legacy/android-baseline/source.tar.gz and recorded 1,617 source hashes | Historical license, including its additional restrictions; separate frozen source, no new APK in this release |
| Rust / JavaScript dependencies and shadcn-derived UI | Committed Cargo.lock / package-lock.json, pinned-source metadata and texts | Each component's declared license and original notices; see ui/third-party-licenses.txt |

## Maintainer authorization and limits

On 2026-10-30 the maintainer confirmed: “本地增强为我方原创，可按 AGPL 授权；第三方部分继续核对”. This records permission for their original AIBuddy enhancements, including the retained local execution/history/task behavior. It does not assign copyrights held by other authors, remove their notices, or grant trademark or native SDK rights. Git authorship and content matching alone are not treated as rights assignments.

The original LICENSE.legacy-aibuddy-3.1.0 remains preserved as historical evidence and for the separate frozen Android baseline. Its noncommercial restrictions are not added to the new AGPL application or plugin. New upstream material is used under its pinned AGPL offering, not relicensed based on the maintainer's statement.

## Dependency and notice verification

The 2026-10-30 inventory records exact source-file hashes and locked dependency metadata. Missing Cargo sources were fetched from the official static.crates.io URLs and verified against Cargo.lock SHA256 values. All 251 installed frontend runtime package records match their locked versions. The notice collection covers 800 unique dependency/package records and retains original texts, exact upstream notices where packages omit them, declared license choices, standard referenced license terms, and source download locations. Standard templates are identified as templates; no copyright holder is invented. Compiler/build dependencies may also appear, which does not assert that each is linked into every executable.

MPL components retain their file-level license and source references. Components with multiple alternative licenses retain their declarations; included standard terms document a permitted option rather than asserting a change to upstream licensing. The objc2 project's pinned licensing explanation, including its Apple SDK discussion, is preserved in the notice bundle. No proprietary SecurityGuard module, KukuAI DLL or Apple SDK binary is redistributed here. Provider-native components are obtained separately by the user through their official client.

Evidence and reproducible commands are in docs/aibuddy-port/plugin-migration/RELEASE-READINESS-20261030.md. These are source and license compliance records, not a legal opinion or a claim that every repository file has the same license.

## Corresponding source

Source and local modifications are published at https://github.com/sinner351sdf/AIBuddy-Panel under the exact application/provider Release tags. Retain Cargo.lock, package-lock.json, provider-plugin SDK/protocol, build scripts, license texts and modification notices with the source. Runtime bundles expose ui/LICENSE.AGPL-3.0.txt and ui/third-party-licenses.txt. Provider ZIPs include LICENSE, NOTICE-AIBUDDY.md and licenses/third-party-licenses.txt. The frozen Android archive is separate and is not required to build the new desktop/server executable.
