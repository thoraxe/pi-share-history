# 0005 — Per-share owner keys separate from the team upload key

- **Status:** Accepted
- **Date:** 2025-11-10

## Context

A single upload key that could modify or delete any share would let any publisher tamper with a colleague's transcript. Full accounts and a login system would add substantial complexity to a small internal tool.

## Decision

Share creation returns the team-key-authorized share plus a freshly generated 24-byte owner key. The service stores only `sha256(ownerKey)` in `shares.owner` and requires the owner key as a Bearer token for records, drafts, stop, revoke, and delete. The extension persists the owner key as a Pi custom entry and excludes that entry from uploads. Saved endpoints migrate only within the same origin.

## Consequences

- The upload key can create shares. It cannot affect existing shares. Rotation stops new shares and does not invalidate owners.
- Losing the owner entry means losing control of a share until an administrator deletes it from the service with a direct database action.
- Branching to before the owner entry creates a new share instead of recovering the old one.
