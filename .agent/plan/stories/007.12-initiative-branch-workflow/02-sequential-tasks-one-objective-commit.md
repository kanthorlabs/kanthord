# Story B — sequential tasks → one objective commit

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
Depends on: Story A (clone), Story D (objective state).

## Change

Run an objective's tasks sequentially in the Story A initiative clone and squash
to one commit at the objective boundary. Today each task builds in its own clone
(`src/workspace/local.ts:608-676`); `RunNextTask` claims jobs one at a time via
`readiness(allTasks)` (`src/app/task/run-next-task.ts:114`).

- **Stable serial order** within an objective: topological over the task DAG
  (`src/domain/graph.ts`), tie-broken by explicit task order then task id.
  Deterministic across runs.
- Route the agent run for an initiative-clone task to the Story A clone dir (not
  `prepare(taskId, …)`). Each task's work stays as ordinary commits on
  `kanthord/init/<initId>` inside the clone.
- When all of an objective's tasks are `completed`, squash its accumulated
  commits into **exactly one commit** on `kanthord/init/<initId>` in the clone
  (`git reset --soft <objectiveParent>` + commit, or `commit-tree`), then move
  the objective to `awaiting_confirmation` (Story D). Record the objective-commit
  OID + expected parent OID (previous objective's integrated commit, or the
  initiative base for the first).
- **No home write** — the squashed commit stays in the clone until Story C.

## Constraints

- Sequential only; no intra-initiative parallelism.
- Reuse the claim/readiness/agent-run machinery — the change is _where_ the
  workspace comes from + the boundary squash.
- Initiative-clone tasks do **not** enqueue per-task `approve` gates (integration
  unit is the objective commit). Don't delete the 007.8 per-task path.

## Verify

- `node --test` (bare home + clone): two sequential tasks of one objective mutate
  the clone in stable order; after the last completes, the objective has exactly
  one new commit (`rev-list --count <parent>..<tip>` == 1); objective →
  `awaiting_confirmation`; bare home branch unchanged; recorded OID + parent
  match.
- `npm run verify` exits 0.
- Sets up Proof B (obj-A brokers as exactly one commit).
