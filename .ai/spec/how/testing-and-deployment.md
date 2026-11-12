# Testing and Deployment

Tests run on `node:test` with no test framework dependency. The service tests import `createService` directly. The extension tests import the TypeScript entry, and Node 22 strips the types. The browser tests load the real scripts into jsdom.

## Module Map

| File | Key Symbols | Responsibility |
|---|---|---|
| `test/service.test.mjs` | temp-dir `createService`, `fetch` helper | Auth, multi-publisher isolation, SSE, restart persistence, revoke/delete, quota rollback, config validation, record allowlist. |
| `test/extension.test.mjs` | fake `pi` and `ctx` objects | Full lifecycle against a real service at `/` and `/pi-history`, plus `/share` version detection. |
| `test/drafts.test.mjs` | `fixture`, `until`, jsdom viewer | Owner-only/ephemeral drafts, revision ordering, submission without duplicates, expiry, disconnect cleanup. |
| `test/subpath.test.mjs` | prefix fixtures | Prefixed API/assets/SSE, canonical redirect, legacy link handling, client URL construction. |
| `test/markdown.test.mjs` | `browser()`, `modeViewer()`, `placeReader()`, jsdom | Rendering, sanitization, raw HTML/image blocking, toggle persistence, fail-closed behavior, Read/Advanced modes, record roles, tool groups, metadata visibility, compact share state, new-activity pill. |
| `test/theme.test.mjs` | jsdom with mocked `matchMedia` | Pre-paint theme, cycle order, storage sync, blocked storage. |
| `Dockerfile` | node:22-bookworm-slim stages | Copies only `package.json`, `server/`, and `web/`. Creates `/data`. Runs as `node`. No npm install. |
| `compose.yaml` | `history` service, `history-data` volume | Requires `UPLOAD_KEY`/`PUBLIC_URL`, binds `127.0.0.1:9080`, caps memory at 512 MB, rotates logs. |
| `deploy/Caddyfile` | `logs.example.com` site, `@legacy` matcher | TLS, `/pi-history` 308 redirect, and a prefix-preserving reverse proxy with `flush_interval -1`. It also redirects legacy `/s/<id>` links and returns 404 at the root. |
| `.dockerignore` | — | Keeps `.env`, `.git`, `node_modules`, `data`, `test`, `extension` out of the image. |
| `scripts/vendor-web.mjs` | copy list | Copies pinned Marked/DOMPurify builds and licenses into `web/vendor/`. |

## Data Flow

1. `npm ci --legacy-peer-deps --ignore-scripts` installs the dev dependencies (`marked`, `dompurify`, `jsdom`). The service itself needs none.
2. `npm test` runs every `test/*.test.mjs`. The tests open services on port `0` and use `mkdtemp` directories. They close and delete these in `finally`.
3. Deployment builds the image, mounts `history-data` at `/data`, and exposes 9080 only on loopback.
4. Caddy terminates TLS on 80/443, redirects `/pi-history` to `/pi-history/`, forwards under that prefix, and streams SSE without buffering.

## Key Abstractions

- **Fake Pi harness.** Tests hand the extension a plain object with `on`, `registerCommand`, and `appendEntry`, plus a `ctx` with `sessionManager.getBranch` and a scripted `ui`. This exercises real handlers without a Pi process.
- **jsdom with `runScripts: 'outside-only'`.** Tests `eval` the committed browser assets in a simulated page. No network is used.
- **Real HTTP against ephemeral ports.** The service, subpath, and extension tests use `fetch` against a listening service, not a mock.
- **Vendored assets are part of the repository.** `npm run vendor:web` is the only supported refresh path. Production reads the committed files.

## Integration Points

| Consumer | Provider | Mechanism |
|---|---|---|
| Tests | Service | Direct `createService` import plus real HTTP. |
| Tests | Extension | Direct import of `extension/index.ts`. Node 22 strips the types. |
| Tests | Browser assets | `readFileSync` + jsdom `window.eval`. |
| Compose | Image | Environment injection and named volume. |
| Caddy | Service | Reverse proxy on `127.0.0.1:9080`, prefix preserved. |

## Implementation Notes

- Tests assume Node 22.18+ (type stripping and `node:sqlite`). A run on an older Node fails at import.
- Extension tests change `process.env.PI_SHARE_URL`/`PI_SHARE_KEY` and restore them in `finally`. They must not run at the same time as other tests that use those variables.
- The image deliberately excludes `extension/` and `test/`. The service never imports them.
- Do not use Caddy `handle_path` for `/pi-history/*`. It strips the prefix that the service expects.
- After a Marked or DOMPurify version change, update the exact devDependency versions. Then rerun `npm ci` and `npm run vendor:web`. Commit the regenerated assets, their licenses, and the lockfile.
- `deploy/Caddyfile` and the deploy hosts in the README are examples. Replace the hostname before you deploy.

## Verification

Unit tests cover API, persistence, routing, extension lifecycle, drafts, theme, Markdown, viewer modes, and the new-activity count. Browser interaction, real proxies, TLS, and container restarts still require manual verification.
