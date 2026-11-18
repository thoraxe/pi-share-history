# Project Structure

The repository is one npm package (`type: module`) that ships a Pi extension, a dependency-free Node HTTP service, and a static browser client. There is no bundler and no HTTP framework.

## Module Map

| File/Directory | Key Symbols | Responsibility |
|---|---|---|
| `extension/index.ts` | default extension factory, `piHasBuiltInShare`, `detectPiHasBuiltInShare` | Registers share commands, captures session events, queues and flushes records, polls editor drafts, and persists owner state. |
| `extension/records.mjs` | `content`, `messageRecord`, `toolRecord` | Allowlist mapping from Pi messages/tool events to publishable records, plus truncation. |
| `server/index.mjs` | `createService`, `body`, `notify`, `publicDraft` | HTTP routing, auth, SQLite schema and queries, SSE fan-out, draft TTL, quota enforcement, static asset serving. |
| `web/app.js` | `refresh`, `renderTranscript`, `buildUnits`, `applyView`, `renderBody`, `renderDraft` | Directory and transcript rendering, Read/Advanced modes, tool groups, SSE-driven refresh, follow-live, search, Markdown toggle wiring. |
| `web/markdown.js` | `window.PiMarkdown.render` | Marked + DOMPurify setup with escaped HTML, image placeholders, fixed tag/attribute allowlist. |
| `web/theme.js` | theme IIFE, `nextPreference` | Applies stored/system theme before paint, cycles themes, syncs tabs. |
| `web/index.html` | `data-base-path`, `__BASE_PATH__` placeholders | Single HTML shell for both directory and transcript routes. |
| `web/style.css` | theme tokens, layout classes | Light/dark token sets keyed on `data-theme`, transcript layout, draft panel. |
| `web/vendor/` | `marked.umd.js`, `purify.min.js`, licenses | Pinned third-party browser libraries committed for offline serving. |
| `scripts/vendor-web.mjs` | copy loops | Reproduces `web/vendor/` from pinned devDependencies. |
| `test/*.test.mjs` | `node:test` cases | Service API, subpath routing, extension lifecycle, records, drafts, theme, Markdown, viewer modes. |
| `compose.yaml`, `Dockerfile` | `history` service, volume `history-data` | Container build and localhost-bound deployment. |
| `deploy/Caddyfile` | site block, legacy redirect | TLS termination and prefix-preserving reverse proxy template. |

## Key Entry Points

- Service process: the bottom block of `server/index.mjs` reads `DATA_DIR`, `UPLOAD_KEY`, `PUBLIC_URL`, `PORT`, and `HOST`. It creates the service, starts the listener, and closes on `SIGINT`/`SIGTERM`.
- Extension: Pi calls the default export of `extension/index.ts` with the `ExtensionAPI`. It registers events and commands, then returns after the version check.
- Browser: `web/index.html` loads `theme.js` synchronously in `<head>` and defers the rest. `app.js` starts `refresh()` immediately and opens SSE when the path matches `/s/<id>`.
- Tests: `npm test` runs `node --test test/*.test.mjs`. The tests import `createService` directly or load web modules into jsdom.

## Naming Conventions

- ESM everywhere. Server and extension helpers are small top-level functions, not classes.
- Share ids and owner keys are 24 random bytes encoded as base64url (32 characters). The service stores only hashes of owner keys.
- Record ids are namespaced by prefix: `message:`, `result:`, `tool:`, `branch:`, and `entry:`.
- Custom Pi entries are namespaced strings that end with a version, e.g. `pi-share-history-owner-v1`.
- Browser globals are namespaced as `window.PiMarkdown`. The theme and app modules are IIFEs or top-level scripts with no exports.
