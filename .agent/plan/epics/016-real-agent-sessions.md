# 016 Real Agent Sessions — pi Stack, Repo Slots & Worktrees, Compaction

## Outcome

The real agentic brick behind the Phase-1 agent-session seam (Epic 006): **repo
slots** loaded from per-repo yaml config with the **worktree strategy** (worktree
per task, capped by `max_concurrent_tasks`, lease per worktree), **live pi
sessions** spawned in those worktrees from the assembled brief with the full
Epic 015 ring-1 chain attached, torn down at task boundaries, respawned from
STATE.md — and **compaction** triggered when the real context-size signal crosses
the per-model configured threshold, running through the identical Phase-1 respawn
path. Unit tests drive the session seam with the pi surface faked per the SU3
findings; one opt-in live smoke test (real model call) exists but is excluded from
the default hermetic suite. The scripted fake agent from Epic 006 remains the
harness double (fakes are never deleted).

## Decision Anchors

- phases.md Phase 2A Deliverable 5 — real agent sessions: pi stack in repo slots,
  worktree strategy, compaction at the configured window threshold via the
  Phase-1 respawn path; `single_checkout` may land in 2B.
- phases.md Security invariant — no real agent session ever runs without full
  ring-1 enforcement (Epic 015 is a hard dependency, wired at spawn, not
  optional).
- PRD §3.2 — durable slot, ephemeral session; teardown at task boundaries;
  re-warm from STATE.md + repo map + AGENTS.md; compaction at ~50–60% of the
  model window (per-model config, never a constant); threshold, task-boundary,
  and crash respawn are one code path.
- PRD §3.3 — per-repo strategy config (`strategy: worktree`,
  `max_concurrent_tasks`); worktree per task, lease per worktree.
- PRD §7.1.1 §6 — spawn brief = task body + epic body + RUNBOOK + STATE + repo
  AGENTS.md.
- Epic 011 SU3 findings — the pi session API this Epic codes against.

## Stories

- `001-repo-slots-and-worktrees.md` — repo-slot registry from per-repo yaml;
  worktree create/remove per task via the git seam; `max_concurrent_tasks` maps
  to slot capability leases (Epic 004); non-git path rejected at registration.
- `002-pi-session-lifecycle.md` — spawn a pi session in a worktree with the
  brief, ring-1 hook chain, and filtered tool manifest; teardown at task
  boundary; respawn from STATE.md through the Epic 006 coordinator; session
  events journaled.
- `003-compaction-threshold.md` — the real context-size signal vs the per-model
  threshold config triggers `checkpoint()` + kill + respawn via the Phase-1
  respawn path; threshold is per-model config, not a constant.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (pi surface
  faked per SU3; no model call, no network in the default suite).
- Registering the sample repo yaml creates a slot; a task dispatch on the slot
  creates a worktree on a branch named for the task; task **completion** removes
  the worktree and releases the lease; task **parking keeps the worktree** (it
  holds uncommitted state; only the session dies — debate finding: removal on
  park would destroy in-progress work; WIP-commit park/resume is the
  `single_checkout` protocol, 2B); a second concurrent task beyond
  `max_concurrent_tasks: 1` waits (Epic 004 lease assertion on slot capability).
- The maintainer-run **live smoke passes and `live-smoke.md` exists** before this
  Epic closes — the live check is part of THIS Epic's gate, not only an Epic 019
  prerequisite (debate finding — otherwise the epic could finalize with a
  fake-compatible, real-incompatible adapter).
- Registering a non-git path fails at registration with a typed error
  (PRD assumption #5 — unsupported, not silently indexed).
- A session spawn passes the assembled brief (task+epic body, RUNBOOK, STATE,
  AGENTS.md), attaches the `ring1PolicyChain`, and passes the filtered tool
  manifest — asserted against the faked pi surface's captured spawn arguments;
  **a spawn attempted without the ring-1 chain is a typed error** (the invariant
  is structural, not conventional).
- Teardown at task boundary destroys the session; respawn injects only STATE.md
  + durable inputs (never prior context) — Epic 006 respawn-equivalence
  re-asserted with the real session adapter in place of the scripted fake.
- With per-model config `{ window: 100k, compaction_threshold: 0.55 }`, a faked
  context-size signal **strictly above** 55_000 triggers (55_001 yes, 55_000 no,
  54_999 no — equality defined; debate finding) checkpoint → teardown → respawn;
  the three triggers (threshold, task-boundary, crash) produce **behaviorally
  identical respawns** (same journal shape, lease ownership, pending-task state,
  injected context — asserted as behavior equivalence, with the one-function
  check kept as a constraint-level guard; debate finding — behavior over
  function identity).
- The live smoke test (`test/live/` — real pi + real model, minimal prompt) is
  **excluded** from `npm test` and documented as maintainer-run; the hermetic
  suite passes with no credentials present.

## Dependencies

- **Epic 015** (ring-1 chain + manifest filter + spawn env — hard precondition).
- **Epic 006** (session seam + respawn coordinator), **Epic 004** (leases),
  **Epic 012** (STATE/RUNBOOK through the real store), **Epic 011 SU1/SU3**
  (git worktree invocations; pi surface findings), **Epic 013** (budget breaker
  active on the session's model calls).

## Non-Goals

- No `single_checkout` strategy / WIP-commit park-resume — Phase 2B (Epic 021),
  since no mobile repo is in the 2A proof (phases.md).
- No model-policy resolution chain — sessions take an explicitly passed model in
  2A; the chain is Epic 024.
- No real TDD workflow execution — the session runs under the fake workflow's
  gates until Epic 024; 2A's proof uses escalate-all-diffs, not gate depth.
- No prompt/agent quality engineering — kanthord executes sessions; output
  quality is exercised by evidence targets and review, never proven (PRD §7.1).
- No time-based session cap (PRD §3.2 backstop) — deferred, with a named risk
  (debate finding): if the live smoke shows the context-size signal is
  unreliable, sessions could fail to recycle; in that case the cap moves INTO 2A
  scope via the SU3 failure-path decision record, before Epic 019's proof.

## Findings Out

- `.agent/plan/feedback/016-real-agent-sessions/live-smoke.md` — written after the
  first maintainer-run live smoke: observed context-size signal fidelity and cost
  signal fidelity vs the SU3 findings (consumed by Epic 019 before the proof run).
