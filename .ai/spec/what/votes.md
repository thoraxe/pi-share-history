# Blind Ballots

A ballot asks the signed-in viewers of one share to choose one option. The owner opens it from a Pi command after an assistant message that offers choices. Viewers vote without seeing the distribution. The owner reveals the result. This file is the contract for the ballot feature. The HTTP shapes live in `http-api.md`.

## Behavioral Rules

### Opening

1. A ballot MUST belong to one share and to one record of that share.
2. The owner key or the admin key MUST open a ballot.
3. The owner MUST open a ballot from Pi with `/share vote "<option>" "<option>" ...`. The extension MUST NOT read the options from the assistant message.
4. A ballot MUST have 2 to 8 options. An option MUST contain at most 200 characters.
4a. An option count outside 2 to 8 MUST be a usage error.
5. The extension MUST anchor a new ballot to the last assistant message of the current branch.
6. A share MUST have at most one open ballot. A second open request MUST return `409`.
7. A ballot MUST work on a live share and on a saved transcript. It MUST NOT require a live share.
8. A ballot MUST NOT expire.

### Voting

9. A vote MUST require a voter identity from the trusted proxy header. The service MUST return `401` when the identity is absent.
10. One voter identity MUST record at most one vote on one ballot. A second vote MUST return `409`.
11. A vote MUST name one option index. An index outside the option list MUST return `400`.
12. A vote MUST be final. A voter MUST NOT change it before the reveal. A vote after the reveal MUST return `409`.
13. The vote route MUST NOT accept a Bearer credential as a voter identity.
14. A vote on a revoked share MUST return `404`.

### Visibility

15. A ballot MUST have one of two states: `open` or `revealed`.
16. While a ballot is open, the share payload MUST hold `anchor`, `state`, `options`, `turnout`, and `choice`. `choice` MUST hold the requesting viewer's option index or `null`.
17. While a ballot is open, the payload MUST NOT hold a tally, a count per option, or the identity of another voter.
18. The turnout MUST be the number of recorded votes.
19. The reveal MUST lock the ballot and MUST make the tally and every voter choice visible.
20. After the reveal, the share payload MUST hold `anchor`, `state`, `options`, `turnout`, `tally`, and `voters`.
21. `tally` MUST hold one count for each option, in option order. `voters` MUST hold one item for each vote with `identity`, `choice`, and `at`, ordered by `at`.
22. The service MUST conceal the tally in the payload. The viewer MUST NOT be the only protection.
23. A reveal MUST be idempotent. A second reveal MUST return the same ballot and MUST NOT change data.
24. The owner key or the admin key MUST reveal a ballot and MUST cancel a ballot.
25. A revoked share MUST return `404` for every ballot route, including reveal.

### Lifecycle

26. Ballots and votes MUST persist in SQLite. They MUST survive a service restart.
27. `/share stop`, a non-live upload, and the share going saved MUST NOT delete a ballot.
28. Deleting a share MUST delete its ballots and its votes.
29. Revoking a share MUST keep the ballot rows and MUST hide them behind the `404` response.
30. `/share vote cancel` MUST delete the open ballot and its votes, MUST require confirmation, and MUST notify viewers.
31. Draft state MUST NOT affect ballot state.
32. Every ballot change MUST send an `update` event on the share stream.

### Viewer behavior

33. The viewer MUST render an open ballot below the records of its anchor turn.
34. If the anchor record is absent, the viewer MUST render the ballot at the end of the transcript.
35. The viewer MUST show each option as one choice control and MUST show the viewer's own choice when it exists.
36. The viewer MUST show the turnout and MUST NOT show a tally while the ballot is open.
37. A viewer without an identity MUST see the ballot, MUST see that voting needs sign-in, and MUST NOT get an enabled vote control.
38. After the reveal, the viewer MUST replace the choice controls with the tally, the total, and the voter list.
39. The viewer MUST show the voter list collapsed by default.
40. The viewer MUST apply a ballot change from an `update` event without a page reload and without moving the scroll position.
41. The viewer MUST show a `409` vote response as "already recorded" and MUST NOT retry.
42. The viewer MUST render an option as plain text. An option MUST NOT render as Markdown.
43. The viewer MUST keep an open ballot visible on a saved transcript.

## Configuration Surface

- Option count: 2 to 8.
- Option length: at most 200 characters.
- `TRUST_PROXY_AUTH` — enables the identity header. Default off.
- `PROXY_AUTH_HEADER` — header that carries the identity. Default `X-Auth-Request-Email`.
- `ADMIN_KEY` — operator secret. It authorizes reveal and cancel on any share.
- `ballot` field in `GET /api/shares/<id>`: `null`, or the open or revealed shape from rules 16 and 20.

## Constraints

- Voting needs the trusted proxy. Without `TRUST_PROXY_AUTH` and an authenticated proxy in front of the service, no viewer can vote. Anonymous voting does not exist.
- Blindness covers the tally before the reveal. It never covers the stored record. Anyone with database access or the admin key reads every vote.
- A reveal publishes each voter identity to everyone who can read the share. The owner MUST know this before starting a ballot.
- The service sends a ballot change to all connected viewers at the same time. There is no per-viewer snapshot.
- There are no reminders, notifications, deadlines, or per-option limits.
- A reveal is permanent. The service has no unreveal and no reopen.

## Planned Changes

| Ticket | Summary |
|---|---|
| #42 | Blind ballots: open from Pi, vote with a proxy identity, reveal with the owner key. |
