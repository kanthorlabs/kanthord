# EPIC 007.12 — Initiative-branch git workflow — stories

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
**Prereq: EPIC 007.11 (bare home) must land first.**

Initiative = branch `kanthord/init/<initId>` in the bare home; objective = one
commit on it; task = a sequential working unit. Agents build in a disposable,
origin-less, `--no-hardlinks` clone; **only the daemon writes the bare home**.

## Dispatch order

1. **D** (state machines + event contract) + **F-harness** (`objectiveIds`
   export + `make-initiative-graph.sh`) first — everything else needs them.
2. **A → B → C** in order.
3. **E** after C. **F delivery hook + daemon summary** last.

Largest epic in the chain; consider D + F-harness as one unit, then A/B/C.

## Stories

- A — initiative branch + isolated clone → `01-initiative-branch-isolated-clone.md`
- B — sequential tasks → one objective commit → `02-sequential-tasks-one-objective-commit.md`
- C — broker (daemon-only integration) → `03-broker-daemon-only-integration.md`
- D — state machines + events → `04-state-machines-and-events.md`
- E — objective conflict + freshness → `05-objective-conflict-and-freshness.md`
- F — delivery + ergonomics + harness → `06-delivery-ergonomics-proof-harness.md`

## Facts (needed for implementation — all greenfield today)

- `Initiative`/`Objective` are bare entities with **no status field**, both in
  `src/domain/initiative.ts:4-20`; no `src/domain/objective.ts`, no transitions.
- No `get initiative` / `get objective` (only name→id `find`). Mirror `GetTask`
  (`src/app/task/get-task.ts:29-44`) + `src/apps/cli/commands/get/task.ts`.
- No `approve objective` (only `approve task`, `src/app/task/approve-task.ts`).
  Broker CAS mechanics to reuse: `src/landing/git.ts` `resolveTargetOID` (`:357`),
  `landPreviewed` CAS `update-ref <ref> <oid> <expectedOld>` (`:381-385/:426`).
- Events: closed tuple `task.*/agent.*/provider.*` (`src/domain/event.ts:3-21`);
  `Event.taskId` is **required non-null** (`:25-30`). Objective/initiative events
  need a contract change (Story D).
- `.kanthord-export.json` (written by `src/apps/cli/import-graph.ts:442-460`) has
  `initiativeId` but **no `objectiveIds`** — Story F adds it (+ in
  `src/app/graph/export-initiative.ts`).
- Per-task clone (`src/workspace/local.ts:620-651`) is hardlinked with `origin`
  present; initiative clone needs `--no-hardlinks --single-branch` + origin
  removed (Story A).
- Daemon summary reports only escalated task count
  (`src/apps/cli/daemon.ts:74-77`) — Story F adds objective/initiative lines.
- Per-task agent run is provisioned at `src/agent-runner/pi.ts:440-443`
  (`workspaces.prepare(task.id, source)`). Topological readiness:
  `readiness(allTasks)` in `src/domain/graph.ts`.
- Migrations must be **contiguous** (`src/storage/sqlite/migrate.ts:47-55`); use
  the next free version, don't hard-code.
