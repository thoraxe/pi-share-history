# 0010 — Blind ballots persist in SQLite and hide the tally in the payload

- **Status:** Proposed
- **Date:** 2026-11-18

## Context

The owner wants a "pointing poker" vote on a choice that the assistant offered mid-session. Three properties drive the design. The result must be visible days later, so the ballot cannot expire. The tally must stay hidden until the owner reveals it, so the backend must conceal it and not only the page. The viewer has no write path today, because ADR 0006 makes it read-only.

ADR 0003 put drafts in process memory with an 8-second TTL. That pattern fits a preview of unsent editor text. It does not fit votes that the owner must read after `/share stop`, a save, or a restart.

## Decision

Store ballots and votes in SQLite in two tables that cascade on share delete. A ballot has one anchor record, 2 to 8 options, and a state of `open` or `revealed`. A vote has one voter identity and one option index, and it is unique per ballot and identity.

The share payload carries the ballot. While the ballot is open the payload holds the options, the turnout, and the requesting viewer's own choice. It does not hold a tally or another voter's identity. After the reveal it holds the tally and the voter list.

Votes lock at the reveal and cannot change. The owner or the admin key reveals. The reveal is idempotent and permanent.

The vote route is the only viewer write in the system. It needs a trusted proxy identity and does not accept a Bearer credential. `system-overview.md` rule 6 and `constraints.md` rule 1 change to describe this one exception.

## Consequences

- A ballot survives a restart, `/share stop`, and the share going saved. It requires no live share and no publisher connection.
- The payload filter is the contract. A UI bug cannot leak the tally, and a page that ignores the filter still gets nothing.
- Blindness stops at the database. The admin key and direct SQL show every vote. The feature must never claim a secret ballot.
- A voter cannot fix a misclick. This is the accepted cost of a simple, final record.
- Every write change adds one row to the store and one `update` event. The 1,000-share and 20 MiB caps stay unchanged, and ballots are not counted against them.
- The viewer now has a write path, a CSRF surface, and a spam surface. The identity requirement and the one-vote rule are the only protections. Rate limiting is a later decision.
