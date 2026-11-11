# Pi share history — Specifications

Pi share history is a Pi extension plus a small self-hosted service that publishes Pi session history to a public read-only web viewer. A publisher runs `/share` (or `/pishare` on Pi 1.5+) inside Pi. The extension uploads the current branch's records and optional live updates to a team service. The service stores them in SQLite and serves them to browsers over HTTP.

## Structure

| Layer | Path | Purpose |
|---|---|---|
| **what/** | `.ai/spec/what/` | System contracts: HTTP API, record format, share lifecycle, draft contract, viewer behavior, configuration surface. |
| **how/** | `.ai/spec/how/` | Codebase map: service routing and persistence, extension sync loop, browser client, testing and deployment. |

## Scope

Covers the extension (`extension/`), the service (`server/`), the static browser client (`web/`), and the deployment templates (`compose.yaml`, `Dockerfile`, `deploy/`). Out of scope: the Pi agent runtime itself, reverse proxies other than the example Caddyfile, and any team access-control layer (none is implemented).

## Audience

AI agents. Content is written for precision and machine consumption.

## Quick Start

| Task | Start here |
|---|---|
| Understand the system end to end | `what/system-overview.md` |
| Call or extend the HTTP API | `what/http-api.md` |
| Change record capture or privacy filtering | `what/record-format.md` |
| Change share start/stop/revoke/delete behavior | `what/share-lifecycle.md` |
| Work on the ephemeral draft feature | `what/drafts.md` |
| Change the browser viewer, theme, or Markdown rendering | `what/browser-viewer.md` |
| Find where service code lives and why | `how/server.md` |
| Find where extension sync code lives | `how/extension-sync.md` |
| Find where browser code lives | `how/browser-client.md` |
| Run tests, vendor assets, or deploy | `how/testing-and-deployment.md` |

## Cross-Reference

| what/ | how/ |
|---|---|
| `what/system-overview.md` | `how/project-structure.md` |
| `what/http-api.md` | `how/server.md` |
| `what/record-format.md` | `how/extension-sync.md`, `how/server.md` |
| `what/share-lifecycle.md` | `how/extension-sync.md` |
| `what/drafts.md` | `how/extension-sync.md`, `how/browser-client.md` |
| `what/browser-viewer.md` | `how/browser-client.md` |
| `what/constraints.md` | `how/testing-and-deployment.md` |

## Conventions

- **Rule numbering:** behavioral rules are numbered sequentially within each what/ file. Numbers are stable identifiers — do not renumber when a rule is removed (leave a gap) or inserted (use sub-numbers like 16a, 16b).
- **Planned changes lifecycle:** unimplemented behavior is marked `[PLANNED]` or `[PLANNED: TICKET-XXXX]` inline next to the rule it affects. When implemented, update the text and change the marker to `[DONE: TICKET-XXXX]`.
- **Constraints:** component-specific constraints live in the relevant what/ file's Constraints section. Cross-cutting project-wide rules live in `constraints.md`. Development conventions live in `AGENTS.md`.
- **Authority:** what/ specs are authoritative for behavior. how/ specs are authoritative for implementation. When they conflict, what/ wins.
- **New file vs. extension:** a concern with its own lifecycle, configuration surface, and independent meaning gets its own file. A capability added to an existing component goes in that component's file.

## Spec Language

All spec text uses ASD-STE100 (Simplified Technical English) in STE-flavored mode. Specs are descriptive prose, so the structural rules apply in full and the lexical rules are a preference. The goal is text that a reviewer reads once and cannot misread. This is a writing guide, not a certified STE document, and it does not include the official ASD dictionary.

1. Use the active voice. Name the actor.
2. Keep sentences at or below 25 words. Split longer sentences.
3. Write one idea or one instruction per sentence.
4. Do not use semicolons. Write two sentences instead.
5. Keep noun phrases to 3 words or fewer.
6. Keep the subject, verb, and article. Do not drop words to save space.
7. Use simple tenses: imperative, simple present, simple past, simple future. Do not use the present perfect.
8. Keep modality. Do not change "may", "can", or "should" into a fact.
9. Use the verb, not a noun form of the verb. Write "analyze the log", not "perform an analysis of the log".
10. Avoid phrasal verbs. Write "start", not "spin up". Write "remove", not "take off".
11. Do not use marketing adjectives such as seamless, robust, or powerful.
12. Use one word for one meaning in a file. Add domain terms to `glossary.md`.
13. Put a sequence of 3 or more steps or conditions in a list.
14. Keep one topic per paragraph and 6 sentences or fewer per paragraph.

Exceptions:

- Keep a compound tense when it carries meaning the simple tense cannot. For example, "may have failed" is a hedge, not a fact.
- Code, identifiers, file paths, and quoted strings do not follow these rules.
- Prefer clarity over the shortest possible sentence. Stop when the sentence is unambiguous.

Source: [asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill). The official ASD-STE100 standard and its dictionary are free to obtain and not redistributable. Treat them as the source of truth for approved wording.

Review each spec change against these rules before you commit it.

## Spec Workflow

The spec is the contract. Build implementation against an approved spec, not the other way around.

1. Open a ticket for the change. Use its ID in the spec.
2. Create a branch for the spec change, for example `spec/<slug>`.
3. Edit the `what/` file that owns the behavior. Add or change the rules. Mark new behavior `[PLANNED: TICKET-XXXX]`.
4. Update `constraints.md`, `glossary.md`, or `decisions/` when the change needs them.
5. Open a pull request (PR) that contains only spec changes. Do not mix implementation into the same PR.
6. Request review against the checklist below.
7. Apply the `spec:approved` label when the review passes. A spec PR without this label is not a build target.
8. Merge the spec PR before implementation starts.
9. Build the implementation against the merged spec. The implementation PR must link the spec PR.
10. When the behavior ships, change each marker to `[DONE: TICKET-XXXX]`.
11. If reality must differ from the spec, change the spec first. Do not merge behavior that the spec does not describe.
12. Remove done markers in a later cleanup pass.

### Labels

| Label | Meaning |
|---|---|
| `spec:draft` | Work in progress. Review not requested. |
| `spec:approved` | Approved. Implementation may start. |
| `spec:blocked` | On hold. Do not implement. |

### Review checklist

- The change belongs in what/ or how/.
- Each new rule is testable and specific.
- New rules use sub-numbers. No existing rule is renumbered.
- The text passes the Spec Language rules.
- New terms are in glossary.md.
- A new architectural choice has an ADR in decisions/.
- A `how/` change that alters behavior starts with a `what/` change.

## Architectural decisions

Recorded in `decisions/`, using `NNNN-slug.md` with Status, Context, Decision, Consequences.
