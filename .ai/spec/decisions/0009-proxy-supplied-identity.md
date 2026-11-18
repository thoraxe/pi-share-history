# 0009 — The service takes a viewer identity from a trusted proxy header

- **Status:** Proposed
- **Date:** 2026-11-18

## Context

A ballot needs one vote per person. The service has no account system (ADR 0006), and the repository forbids a runtime dependency, so an in-process OpenID Connect client, a session store, and a cookie layer are all large additions. A reverse proxy already terminates TLS in every recommended deployment, and every candidate provider (Google, GitHub, cluster SSO) is configured there in the same way.

The alternative is an anonymous browser token. It is small, but it is forgeable, so the ballot result carries no authority.

## Decision

Add `TRUST_PROXY_AUTH`, default off, and `PROXY_AUTH_HEADER`, default `X-Auth-Request-Email`. When the flag is on and the header holds a value, the service attaches that identity to the request. The value is opaque, lowercased, and capped at 320 characters. The service never calls an identity provider, never stores a session, and never sets an identity cookie.

The proxy contract is explicit: strip any inbound copy of the header, set it from the authenticated identity, and leave viewer routes anonymous. Reads never require an identity.

## Consequences

- ADR 0006 keeps its force. The identity does not gate a transcript read, and `constraints.md` rule 11 records that an identity is not access.
- A misconfigured proxy that forwards a client-supplied header defeats the feature. The flag is therefore off by default, and the deployment documentation states the strip rule.
- The service cannot tell Google from GitHub from cluster SSO. Provider choice, callback URLs, and group claims stay in proxy configuration.
- Publisher identity and per-user credentials remain open work in issue #1. This decision supplies the primitive only.
- A self-hoster with no proxy gets no voting. There is no anonymous fallback, because a forgeable vote is worse than no vote.
