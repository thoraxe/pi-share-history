# 0008 — An operator admin key with owner-equivalent powers

- **Status:** Proposed
- **Date:** 2026-11-18

## Context

ADR 0005 gives every share its own owner key and stores only the hash. That decision stops a colleague from tampering with another publisher's transcript. It also leaves no supported owner of last resort. When a publisher loses the Pi owner entry, the share becomes unmanageable. ADR 0005 names the remedy: an administrator deletes the row with a direct database action.

Two further facts make the gap real. The share cap is 1,000 rows and the storage cap is 20 MiB per share, so old shares accumulate until someone removes them. The service operator already has read access to every transcript through `history.sqlite`, so a delete route grants no new read exposure.

## Decision

Add an optional `ADMIN_KEY` environment variable, at least 24 characters. A request that presents it satisfies the owner check on every share. Admin is therefore owner-equivalent for records, draft, stop, revoke, delete, ballot reveal, and ballot cancel. The admin key does not replace the upload key for share creation. When `ADMIN_KEY` is unset, the admin routes return `404`.

The operator surface is one page at `<prefix>/admin/`. It lists every share, including revoked shares, with a delete button per row. The page takes the key from the URL fragment, so the key never reaches the service in a request line and the proxy access log and `Referer` stay clean.

Pruning stays manual. There is no retention timer.

## Consequences

- The operator no longer needs raw SQL to remove a share. `constraints.md` rule 10 changes from "no admin UI" to "no publisher accounts".
- The admin key is a total-control secret. It must be held by fewer people than the upload key, because it can delete a colleague's work. Rotation is an environment change and a service restart.
- Owner key loss stays a delete, not a restore. There is no key rotation and no transfer of a share to a new owner.
- An unset `ADMIN_KEY` keeps the previous behavior exactly, including the `404` on admin routes.
- The page is a single delete button. Any per-share detail, size reporting, or bulk prune is a later decision.
