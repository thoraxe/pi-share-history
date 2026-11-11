# 0002 — Render Markdown in the browser only, from vendored libraries

- **Status:** Accepted
- **Date:** 2025-11-11

## Context

Transcripts contain user and assistant messages that are far more readable as Markdown. Rendering in the service would alter stored text, require a sanitizer in the service, and risk trusting publisher content during upload. A CDN would add a third-party dependency and leak viewer requests.

## Decision

Store and serve original text unchanged. Render and sanitize in the browser with pinned Marked and DOMPurify builds. Commit the builds under `web/vendor/`. Escape raw HTML, replace images with text, and use a fixed tag/attribute allowlist. Show plain text if either library is missing or fails.

## Consequences

- The API and database remain exact text. Toggling Markdown is presentation-only.
- The deployment must serve the vendored assets, and updates require `npm run vendor:web` plus a commit.
- Strict CSP compatibility requires external scripts and no inline handlers.
