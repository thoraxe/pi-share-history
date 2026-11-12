# Browser Viewer

The viewer is a static single-page client served by the service. It has two page types: a public directory of shares at the prefix root, and a single transcript at `/s/<id>`. It holds no state beyond the browser's local storage. A transcript has two view modes: Read mode and Advanced mode. Read mode is the default.

## Behavioral Rules

### Rendering

1. `/s/<id>` MUST render the transcript title, live/saved status, sync time, and every record in order.
1b. The header MUST show the share state as a dot and a state word. The state word MUST read `Live` for a live share and `Saved` for a saved transcript. [PLANNED: #6]
1c. The share state MUST NOT include the sync time. The header MUST show the sync time as its own text next to the share state. [PLANNED: #6]
2. The directory MUST list non-revoked shares with title, live indicator, and last-updated time, and MUST refresh every 10 seconds.
3. A transcript page MUST open an SSE connection. It MUST re-fetch the transcript on each `update` event. It MUST use the browser's built-in reconnection on errors.
4. Search MUST filter the currently rendered page by case-insensitive substring match over visible text.
5. Tool and tool-result content MUST be collapsed by default and expandable. Other records MUST be expanded.
6. The viewer MUST mark an error record with a distinct visual style. The viewer MUST show the error message with the record text when the viewer shows the record body.
7. Follow-live MUST be on by default, MUST scroll to the newest record, and MUST stop when the user scrolls away from the bottom.

### Read mode

7a. The viewer MUST keep Advanced mode off on the first visit. The viewer MUST remember the choice in that browser. [DONE: #2]
7b. Read mode MUST show `user` prompts, `assistant` replies, errors, and `notice` records. Read mode MUST hide every other record. [DONE: #2]
7c. Advanced mode MUST show every record in the transcript. This set includes `tool` records, `toolResult` records, `bashExecution` records, summaries, and metadata. [DONE: #2]
7d. The viewer MUST show an error record in Read mode and in Advanced mode. A mode change MUST NOT hide an error record. [DONE: #2]
7e. A mode change MUST NOT fetch data again. It MUST NOT remove a record from the DOM. It MUST keep the scroll position. [DONE: #2]

### Record roles

7f. Each rendered record MUST expose its role in the DOM with a `data-kind` attribute. The attribute value MUST equal `record.kind`. The viewer MUST NOT derive the role from text. [DONE: #4]
7g. Each role MUST have a distinct visual style. A prompt, a reply, an error, a notice, and a summary MUST look different. [DONE: #4]
7h. A `user` prompt MUST show a `You` label and a tinted background. An `assistant` reply MUST show as plain prose. An error MUST show as an inline notice. A summary MUST show as subdued text. [DONE: #4]
7i. A record MUST NOT use a raw kind name as a heading. The viewer MUST NOT show a generic label such as "Content / output". [DONE: #4]
7j. Markdown text, code blocks, and tables MUST render in both themes. This rule applies to `user` and `assistant` records. [DONE: #4]

### Tool groups

7k. Consecutive `tool`, `toolResult`, and `bashExecution` records between two messages MUST render as one disclosure row. [DONE: #3]
7l. The row summary MUST show a step count and the tool names from `record.label`. Example: `4 steps · read, edit, bash ×2`. [DONE: #3]
7m. An open row MUST list each step with its tool name and its status. The body of each step MUST stay collapsed until the user opens it. [DONE: #3]
7n. A failed step MUST add a warning to the row summary whenever the viewer shows the row. The viewer shows the row only in Advanced mode. Read mode MUST show a one-line notice that names each failed step. [DONE: #3]
7o. Grouping MUST keep each row stable across live appends. A live append MUST NOT duplicate a row. A live append MUST NOT reorder a row. [DONE: #3]

### Metadata

7p. Read mode MUST hide the timestamp, the model, and the status at rest. [DONE: #5]
7q. Read mode MUST hide the metadata at rest without removing it from the page. Read mode MUST reveal the metadata on hover and on keyboard focus. Advanced mode MUST show the metadata at rest. [DONE: #5]
7r. The viewer MUST NOT change the layout when the metadata appears. The metadata MUST stay in the accessibility tree. [DONE: #5]

### Live updates

7u. The viewer MUST show a new-activity pill when records that the current view mode shows arrive while the user is away from the bottom. The viewer MUST hide the pill when the count is zero or when the user reaches the bottom. [PLANNED: #6]
7v. The viewer MUST NOT change the scroll position when the new-activity pill appears or disappears. [PLANNED: #6]
7w. The new-activity pill MUST show the count of records that the current view mode shows and that arrived after the user left the bottom. [PLANNED: #6]
7x. The new-activity pill MUST appear in Read mode and in Advanced mode. [PLANNED: #6]
7y. One activation of the new-activity pill MUST scroll to the bottom and MUST resume follow-live. [PLANNED: #6]
7z. The viewer MUST NOT animate the new-activity pill when the user requests reduced motion. [PLANNED: #6]
7aa. The new-activity pill MUST be reachable and operable with the keyboard. [PLANNED: #6]
7ab. When the count changes, the viewer MUST announce the new count to assistive technology. [PLANNED: #6]
7ac. The new-activity pill MUST appear at the bottom of the viewport. [PLANNED: #6]

### Markdown

8. Markdown rendering MUST apply only to `user` and `assistant` messages, and MUST be enabled by default.
9. The header toggle MUST switch between formatted and original text. It MUST apply the change to rendered messages and to streaming updates. It MUST remember the choice in that browser.
10. Raw HTML MUST be escaped, not interpreted. Rendered output MUST be sanitized to a fixed set of structural tags and the `href`, `title`, `start`, and `align` attributes.
11. Images MUST be replaced with a text placeholder so no tracking or network requests occur.
12. Tool output and draft previews MUST always render as plain text.
13. Rendering MUST happen only in the browser. Stored records and API responses MUST remain the original text.
14. If the Markdown parser or sanitizer is unavailable or throws, the viewer MUST show plain text.
15. Markdown libraries MUST come from the service's own origin. No CDN or remote asset may be used.

### Theme

16. The viewer MUST default to the system color scheme and MUST follow OS theme changes while in System mode.
17. The Theme button MUST cycle light → dark → System, showing the effective theme while in System mode.
18. An explicit theme choice MUST be remembered in that browser and MUST override OS changes.
19. A saved theme MUST be applied before first paint to avoid flashing the wrong theme, and changes MUST synchronize across tabs.
20. Blocked or unavailable local storage MUST NOT break the controls. The page MUST keep working with page-local defaults.

### Navigation and errors

21. A `404` on a transcript MUST clear the page, stop live updates, and explain that the transcript was deleted, revoked, or not found.
22. A `removed` SSE event MUST clear the transcript and report revocation or deletion.
23. A connection error MUST clear any draft preview and show a reconnecting status.
23a. A `404`, a `removed` event, or a reconnect MUST hide the new-activity pill and reset the count. [PLANNED: #6]
24. The viewer MUST derive API and asset URLs from the served base path rather than assuming the domain root.

## Configuration Surface

- `data-base-path` on `<html>` — service-injected route prefix used by all client URLs.
- `pi-share-history-theme` localStorage key — `light`, `dark`, or absent for System.
- `pi-share-history-markdown` localStorage key — `on` or `off`.
- `pi-share-history-advanced` localStorage key — `on` for Advanced mode, or absent for Read mode.
- Viewport and `color-scheme: light dark` metadata drive responsive and theme defaults.

## Constraints

- The viewer is read-only: no editing, deleting, or publishing controls exist in the browser.
- It must work with JavaScript from the service only, under a strict CSP that forbids inline script and style.
- Manual browser and network verification is required for interaction and deployment changes. Unit tests cover rendering logic only.

## Planned Changes

| Ticket | Summary |
|---|---|
| #6 | Live updates that do not interrupt the user: compact share state and a new-activity pill. |
