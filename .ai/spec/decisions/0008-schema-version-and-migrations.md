# 0008 — Schema version and ordered migrations

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

The service creates its tables with `CREATE TABLE IF NOT EXISTS`. A released database and a newer service have no way to detect each other. The first column change, index change, or backfill would run against an unknown schema.

## Decision

Store one integer schema version in `PRAGMA user_version`. Apply the pending migrations in order inside one transaction at startup. Refuse a database whose version is newer than the service version, and name both versions in the error.

## Consequences

- Every schema change needs a new migration and a version increment.
- A failed migration rolls back, so the service starts only with the previous schema or not at all.
- A downgrade fails at startup instead of serving data from an unknown schema.
- The project keeps a fixture database for each released schema version, so the migration path stays tested.
