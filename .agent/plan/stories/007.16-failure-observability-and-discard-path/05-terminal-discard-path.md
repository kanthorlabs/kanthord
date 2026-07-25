# Story 5 — Terminal discard path + cascade

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`
Depends on: Story 1 (`contract.md` must exist and is the authority for every rule
below), Story 4 (migration 18 must be numbered before 19).

## Change

1. `src/domain/task.ts:85-94` — add two entries to `LEGAL_TRANSITIONS`:
   `"failed->discarded"` and `"pending->discarded"`. Add nothing else — in
   particular no `discarded->pending` (discarded is not retryable, contract §6).
2. `src/domain/initiative.ts:8-15` — add `"discarded"` to `OBJECTIVE_STATUSES`.
   `src/domain/initiative.ts:4` — add `"discarded"` to `INITIATIVE_STATUSES`.
3. `src/domain/initiative.ts:47-56` — add `"building->discarded"` to
   `LEGAL_OBJECTIVE_TRANSITIONS` and `"building->discarded"` to
   `LEGAL_INITIATIVE_TRANSITIONS`. Both are terminal: add no outbound edge.
4. `src/domain/event.ts:3-28` — add `"objective.discarded"` and
   `"initiative.discarded"` to `EVENT_TYPES`. Reuse the existing
   `"task.discarded"` (`:13`).
5. **Migration 19** in `src/storage/sqlite/migrations.ts`,
   `name: "007.16-s5-discarded-status"` — widen two `CHECK (status IN (…))`
   constraints by table rebuild:
   - `objectives`: add `'discarded'` to
     `('building','awaiting_confirmation','conflict','integrated')`.
   - `initiatives`: add `'discarded'` to `('building','landed')`. This rebuild
     **must** set `disableForeignKeys: true` — `objectives.initiativeId`
     references `initiatives(id)`; copy the flag and its explanatory comment from
     the version-17 migration (`migrations.ts:377-383`).
   - First check `tasks.status`'s CHECK list: it already contains `'discarded'`.
     If so, leave `tasks` alone.
6. `src/app/task/reject-task.ts:73` — the guard
   `if (task.status !== "awaiting_confirmation") throw new TaskNotAwaitingConfirmationError(...)`
   must additionally accept `failed` **only** when
   `resolution === "discard"`. Precise rule:
   - `awaiting_confirmation` → both resolutions allowed (unchanged).
   - `failed` + `discard` → allowed (new).
   - `failed` + `retry` → still throws `TaskNotAwaitingConfirmationError`
     (`retry task` is the verb for that path; do not duplicate it here).
   - any other status → unchanged behavior.
     Leave the `completed` → `RejectionConflictError` check at `:69-71` above it
     untouched and first.
7. **Cascade**, implemented in `reject-task.ts` inside the existing
   `#uow.transaction`. After discarding the target task, compute the dependent
   closure with a new pure helper in `src/domain/graph.ts`:

   ```ts
   export function dependentClosure(
     nodes: GraphNode[],
     rootId: string,
   ): string[];
   ```

   Breadth-first from `rootId`, following edges _into_ nodes that list a visited
   node in their `dependencies`, visiting siblings in **ascending id order**, and
   returning ids in visit order excluding `rootId`. The caller then transitions
   each returned task **whose status is `pending`** to `discarded`, skipping any
   other status. Each cascaded task emits
   `newEvent("task.discarded", { taskId, payload: { reason: "cascade", origin: rootId } })`.
   Skipped tasks are collected and returned so the CLI can report them.

8. **Objective + initiative rollup**, same transaction, after the cascade — per
   contract §4/§5: if every task of the objective is `completed` or `discarded`
   **and at least one is `discarded`**, `transitionObjective(obj, "discarded")`
   and append `objective.discarded` with `payload: { reason }`. Then if every
   objective of the initiative is `integrated` or `discarded` **and at least one
   is `discarded`**, `transitionInitiative(init, "discarded")` and append
   `initiative.discarded`.
9. **`reject objective`** — new use case
   `src/app/objective/reject-objective.ts` exporting `RejectObjective` with
   `execute({ objectiveId, resolution: "retry" | "discard", reason?: string })`:
   - `discard`: allowed from `building`, `awaiting_confirmation`, `conflict`.
     Discards every non-terminal task of the objective (`pending` → `discarded`;
     `failed` → `discarded`), then applies steps 8's rollup.
   - `retry`: allowed from `awaiting_confirmation` and `conflict` only; delegates
     to the existing `RetryObjective` behavior — do **not** reimplement it.
   - Any other source status throws `ObjectiveNotAwaitingConfirmationError`.
10. CLI wiring: add a `reject objective` subcommand with `--id`,
    `--resolution retry|discard`, `--reason` in `src/apps/cli/objective.ts`
    (mirror `runRetryObjective` at `:105-117`), register it in the `reject`
    command table in `src/apps/cli/index.ts` beside `reject task`, and construct
    `RejectObjective` in `src/composition.ts` beside `ApproveObjective`.
11. `scripts/e2e/make-discard-graph.sh` — new script taking `<out-dir>`, writing a
    graph with `ref: root-task` (Verification `test -f src/definitely-missing-on-purpose.mjs`,
    which can never pass) and `ref: dep-task` (`dependencies: [root-task]`), plus
    a `.fake-agent.json` so the no-model daemon path drives it. Copy the structure
    of `scripts/e2e/make-landing-graph.sh`.

## Constraints

- `contract.md` from Story 1 is authoritative. If any rule here disagrees with it,
  stop and escalate — do not pick one.
- `readiness()` (`src/domain/graph.ts:156-177`) must **not** change: it already
  treats only `completed` as satisfying an edge, which is exactly the required
  semantics. Adding `discarded` to the satisfied set would be the bug this epic
  exists to prevent.
- `discarded` must never allow an objective to reach `awaiting_confirmation` or
  `integrated`.
- Every task/objective/initiative write in the discard flow happens in **one**
  `#uow.transaction` — a crash must not leave a partial cascade.
- Migration **19**. Do not renumber 18.

## Verify

- `node --test src/domain/task.test.ts` — `failed->discarded` and
  `pending->discarded` succeed; `discarded->pending`, `completed->discarded`, and
  `running->discarded` each throw `IllegalTransitionError`.
- `node --test src/domain/initiative.test.ts` — `building->discarded` succeeds for
  both objective and initiative; any transition **out of** `discarded` throws.
- `node --test src/domain/graph.test.ts` — `dependentClosure` on the 5-node TODO
  shape (root + 4 dependents) returns the 4 dependent ids in ascending-id order;
  on a chain a→b→c returns `[b, c]`; on a node with no dependents returns `[]`.
- `node --test src/app/task/reject-task.test.ts` — (a) `failed` + `discard`
  succeeds and the task is `discarded`; (b) `failed` + `retry` throws
  `TaskNotAwaitingConfirmationError`; (c) discarding a root cascades its `pending`
  dependents to `discarded` while a `completed` dependent is left untouched and
  reported as skipped; (d) each cascaded task has a `task.discarded` event with
  `payload.reason === "cascade"` and `payload.origin === rootId`; (e) the
  objective becomes `discarded` and emits `objective.discarded`; (f) the
  initiative becomes `discarded` and emits `initiative.discarded`; (g) **no**
  `objective.integrated` event is ever appended.
- `node --test src/app/objective/reject-objective.test.ts` — new file: `discard`
  from each of `building` / `awaiting_confirmation` / `conflict` reaches
  `discarded`; `retry` from `building` throws; `discard` from `integrated` throws.
- `node --test src/storage/sqlite/migrations.test.ts` — a fresh migrated DB
  accepts `UPDATE objectives SET status='discarded'` and
  `UPDATE initiatives SET status='discarded'` without a CHECK violation.
- `node --test src/apps/cli/objective.test.ts` — `reject objective` requires
  `--id` and `--resolution`, and an unknown resolution exits non-zero.
- `npm run verify` exits 0.
- Proof: delivers Proof lines 2, 3 and 4 (first block), and provides
  `scripts/e2e/make-discard-graph.sh` used by the whole first Proof block.
