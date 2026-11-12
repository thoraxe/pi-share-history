---
name: spec-pr
description: Open a spec-only pull request for pi-share-history. Use when adding or changing rules in .ai/spec/, when a GitHub issue needs a spec PR, or when asked to follow the Spec Workflow.
---

# Spec PR

Follow the Spec Workflow in `.ai/spec/README.md`. A spec PR contains spec text only. It does not contain implementation code.

## Read first

Read these files before you edit:

1. `.ai/spec/README.md`: structure, Spec Language, Spec Workflow, and the review checklist.
2. The `what/` file that owns the behavior.
3. `.ai/spec/glossary.md` and `.ai/spec/decisions/`.
4. The GitHub issues for the change: `gh issue view <n> --repo thoraxe/pi-share-history`.
5. The current code and tests that the spec describes. Read `how/` for the code map. Do not edit `how/`.

## Preconditions

- Stop if the working tree is not clean.
- Stop if the issue is unclear. Ask the operator.
- Create `spec/<slug>` from `main`. Do not branch from another spec branch.
- Do not touch unrelated spec branches.

## Write the rules

1. Edit only the `what/` file that owns the behavior. Update `glossary.md` only for a new domain term. Update `decisions/` only for a new architectural choice.
2. Keep every existing rule number. Do not renumber a rule.
3. Insert new rules with sub-numbers of the nearest rule: `22a`, `22b`.
4. Mark each new rule `[PLANNED: #N]`, where N is the issue number. Use `[PLANNED: TICKET-XXXX]` only for a non-issue ticket.
5. Make each rule testable. State the actor, the condition, and the observable result.
6. Keep one behavior per rule. Split a rule that combines unrelated checks.
7. Use `MUST`, `MUST NOT`, `SHOULD`, or `MAY` as the issue requires. Do not change modality.
8. Preserve these contracts unless the issue changes them: read-only viewer, public transcripts, no browser auth, same-origin assets.
9. Record an ambiguity choice in the PR body. Do not invent an unstated behavior.
10. Update the file's Planned Changes table.

## Write in STE

Write all spec text in ASD-STE100 style. Follow the rules in `.ai/spec/README.md`:

- Use the active voice and name the actor.
- Keep sentences at 25 words or fewer.
- Write one idea per sentence.
- Do not use semicolons.
- Keep noun phrases to 3 words or fewer.
- Use simple tenses.
- Put 3 or more steps or conditions in a list.

Self-check the added lines before you commit:

```bash
node -e "
const {execSync}=require('child_process');
const d=execSync('git diff -U0').toString();
const added=d.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1));
console.log('semicolons:', added.join(' ').split(';').length-1);
for(const line of added){let s=line.trim(); if(!s||s.startsWith('|'))continue; s=s.replace(/\[PLANNED: [^\]]+\]/g,'');
for(const sent of s.split(/(?<=[.!?])\s+/)){const w=sent.split(/\s+/).filter(Boolean).length; if(w>25) console.log(w+' WORDS:',sent);}}
"
```

## Commit and open the PR

1. Stage only spec paths: `git add -- .ai/spec/<file>`.
2. Check that `git diff --cached --name-only` shows no code, test, or `how/` path.
3. Commit with `Spec: <summary> (#N, #M)`.
4. Push to the `fork` remote: `git push -u fork <branch>`.
5. Open a PR against `thoraxe:main`: `gh pr create --repo thoraxe/pi-share-history --base main`.
6. Start the title with `Spec:`.
7. Put these sections in the PR body: Summary, Issues covered, Behavior changes, Ambiguity choices, Files, Test plan.
8. Set the test plan to `Spec review only`.
9. Stop. Do not merge. Do not apply `spec:approved`; a human applies it after approval. Do not add `ready-to-merge` and do not enable auto-merge: auto-merge is for implementation PRs only.
10. Report the PR URL and the rule numbers that you added.

## Review checklist

Use the checklist in `.ai/spec/README.md`:

- The change belongs in `what/` or `how/`.
- Each new rule is testable and specific.
- New rules use sub-numbers. No rule is renumbered.
- The text passes the Spec Language rules.
- New terms are in `glossary.md`.
- A new architectural choice has an ADR.
- A `how/` change that alters behavior starts with a `what/` change.
