# Feedback — 024 design input: real gates fill `GateResult.summary`

Recorded 2026-07-10 during Epic 019.3 authoring (Ulrich + debate engine).
Owning epic: 024 (fold into authoring/dispatch). Companion:
`.agent/plan/epics/019.3-task-goal-loop.md` and
`.agent/plan/feedback/019.3-task-goal-loop/goal-loop-and-termination-review.md`.

Epic 019.3 Story 001 changes the Epic 006 workflow seam: `gateCheck`
returns `GateResult { outcome, summary? }` — `summary` is the bounded
failure evidence the goal loop records and injects into the next spawn
brief (debate finding — the bare `GateOutcome` enum could not carry
evidence, and without evidence a retry is amnesiac).

Input for 024: the real `tdd@1` gates must fill `summary` on `fail` from
the parsed test-runner result they already produce (the 024 epic mandates
parsing the runner output to distinguish assertion failure from
infrastructure failure). The evidence shape and truncation cap are
documented in `src/scheduler/attempt-evidence.ts` (019.3 Story 002); a
mismatch routes as a decision record, never an ad-hoc edit. Also note
019.3 Story 004's join point: `max_attempts` joins the model-policy
resolution chain (feature / repo-slot tiers) when 024 Story 003 builds it.
