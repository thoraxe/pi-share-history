# Record Format

A record is one published unit of transcript: a message, a tool execution, a notice, or a compaction/branch summary. The extension builds records through an explicit allowlist. The service stores each record as JSON and returns it verbatim to the viewer.

## Behavioral Rules

### Record shape

1. Every record MUST have `id` (string, <= 200 chars), `kind` (string), and `timestamp`.
2. A record MAY include `model`, `label`, `text`, `error`, `errorMessage`, `status`, and `parent`.
3. `text` MUST be truncated to 24,000 characters and append `\n[truncated by pi-share-history]` when truncation occurs.
4. Record ids MUST be stable across retries so the same logical record upserts rather than duplicates.

### Identity conventions

5. Message ids MUST follow `message:<role>:<timestamp>`, except tool results which use `result:<toolCallId>`.
6. Tool execution ids MUST follow `tool:<toolCallId>`, with status `running`, `done`, or `error`.
7. Branch notices MUST use `branch:<epoch-ms>`. Compaction and branch summaries MUST use `entry:<entryId>`.
8. Re-uploading the same id MUST replace the stored body but keep the record's original position in the transcript.

### Allowlist and omissions

9. The extension MUST only emit records for these roles: `user`, `assistant`, `toolResult`, `bashExecution`, `custom`, `branchSummary`, and `compactionSummary`. It MUST drop `system` messages.
10. System prompts, model thinking blocks, image data, provider signatures, raw provider events, and arbitrary tool-result metadata MUST NOT be uploaded.
11. Image content blocks MUST become `[image omitted]`. Thinking blocks MUST become `[thinking omitted]`. Other unknown block types MUST become `[<type> block omitted]`.
12. `bashExecution` records MUST contain the command prefixed with `$ ` and the command output.

### Upload batching

13. The extension MUST batch pending records into requests of at most 100 records and about 800 KB. This keeps each request under the service's 1 MiB limit.
14. The extension MUST capture only changes to the current branch on an explicit `start` or `upload`. After that, live capture MUST listen to message and tool events.
15. Each upload batch MUST carry the publisher's current `live` flag so the service can update share status in the same transaction.
16. A lost acknowledgement MUST be safe to retry because records upsert by id.

## Configuration Surface

- 24,000-character cap applied when the extension builds record text. Drafts use the same cap.
- 800 KB or 100-record batch cap in the extension. 1 MiB body cap in the service.
- 128 KiB per-record cap enforced by the service.

## Constraints

- The stored transcript is a readable log. It is not an exact terminal mirror and not a restorable Pi session export.
- Ephemeral tool progress cannot be recovered after a crash. Only persisted conversation history can be re-uploaded.

## Planned Changes

| Ticket | Summary |
|---|---|
| — | No planned changes recorded. |
