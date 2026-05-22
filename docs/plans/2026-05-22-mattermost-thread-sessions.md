# Mattermost Thread Sessions Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Treat each Mattermost thread as a durable PD One session with synchronized posts, attachment artifacts, bounded summaries, and a layered context compiler through Phase 4.

**Architecture:** Keep @mention/onchar gating in the existing Mattermost monitor, but replace one-shot thread text append logic with a local thread-session layer. The connector resolves a stable session identity from account/channel/root post, syncs fetched Mattermost thread data into an idempotent JSON store, updates attachment artifact status after media download, then compiles a layered prompt context for each activated turn.

**Tech Stack:** TypeScript, Vitest, existing OpenClaw Mattermost extension, existing session route keys, JSON file store under the configured OpenClaw session store directory.

---

## Acceptance criteria

1. Channel/group messages still require @mention or onchar activation according to existing policy before model invocation.
2. Activated thread replies use a deterministic Mattermost thread session key derived from account id, channel id, and root post id.
3. Thread sync is idempotent: repeated sync of the same fetched thread updates existing post records instead of duplicating them.
4. Thread session records persist normalized post metadata, attachment manifest entries, activation metadata, sync stats/caveats, and deterministic summary/checkpoint text.
5. Attachment status is updated after media resolution/download, including downloaded/missing/failed and local path/status caveats.
6. The model sees layered context: current request first, thread session summary/checkpoint, recent chronological messages, attachment manifest, and caveats.
7. Long threads are bounded deterministically: recent messages are kept raw; older messages become a checkpoint summary, not unbounded raw dump.
8. Non-activated messages do not call model, do not fetch/download attachments, and only update the existing volatile channel history as today.
9. Tests cover pure session key/sync/context behavior plus monitor integration points.
10. No Gateway restart occurs without explicit approval.

## Phase 1 — Bridge hardening already completed

### Task 1.1: Preserve mention-only activation context

**Status:** Done in commit `26b77df538`.

**Behavior:** If an activated post is only `@pd_one_bot` and thread/attachment context exists, PD One no longer drops it as empty. It substitutes `[Mattermost thread context and/or attachments provided]` and includes thread/attachment context.

### Task 1.2: Thread-wide attachment manifest and diagnostics

**Status:** Done in commit `26b77df538`.

**Behavior:** Thread attachment refs are collected from fetched thread posts, manifest statuses are model-visible, and verbose diagnostics record thread post/file counts.

---

## Phase 2 — Durable thread session store

### Task 2.1: Add thread session key and path helpers

**Files:**
- Create: `extensions/mattermost/src/mattermost/thread-session.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- `buildMattermostThreadSessionId({ accountId, channelId, rootPostId })` returns `mattermost:<account>:channel:<channel>:thread:<root>` with URL-safe escaped components.
- Root posts use their own post id as root id when `root_id` is absent.
- `resolveMattermostThreadSessionStorePath('/tmp/sessions/main.json')` returns `/tmp/sessions/mattermost-thread-sessions.json`.

**Implementation:**
- Export `buildMattermostThreadSessionId`, `resolveMattermostThreadRootId`, and `resolveMattermostThreadSessionStorePath`.
- Use `encodeURIComponent` for opaque ids.

### Task 2.2: Add JSON store load/save helpers

**Files:**
- Modify: `extensions/mattermost/src/mattermost/thread-session.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- Loading a missing file returns `{ version: 1, sessions: {} }`.
- Saving and loading round-trips a session record.
- Invalid JSON is treated as empty but does not throw.

**Implementation:**
- Synchronous file helpers are acceptable because the store is small and called once per activated inbound turn.
- Write via temp file + rename to avoid partial JSON.
- Create parent directory recursively.

### Task 2.3: Add idempotent sync from fetched thread posts

**Files:**
- Modify: `extensions/mattermost/src/mattermost/thread-session.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- First sync stores ordered post records and attachment refs.
- Second sync with same posts does not duplicate posts or attachments.
- Edited post text updates the existing post record and `updatedAt`.
- Session records `activatedAt`, `lastSyncedAt`, `lastTriggerPostId`, and `syncCaveat`.

**Implementation:**
- Store normalized fields only: id, rootId, channelId, userId, message, createAt, updateAt, fileIds.
- Attachment entries keyed by file id with source post id and latest metadata/status.

---

## Phase 3 — Context compiler and bounded compaction

### Task 3.1: Add deterministic summary/checkpoint builder

**Files:**
- Modify: `extensions/mattermost/src/mattermost/thread-session.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- Long sessions keep latest N posts as raw recent messages.
- Older posts are represented by a deterministic checkpoint containing post count, participant ids, time range, and truncated bullet lines.
- Summary is stable across repeated compiles.

**Implementation:**
- No LLM call in this phase; use deterministic bounded summarization to avoid new model/reentrancy complexity in the monitor.
- Default recent raw message count: 20.
- Default summary bullet count: 12.
- Default max chars per raw recent message: 1200.

### Task 3.2: Add layered context compiler

**Files:**
- Modify: `extensions/mattermost/src/mattermost/thread-session.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- Compiled context starts with `Mattermost thread session:` metadata.
- Includes session summary/checkpoint before recent messages.
- Includes recent messages oldest→newest with `[current message]` marker.
- Includes attachment manifest and explicit caveats.
- Does not include duplicate current request text as both current request and recent context without a marker.

**Implementation:**
- Export `compileMattermostThreadSessionContext(session, opts)`.
- Keep current request assembly in `buildMattermostAgentInputText`; pass compiled session context instead of raw thread text context.

---

## Phase 4 — Monitor integration and proactive activated-thread maintenance

### Task 4.1: Integrate session sync before context compile

**Files:**
- Modify: `extensions/mattermost/src/mattermost/monitor.ts`
- Test: `extensions/mattermost/src/mattermost/monitor.test.ts`

**Test first:**
- Existing thread attachment tests still pass.
- New test proves `buildMattermostAgentInputText` can use compiled session context.

**Implementation:**
- After mention gate passes and before media resolution, compute `storePath`, `threadSessionStorePath`, and `threadSessionId`.
- Sync `attachmentRefs.threadPosts` and `attachmentRefs.manifest` into the thread-session store.
- Compile `threadTextContext` from the thread session instead of `buildMattermostThreadTextContext` where possible.
- Preserve fallback to raw thread context if store write fails.

### Task 4.2: Persist post-download attachment statuses

**Files:**
- Modify: `extensions/mattermost/src/mattermost/monitor.ts`
- Modify: `extensions/mattermost/src/mattermost/thread-session.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- Updating downloaded/missing statuses patches existing attachment entries by file id.
- Local paths and failure reasons persist.

**Implementation:**
- After `applyMattermostDownloadStatusToManifest`, call `updateMattermostThreadSessionAttachments(...)`.
- Recompile attachment context from persisted session or use freshly updated manifest.

### Task 4.3: Activated-thread maintenance policy

**Files:**
- Modify: `extensions/mattermost/src/mattermost/thread-session.ts`
- Modify: `extensions/mattermost/src/mattermost/monitor.ts`
- Test: `extensions/mattermost/src/mattermost/thread-session.test.ts`

**Test first:**
- Activated sessions record `activated: true` and increment `activationCount` only after mention/onchar passes.
- Unmentioned/drop paths do not create thread-session records.

**Implementation:**
- This phase deliberately does not reply or download on unmentioned messages.
- Future @mentions in the same thread resync from Mattermost and reuse the existing session/artifact state.
- No background poller yet; avoid unsolicited processing.

### Task 4.4: Diagnostics and operational rollback

**Files:**
- Modify: `extensions/mattermost/src/mattermost/monitor.ts`
- Optional docs: `docs/plans/2026-05-22-mattermost-thread-sessions.md`

**Implementation:**
- Extend verbose log with `threadSessionId`, store sync status, post count, attachment count, recent raw count, and summary count.
- On store read/write failure, log caveat and continue with current bridge behavior.
- Rollback is source revert plus deleting/ignoring `mattermost-thread-sessions.json`; no migration is required for first version.

---

## Verification commands

Run from the OpenClaw repository root:

```bash
node scripts/run-vitest.mjs --config test/vitest/vitest.extension-mattermost.config.ts extensions/mattermost/src/mattermost/thread-session.test.ts --run --maxWorkers=1 --no-file-parallelism --reporter=dot
node scripts/run-vitest.mjs --config test/vitest/vitest.extension-mattermost.config.ts extensions/mattermost/src/mattermost/monitor.test.ts --run --maxWorkers=1 --no-file-parallelism --reporter=dot
node scripts/run-vitest.mjs --config test/vitest/vitest.extension-mattermost.config.ts --run --maxWorkers=1 --no-file-parallelism --reporter=dot
git diff --check
openclaw config validate
```

`pnpm check:changed` is desirable but may be blocked on this host by native package download/`@typescript/native-preview-linux-x64` installation failures; if blocked, record the exact blocker and rely on targeted Mattermost tests plus `git diff --check`.

---

## Second-pass risk review

- **Privacy:** The store persists Mattermost thread contents and attachment metadata. Store it under the same local OpenClaw state/session directory, not in repo or logs. Do not persist secrets from messages outside the local runtime store. Verbose diagnostics must log counts/ids, not full message text. Write the store with restrictive `0600` permissions where possible.
- **Mention gating:** Store creation/sync must happen only after mention/onchar gate passes for group/channel contexts. Existing drop paths remain before thread sync/media download. Monitor tests must prove unmentioned/onchar-non-triggered messages do not fetch thread data, file info, media, or write the durable thread-session store.
- **Session identity:** The durable Mattermost thread-session id and `ctxPayload.SessionKey` should converge on the thread root identity for activated thread/root posts. Tests must cover root posts and replies independently of reply-to mode.
- **Data leakage:** Session key contains encoded opaque ids only; context compiler only includes the current thread session, never unrelated channel history or global memory. When durable thread context is present, volatile channel history must not inject unrelated unmentioned channel chatter into the model context.
- **Post lifecycle:** Store `update_at`/`edit_at`/`delete_at` if present. Edited posts update existing records; deleted posts should be marked deleted and excluded/redacted from compiled model context. Attachments removed from posts should be marked stale rather than silently retained as active.
- **Attachment safety:** Download limits remain enforced by existing media resolver. Missing/failed files stay model-visible to avoid hallucination. Status merge rules must allow pending/failed/missing to become downloaded on retry, while stale local paths are not shown as current if later media resolution fails.
- **Concurrency:** JSON temp-write + rename reduces partial writes; also serialize in-process read/modify/write by store path to avoid lost updates between simultaneous Mattermost inbound handlers. Cross-process file locking is a future hardening item if multiple Gateway processes are introduced.
- **Error sanitization:** Persist and expose sanitized caveats/failure reasons. Avoid raw token-bearing URLs, full stack traces, or unnecessary absolute local paths in model-visible context/logs.
- **Operational:** No Gateway restart without approval. Store failure is non-fatal and falls back to current bridge behavior, still bounded and current-thread-only.
- **YAGNI:** No background poller and no LLM summarizer in this implementation. Future semantic summaries can be added behind an explicit config once deterministic sessioning is stable.
