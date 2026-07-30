# Story S5 — retirement and coverage bookkeeping

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decisions 9, 10)
Depends on: Story S4 (it makes the one claim this records)

Documentation only, plus one test comment. No production code, no new test.

All edits are in `.agent/plan/stories/019-http-server/retirement.md`, whose
merged state (commit `f2251c0`) is the baseline. Line numbers below are from that
state; if an earlier epic edited the file first, match on the quoted text.

## Change

### 1. Line 20 — the inventory note

Under `## Inventory — 79 leaves today (80 with `serve`)`, append:

> EPIC 025 claims one leaf (`db status`) and **retires none**. The retirement rule needs the UI to use the
> route, and the UI is Target 026 — it lands after this epic. Removal is deferred
> anyway: the retirement plan is on hold until Ulrich revisits it after the UI and
> integration.

### 2. Target 023 is NOT edited

An earlier draft of this story moved `pause initiative` / `resume initiative` out
of Target 023 and into 025. That is reversed: EPIC 023 decision 2 owns them via
`PUT | DELETE /api/initiative/:id/suspension`, and 023 runs first. Leave the
Target 023 section exactly as it is.

### 3. Lines 152-157 — rewrite Target 025

Replace the whole section:

```
### Target 025 — serve-hosted daemon and run control

`run daemon` (covered by composition), `db status`.
Shape: `serve` runs the execution loop in-process under an atomic single-daemon
lease; run control is 023's `PUT | DELETE /api/initiative/:id/suspension`;
`GET /api/database` is the bootstrap-safe schema read (`check project`'s
`database` check needs a project id, so it cannot answer before one exists).
The async job API this target originally named was rejected after three debate
rounds — `resume initiative` already starts a graph, so a daemon is a switch, not
a job. `setup project`, `login provider` and `db migrate` moved to the categories
below.
Authored as `.agent/plan/epics/025-serve-hosted-daemon.md`, proved by
`scripts/e2e/http-execution-proof.sh` and
`scripts/e2e/http-daemon-ownership-proof.sh`.
```

### 4. Lines 212-214 — three categories replace one

```
### Never retired (operator-only, stays CLI)

`serve` (it IS the server), `commands` (a CLI help table), `db migrate` (mutates
schema under a live server), `login provider --method browser` (needs a browser
on the operator's machine; the server cannot hold the callback).

### Covered by composition (no single row claims the leaf)

`run daemon` — `serve` now runs the loop, and `serve` is already excluded from
the coverage set. `setup project` — every write it performs is a 021 row; its
value is the interview, which is a client concern.

### Deferred but feasible

`login provider --method device_code` — device-code OAuth is designed for
headless use and the secret never crosses the client. Deferred on scope, not
refused.
```

### 5. Lines 216-222 — resolve one open question

Under `## Deliberately unresolved here`, delete the `login provider` bullet
("Decide in 025 with the flow in hand"): EPIC 025 Decision 12 answers
it — browser never, device_code deferred. Leave the `export diagnostic` bullet.

### 6. `src/apps/http/cli-coverage.test.ts:148` — the comment

The count reaches its S6 value. Update the comment so the arithmetic reads:

```ts
// <N> retirable leaves, 25 claimed by 020, 27 by 021, 3 by 025.
```

Keep the numbers consistent with whatever the assertion holds after S6.

## Constraints

- Do NOT change the assertion at `cli-coverage.test.ts:53-63` — the uncovered set
  must stay non-empty after 025. Only a later epic flips it.
- Do NOT delete any CLI command. 025 retires nothing.
- Do NOT renumber epics. The final order was settled on 2026-07-30: 024
  ai-provider writes, 025 this epic, 026 the UI. Superseded states (frontend at
  024; this epic at 026; a "Target 027 — delivery") must not be reintroduced.
- Do NOT retire any leaf, and do not add a "covered" marker that implies removal.
  The retirement plan is on hold until Ulrich revisits it after the UI and
  integration (`retirement.md`, "Why the numbering changed").
- Do not edit the "Why the numbering changed" section (`:149`) beyond what that
  correction already did — it is the authority this epic follows.

## Verify

- `node --test src/apps/http/cli-coverage.test.ts` — the uncovered count matches
  S6's value and the non-empty assertion still holds.
- `npm run verify` exits 0.
- `grep -n "pause initiative" .agent/plan/stories/019-http-server/retirement.md`
  still shows it inside the Target 023 leaf list — 025 must NOT move it.
- `grep -c "Decide in 025" .agent/plan/stories/019-http-server/retirement.md`
  returns 0.
- Proof: none. S7 records what S5 and S6 proved.
