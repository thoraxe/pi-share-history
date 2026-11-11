# Extension Sync

`extension/index.ts` exports the Pi extension factory. All publishing state lives in closure variables created per Pi session. Module-level code is limited to the version helper.

## Module Map

| Symbol | Responsibility |
|---|---|
| `piHasBuiltInShare`, `detectPiHasBuiltInShare` | Decides whether `/share` can be registered by parsing the Pi `VERSION` export. |
| default factory | Wires events, commands, timers, and the draft poller. |
| `server()` | Validates `PI_SHARE_URL` and returns the normalized base URL. |
| `request()` | JSON `fetch` with Bearer auth, redirect rejection, and a 5 s timeout. |
| `capture()` | Walks `sessionManager.getBranch()` and queues message/summary records. |
| `flush()` | Uploads queued records/drafts in bounded batches, serialized by `sending`. |
| `put`, `status`, `startTimer`, `stop` | Queue insertion, status bar, 1.5 s flush timer, live stop. |
| `setDraft`, `pollDraft`, `disableDrafts`, `clearSubmittedDraft` | Draft lifecycle driven from the editor. |

## Data Flow

1. `session_start` resets `share`, `pending`, `live`, and draft state, then scans branch entries for the owner custom entry.
2. A command handler validates the action, confirms with the user, creates the share if needed, sets `live`, calls `capture()`, and awaits `flush()`.
3. Live Pi events (`message_*`, `tool_execution_*`, `session_tree`, `agent_settled`) call `put()` while `live` is true. The `session_tree` and `agent_settled` events also run a full branch capture.
4. `flush()` pulls records from `pending` until the byte/record-count budget is reached, attaches the current `pendingDraft`, and posts the batch.
5. On success it deletes only the records it sent (comparing object identity) and clears the draft if it is unchanged.
6. The 1.5 s interval re-enters `flush()`. The `sending` promise makes concurrent calls join the in-flight request.
7. `stop()` disables drafts, clears the timer, flushes, then posts `/stop`.
8. `session_shutdown` runs `stop()`, warns on failure, and clears the status bar.

## Key Abstractions

- **Pending is a Map keyed by record id.** `message_update` and `message_end` for the same record overwrite each other. Only the newest body is sent.
- **Batching is bounded by serialized size.** Accumulate up to 800,000 bytes or 100 records per request. This stays under the service's 1 MiB cap.
- **Draft updates can ride with records.** A non-empty batch carries the draft in the same `/records` call. With no batch, the extension posts the draft to `/draft` while live.
- **Submissions are ordered.** `submittedText` suppresses re-publishing a buffer that has been sent but not cleared. It resets once the editor text changes.
- **Timers are unref'd** so they do not keep the Pi process alive.
- **Owner state is a Pi custom entry,** written with `pi.appendEntry(STATE, …)` and recovered from the branch, never from env.

## Integration Points

| Consumer | Provider | Mechanism |
|---|---|---|
| Extension | `@earendil-works/pi-coding-agent` | Extension factory, typed events, `ExtensionContext.ui` (notify, confirm, status, editor text), `sessionManager`, `appendEntry`. |
| Extension | `extension/records.mjs` | Pure mapping functions with no Pi imports. |
| Extension | Service | `fetch` to `/api/shares`, `/records`, `/draft`, `/stop`, `/revoke` and `DELETE`. |

## Implementation Notes

- `pi.registerCommand('pishare', …)` always runs. The `share` name is registered only when the built-in is absent. Both names share one handler object.
- The dynamic import of the Pi package for `VERSION` is wrapped in `try/catch`. A failure means "assume no built-in", preserving `/share`.
- Draft revisions are `Math.max(revision + 1, Date.now())`. A restarted process cannot reuse a revision that the service has already seen.
- `disableDrafts()` forces one empty draft when it had been on or had text. The viewer then clears even if no further uploads occur.
- Record capture uses `entry.type === 'message'` plus compaction/branch-summary entries. Tool events are captured separately, not from branch history.
