# Browser Viewer

The viewer is a static single-page client served by the service. It has two modes: a public directory of shares at the prefix root, and a single transcript at `/s/<id>`. It holds no state beyond the browser's local storage.

## Behavioral Rules

### Rendering

1. `/s/<id>` MUST render the transcript title, live/saved status, sync time, and every record in order.
2. The directory MUST list non-revoked shares with title, live indicator, and last-updated time, and MUST refresh every 10 seconds.
3. A transcript page MUST open an SSE connection. It MUST re-fetch the transcript on each `update` event. It MUST use the browser's built-in reconnection on errors.
4. Search MUST filter the currently rendered page by case-insensitive substring match over visible text.
5. Tool and tool-result content MUST be collapsed by default and expandable. Other records MUST be expanded.
6. Errors MUST be marked distinctly and the error message MUST be shown with the record text.
7. Follow-live MUST be on by default, MUST scroll to the newest record, and MUST stop when the user scrolls away from the bottom.

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
24. The viewer MUST derive API and asset URLs from the served base path rather than assuming the domain root.

## Configuration Surface

- `data-base-path` on `<html>` — service-injected route prefix used by all client URLs.
- `pi-share-history-theme` localStorage key — `light`, `dark`, or absent for System.
- `pi-share-history-markdown` localStorage key — `on` or `off`.
- Viewport and `color-scheme: light dark` metadata drive responsive and theme defaults.

## Constraints

- The viewer is read-only: no editing, deleting, or publishing controls exist in the browser.
- It must work with JavaScript from the service only, under a strict CSP that forbids inline script and style.
- Manual browser and network verification is required for interaction and deployment changes. Unit tests cover rendering logic only.

## Planned Changes

| Ticket | Summary |
|---|---|
| — | No planned changes recorded. |
