# Story 7 — Run-scoped daemon summary

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`
Depends on: Story 2 (the failure `reason` must be persisted before the summary can
print it).

Dispatch this story **last**. It has an abort clause — read it first.

## Abort clause

The bug is that the summary counts the whole DB. The fix needs a definition of
"this run" that stays correct under (a) a task retried within the run, (b) a task
recovered by `recover-interrupted-tasks`, and (c) a task claimed by a _concurrent_
daemon on the same DB.

The definition this story ships is: **an initiative is in scope iff `RunDaemon`
observed at least one task of that initiative reach a terminal status during this
`execute()` call** — tracked as an in-memory `Set<string>` of initiative ids
accumulated by the loop that already dispatches tasks. Under (a) the initiative is
in scope once, not twice (it is a Set). Under (b) a recovered task counts, because
the recovery runs inside the same `execute()`. Under (c) a task claimed by another
daemon is _not_ observed by this one, so it is correctly out of scope.

If, while implementing, that definition proves insufficient — e.g. the dispatch
loop cannot cheaply learn a task's initiative id — **stop and escalate to the
human. Do not invent a different scope rule.** The epic explicitly prefers cutting
this story to guessing.

## Change

1. `src/app/task/run-daemon.ts:37-41` — the optional `InitiativeCounts` dep walks
   `listAllInitiatives()`, i.e. the entire DB. Stop using it for the counts.
   Instead, accumulate `#touchedInitiatives: Set<string>` during the run: each
   time the daemon finishes dispatching a task, add that task's initiative id
   (available via the store's `getInitiativeId(taskId)`, already used at
   `src/app/task/reject-task.ts`'s store interface).
2. Extend `RunDaemon`'s returned result with:
   - `landedInitiativeIds: string[]` — the touched initiatives whose status is
     `landed`, in ascending id order (deterministic).
   - `failedTasks: Array<{ id: string; reason: string }>` — tasks that reached
     `failed` during this run, in the order they failed, with `reason` read from
     the `task_results` row Story 2 now persists.
     Keep `escalatedCount` and the objectives-awaiting count, but compute the
     objectives count from touched initiatives only.
3. `src/apps/cli/daemon.ts:81-89` — reorder and rewrite the summary so **failures
   come first**:
   - For each entry of `failedTasks`:
     `stderr.push(\`task failed: ${id} — ${reason}\`)`.
   - Then `${failedTasks.length} task(s) failed` when non-zero.
   - Then the existing escalated / objectives-awaiting lines, unchanged in wording.
   - Then `${landedInitiativeIds.length} initiative(s) landed`, printed **only when
     non-zero** (today it prints a whole-DB count even when this run landed
     nothing).

## Constraints

- Do not change the daemon's exit code semantics.
- Do not add a DB table or migration — scope tracking is in-memory for one
  `execute()` call.
- The summary must be deterministic for a given run: sort initiative ids ascending;
  keep `failedTasks` in failure order.
- Leave the dispatch/claim logic itself untouched; this story only observes it.

## Verify

- `node --test src/app/task/run-daemon.test.ts` — add tests asserting:
  (a) with two initiatives in the store where the run touches only one, the result's
  `landedInitiativeIds` contains only the touched one; (b) a task that fails during
  the run appears in `failedTasks` with the `reason` from its persisted result row;
  (c) a task retried twice within one run yields a single initiative-id entry.
- `node --test src/apps/cli/daemon-summary.test.ts` — assert that for a run whose
  only task failed, `stderr` line 1 starts with `task failed: ` and contains the
  reason, and that **no** `initiative(s) landed` line is printed. Add the exact
  regression: a pre-existing unrelated `landed` initiative in the DB must not be
  counted.
- `npm run verify` exits 0.
- Proof: no dedicated Proof line — the epic's Proof block calls
  `run daemon --until-idle … || true` and does not assert on the summary text.
  This story's contract is covered by the two test files above.
