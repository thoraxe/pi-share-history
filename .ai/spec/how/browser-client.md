# Browser Client

Three plain scripts plus one HTML shell. There is no framework, no module system, and no bundler. Each script attaches behavior to the DOM or a `window` namespace.

## Module Map

| File | Key Symbols | Responsibility |
|---|---|---|
| `web/index.html` | `data-base-path`, `__BASE_PATH__` | Shell for directory and transcript, all fixed DOM ids used by scripts. |
| `web/theme.js` | `preference`, `render`, `connectButton` | Applied synchronously in `<head>` before stylesheet paint. It cycles and persists the theme. |
| `web/app.js` | `refresh`, `renderBody`, `renderDraft`, `applySearch`, `nodes`, `bodyCache` | Data fetching, node reuse, Markdown toggle, draft panel, follow-live, search. |
| `web/markdown.js` | `window.PiMarkdown.render` | Marked renderer overrides plus a DOMPurify allowlist. It returns `false` on failure. |
| `web/style.css` | `:root[data-theme=…]` tokens | Theme variables, transcript and draft layout. |

## Data Flow

1. `theme.js` reads `localStorage`, computes the effective theme, sets `documentElement.dataset.theme`, and later binds `#theme-toggle`.
2. `app.js` derives `basePath` and the share id from `location.pathname`, then calls `refresh()`.
3. `refresh()` coalesces concurrent calls (`busy`/`again`). It fetches either the directory or one share and reuses DOM nodes by record id.
4. On a transcript, `renderDraft()` runs before records render so the preview and submitted history paint together.
5. `EventSource` receives `update` → `refresh()`, `removed` → clear page, `onerror` → clear draft and show reconnecting.
6. The directory polls every 10 s instead of using SSE (no share id in the URL).
7. Follow-live is recalculated on scroll and re-applied after each render when enabled.

## Key Abstractions

- **Node reuse by record id.** `nodes` maps id → `<article>`. Updates mutate in place, so expansion state and scroll position survive refreshes.
- **Render cache per node.** `bodyCache` is a WeakMap of `{text, useMarkdown}`. `renderBody` stops early when neither value changed, so it does not re-parse Markdown on every SSE tick.
- **Plain text is always populated.** The `<pre>` is updated even when hidden, so the Markdown toggle and search do not need a refetch.
- **Theme preference has three states.** `light`, `dark`, or absent (System). The cycle in `nextPreference` goes from System to the opposite of the current OS theme, then to the OS theme explicitly, then back to System.

## Integration Points

| Consumer | Provider | Mechanism |
|---|---|---|
| `app.js` | Service API | `fetch` with `AbortSignal.timeout(10000)` and `EventSource`. |
| `app.js` | `window.PiMarkdown` | `render(element, text)` returns false when unavailable or failing. |
| `markdown.js` | `window.marked`, `window.DOMPurify` | Loaded from `web/vendor/` with `defer` in a fixed order. |
| `theme.js` | CSS | Writes `data-theme` consumed by `style.css` token blocks. |

## Implementation Notes

- `theme.js` is loaded without `defer` so `data-theme` exists before the first paint and before `style.css` applies. The button binds after DOM ready.
- `defer` scripts execute in document order: marked, DOMPurify, `markdown.js`, then `app.js`. Reordering breaks Markdown rendering.
- Markdown failures are silent by design. `renderBody` uses the always-present `<pre>` instead.
- `renderDraft` owns a timeout sized from the service's `expiresIn`. Every refresh restarts it, and `null` clears the panel.
- Search hides top-level record nodes. Hidden `<pre>` text still counts toward the match.
