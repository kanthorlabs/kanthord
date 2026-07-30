# Story S3 — Proof green, CLI-coverage inventory

Epic: `.agent/plan/epics/022-event-feed.md` (Verification Gate)
Depends on: Story S2 (both rows and all wiring exist).

No production source changes are expected. This story records the two claimed CLI
leaves and proves the whole epic on the running program.

## Change

### 1. `src/apps/http/cli-coverage.test.ts` — claim the two leaves

Append the two entries to the END of the `expectedCovered` array (`:67-93`, its
entries at `:68-92`), one per line:

```ts
    "list event",
    "ack project",
```

Update the test title (`:65`) so its leaf count is **the number currently in the
title plus 2** (as authored the title reads "the 25 CLI leaves claimed by EPIC
020"; the title must name the cumulative total and the epics it now covers).

`leaves.length === 80` (`:48-51`) is NOT touched — 022 adds no CLI leaf. The
"uncovered set is non-empty" assertion (`:53-63`) is NOT touched and must still
pass: 022 claims 2 of the remaining uncovered leaves, not all of them.

### 2. `scripts/e2e/http-events-proof.sh` — only if it is defective

The script was written and executed against the pre-implementation tree by the
epic author, and it failed in phase B for the documented reason
(`404 unknown_route`). Do **not** rewrite it to match the implementation. Change
it only when a phase fails because the SCRIPT is wrong (a bad assertion, a wrong
code name), and then record the exact line and the reason in the story's handoff
note. If a phase fails because the row behaves differently from the EPIC, the row
is wrong — fix the row, not the assertion.

## Constraints

- **No file under `.agent/plan/` is edited by this story.**
  `scripts/lane-check.sh:13-19` exits `1` on `.agent/plan/*` for every role.
  Marking "Target 022 covered" in
  `.agent/plan/stories/019-http-server/retirement.md` is a HUMAN follow-up,
  reported at handoff, not performed here.
- **No CLI leaf is removed.** `list event` and `ack project` stay in the CLI;
  022 makes them retirable, and removal waits until the UI uses the routes.
- No route is added or changed in this story. `ROUTES.length` stays at the total
  Story S2 set.

## Verify

- `node --test src/apps/http/cli-coverage.test.ts` passes: every `cliCommands`
  entry names a real Commander leaf, both new entries are covered, and the
  uncovered set is still non-empty.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-events-proof.sh` prints
  `022 ok: pull-based feed on 127.0.0.1:<port> — …` and exits `0`. All six phases
  must pass:
  - **A** — migrate, the p1/p2/p3 CLI fixture, `serve --port 0`, the bound port,
    `/healthz` `200`;
  - **B** — the page, ascending ids, count `< 100`, no `projectId` on the wire, no
    `null` optional field, `nextCursor` = the last returned id, an `ETag`, the
    idempotent empty page, and the `?limit=1` walk equal to the unpaged page;
  - **C** — `?after=0`, `?after=`, a lowercase ULID, `?limit=0|501|x` all
    `400 invalid_input`, and an unknown `?project=` an empty `200`;
  - **D** — disjoint scoped feeds, the global cursor asserted ahead of p1's, the
    ack round trip against `overview.since`, the idempotent replay, the backwards
    ack returning the STORED cursor, `409 cursor_ahead_of_feed` for the global
    cursor and for the event-less p3, `400 cursor_not_ulid`,
    `400 invalid_input` for a missing field, `404 unknown_reference` for an
    unknown project;
  - **E** — the ack `200` with no `If-Match`, `401` on both unauthenticated calls
    with `overview.since` unchanged, `415` on a wrong content type, `403` on a
    foreign `Host`, `405` on `PUT`, `404 unknown_route` on `/api/events`;
  - **F** — the `API_KEY` in no log line, and `SIGTERM` closing the port.
- Regression — every sibling program proof must still pass unchanged:
  - `scripts/e2e/http-serve-proof.sh` → `019 ok: …`
  - `scripts/e2e/http-reads-proof.sh` → `020 ok: …`
  - `scripts/e2e/http-writes-proof.sh` → `021 ok: …`
- Handoff note must state: (a) whether `http-events-proof.sh` needed any edit and
  why, and (b) the human follow-up — mark Target 022 covered in
  `.agent/plan/stories/019-http-server/retirement.md`.
