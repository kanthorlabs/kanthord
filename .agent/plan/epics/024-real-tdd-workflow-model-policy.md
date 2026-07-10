# 024 Real `tdd@1` Workflow, Model Policy Chain & Provider Registry

## Outcome

The execution half of the `tdd@1` shape becomes real: the **`tdd@1` workflow**
whose entry gate `failing_test_exists` and exit gate `tests_pass` run the repo's
actual test command and judge real results, with `checkpoint()` writing bounded
STATE.md through the real store — replacing the fake workflow's scripted gate
outcomes behind the same Epic 006 interface. Alongside it, the **model policy
resolution chain** (task override → feature default → repo slot → role default →
system default) resolving every session's model deterministically, recording
`model@version` in task frontmatter and the metrics events, and the **provider
registry** (yaml, mirrors the verb registry: providers/endpoints/keys registered
once; plans reference models by name, never by credential).

## Decision Anchors

- phases.md Phase 2B Deliverable 4 — real TDD workflow (failing-test entry gate,
  tests-pass exit gate, `checkpoint()` writing STATE.md) + model policy
  resolution chain and provider registry.
- PRD §10 — the workflow interface (`phases[]`, `currentPhase()`, `gateCheck`,
  `checkpoint()`, status events), versioned; PRD §7.1.1 §8 — the `tdd@1` gate
  pair bound by the shape.
- PRD §8 — resolution precedence (most specific wins); provider registry mirrors
  the verb registry; record `model@version` in frontmatter and metrics; the
  ring-2 classifier model resolves from global config only, never per-plan.
- Epic 006 — the workflow seam this implementation plugs into; the fake stays
  the harness double.

## Stories

- `001-real-tdd-gates.md` — `failing_test_exists` / `tests_pass` run the repo's
  configured test command in the task worktree and judge exit status + parsed
  result; gate outcomes flow to the Epic 004 gate-status sink; a test-command
  crash is `needs_human`, not a false pass/fail.
- `002-checkpoint-and-phase-events.md` — `checkpoint()` rewrites bounded
  STATE.md through the store; phase transitions emit status events and drive
  the Epic 006 phase-boundary drift hook; frontmatter records
  `workflow: tdd@1` (one identifier form, normalized — debate finding).
- `003-model-policy-chain.md` — the five-level resolution chain as data;
  `model@version` recorded in task frontmatter + interaction/metrics events;
  the classifier model is global-only (a plan override of it is a lint error).
- `004-provider-registry.md` — the yaml provider registry: named providers with
  endpoint + credential ref (custody config); plans reference model names;
  resolving an unregistered provider/model is a typed error naming the chain
  step that produced it.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (test
  commands run against tiny fixture repos with real passing/failing tests —
  local, hermetic; the model resolution/provider tests use fakes).
- On a fixture repo with no failing test, the `tdd@1` entry gate returns
  `fail` (no failing test exists ⇒ TDD cannot start); after adding a failing
  test it returns `pass`; the exit gate returns `pass` only when the suite is
  green (real `node --test` runs asserted both ways).
- The entry gate distinguishes **a real test-assertion failure from
  infrastructure failure** (debate finding — a nonzero exit alone is not a
  failing test): it parses the runner's result to require ≥1 executed-and-
  failed test; a syntax error, missing dependency, or compile failure at the
  entry gate is `needs_human`, not `pass`.
- A test command that crashes (missing script, spawn failure, timeout) yields
  `needs_human` with the error attached — never a silent gate outcome.
- The full Epic 006 interface is exercised on the real workflow: `phases[]`
  reported, `currentPhase()` advances in order, an out-of-order transition is a
  typed error, and status events carry the workflow version in emission order
  (debate finding — gateCheck/checkpoint alone under-pinned the interface).
- `checkpoint()` writes STATE.md whose size stays under the configured bound
  (bounded-rewrite discipline, PRD §6.2) and journals the phase transition; a
  checkpoint failure (oversize or write error) yields `needs_human` **with the
  previous STATE preserved intact** — a failed checkpoint can never corrupt the
  respawn source (debate finding); the Epic 010 compaction-respawn scenario
  passes with the real workflow substituted.
- Resolution: given all five levels configured, the task override wins; removing
  levels one at a time falls through in order to the system default. The type
  boundary is fixed (debate finding): the chain resolves to a **symbolic model
  name**; the provider registry (Story 004) turns that name into the
  provider-backed record; `model@version` = the registry model name plus its
  registry entry version, stamped at dispatch — one definition, used in
  frontmatter, metric events, and interaction events alike (PRD §8 —
  attribution).
- The classifier role is protected **structurally, not only by lint**: the
  chain resolves the classifier role exclusively from global config — task/
  feature/slot entries for it are ignored by construction, and a plan declaring
  one additionally fails shape lint with a planner-vocabulary diagnostic
  (PRD §8/§4; debate finding — every non-global home covered).
- Credential hygiene follows the Epic 014 redaction standard across the model
  path: no credential in logs, status events, metric events, typed errors, or
  serialized resolved-provider records (sweep asserted; debate finding).
- Providers load from yaml with credential refs only (no inline secrets — a
  literal secret value in the registry is a load error); a plan referencing an
  unknown model name fails with a typed error naming the resolution step.

## Dependencies

- **Epic 006** (workflow seam + drift hook), **Epic 016** (worktrees + session
  wiring; sessions now take the resolved model), **Epic 012** (STATE through the
  real store), **Epic 002** (shape lint — the classifier-override rule lands as
  a lint addition), **Epic 020 SU4** (classifier config exists to protect).
- `.agent/plan/feedback/024-real-tdd-workflow-model-policy/skills-and-budget-classes.md`
  (2026-07-10 agentic-system review) — MUST fold in before `/work`: skills-style
  lazy guidance in the prompt assembly, per-task-class budget ceilings, and the
  019.2-deferred prompt-parity item (pi tool guidance).

## Non-Goals

- No second workflow (legacy-minimal-test) — an **accepted deviation, recorded**
  (debate finding — the fake does not count as PRD §10's second workflow):
  PRD §10 says start with exactly two, but phases.md 2B Deliverable 4 scopes
  Phase 2 to the real `tdd@1` execution only, and no legacy repo exists in the
  Phase-2 proofs to exercise a second workflow honestly. `legacy-minimal-test`
  lands with the first real legacy repo (Phase 3 company project), where its
  gates have something real to check. The interface's plurality is held open by
  the permanent fake until then.
- No per-model cost/poll tuning (Phase 3), no A/B analysis (Phase 3 metrics).
- No provider failover logic — a provider error is the session's error path,
  not a silent model swap (attribution integrity, PRD §8).

## Findings Out

- none. The gate-command config shape and the resolution-chain data format are
  documented in the stories and asserted by tests.
