# Browser Client

Three plain scripts plus one HTML shell. There is no framework, no module system, and no bundler. Each script attaches behavior to the DOM or a `window` namespace.

## Module Map

| File | Key Symbols | Responsibility |
|---|---|---|
| `web/index.html` | `data-base-path`, `__BASE_PATH__` | Shell for directory and transcript, all fixed DOM ids used by scripts. |
| `web/theme.js` | `preference`, `render`, `connectButton` | Applied synchronously in `<head>` before stylesheet paint. It cycles and persists the theme. |
| `web/app.js` | `refresh`, `renderTranscript`, `buildUnits`, `applyView`, `visibleText`, `renderBody`, `renderDraft` | Data fetching, node reuse, Read/Advanced modes, record roles, tool groups, Markdown toggle, draft panel, follow-live, search. |
| `web/markdown.js` | `window.PiMarkdown.render` | Marked renderer overrides plus a DOMPurify allowlist. It returns `false` on failure. |
| `web/style.css` | `:root[data-theme=…]` tokens | Theme variables, transcript and draft layout. |

## Data Flow

1. `theme.js` reads `localStorage`, computes the effective theme, sets `documentElement.dataset.theme`, and later binds `#theme-toggle`.
2. `app.js` derives `basePath` and the share id from `location.pathname`, then calls `refresh()`.
3. `refresh()` coalesces concurrent calls (`busy`/`again`). It fetches either the directory or one share and reuses DOM nodes by unit key (see `buildUnits`).
4. `renderTranscript()` calls `buildUnits()`. It turns consecutive `tool`, `toolResult`, and `bashExecution` records into one `tool-group` unit. Other records become one message unit each.
5. `applyView()` sets node visibility from the mode and the search query. It does not fetch, remove nodes, or scroll.
6. On a transcript, `renderDraft()` runs before records render so the preview and submitted history paint together.
7. `EventSource` receives `update` → `refresh()`, `removed` → clear page, `onerror` → clear draft and show reconnecting.
8. The directory polls every 10 s instead of using SSE (no share id in the URL).
9. Follow-live is recalculated on scroll and re-applied after each render when enabled.

## Key Abstractions

- **Node reuse by unit key.** `nodes` maps a unit key → `<article>`. A message unit uses `record:<id>`. A tool group uses `group:<first record id>`, so a live append extends the same row. Updates mutate in place, so expansion state and scroll position survive refreshes.
- **Insert only when needed.** `renderTranscript` and `updateGroupNode` insert a node only when it is new or when it does not already follow its predecessor. A re-insert would remove and re-add the node, which drops focus and the text selection on every refresh. A record `<article>` and a group `<article>` are keyboard-focusable so Read mode can reveal their metadata.
- **Render cache per node.** `bodyCache` is a WeakMap of `{text, useMarkdown}`. `renderBody` stops early when neither value changed, so it does not re-parse Markdown on every SSE tick.
- **Plain text is always populated.** The `<pre>` is updated even when hidden, so the Markdown toggle and search do not need a refetch.
- **Mode is a page attribute.** `data-mode` on `<html>` is `read` or `advanced`. CSS hides metadata with `opacity` and reveals it on hover or `:focus-within`, so the layout and the accessibility tree do not change.
- **Tool group internals.** Each group is one `<details>`. Each step is a nested `<details>` with `data-kind`. The step summary holds `.tool-step-label` and a `.meta` span. The metadata sits inside the summary because a closed step does not render its body. The row summary carries the step count, tool names, and a failed warning. A `.tool-failure` notice shows in Read mode. A record without a label, or with a label equal to its kind, uses a neutral name: `bash` for a `bashExecution` record, and `Tool` otherwise. A failed group also carries its own `.meta` chip from the first failed record, because Read mode renders the group with the row closed. The group `<article>` is keyboard-focusable and reserves the metadata band, so the chip reveals on hover or focus without a layout change. The group chip is hidden when no step failed, because each step then shows its own metadata.
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
- Search hides top-level unit nodes and matches only visible text. `visibleText` skips a hidden element, skips the metadata chip in Read mode, and reduces a closed disclosure to its summary. A record renders its `.label` only when that label differs from the kind, and it renders its Markdown body instead of its `<pre>` while Markdown is on. Visible text therefore includes the fixed `You` marker and, in Advanced mode, the row summary. Hidden text never matches.
- An Advanced choice persists in `pi-share-history-advanced`. The key is `on` for Advanced. The key is absent for Read mode.
