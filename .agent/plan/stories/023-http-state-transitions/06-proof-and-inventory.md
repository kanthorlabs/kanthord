# Story S6 — Proof green, CLI-coverage inventory

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Depends on: Stories S1-S5 (all nine rows land and are wired).

Lands no row. `ROUTES.length` stays 63.

## Change

**1. `src/apps/http/cli-coverage.test.ts`** — add ONE test, mirroring
`the 25 CLI leaves claimed by EPIC 020` (`:65-100`) exactly in shape:

```ts
test("the 9 CLI leaves claimed by EPIC 023 all appear across ROUTES' cliCommands", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const expectedCovered = [
    "approve task",
    "approve objective",
    "reject task",
    "reject objective",
    "retry task",
    "retry objective",
    "abandon task",
    "pause initiative",
    "resume initiative",
  ];
  for (const cliCommand of expectedCovered) {
    assert.ok(
      covered.has(cliCommand),
      `expected "${cliCommand}" to be covered by ROUTES' cliCommands`,
    );
  }
});
```

Do NOT touch: `leaves.length is 80` (`:48-51`) — 023 adds no CLI leaf — or the
"uncovered set is non-empty" test (`:53-63`), which must keep passing untouched.

**2. `scripts/e2e/http-transitions-proof.sh`** — make it pass. The script and
`scripts/e2e/make-transitions-graph.sh` already exist, are executable, and
already fail at phase C with `expected '200', got '404'`. This story changes NO
assertion in either file. Run it, and fix the PRODUCTION code for any phase that
fails.

Expected end state:

```
scripts/e2e/http-transitions-proof.sh
# … A through J …
023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk
```

If a phase fails because the epic's decision was wrong (not because the code is
incomplete), raise an `OPEN:` blocker naming the phase, the assertion, and the
code site that contradicts it. Do not weaken the assertion, do not delete a
phase, and do not add a `|| true`.

Phase-to-story map, for diagnosing a failure:

| phase | needs                                                        |
| ----- | ------------------------------------------------------------ |
| A, B  | nothing from 023 (CLI fixture + 019/020 serve)               |
| C     | S2 `task.approval.create`                                    |
| D     | S2 `task.rejection.create`                                   |
| E     | S4 `objective.approval.create`                               |
| F     | S3 `task.reattempt.create`, `task.abandonment.create`        |
| G     | S5 the suspension pair                                       |
| H     | EPIC 021's `initiative.patch` + `If-Match` (regression only) |
| I     | S2 and S5 rows, plus the 019 gates                           |
| J     | 019 logging and shutdown                                     |

**3. Nothing else.** No new production file, no new view, no registry change.

## Constraints

- Do not edit any file under `.agent/plan/` (`scripts/lane-check.sh:13-19`).
  Marking "Target 023 covered" in `retirement.md` is a human follow-up.
- Do not re-author the Proof or the fixture maker. The only permitted edit to
  either is a fix to a genuine script defect (a bad shell quoting, a race), never
  a relaxed expectation. Record any such edit in the story's completion note.
- The Proof must stay hermetic: no model, loopback and `file://` only, no server
  or daemon left running, and no dependence on the developer's `.env`.
- Phase H asserts EPIC 021 behaviour. If it fails, the defect is in 021, not 023 —
  raise it as an `OPEN:` blocker rather than editing 023 code to compensate.

## Verify

- `node --test src/apps/http/cli-coverage.test.ts` — the new 023 test passes, and
  all four pre-existing tests still pass, including `leaves.length is 80` and the
  non-empty uncovered set.
- `node --test src/apps/http/routes.test.ts` — `ROUTES.length === 63` and all 63
  ids listed.
- `npm run verify` exits 0.
- `scripts/e2e/http-transitions-proof.sh` exits 0 and its last line is
  `023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk`.
- Sibling regression proofs still pass (they share the CLI verdict paths this
  epic exposes over HTTP):
  - `scripts/e2e/http-reads-proof.sh`
  - `scripts/e2e/http-writes-proof.sh` (EPIC 021)
  - `scripts/e2e/http-events-proof.sh` (EPIC 022)
  - `scripts/e2e/activation-verdict-proof.sh` (EPIC 012 — the CLI guard path)
  - `scripts/e2e/decision-workbench-proof.sh` (EPIC 017 — impact digests)
- Proof: delivers the whole `023 ok: …` line, i.e. every phase A-J.
