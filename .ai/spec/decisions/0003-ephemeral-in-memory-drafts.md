# 0003 — Keep draft previews in memory with short TTLs

- **Status:** Accepted
- **Date:** 2025-11-11

## Context

Pair programming benefits from seeing what the other person is typing before they send it. Storing drafts as transcript records would corrupt history ordering, survive restarts, and create sensitive artifacts that outlive the conversation.

## Decision

Drafts live in a `Map` in the service, keyed by share id. They never touch SQLite. They expire 8 seconds after the last update. They are cleared on stop, revoke, delete, or a non-live upload. The extension samples the editor every 400 ms and renews visible drafts every 2 seconds. Publishing drafts is a separate opt-in with its own confirmation.

## Consequences

- Draft text is never durable and cannot be recovered after a crash — by design.
- The revision field prevents out-of-order updates from resurrecting stale text.
- Viewers can still copy any preview they see. The UI labels previews as unsent and temporary.
