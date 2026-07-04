# 019 Phase-2A Checkpoint — Single-Repo Proof (gate to 2B)

## Outcome

The 2A checkpoint passes: the Phase-1 harness suite is green with the 2A bricks
swapped in (real store, real verb adapters on their doubles, pi adapter on the
faked surface), and the **live single-repo proof** runs on the sandbox repo — one
real feature: plan sign-off → real pi session in a worktree → real PR via the
broker → human merge, with escalate-all-diffs and the cost breaker active, forced
security violations blocked, a mid-`create_pr` daemon kill reconciled against real
GitHub state, and `kanthord verify` reporting zero divergence afterwards. Interface
corrections discovered live get decision records and the harness updated green
(phases.md — 2A is expected to correct contract hypotheses; the harness is the
regression net).

## Decision Anchors

- phases.md 2A Success criteria — the five checkpoint criteria this Epic's gate
  restates as named checks (single-repo proof; forced out-of-scope write blocked;
  forced budget breach halts; kill mid-create_pr reconciles against real GitHub;
  verify zero divergence; corrections decision-recorded + harness green).
- phases.md guiding rules — gate criteria are named scenarios/checklist items with
  observable pass/fail; the golden scenario carries across phases (Phase 2 = real
  components).
- Epic 010 — the harness suite and its anti-reimplementation rule; this Epic adds
  scenario wiring, no production mechanism.

## Stories

- `001-harness-on-2a-bricks.md` — the Epic 010 golden + lifecycle scenarios run
  with the 2A bricks substituted (real git store, git verbs on temp remotes,
  github adapter on its double, pi adapter on the SU3 fake), plus the three named
  2A security scenarios end-to-end: forced out-of-scope write → blocked +
  escalated + inbox item; forced budget breach → halt + escalation; kill
  mid-create_pr → ledger reconciliation against the double (all hermetic).

## Live proof checklist (maintainer-executed — not `/work` tasks)

Same lane rationale as Epic 000: the live proof needs real credentials, a real
repo, and a human — it is a checklist with observable pass/fail per item,
executed by the maintainer on the SU5 sandbox repo, results recorded in
`.agent/plan/feedback/019-phase2a-single-repo-proof/proof-run.md`.

**Evidence format (debate finding — a gate needs structured evidence, not loose
notes):** each LP entry in `proof-run.md` records date, repo URL, PR URL(s),
commit SHA(s), the relevant command outputs, ledger/inbox excerpts, the verify
exit code, and links to any decision records. **"Interface correction" is
defined** as any change to a Phase-1/2A seam signature or documented contract;
its decision record must state what changed, why the live run forced it, which
epics/stories are affected, and the harness update that keeps the suite green.

### LP1 — Golden single-repo feature end-to-end
- **Action:** author a real one-repo `tdd@1` feature on the sandbox repo with a
  **minimum shape** (debate finding — the gate constrains its input): it changes
  production code **and** at least one test, and its expected run produces at
  least one diff escalation and at least one broker-pushed commit. Sign off; let
  kanthord run it: session → commits → push → `github.create_pr`; respond to
  escalations via the Epic 017 surface; merge the PR by hand.
- **Pass:** the PR exists on GitHub, produced through the broker (audit ledger
  shows the op chain); the feature reaches complete after the human merge;
  escalate-all-diffs interactions all appear in the inbox and are captured as
  typed interaction events; `kanthord verify` (LP5) observes the post-merge
  state.

### LP2 — Forced out-of-scope write (live)
- **Action:** plant a task whose agent instruction leads it to write outside
  `write_scope`; snapshot the worktree + protected roots before the run.
- **Pass:** a post-run filesystem diff outside the allowed roots is empty (not
  only "the one file is absent" — debate finding); the blocked call is durably
  recorded (ledger/journal) and the escalation appears in the inbox tagged
  re-planning; the task does not proceed past it until responded.

### LP3 — Forced budget breach (live)
- **Action:** set the task's hard ceiling to a fixed small value known to be
  below the session's minimum cost (e.g. one model call's conservative
  reservation).
- **Pass:** the halt occurs **before** the breaching call executes (ledger shows
  the reservation attempt, no corresponding provider charge after it); the halt
  survives a **daemon restart** (the task does not resume spending); the breach
  interaction is captured with cost attribution (debate finding — boundary and
  respawn semantics named).

### LP4 — Kill mid-create_pr, reconcile against real GitHub
- **Action:** use the broker's **debug hold-point** (a config flag pausing an op
  between its ledger write and adapter submit / between submit and completion —
  the live-safe, reproducible cutpoint; debate finding — manual timing would be
  flaky) to kill the daemon mid-`github.create_pr`; restart.
- **Pass:** reconciliation resolves the op via the head-branch lookup with **no
  duplicate PR** on GitHub (checked by listing PRs for the head branch); the
  recorded evidence includes the real GitHub observed state and the ledger state
  before and after restart; the op reaches a terminal state consistent with the
  real PR.

### LP5 — Zero divergence + corrections recorded
- **Action:** after LP1–LP4, run `node src/cli/verify.ts --from-markdown
  --read-only`; review any seam corrections made during 2A.
- **Pass:** verify exits 0 (zero divergence); every interface correction made
  during 2A has a decision record in `proof-run.md` (or linked), and `npm test`
  is green on the corrected seams.

## Verification Gate

- Story 001's suites green in `npm test` (hermetic).
- LP1–LP5 all recorded **pass** in `proof-run.md`.
- Phase 2B epics are blocked until both hold — this Epic **is** the 2A→2B gate.

## Dependencies

- **Epics 011–018 all complete** (the proof exercises every 2A brick).
- **Epic 010** (harness suite — extended, never duplicated).
- **Epic 016's live-smoke findings** (`live-smoke.md`) — run before LP1 so signal
  fidelity surprises surface cheaply.

## Non-Goals

- No multi-repo, no artifact handoff across repos, no deploy chain observation —
  the 2B multi-repo proof (Epic 030).
- No dashboard — responses go through the Epic 017 HTTP/JSON surface.
- No performance/soak claims — the proof is functional.

## Findings Out

- `.agent/plan/feedback/019-phase2a-single-repo-proof/proof-run.md` — LP results +
  any seam-correction decision records (consumed by 2B planning; phases.md
  requires corrections to be decision-recorded).
