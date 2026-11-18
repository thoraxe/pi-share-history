# HTTP API

The service exposes a small JSON API, an SSE stream, and static browser assets under an optional path prefix. Reads need no authentication. Writes require a Bearer token. All responses are `Cache-Control: no-store` and include `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive Content Security Policy (`default-src 'self'`, no inline script/style, `frame-ancestors 'none'`, `form-action 'none'`).

## Behavioral Rules

### Routing and prefix

1. All routes MUST live under the path of `PUBLIC_URL`. A request outside that prefix MUST return `404`.
2. A request for the prefix without a trailing slash MUST return `308` to the same path with `/` (query string preserved).
3. The prefix MUST be preserved end to end: generated viewer URLs, API calls, asset URLs, and SSE endpoints all include it.
4. Share ids MUST match `[A-Za-z0-9_-]{32}`. Unknown ids MUST return `404`.

### Authentication

5. Write requests MUST send `Authorization: Bearer <key>`. A missing or wrong key MUST return `401`.
6. `POST /api/shares` MUST authenticate with the team upload key.
7. Every other write (`POST .../records`, `.../draft`, `.../stop`, `.../revoke`, `DELETE .../<id>`) MUST authenticate with that share's owner key.
8. Key comparison MUST be constant-time with respect to the secret (hash then timing-safe compare).
9. Reads (`GET /health`, `GET /api/shares`, `GET /api/shares/<id>`, `GET .../events`, static assets) MUST NOT require authentication.

### Endpoints

10. `GET /health` MUST return `200` and `{"ok":true}`.
11. `GET /api/shares` MUST return up to 200 non-revoked shares, each with `id`, `title`, `created`, `updated`, and a boolean `live`.
11a. `GET /api/shares` MUST return a `count` field for each share. The `count` field MUST hold the number of stored records for that share. [DONE: #9]
11b. The service MUST compute `count` in the same query that reads the shares. The service MUST NOT run one query for each share. [DONE: #9]
11c. `GET /api/shares` MUST list live shares before saved transcripts. Within each group, the service MUST order shares by `updated` descending. [DONE: #9]
12. `POST /api/shares` MUST accept `{"title": string}` (`title` length <= 200), create a share, and return `201` with `{id, ownerKey, url}` where `url` is `<PUBLIC_URL>/s/<id>`.
13. `GET /api/shares/<id>` MUST return `{id, title, updated, live, draft, records}`. The `records` field holds full record objects in insertion order. The `draft` field holds the public draft or `null`.
14. `GET /api/shares/<id>/events` MUST open an SSE stream with an initial `update` event. It MUST send `update` on every change, a keepalive `update` at least every 10 seconds, and `removed` when the share is revoked or deleted.
15. `POST /api/shares/<id>/records` MUST accept `{records: Record[], live: boolean, draft?: Draft}` and MUST upsert records idempotently by `id`.
16. `POST /api/shares/<id>/stop` MUST clear the live flag and clear any current draft text.
17. `POST /api/shares/<id>/revoke` MUST mark the share revoked, clear live state, drop its draft, notify viewers with `removed`, and close their streams. Stored records MUST remain in the database.
18. `DELETE /api/shares/<id>` MUST delete the share and cascade to its records, drop its draft, notify viewers with `removed`, and close their streams.
19. `POST /api/shares/<id>/draft` MUST accept a draft and return `409` unless the share is live and updated within the last 20 seconds.
20. Static routes `/`, `/s/<id>`, `/app.js`, `/theme.js`, `/markdown.js`, `/style.css`, and `/vendor/*` MUST serve the bundled browser client. The route `/s/<id>` MUST serve the same HTML shell as `/`.

### Limits and errors

21. Any request body over 1 MiB MUST be rejected with `413`.
22. A records batch MUST contain at most 200 records, and each record MUST serialize to at most 128 KiB.
23. A share MUST NOT exceed 10,000 records or 20 MiB of stored record bodies. Exceeding either limit MUST fail the whole batch and leave prior state unchanged.
24. A create request when 1,000 shares already exist MUST return `507`.
25. An SSE connection when 200 viewers are already connected MUST return `503`.
26. Invalid JSON MUST return `400`. Invalid field values MUST return `400`.
27. Errors MUST be JSON `{"error": string}`. Unexpected failures MUST return `500` with the generic message `Internal error` and MUST NOT leak internals.
28. The service MUST enforce a 15-second request timeout and a 10-second header timeout.
29. An SSE client whose unsent buffer exceeds 64 KiB MUST be disconnected.

## Configuration Surface

- `PUBLIC_URL.pathname` — route prefix. It must match `^(\/[A-Za-z0-9_-]+)+$` or be empty.
- 8-second draft TTL, configurable through the service factory for tests.
- `UPLOAD_KEY` — upload key. The length must be at least 24 characters.

## Constraints

- The API has no versioning scheme. The extension and the service must be updated together when the contract changes.
- Response bodies are JSON only for API routes. The viewer is the only HTML surface.
- The service is a single Node process with one SQLite database. There is no clustering and no external queue.

## Planned Changes

| Ticket | Summary |
|---|---|
| — | No planned changes recorded. |
