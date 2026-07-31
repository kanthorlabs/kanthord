# Story 8 — the Proof runs green

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Stories 1–7.

## Change

- No production change of its own. Run
  `scripts/e2e/ui-decision-identity-proof.sh` and make it print
  `026.8 ok: …` by fixing production code, never the script's assertions.
- Every `eq` / `ne` / `has` call in the script and in its browser steps is
  **frozen**, named here by its label rather than a line number so the list
  survives an edit elsewhere in the file:
  `package.json defines build:ui`, `fixture: the root task really failed`,
  `the id survives recomputation of the projection`,
  `an open decision reports its state`, `an id the server never issued is 404`,
  `a known decision is 200, never 410`,
  `fixture: the retried task failed again`, `a closed decision is still 200`,
  `the closed decision is no longer open`,
  `the recurrence is a different occurrence`, `the recurrence is open`,
  `the other kind matches nothing`, `counts stay global under a filter`,
  `the row shows the entity's real title`,
  `the kind filter did not reach the server`,
  `the global counts are labelled as global`, `the decision cold-loads`,
  `a closed decision marks its names historical`,
  `an unknown decision is the missing state`, `no console error`, and the
  `Authorization` offender check. The `PROOF_*` env contract handed to
  `ui-browser.mjs` is frozen too.
- The header's expected-failure note now says phase C fails on the missing DTO
  `id`; correct it to "passes" only once the Proof is green.
- Phase E deliberately re-runs the daemon after `retry task` so the task fails a
  second time. That is what closes the first occurrence, proves the recurrence
  gets a new id, and leaves one open decision for phases F and G. Do not remove
  it: a retry alone empties the queue and makes F and G vacuous.
- Also re-run 026.7's Proof, `scripts/e2e/ui-inbox-proof.sh`, and keep it green:
  its `:171` (`rows === items.length` on an unfiltered queue), `:179-184` (no
  per-row entity fetch) and `:187-192` (the order statement, without "impact" or
  "priority") are the regression this epic must not break.

## Constraints

- Deterministic: no model call, no outbound network, nothing left running.
- If a phase cannot pass without changing an assertion, stop and report it as a
  blocker — it means a story is wrong, not the Proof.

## Verify

- `scripts/e2e/ui-decision-identity-proof.sh` exits 0 and its last line starts
  with `026.8 ok:`.
- `scripts/e2e/ui-inbox-proof.sh` exits 0 and its last line starts with
  `026.7 ok:`.
- `npm run verify` exits 0.
- Proof: all phases A–H.
