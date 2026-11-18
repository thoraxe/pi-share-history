# 0001 — Dependency-free Node service with built-in SQLite

- **Status:** Accepted
- **Date:** 2025-11-10

## Context

The project needs a small self-hosted sharing service that a team can run from Docker Compose with minimal operational work. It is a low-traffic internal tool, not a multi-tenant product.

## Decision

Implement the service with `node:http` and `node:sqlite`, no framework or ORM, and require Node 22.18+. Ship the browser client as static files that the service reads into memory at startup.

## Consequences

- Production needs no `npm install` or build step. The image copies only `package.json`, `server/`, and `web/`.
- Routing, validation, and persistence are hand-written and must be kept consistent as the API grows.
- The project is pinned to a Node version whose SQLite module was still experimental.
