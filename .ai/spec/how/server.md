# Service

`server/index.mjs` is the whole service. `createService(options)` builds an `http.Server`, opens SQLite, loads the browser assets into memory, and returns `{ server, db, close }`. The CLI entry point at the bottom calls it with environment variables.

## Module Map

| Symbol | Responsibility |
|---|---|
| `createService` | Config validation, DB init, asset loading, HTTP handler, timers, shutdown. |
| `hash`, `equal` | SHA-256 helper and constant-time comparison used for both keys. |
| `failure(status, message)` | Creates an `Error` with a `status` used by the catch-all response path. |
| `body(req)` | Reads and parses a request body, enforcing the 1 MiB cap. |
| `notify(id, event)` | Writes an SSE frame to every viewer of a share. It destroys a session that has more than 64 KiB unsent. |
| `publicDraft(id)` | Returns `{text, expiresIn}` only for a non-empty, unexpired draft. |
| `assets` | Map of asset path to a Buffer read once at startup. |
| `drafts`, `viewers` | In-memory draft map and share-id → set of SSE responses. |

## Data Flow

1. Global security headers are set, then the URL is parsed and the configured prefix is stripped into `path`.
2. `/health`, directory, and create routes are handled before the share pattern match. The directory query returns `id, title, created, updated, live, count` in one statement. It computes the effective `live` value in SQL and orders live shares first, then `updated` descending (rules 11a-11c).
3. The regex `^/api/shares/([\w-]{32})(?:/(records|events|stop|revoke|draft))?$` splits the share id and action.
4. The service fetches the share row once. For non-GET requests it authorizes the token against `shares.owner`, a SHA-256 of the owner key. It then checks `revoked`.
5. Writes notify viewers only after the database change is committed. Delete and revoke are different: they notify, then close the streams.
6. If no API route matches, `GET` requests use the static asset map. The routes `/` and `/s/<id>` map to `index.html`.
7. Unmatched routes and domain errors are converted to `{error}` JSON by a single catch block.

## Key Abstractions

- **Schema:** `shares(id PK, owner, title, created, updated, live, revoked)` and `records(share FK CASCADE, id, body, position, PK(share,id))`. An index on `(share, position)` orders the records. The service enables WAL mode and foreign keys on the connection.
- **Owner stored as hash:** `shares.owner = sha256(ownerKey)`. The `equal` helper hashes both arguments, so it hashes the request token twice. Verification still matches.
- **Status derived, not stored:** `shares.live` is an intent flag. A read reports live only when the flag is set and the last update is less than 20 seconds old. The directory query repeats that test in SQL, so the `live` field and the live-first order agree.
- **Directory count in one query:** `GET /api/shares` selects `(SELECT count(*) FROM records r WHERE r.share=s.id) AS count`. It is one statement for the whole page, not one query for each share (rule 11b).
- **Two clocks:** `shares.updated` advances on record and draft writes. The SSE heartbeat every 10 s only keeps connections alive and does not change `updated`.
- **Quota inside a transaction:** the batch inserts the records. The service then recomputes count and bytes for the share. It commits, or it rolls back when a limit is exceeded.

## Integration Points

| Consumer | Provider | Mechanism |
|---|---|---|
| Extension | API routes | `fetch` with Bearer token, 5 s timeout, redirects rejected. |
| Extension | `POST /records`, `POST /draft` | JSON batches carrying records, live flag, and optional draft. |
| Browser | `GET /api/shares/<id>` and `/events` | Full-document fetch on each SSE invalidation. |
| Browser | Static routes | Cached-in-memory Buffers with `__BASE_PATH__` substitution in HTML. |
| Compose/Caddy | `server.listen` | HTTP on `PORT`. The proxy preserves the prefix and disables buffering for SSE. |

## Implementation Notes

- Only `index.html` is templated (`__BASE_PATH__`). Client scripts must build URLs from `document.documentElement.dataset.basePath`.
- The service handles `DELETE` and `revoke` before the `revoked` check. An owner can therefore delete an already-revoked share.
- `stop` writes `live=0` and blanks the draft text. It keeps the draft entry and its revision, so an in-flight older draft cannot restore the text.
- A records batch sets the live flag even when it carries only a draft-clear. The order with `stop` therefore matters.
- The service reads assets synchronously at startup. To add a viewer file, update the `assets` path list as well as the file.
