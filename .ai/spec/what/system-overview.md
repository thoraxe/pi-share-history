# System Overview

Pi share history has two parts: a Pi extension that captures and uploads session records, and a self-hosted Node service. The service stores the records in SQLite and serves a read-only browser viewer. Multiple publishers share one service and one team upload key. Each share gets its own owner key. Published transcripts are public. There is no viewer login and no automatic secret redaction.

## Behavioral Rules

### Roles and trust

1. The service MUST allow anyone who can reach it to read the session directory, any non-revoked share, and its records, without authentication.
2. The service MUST require the team upload key to create a share. It MUST require the share's owner key to modify, revoke, or delete that share.
3. The team upload key MUST NOT be able to modify, revoke, or delete a share created with a different owner key.
4. The system MUST NOT do automatic secret redaction. It provides none. The upload allowlist and truncation are the only limits on published content.
5. Transport MUST be HTTPS for any non-localhost deployment. The extension accepts plain HTTP only for `localhost`, `127.0.0.1`, and `[::1]`.
6. The browser viewer MUST NOT require credentials and MUST be read-only.

### Component inventory

7. The extension (`extension/`) registers share commands in Pi, captures session records, and uploads them in batches.
8. The service (`server/`) validates configuration, owns the SQLite database, exposes the HTTP API, and fans out live invalidations over SSE.
9. The browser client (`web/`) renders the directory and transcripts, follows live updates, and applies presentation-only Markdown and theme choices.

### Publication lifecycle

10. Creating a share MUST return an opaque share id, an owner key, and a public viewer URL. The service MUST NOT let a client choose the id.
11. A share MUST remain readable after live updates stop. `/share stop` clears only the live flag.
12. Revoking a share MUST make subsequent reads and writes return `404` and MUST keep the stored data. Deleting a share MUST remove its records.
13. Resuming a Pi session MUST NOT automatically resume publishing. The publisher MUST run `start` or `upload` again.
14. A revoked share MUST NOT restart. The publisher MUST delete it before creating a new share for that session.
15. Live status MUST be derived from recency: `live` is reported only while the last publisher upload is younger than 20 seconds.
16. Navigating branches or compaction MUST only add records. Previously published records MUST remain visible.

## Configuration Surface

Service environment (read by `server/index.mjs` when run as the entry point):

- `UPLOAD_KEY` — team upload key. It MUST contain at least 24 characters. Required.
- `PUBLIC_URL` — public service URL. It controls generated viewer links and the route prefix. It must be HTTP(S), with no credentials, query, or fragment, and with simple slash-separated path segments. Default `http://localhost:9080`.
- `DATA_DIR` — directory holding `history.sqlite`. Default `./data`.
- `PORT` — HTTP listen port. Default `9080`.
- `HOST` — HTTP bind address. Default `0.0.0.0`.

Extension environment:

- `PI_SHARE_URL` — service URL including any path prefix. It MUST equal the service `PUBLIC_URL`.
- `PI_SHARE_KEY` — team upload key, sent as a Bearer token when creating a share.

## Constraints

- The service MUST run on Node 22.18+ because it uses built-in `node:sqlite`.
- The browser client MUST be served from the same origin as the API and MUST NOT load third-party assets or CDNs.
- Storage limits are part of the contract. The limits are 1 MiB per HTTP request, 128 KiB per record, and 10,000 records or 20 MiB per share. The service allows 1,000 shares and 200 concurrent SSE viewers.
- There is no publisher account system, admin dashboard, automatic expiry, or access control beyond keys.

## Planned Changes

| Ticket | Summary |
|---|---|
| — | No planned changes recorded. |
