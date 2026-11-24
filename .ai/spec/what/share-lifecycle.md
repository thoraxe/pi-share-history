# Share Lifecycle

The publisher drives every state transition from inside Pi through a command. The extension decides what to capture and when to flush. The service owns the stored state.

## Behavioral Rules

### Commands

1. The extension MUST register `/pishare` on all Pi versions. It MUST also register `/share` when Pi has no built-in `/share`. That means Pi versions before 1.5, or an unknown version.
2. `/share start` and `/share upload` MUST publish the current branch after explicit user confirmation. The `start` action also enables live streaming. `upload` does not.
3. `/share status` MUST show the viewer URL, live state, draft-sharing state, pending update count, and the last sync error when one exists.
4. `/share stop` MUST stop live updates, flush pending records, and tell the service the share is no longer live while keeping the transcript readable.
5. `/share revoke` MUST disable public access and keep stored data. `/share delete` MUST delete the hosted copy and clear the saved owner entry.
6. `revoke` and `delete` MUST require confirmation and MUST affect only the hosted copy, not local Pi history.
7. A bare command with no arguments MUST behave as `status`.
8. An unknown action MUST produce a usage error rather than a side effect.

### Owner state

9. After creating a share the extension MUST persist `{id, ownerKey, url, server}` as a Pi custom entry of type `pi-share-history-owner-v1`.
10. The saved owner entry MUST be excluded from uploads by the record allowlist.
11. On session start the extension MUST recover the saved entry from the current branch and MUST NOT start publishing automatically.
12. If `PI_SHARE_URL` changes to a different path on the same origin, the extension MUST migrate the saved `server` and `url` in place without resuming publishing.
13. If `PI_SHARE_URL` points at a different origin, the extension MUST NOT send saved owner credentials there. The publisher MUST create a new share.
14. A session that branches to before the owner entry MUST create a new share rather than reuse the old one.
15. If the extension cannot read the Pi version, it MUST register `/share`.

### Synchronization and failure

16. Live updates MUST be coalesced and flushed about every 1.5 seconds. The extension MUST also flush on submission and on shutdown.
17. HTTP requests from the extension MUST time out after 5 seconds and MUST NOT follow redirects.
18. Failed uploads MUST remain queued in process memory for retry. There is no durable offline queue.
19. On graceful shutdown the extension MUST try a final flush and a `stop`. If the flush fails, it MUST warn that the service stores only acknowledged uploads.
20. `status` MUST report sync errors. The Pi status bar MUST distinguish sync error, pending updates, live, and saved states.
21. Stopping, uploading without streaming, revoking, deleting, shutting down, or replacing the session MUST disable draft sharing.
22. Publishing a share MUST NOT unpublish or rewrite previously shared records.
23. The extension MUST reject a non-localhost `PI_SHARE_URL` that is not HTTPS. It MUST also reject credentials, query strings, fragments, and non-simple path prefixes.

### Import from a share

24. `/share continue` MUST accept one argument. The argument MUST be a share id that matches `[A-Za-z0-9_-]{32}`, or `<service URL>/s/<id>`. The path MUST be the service URL path followed by `/s/<id>`. The extension MUST ignore one trailing slash after the id and a `#` fragment. It MUST reject any other path, a query string, credentials, or an origin that is not the origin of the service URL. [PLANNED: #54]
24a. A rejected argument, a missing argument, or an extra argument MUST produce a usage error and MUST NOT create a session. [PLANNED: #54]
24b. If the share id equals the current share id, `/share continue` MUST report an error and MUST NOT create a session. [PLANNED: #54]
24c. If `PI_SHARE_URL` is not set, `/share continue` MUST report an error and MUST NOT create a session. [PLANNED: #54]
25. After the share read and its checks pass, and before it replaces the session, `/share continue` MUST require confirmation. If the publisher declines, it MUST NOT create a session. [PLANNED: #54]
25a. After confirmation, `/share continue` MUST wait until the agent is idle. The extension MUST NOT wait when the agent is already idle. If the agent is not idle after 60 seconds, `/share continue` MUST report an error and MUST NOT create a session. [PLANNED: #54]
25b. After the agent is idle and before it replaces the session, `/share continue` MUST flush pending records. It MUST stop the current share when one exists. If the flush fails, it MUST warn that the service stores only acknowledged uploads. [PLANNED: #54]
26. Before the confirmation in rule 25, `/share continue` MUST read `<service URL>/api/shares/<id>` without credentials. [PLANNED: #54]
27. If the share is missing, revoked, or has no non-empty record `text`, `/share continue` MUST report an error. It MUST NOT create a session. [PLANNED: #54]
27a. If the share read fails with a network or service error, `/share continue` MUST report an error. It MUST NOT create a session. [PLANNED: #54]
27b. A record is non-empty when its `text` value holds at least one non-whitespace character. [PLANNED: #54]
28. If the share holds more than 2,000 records, `/share continue` MUST report the record count and the 2,000-record limit. It MUST NOT create a session. [PLANNED: #54]
29. The extension MUST start a new local Pi session with no prior conversation. The extension MUST NOT delete or change the replaced session. [PLANNED: #54]
29a. If the Pi context cannot start a new session, `/share continue` MUST report an error and MUST NOT create a session. [PLANNED: #54]
30. The first branch entry of the imported session MUST be a Pi custom entry of type `pi-share-history-import-v1`. It MUST hold `shareUrl` and `importedAt`. `importedAt` MUST be an ISO 8601 string. [PLANNED: #54]
30a. `/share status` in an imported session MUST show the source share URL. After a later publish, it MUST also show the current viewer URL. [PLANNED: #54]
30b. `shareUrl` MUST hold the canonical share URL, without a trailing slash or fragment. [PLANNED: #54]
30c. The record allowlist MUST exclude the import marker from uploads. [PLANNED: #54]
31. Each non-empty record with kind `user` or `assistant` MUST become a message with the same role and text. The imported entries MUST keep the insertion order of the `records` array. [PLANNED: #54]
32. Each non-empty record with a kind other than `user` or `assistant` MUST become a text-only custom message. The extension MUST NOT create a tool call message or a tool result message. [PLANNED: #54]
32a. Each custom message that the import creates MUST set `customType` to the canonical share URL from rule 30b. [PLANNED: #54]
33. The extension MUST copy the record `text` value. The extension MUST NOT copy other record fields or add image data, `thinking`, `errorMessage`, signatures, credentials, or local session paths. [PLANNED: #54]
33a. The extension MUST ignore the share `draft` field. [PLANNED: #54]
33b. The import MUST NOT start an agent turn. The agent MUST stay idle until the publisher sends the next prompt. [PLANNED: #54]
34. `/share continue` MUST NOT start publishing. [PLANNED: #54]
34a. `/share continue` MUST NOT create a share or write an owner entry. [PLANNED: #54]
34b. A later `start` or `upload` in an imported session MUST create a new share and a new owner key. [PLANNED: #54]
35. `/share continue` MUST NOT change the source share. [PLANNED: #54]
36. Tests MUST cover a full import, a missing share, a revoked share, an empty share, a foreign-origin argument, and a missing service URL. Tests MUST also cover a share over the 2,000-record limit, a self-import, an invalid argument, and a later publish. Tests MUST assert that the first branch entry holds the import marker with the canonical share URL and an ISO 8601 `importedAt`. Tests MUST assert that imported entries keep record order. Tests MUST assert that a later publish uploads no import marker and no `errorMessage`. Tests MUST assert that each imported custom message sets `customType` to the canonical share URL. Tests MUST assert that an imported entry holds the record text and no `thinking`, image data, signature, credential, or session path. Tests MUST assert that the extension creates no tool call message for a record of another kind. Tests MUST assert that the import does not start publishing, create a share, or write an owner entry. Tests MUST assert that the import does not start an agent turn. Tests MUST assert that the source share keeps the same record count and `updated` value. [PLANNED: #54]
36a. The test fake MUST provide a new-session action, a message append action, a custom-entry append action, and an idle wait. [PLANNED: #54]

## Configuration Surface

- `PI_SHARE_URL` — service base URL, including the prefix. HTTPS is required except on loopback.
- `PI_SHARE_KEY` — team upload key. The extension uses it only to create a share.
- Saved owner entry fields: `id`, `ownerKey`, `url`, `server`.
- Import record limit: 2,000 records.
- Idle wait: 60 seconds, overridable for tests.
- New session start: a Pi context capability. Tests supply a fake.

## Constraints

- The extension supports only the current branch's history. It does not publish other branches.
- Live status expires after 20 seconds without an upload. A stalled publisher appears offline to viewers.
- Rotating the upload key stops new shares. It does not invalidate existing owner keys.
- An imported session is a readable transcript. It is not a faithful Pi session fork. It has no system prompt, tool call structure, images, thinking, or thinking signatures.

## Planned Changes

| Ticket | Summary |
|---|---|
| #54 | Continue a local Pi session from a public share. |
