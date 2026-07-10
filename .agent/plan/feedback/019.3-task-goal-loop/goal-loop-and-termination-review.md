# Feedback — the task goal loop is unowned (system-workability review)

Recorded 2026-07-10 during the loop-capacity review (Ulrich + Aelita).
Owning epic: **019.3** (authored from this record). Links: PRD §7.1/§10
(workflow gates), PRD §3.2 (durable slot / ephemeral session), PRD §4
(budget breaker), PRD §8 (model-policy resolution chain, `gate-check` role),
Epic 006 (respawn-equivalence), Epic 024 (real gates, 2B).

## Finding — three loop layers exist, the corrective one does not

- **L1 (agent inner loop)** exists: pi's `Agent` iterates tool calls until
  idle, bounded by the ring-1 budget breaker. Live wiring is Epic 019.2.
- **L2 (workflow phase loop)** is a seam only: `gateCheck(phase) →
  pass|fail|needs_human` exists with a fake (Epic 006); real gates are
  Epic 024. Nothing defines what any caller DOES on `fail`.
- **L3 (scheduler loop)** is dispatch-once: the tick spawns a session once
  and marks complete on PR merge; `blocked_on` re-dispatch is resume, not
  retry. No path exists: gate fail → re-dispatch with evidence → recheck →
  stop condition.

Consequence: an agent gets one session-lifetime per task. Every imperfect
run becomes a human touch, and the only brake on a fail loop would be the
budget ceiling — the wrong stop (cost-bound, not attempt-bound).

## Review findings (2026-07-10)

- **B1** — task-attempt loop unowned: no attempt counter, no on-fail
  re-dispatch semantics, no `max_attempts → needs_human` escalation,
  anywhere in plan or code. The dev pipeline (`/work`) has exactly this;
  the product does not mirror its own harness.
- **B2** — condition knobs need the existing hierarchy: `max_attempts`
  (and later finer budget ceilings) should resolve like model policy
  (task → feature → repo slot → system). MVP scope: task frontmatter →
  system default only; the full chain joins when Epic 024 builds the
  model-policy resolution chain.
- **S1** — make the MVP substitution explicit: the "goal reached by agent
  reasoning" check is the human via `escalate_all_diffs`; the LLM
  `gate-check` role (PRD §8) is the named Phase-3 owner. Today this is
  implied and easy to lose.
- **S2 (won't-do)** — no story-level condition tier: stories stay
  ordering/grouping; recorded deliberately.

## Resolution

Epic `019.3-task-goal-loop` owns the corrective loop: gate-fail
re-dispatch with durable failure evidence injected into the next spawn
brief, a durable respawn-proof attempt ledger, the ordered termination
contract (pass / needs_human / max attempts / budget / operator halt),
and minimal `max_attempts` resolution. Retry stays distinct from
lifecycle respawn — Epic 006 respawn-equivalence is untouched.

Debate-hardened 2026-07-10 (one adversarial pass + pi-source
verification): `gateCheck` extended to a structured `GateResult` (the bare
enum could not carry evidence — Story 001 owns the contract change); the
ledger counts **dispatched attempts**, not gate-fails (honest operator
vocabulary); session end is classified before gate-checking (pi
`stopReason`/`errorMessage`, verified in pi-agent-core `agent.ts`);
post-session facts always record before any verdict, budget/halt stay
pre-spawn; `retry-once` and `re-arm` are two distinct typed operator
actions; the crash-before-gate loop brake is named (PRD §4 budget
cost + wall-clock), not `max_attempts`.
