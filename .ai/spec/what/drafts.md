# Ephemeral Drafts

Draft sharing publishes the text currently in Pi's editor, before submission, to viewers of a live share. Drafts are explicitly opt-in. They live only in service memory and are never stored as history.

## Behavioral Rules

### Opt-in and scope

1. Draft sharing MUST be off by default, MUST require a live share, and MUST require a separate confirmation explaining that unsent text becomes public.
2. Draft sharing MUST be unavailable outside Pi's interactive terminal mode (no RPC or print mode).
3. Enabling drafts MUST NOT persist a preference. Resuming a session MUST leave drafts off.
4. Draft text MUST be capped at 24,000 characters.
5. Editor text beginning with `/` or `!` after leading whitespace MUST be excluded from the preview.
6. Text that has just been submitted but not yet cleared from the editor MUST NOT be republished as a draft.

### Transport and retention

7. The extension MUST sample the editor about every 400 ms while drafts are on. It MUST renew a visible draft at least every 2 seconds. A draft that gets no update expires.
8. Drafts MUST be sent as `{revision, text}` with a monotonic revision. The service MUST ignore revisions that are not newer than the stored one.
9. Drafts MUST live only in memory, MUST NOT be written to SQLite, and MUST NOT become transcript records.
10. A draft MUST expire 8 seconds after its last update, and the service MUST clear it on `/stop`, `/revoke`, `/delete`, or a non-live upload.
11. A submitted draft MUST be cleared in the same snapshot as the uploaded history so viewers see the message once.
12. Emptied drafts MUST be broadcast so viewers can remove the preview immediately.
13. The extension MUST show a persistent `DRAFTS PUBLIC` status while draft sharing is on.

### Viewer behavior

14. The viewer MUST show drafts below the transcript, visually separated and labelled as unsent and unsaved.
15. The viewer MUST clear a draft preview on submission, expiry, connection error, and removal of the share.
16. Draft previews MUST always render as plain text, never Markdown.
17. Viewers MUST be able to copy or record a draft. The viewer MUST NOT imply confidentiality.

## Configuration Surface

- Draft TTL: 8 seconds, configurable when embedding `createService` for tests.
- Editor poll interval 400 ms and renewal interval 2 s in the extension.
- `draft` field in `GET /api/shares/<id>`: `{text, expiresIn}` or `null`.
- `POST /api/shares/<id>/draft` request body: `{revision: integer >= 0, text: string}`.

## Constraints

- Draft delivery is best effort. There is no acknowledgement beyond the upload response. Updates made while offline are lost after they leave the editor.
- Drafts require a live share and a recent upload, so they cannot be previewed on a saved-only transcript.

## Planned Changes

| Ticket | Summary |
|---|---|
| — | No planned changes recorded. |
