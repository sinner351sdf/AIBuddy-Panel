# Chatbot Demo detail pass — 2026-10-16

Reference: https://chatbot.ai-sdk.dev/demo and the user's supplied screenshot. The official demo was inspected in the browser, including its searchable model menu.

## Delivered behavior

- History rail: square-pen New chat (`新聊天记录`) action, trash Delete all (`删除全部`) action, history heading, existing title search and per-conversation actions. Removed the local database footer sentence. Empty delete-all is disabled; non-empty delete-all requires a count-aware confirmation.
- Bulk deletion: admin-only `DELETE /api/assistant/conversations` requires an explicit nonempty ID list (up to 1000). Validation finishes before a transaction. Only confirmed IDs are deleted, with cleared message/file payloads and tombstones; a chat created in another tab after the list was confirmed is preserved. Stale saves cannot recreate deleted conversations. No production conversations were deleted in validation.
- Model picker: shared Base UI Popover and shadcn Command search with provider groups. Enabled public IDs and aliases retain the previous gateway routing semantics. Aliases inherit target metadata. The tool/image/video/reasoning icons reflect declared capability values. A shared public ID only promises a capability if all its enabled routes declare support; varying routes get an explicit mixed-capability indicator. This view does not change model reasoning settings or permissions.
- Welcome copy is now `我能帮您什么？` with the demo-style short subtitle. Four local gateway suggestions are above the composer. Removed the click-to-fill explanation and the extra attachment footer sentence; existing draft-fill behavior and file validation remain.
- Round send/stop buttons and pill model/new-chat controls use a shared Button `shape` option; existing controls retain their default shape.
- Enabled tools now opens a click/touch/keyboard popover with all nine tools, current enabled state, short descriptions and read/confirm labels. The previous trigger only had a hover tooltip. Actual 3065 config still enables only `list_models` and `list_account_balance`; the remaining seven stay disabled.
- MessageScroller provider is keyed by conversation. Switching to a new chat no longer retains the previous chat's anchor spacer/blank scrolling distance. The JSDOM fixture now also installs window-level animation-frame APIs for the real scroller's unmount path.

## Checks

- Rust: 672 passed, 0 failed, 7 ignored.
- Backend assistant fixture: 69 checks, including invalid bulk-delete atomicity, confirmed IDs only, newer chat preservation, and stale-save rejection.
- 26 frontend suites passed (assistant suite rerun after the scroller-key and fixture RAF change). Actual SDK page/controller tests cover search/no-results/model selection, conservative capability aggregation and aliases, nine-tool click popover, bulk-delete cancel/confirm, plus the prior permissions, attachments, stop/retry and history cases. No-model draft/file retention also passes.
- Frontend typecheck/build, desktop Rust source check, shadcn scan (79 island files + 11 shell sources), and i18n missing-key check passed. 93 generated assets match a repeated rebuild byte for byte.
- Real browser fixture: searched/selected model via keyboard, checked reasoning/image/tool icons, opened the tools list, sent a synthetic message, opened/cancelled bulk delete, checked history drawer, dark theme, and 390 × 844 layout. Width/scroll width both 390. Empty message viewport height/scroll height both 341 after the scroller fix. No browser error-level logs.
- Actual 3065: restored session, searchable real model catalog/capability icons, current model `hy3` unchanged, working click tools popover with two read tools enabled, updated layout, no front-end error-level logs. No real model chat, task, reward or account mutation was executed.

## Cutover

Backup: `data/backups/pre-assistant-demo-polish-cutover-20261016-153317/`.

3065 healthy after restart as PID 88683. Schema remains 16; SQLite quick_check is `ok`. Before/after counts match: 11 accounts, 286 requests, 3 daily rows, 272 raw rows, 16 task runs, 12 historical account identities, 0 assistant conversation rows. All account/conversation rows, assistant config, encryption key and release drafts are retained. Only routine logs/background-task KV entries changed. No commit, push or release.

Evidence: ignored `data/integration-verification/assistant-demo-polish/`, including live screenshots, model and tool popovers, mobile/dark captures and validation logs.
