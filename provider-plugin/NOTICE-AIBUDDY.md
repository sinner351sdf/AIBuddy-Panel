# Source and license notice

This directory vendors ProvidersPlugin/Agent2Providers at commit
`5a1ddd5f0d137f0349ee0bb3ae2f59a2bd0fb045` (`0.2.2-beta.2`). The original
source, notices, authorship and GNU Affero General Public License text are
retained. Corresponding main gateway baseline is aimod-cc/Agent2API
`3.3.0-beta.3`.

AIBuddy modifications import previously maintained provider behavior from the
saved AIBuddy-Panel source baseline. The per-file hashes and adoption records are
in `MIGRATION-INVENTORY.json`. This notice records provenance; it does not grant
new rights in third-party code, native SDKs, brand assets or trademarks.

The main application and this provider executable are built and updated
separately. The pack ID is `aibuddy-providers`, wire protocol is `1`, and the
pack version is `0.2.2-aibuddy.1-beta.1`. The provider binary remains
`agent2api-providers` for compatibility with the upstream package format.

`security_guard.cjs` is the existing local stdio adapter. It does not contain or
download the proprietary SecurityGuard native module. KukuAI DLL discovery loads
a separately installed official client component only in normal Windows use;
no native provider binary is bundled or downloaded for this migration.

Validation is synthetic and local. `AIBUDDY_VALIDATION_MODE=1` rejects non-literal
loopback HTTP/WebSocket destinations, overrides configured proxies with a local
refused endpoint for forbidden URLs, blocks native provider execution, and
allows the explicit synthetic SecurityGuard fixture only with
`AIBUDDY_VALIDATION_SG_FIXTURE=1`. Production signing trust is configured by the
host; no test key belongs in the production trust list.

Maintainer-owned original AIBuddy enhancements are authorized under AGPL-3.0-only by explicit confirmation on 2026-10-30. Third-party components keep their own terms. LICENSE and licenses/third-party-licenses.txt are included in every release ZIP; exact source tags and locked dependency references identify corresponding source. The historical frozen Android license is separate and does not restrict this new plugin.
