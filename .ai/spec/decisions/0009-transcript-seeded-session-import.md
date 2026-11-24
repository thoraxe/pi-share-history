# 0009 — Transcript-seeded session import

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

A public share holds a readable transcript. It does not hold a replayable Pi session. The upload allowlist removes system prompts, tool call structure, images, thinking signatures, and local paths.

A publisher can continue the work only by copying text by hand. A faithful fork needs a new private snapshot on the service. That snapshot conflicts with the public-by-default rule.

## Decision

Build the new local session from the public record text. User and assistant records become messages, other records become text-only custom messages, and the import marker names the source share.

## Consequences

- The import works with the current public payload and needs no service change.
- The imported session is a readable transcript, not a faithful fork. It has no system prompt, tool call structure, images, or signatures.
- Each imported custom message sets its `customType` to the canonical share URL. The model sees the text as user context.
- The import does not start an agent turn.
- The import has a fixed record limit. A large share fails as a whole, so a partial session never looks complete.
- A later `start` or `upload` creates a new share and a new owner key.
