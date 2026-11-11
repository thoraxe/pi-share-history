# 0004 — Register /pishare always and /share only where it is free

- **Status:** Accepted
- **Date:** 2025-11-11

## Context

Pi 1.5 introduced its own `/share` command (Radius artifact or GitHub gist) and intercepts a bare `/share` before extension dispatch. Registering `/share` there produces a startup warning and a command whose meaning differs from this project's.

## Decision

Register `/pishare` unconditionally and register `/share` only when the Pi `VERSION` export is below 1.5 or cannot be read. Both names share the same handler object and produce identical output.

## Consequences

- Users on Pi 1.5+ must type `/pishare`. The documentation must explain the alias.
- Undetectable versions use the historical `/share`. That may warn on new Pi rather than disappear.
- The version check imports the Pi package dynamically inside a `try/catch`, so the extension still loads when the peer dependency is absent.
