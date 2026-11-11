# 0006 — Public-by-default sharing with no viewer authentication

- **Status:** Accepted
- **Date:** 2025-11-10

## Context

The primary use case is a link that opens immediately in a browser. The teammate may use a phone or a machine without the upload key. Adding viewer accounts would require identity, sessions, and administration that the project deliberately avoids.

## Decision

The directory and every non-revoked share are readable without credentials. Access restriction is an operational concern: run the service behind a VPN or an authenticated reverse proxy. Keys authorize writes only. The UI and documentation state plainly that transcripts are public and unredacted.

## Consequences

- A leaked viewer link is equivalent to a public page. Revocation is the only remedy, and it cannot retract copies already downloaded.
- Prompts, code, tool arguments, and command output may contain secrets. The system does not scan them.
- Team access control, per-viewer permissions, or end-to-end encryption would require a separate design.
