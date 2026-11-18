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

## Configuration Surface

- `PI_SHARE_URL` — service base URL, including the prefix. HTTPS is required except on loopback.
- `PI_SHARE_KEY` — team upload key. The extension uses it only to create a share.
- Saved owner entry fields: `id`, `ownerKey`, `url`, `server`.

## Constraints

- The extension supports only the current branch's history. It does not publish other branches.
- Live status expires after 20 seconds without an upload. A stalled publisher appears offline to viewers.
- Rotating the upload key stops new shares. It does not invalidate existing owner keys.

## Planned Changes

| Ticket | Summary |
|---|---|
| — | No planned changes recorded. |
