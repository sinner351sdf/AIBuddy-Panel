# Assistant Chatbot layout and durable history — 2026-10-16

Reference: https://chatbot.ai-sdk.dev/demo (inspected in a real browser).

The existing AI SDK UI controller and Rust gateway remain in place. The assistant now uses a collapsible conversation rail, a centered empty state, four local gateway suggestions, and the existing attachment/model composer. Phones use the Base UI Sheet history drawer. Shared app navigation, shadcn components, themes, system prompt, tool policy, and real usage accounting are preserved.

## Persistence and safety

- Schema 16 adds `assistant_conversations` without rewriting existing accounts, requests, tasks, configuration, or conversation request bodies. It is included in both full and compact SQLite backups.
- Admin-only `/api/assistant/conversations` list/create and `/{id}` get/save/rename/delete endpoints use the existing web session/native assistant access controls. Gateway inference keys do not gain management access.
- Actual AI SDK messages, tool outputs, and inline image/text attachment contents are saved to the local SQLite database. The active conversation identifier alone is kept in browser storage. Previous conversations that were never persisted cannot be reconstructed automatically.
- Titles default to the first user message/file name; they can be renamed. Search is local over titles, with date groups. Empty new chats are only created in the database when a first message is submitted.
- Saves are serialized with optimistic revisions. Stale tabs receive 409, retain their visible messages, and cannot overwrite newer/deleted data. Deletion clears message/file payloads and leaves an identifier tombstone to reject stale resurrection.
- A settled reply is flushed immediately; active streams are checkpointed every second, and backgrounding also attempts a flush. The existing page cannot be switched to another chat during streaming/tool confirmation until stopped or resolved. A failed flush blocks switching rather than discarding unsaved content.
- Reopening a conversation cancels unfinished tool calls locally. It does not resume tools or send model requests. Every new mutation/model-test call still needs its own enabled permission and explicit confirmation.
- Limits: 200 stored messages, 1000 active conversations, 31 MiB per saved conversation (headroom for SDK inline file representations over the existing 24 MiB model request budget), 256 MiB total message payloads. The composer guards the message-count boundary. Binary/PDF/Office support has not been implied; current supported image/text attachment behavior is retained.
- Database version rollback protection remains enforced. The rollback regression now derives its unsupported version from `SCHEMA_VERSION + 1` instead of hard-coding 16.

## Verification

- Rust library: **672 passed, 0 failed, 7 ignored**. Localhost-dependent cases were run outside the network-restricted sandbox against disposable local fixtures.
- Real backend API regression: **57 checks**, including exact stored attachment/tool parts, history CRUD, unauthorized access, version conflicts, stale deletion saves, and restart persistence. No real upstream model requests.
- Upstream 3.0.6 integration regression: **51 checks**.
- **26 frontend regression suites passed**. The actual assistant controller/page test also covers history save/select/search/rename/delete, attachments on reopen, and no model/tool execution from restored history. The separate no-model case preserves drafts/files.
- Frontend typecheck/build and macOS desktop source check passed. Shadcn check: **77 island files + 11 shell sources**. I18n scan has no missing keys. **93 generated artifacts are byte-identical after rebuilding**.
- Real browser against disposable fixture: send, new conversation, switch, refresh restore, rename, history rail collapse, dark theme, mobile drawer and selection. At 390 × 844, document width and scroll width were both 390. The assistant-only mobile viewport rule does not change other pages' document scrolling.
- Actual 3065: new layout and history endpoint load without browser errors; login persisted. Task center and its 16 execution records load normally. No real task, reward, account mutation, or paid model request was executed for this verification.

## Deployment and retained state

Backup: `data/backups/pre-assistant-history-cutover-20261016-151031/` (online SQLite snapshot, independent `account.key`, source patch/untracked source archive, release drafts).

3065 restarted successfully as PID 81781. SQLite `quick_check` returned `ok`, schema is 16. Before/after counts match: 11 accounts, 286 requests, 3 daily aggregate rows, 272 raw request rows, 16 task runs, 12 account identity archive rows. Account rows, encryption key and release drafts are unchanged. Configuration changes were limited to routine `backgroundTaskState` and `logsNextId`; assistant prompt/model/tool configuration was not changed.

Evidence is in ignored `data/integration-verification/assistant-history/`, including the live screenshot and test/build logs. No commit, push, or Release was performed.
