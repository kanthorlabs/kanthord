# 008 Deploy-Chain Executor (fake observers + soak)

## Outcome

The chain-of-responsibility deploy executor: per deploy stage it runs an **ordered**
set of observer handlers, evaluates **explicit success criteria** (an AND of observer
outcomes), holds for a **soak duration** on the fake clock (re-checking so a deploy
that looks healthy at 90s but fails at minute five is caught), and resolves the stage
`on_pass: notify_human` (merge stays a human action) or `on_fail: halt_and_escalate`
with the observation evidence attached. Chain definitions come from the plan; the
executor is generic (a §10 extension family); observers are **fakes** — no real
`k8s`/`signoz`/`sentry`, no network.

## Decision Anchors

- PRD §7.4 — per stage: observers (read-only broker verbs registered as handlers);
  explicit success criteria (rollout complete AND error rate below threshold AND zero
  new issues); **soak duration** ("observe for N minutes" is part of the gate — the
  async design handles the wait natively); `on_pass: notify_human` (merge remains a
  human-approval verb); `on_fail: halt_and_escalate` with observation evidence;
  cross-repo rollback is human.
- PRD §7.4 / §10 — kanthord ships the **chain executor** (ordered handlers,
  pass/fail/escalate semantics); handler logic is per-project integration; chain
  definitions live in the plan.
- PRD §7.4 — the DAG continues past "PR open" into per-repo deploy stages.
- phases.md Phase 1 Deliverable 6 — deploy-chain executor with **fake observers and
  soak timers on the fake clock**.

## Stories

- `001-chain-executor.md` — ordered stage handlers with pass/fail/escalate semantics;
  a failing handler halts and escalates with evidence; chain definition read from the
  plan.
- `002-soak-and-criteria.md` — soak duration on the fake clock with re-checking;
  explicit AND success criteria; `on_pass: notify_human`, `on_fail: halt_and_escalate`
  with observation evidence.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- **Plan-compiled, scheduler-driven (not a standalone checker):** the compiled plan
  (Epic 002) contains deploy-stage DAG nodes derived from epic frontmatter, and the
  scheduler (Epic 004) continues into them past PR-open, invoking the executor as a
  scheduler-owned transition — asserted, not assumed (debate finding — §7.4 says
  deploy stages ARE DAG nodes).
- The executor calls **ordered read-only fake broker observer verbs** (Epic 005) and
  the soak advances via **repeated scheduled re-polls** on the fake clock (observable
  repeated observer invocations at poll points) — not a private one-shot loop.
- A stage healthy across its full soak resolves `on_pass` and emits a `notify_human`
  event; the **fake broker's side-effect log shows no merge/deploy/rollback verb was
  called** (the no-auto-merge negative is asserted against a recorded command log, not
  a vacuous absence) (PRD §7.4, §9).
- A fake observer flipping unhealthy **during** the soak resolves
  `on_fail: halt_and_escalate` with evidence including which observer failed, its
  observed value, the fake-clock instant, the stage id, and the soak-window history.
- A handler that fails halts the chain (later stages do not run) and escalates;
  ordering is respected.

## Dependencies

- **Epic 001** (injectable clock — soak timers), **Epic 005** (observer verbs are
  read-only broker verbs; the async poll drives the soak re-checks — fakes here),
  **Epic 004** (deploy stages are DAG nodes the scheduler continues into past PR).

## Non-Goals

- No **real** observer handlers (`k8s.rollout_status`, `signoz.query`,
  `sentry.new_issues`) and no network — those are Phase 2B integration (phases.md).
  Phase 1 ships the generic executor + soak against fakes.
- No **auto-merge / auto-deploy** — `on_pass` only **notifies**; the human keeps the
  merge/deploy button (PRD §7.4, §9; Trade-off #14).
- No **cross-repo rollback** — human (MVP stance, PRD §7.4).
- Handler business logic is integration work, not built here (PRD §7.4, §10 — engine
  ships generic). **The generic executor knows nothing of Sentry / SigNoz / k8s /
  error-rates / rollout** — it evaluates plan-declared predicates over generic
  observer outcomes; those product names appear only as prose examples (debate
  finding — do not bake integration vocabulary into Core).
- **Durable soak state across crash/respawn is Epic 009's concern**, not built here;
  this Epic only ensures its stage-state shape is compatible with the Epic 009
  crash/restart entrypoint (debate finding — don't absorb durability here).

## Findings Out

- none as a TDD-task output. The chain-executor handler interface + soak semantics are
  documented here and asserted by tests; Epic 010's golden scenario runs a fake
  deploy chain with soak.
