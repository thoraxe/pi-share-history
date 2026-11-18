# 0007 — Publish model thinking in Advanced mode

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

A transcript is read at two levels. Read mode serves the conversation. Advanced mode serves a reader who wants to understand how a turn was produced, which includes the model's reasoning.

Until now the extension discarded thinking blocks and replaced each one with the text `[thinking omitted]`. That text sits inside the assistant message body. It reached the viewer as content, so Read mode showed bubbles that held only the marker. On one measured session, 106 of 161 assistant records were placeholder-only.

Pi's thinking display is a view flag on the assistant message component. It does not change the stored message. The extension discarded the text by its own allowlist rule, not because the text was absent.

## Decision

The extension publishes a model thinking block in a `thinking` field on the `assistant` record. It never adds thinking text to `text`. Read mode does not show `thinking`. Advanced mode shows it with the record, and may start it collapsed. The extension still drops thinking signatures, provider signatures, and image data.

Publication is not opt-in. A publisher who starts a share publishes thinking, the same way it publishes prompts and tool output. The publish confirmation names thinking, and the README states it.

## Consequences

- Reasoning becomes public with no redaction, as the project's public-by-default constraint already states for every other record field. Thinking can contain speculation, credentials, or internal detail. The confirmation dialog is the only protection.
- A tool-only turn now has empty `text` and non-empty `thinking`. Read mode hides it under rule 7b1, so the placeholder bubbles disappear. Advanced mode shows the record with its reasoning.
- Shares grow. Thinking is capped at 24,000 characters per record, like `text`.
- A re-upload rewrites existing records because ids are stable. Old shares gain thinking on the next upload, and their `[thinking omitted]` markers disappear.
- Search in Read mode cannot reach thinking text, because the element is not rendered.
- The decision is hard to reverse for an already published share. Stored thinking stays public until the share is deleted or the record is overwritten without it.
