# Story 001 - Read Surfaces

Epic: `.agent/plan/epics/026-control-plane-api.md`

## Goal

Every dashboard surface reads from a Connect method over the daemon's existing
state seams: features and their inner life, broker operations, repo slots,
budgets, and daemon ops — with plan files and registries strictly read-only.

## Acceptance Criteria

- `features.list` returns per-feature id, status, phase, and progress summary;
  `features.get` returns the drill-down: stories/tasks with live status, DAG
  progress (nodes + satisfied edges), in-flight broker ops for the feature, and
  STATE/JOURNAL content views (phases.md surface list, asserted field-by-field
  on a golden fixture).
- `broker.operations` lists in-flight / pending / expiring ops with state and
  correlation; `broker.verbs` returns the registry view with tiers — and the
  descriptor contains no registry-write method.
- `slots.list` returns registered repos, strategy, held leases, active
  sessions.
- `budgets.get` returns the per-task ledger view and breaker state including
  any recorded override.
- `daemon.status` returns health, last dead-man ping info (field present;
  populated by Epic 029), and the last verify report; `daemon.verify` triggers
  the Epic 018 engine (a read-only engine run) and stores + returns its report —
  the report record is the method's **single declared write**, excluded from
  the zero-write read list (debate finding).
- `audit.taskTimeline` returns a task's ordered timeline (Epic 019.5's
  `queryTaskTimeline`) — events with `observed_failure_signal` and, on model-call
  events, `account_id` + `model`; plus the outbound read-only **session-event
  stream** (subscription) from Epic 019.5. **Thin wiring only — the logic is 019.5;
  026 exposes it** (do not re-implement the timeline, per-call record, or SIGNAL_MAP
  here). Reads perform zero writes.
- A phases.md-surface checklist test enumerates each required surface and
  asserts a descriptor method covers it (the gate's method-by-method check) —
  **including the 019.5 audit-timeline + session-event surface.**

## Constraints

- Read methods perform zero writes (write-counting seam, Epic 009 standard).
- All data comes from existing seams (store, SQLite views, ledger, registry
  loaders) — no shadow state kept by the RPC layer.

## Verification Gate

- `npm test` green for `src/rpc/read-surfaces.test.ts`.

### Task T1 - Feature + broker surfaces

**Input:** `src/rpc/read-surfaces.ts`, `src/rpc/read-surfaces.test.ts`

**Action - RED:** Write tests on a golden compiled feature with in-flight fake
ops: (a) list + drill-down fields; (b) broker op views incl. an expiring op;
(c) verb registry view with tiers; (d) zero writes.

**Action - GREEN:** Implement the feature + broker read methods over existing
seams.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Slots, budgets, daemon-ops + surface checklist

**Input:** `src/rpc/read-surfaces.ts`, `src/rpc/read-surfaces.test.ts`

**Action - RED:** Write tests: (a) slot view with leases + sessions; (b) budget
view with breaker state; (c) daemon status incl. verify trigger returning the
Epic 018 report; (d) the phases.md surface checklist maps every surface to a
descriptor method and finds no write method for plans/registries.

**Action - GREEN:** Implement the remaining read methods.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
