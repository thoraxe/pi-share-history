# Project

Pi share history — a Pi extension plus a self-hosted Node service that publishes Pi session history to a public read-only browser viewer.

## Specs

All specifications live in `.ai/spec/`. Start with `.ai/spec/README.md` for the project overview, reading order, and structure guide. Behavior contracts are in `.ai/spec/what/`. Codebase maps are in `.ai/spec/how/`.

Write and review spec text in ASD-STE100 style. See the "Spec Language" section in `.ai/spec/README.md`.

Spec changes follow the Spec Workflow in `.ai/spec/README.md`.

## Review and merge

- A pull request is ready when a code review reports no P0 and no P1 findings.
- Add the `ready-to-merge` label to a ready pull request.
- Enable auto-merge (squash) on the same pull request. Do not merge a pull request that lacks the label.
- Merge the spec pull request first. Rebase the implementation branch onto `main` after the spec lands, because the branch no longer needs the spec change.

## Development

- Node 22.18+ (`node:sqlite`, TypeScript type stripping). The service needs no dependencies.
- Install test dependencies: `npm ci --legacy-peer-deps --ignore-scripts`
- Run tests: `npm test` (all tests use `node:test`, jsdom, and real HTTP on ephemeral ports)
- Run the service locally: `UPLOAD_KEY=<24+ chars> PUBLIC_URL=http://localhost:9080 npm start`
- Run the extension against it: `PI_SHARE_URL=http://localhost:9080 PI_SHARE_KEY=<key> pi --extension ./extension/index.ts`
- Refresh committed browser libraries after version bumps: `npm run vendor:web`, then commit `web/vendor/` and the lockfile.
- Do not add a bundler, framework, CDN dependency, or Markdown rendering in the service.
