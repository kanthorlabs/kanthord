# Story E — per-initiative claim exclusion (job queue)

Epic: `.agent/plan/epics/007.13-repository-publication.md`
Queue-only correctness fix. Protects the per-initiative clone invariant that
007.12 / 007.13 depend on: the clone is per-initiative, so all of an
initiative's tasks (across all its objectives) must run one at a time.

## Problem

`SqliteJobQueue.claim()` (`src/queue/sqlite.ts:23-39`) picks the oldest queued
job with NO filter on whether that job's initiative already has a running task.
"Tasks run sequentially within an initiative" is only true by convention (one
daemon per database), not enforced: two daemon processes against the same
`KANTHORD_DB` can each claim a different ready task of the SAME initiative, and
the shared per-initiative clone (`src/workspace/local.ts`) holds no lock during
task execution — so two concurrent tasks of one initiative would mutate the one
clone at once and corrupt the one-commit-per-objective invariant.

The exclusion unit is the INITIATIVE (not the objective): two objectives of one
initiative share the same clone and must also be serialized.

## Change

- `src/queue/sqlite.ts` — `SqliteJobQueue.claim()` (lines 23-39): add a
  `NOT EXISTS` sub-clause so the single atomic `UPDATE … RETURNING` skips any
  initiative that already has an in-flight (`status='running'`) task. Keep it
  ONE statement (do NOT split into select-then-update) so SQLite's writer
  serialization makes the exclusion atomic — a second concurrent `claim()` sees
  the first's `running` row. New SQL:
  ```
  UPDATE jobs SET status='running'
  WHERE id = (
    SELECT j.id FROM jobs j
    JOIN tasks t ON j.taskId = t.id
    JOIN objectives o ON t.objectiveId = o.id
    JOIN initiatives i ON o.initiativeId = i.id
    WHERE j.status='queued' AND i.paused = 0
      AND NOT EXISTS (
        SELECT 1 FROM jobs rj
        JOIN tasks rt ON rj.taskId = rt.id
        JOIN objectives ro ON rt.objectiveId = ro.id
        WHERE rj.status='running' AND ro.initiativeId = i.id
      )
    ORDER BY j.id LIMIT 1
  )
  RETURNING id, taskId
  ```

## Constraints

- `claim()` only. No change to `enqueue`, `finish`, `discard`,
  `listRunningJobs`, the broker, `enqueue-ready-tasks.ts`, or the approval flow.
- Single atomic SQL statement; no application-side select-then-update.
- Different initiatives (and different projects) still claim in parallel — the
  initiative filter already gives project-level parallelism for free.
- Rely on the existing `recover-interrupted-tasks` path (it resets a crashed
  `running` task) so a stale `running` row cannot deadlock an initiative
  permanently — do NOT add new recovery logic.

## Verify

- `node --test src/queue/sqlite.test.ts` — add two hermetic cases (real sqlite
  temp db, seed via the existing `project → initiative → objective → task`
  pattern already in the file; add a helper that seeds a task under a caller-
  supplied `initiativeId`/`objectiveId` so two tasks can share one initiative):
  - **SAME initiative → serialized.** Seed two ready tasks under ONE initiative
    (two objectives, or two tasks in one objective), `enqueue` both. First
    `claim()` returns task 1; a second `claim()` returns `undefined` while task
    1's job is still `running`; after `finish(job1, "completed")`, `claim()`
    returns task 2.
  - **DIFFERENT initiatives → parallel.** Seed one ready task in each of two
    initiatives, `enqueue` both. Two `claim()` calls both return a job (both
    initiatives may run at once).
- `npm run verify` exits 0.
- The 007.12 objective Proof still passes (one-commit-per-objective invariant
  intact).

## Action — RED

Write the SAME-initiative serialization test first. It fails today: with no
in-flight-initiative filter, the second `claim()` returns task 2 instead of
`undefined`.

## Non-goals

- No intra-initiative parallelism (this enforces the existing non-goal).
- No change to enqueue, broker, or approval flow — `claim()` only.
