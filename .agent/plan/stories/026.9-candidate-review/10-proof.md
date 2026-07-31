# Story 10 — the Proof: `scripts/e2e/ui-candidate-review-proof.sh` prints `026.9 ok:`

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Stories 1–9.

The script is **already written and already measured**. Against the tree at
authoring time it exits `1` in phase C with
`FAILED: the objective candidate route answers 200 — expected '200', got '404'`;
phases A and B pass, so all three fixtures really reach
`awaiting_confirmation` with real commit pairs.

## Change

This story adds **no production code of its own.** It is the gate: run the
script, and fix production code until it prints its banner.

The only file this story may edit is the script's own header note, once green,
to record that it passes.

### Frozen assertion labels

Every `eq` / `ne` label below is part of the contract. A story may not reword,
weaken or delete one to reach the banner. If a phase cannot pass without editing
an assertion, that is a **blocker to report**, not a script edit.

Phase A: `package.json defines build:ui`.
Phase B: `fixture: subject 1 really awaits confirmation`, `… subject 2 …`,
`… subject 3 …`, `subject 1 has a real candidate commit`.
Phase C: `the objective candidate route answers 200`, `it names the source it
read`, `the diff is available`, `base is the objective's parent oid`, `head is
the objective's candidate oid`, `it returns at least one file`, `the file the
fixture wrote is in the diff`, `that file carries a real patch`, `reading the
diff did not mutate the bare managed home`.
Phase D: `the queue answers 200`, `the queue carries a decision occurrence id
for subject 1 (EPIC 026.8)`, `a stale expectedCommit is refused with 409`,
`...and names the reason`, `the objective did not move`, `an unknown decision
occurrence is refused with 409`, `the objective still did not move`.
Phase E: `the approval answers 200`, `it reports the outcome, not a bare
success`, `the objective really transitioned in SQLite`, `replaying the same
verdict is refused, not re-run`.
Phase F: `the queue carries a decision occurrence id for subject 2`, `subject 2
has a real candidate commit`, `a discard with no impact digest is refused`,
`subject 2 did not move`, `the dry run answers 200`, `the dry run returns an
impact digest`, `the dry run wrote nothing`, `the discard with the digest
succeeds`, `subject 2 is really discarded`.
Phase G: `the queue carries a decision occurrence id for subject 3`, plus the
browser step assertions inside `steps.mjs` — `the review shell rendered`, `the
fixture's file is on screen`, `the verdict carries the occurrence id`, `the
verdict carries the head OID it reviewed`, `the resolved state rendered`,
`...on the same URL`, `no console error`, and the `Authorization` offender
check — then `the browser verdict really transitioned subject 3`.

### Load-bearing details a story must not "simplify"

- **Three independent subjects.** A verdict is terminal. Subject 1 answers the
  HTTP approval, subject 2 the discard, subject 3 the browser. Do not collapse
  them; phases E and G cannot share one.
- **Phase C's home hash** is a content hash of every file under the bare managed
  mirror (`find … -exec shasum` piped through `sort` and `shasum`), not a ref
  listing. A `git fetch` into the home writes loose objects and `FETCH_HEAD`
  while moving no ref, so a ref comparison would not see the mutation epic
  decision 1 forbids.
- **`scripts/e2e/ui-browser.mjs` records `postData`** (added while the epic was
  authored, `:80-83`). Phase G reads it to prove which occurrence id and which
  head OID the page sent. Do not remove that field.
- **Phase E replays the same verdict** and requires a `409` — the objective is
  `integrated` by then, so `ObjectiveNotAwaitingConfirmationError` must map to
  `409 objective_not_awaiting_confirmation` (Story 5). A `500` there fails the
  Proof.
- The script is deterministic: no model, no outbound network, nothing left
  running. `KANTHORD_FAKE_AGENT` supplies the agent turn.

### Sibling regressions

These must stay green and print their own banners:

- `scripts/e2e/ui-inbox-proof.sh` → `026.7 ok:`
- `scripts/e2e/ui-decision-identity-proof.sh` → `026.8 ok:`
- `scripts/e2e/http-reads-proof.sh` — its `409 no_conflict_candidate` pin at
  `:254` must still hold; Story 6 adds a **new** `409 no_candidate`, it does not
  change the conflict route.
- `scripts/e2e/landing-proof.sh` → `007.3 PROOF PART A OK`. It calls
  `approve objective --expected-commit`, which Story 4 does not touch. It does
  **not** call `approve task`, so Story 4's required `--expect-commit` breaks no
  existing proof — verify this by grep before assuming it.

## Constraints

- Never edit an assertion to reach the banner.
- Never add a `sleep` to make a phase pass; the script's waits are bounded polls
  on real state.
- The script must leave no server running: `cleanup()` kills the serve pid and
  removes the temp dir on every exit path.

## Verify

- `scripts/e2e/ui-candidate-review-proof.sh` exits `0` and its last line starts
  `026.9 ok:`.
- `scripts/e2e/ui-inbox-proof.sh`, `scripts/e2e/ui-decision-identity-proof.sh`,
  `scripts/e2e/http-reads-proof.sh` and `scripts/e2e/landing-proof.sh` all still
  exit `0`.
- `npm run verify` exits 0.
- Proof: all of it — this story is the Proof.
