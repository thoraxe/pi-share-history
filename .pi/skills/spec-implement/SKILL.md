---
name: spec-implement
description: Implement an approved pi-share-history spec. Use when building code against a merged spec PR, changing server/, extension/, web/, or tests, or converting PLANNED markers to DONE.
---

# Spec implementation

Build against the approved spec. The spec is the contract. Do not merge behavior that the spec does not describe.

## Preconditions

Stop and report when either condition is false:

1. The spec PR is merged.
2. The spec PR has the `spec:approved` label.

Check with:

```bash
gh pr view <spec-pr> --repo thoraxe/pi-share-history --json state,labels,mergedAt
```

## Read first

1. The `what/` file with the new rules. Note each rule number and marker.
2. The matching `how/` file. It maps the current code.
3. `AGENTS.md` and `.ai/spec/constraints.md`.
4. The tests for the changed behavior, under `test/`.

## Plan

1. Create `impl/<slug>` from `main`. Include the merged spec.
2. Map each new rule to a code change and a test. Write the mapping down before you edit.
3. If a rule is impossible or wrong, stop. Change the spec first in a separate PR. Do not code around the spec.

## Implement

1. Keep the stack. Do not add a bundler, framework, or CDN dependency. Do not add Markdown rendering in the service.
2. Keep Node 22.18+ support. Use `node:test`, jsdom, and real HTTP on ephemeral ports for tests.
3. Keep the viewer read-only. Keep transcripts public by default. Do not add browser credentials.
4. Serve browser assets from the service origin only.
5. Write or update a test for each new rule. Update an existing test when the rule changes that behavior. Do not delete coverage.
6. Run `npm test` before you commit.
7. If a vendored browser library changes, run `npm run vendor:web`. Commit `web/vendor/` and the lockfile.
8. Change each shipped marker from `[PLANNED: #N]` to `[DONE: #N]` in the same PR.
9. Update the `how/` file when the code map changes. Keep `what/` unchanged unless the spec is wrong.

## Verify

Check each changed rule against its test:

- The test fails without the change.
- The test passes with the change.
- The test checks the observable behavior, not an implementation detail.

Run the full suite. Report the count of pass and fail.

## Commit and open the PR

1. Stage the code, test, spec marker, and `how/` changes. Do not stage unrelated files.
2. Commit with a message that names the behavior, for example `Group tool activity per turn (#3)`.
3. Push to the `fork` remote.
4. Open a PR against `thoraxe:main`.
5. Link the spec PR in the body.
6. Put these sections in the body: Summary, Spec PR, Rules implemented, Tests, Manual checks.
7. List each rule number next to its code change and its test.
8. Report the manual checks that need a browser. Unit tests cover rendering logic only.
9. Do not merge without review.

## Guardrails

- Use one spec change per implementation PR.
- Do not mix an unrelated fix into the PR.
- Do not edit `what/` rules to match the code. Edit the code to match the rules.
- Do not add a secret to the repo or a transcript.
- Do not weaken CSP, same-origin, or read-only behavior.
