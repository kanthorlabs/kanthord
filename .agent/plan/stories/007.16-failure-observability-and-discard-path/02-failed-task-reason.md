# Story 2 — Persist + render a failed task's reason

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`

## Change

1. `src/app/task/run-next-task.ts:385-393` — the failure branch currently saves
   the task, finishes the job, and appends `task.failed`, but writes **no**
   `task_results` row. Add a `saveTaskResult` call inside the same transaction as
   the `failed` transition, so a crash can never leave a `failed` task with no
   reason:

   ```ts
   const reason = failReason ?? "unknown failure";
   const failedTask = transitionTask(runningTask, "failed");
   this.#store.save(failedTask);
   this.#queue.finish(jobId, "failed");
   this.#store.saveTaskResult(taskId, {
     workspace: null,
     branch: null,
     baseCommit: null,
     proposalCommit: null,
     commitSha: null,
     summary: null,
     reason,
     rejectionResolution: null,
     rejectionReason: null,
     evidence: null,
   });
   this.#feed.append(newEvent("task.failed", {/* unchanged */}));
   ```

   Use the exact same `reason` string already passed to the `task.failed`
   payload at `:391-393` — one value, two sinks, never divergent.

2. `src/apps/cli/task.ts:308` — after the existing
   `if (r.summary !== null) lines.push(\`summary: ${r.summary}\`);`, add:
   `if (r.reason !== null) lines.push(\`reason: ${r.reason}\`);`Insert it immediately after the`summary:` line so field order is stable.
3. Do **not** add an `attempts:` line (epic decision record).
4. `GetTask` (`src/app/task/get-task.ts`) needs **no** change — it already
   returns the whole `TaskResultRow` as `result`.

## Constraints

- `TaskResultRow.reason` (`src/storage/port.ts:156`) and the `task_results.reason`
  column already exist. **No migration.**
- Do not change the `task.failed` event payload.
- Do not touch the `completed` / `awaiting_confirmation` branches of
  `run-next-task.ts`.
- The transient-retry loop at `run-next-task.ts:193-215` is out of scope.

## Verify

- `node --test src/app/task/run-next-task.test.ts` — add a test asserting that
  after a run whose verification fails, `store.getTaskResult(taskId)` returns a
  row whose `reason` starts with `"VerificationFailedError"` and whose `summary`
  is `null`.
- `node --test src/app/task/failure-semantics.test.ts` — add a regression test
  asserting the persisted `reason` is **string-identical** to the `reason` in the
  emitted `task.failed` event payload.
- `node --test src/apps/cli/get-task.test.ts` — add a test that, given a task
  with `status: "failed"` and a result row with `reason: "VerificationFailedError: x (exit 1)"`,
  `stdout` contains a line exactly equal to
  `reason: VerificationFailedError: x (exit 1)`, and contains **no** line starting
  with `attempts:`. Mirror the `summary:` assertion at `get-task.test.ts:151-152`.
- `npm run verify` exits 0.
- Proof: delivers Proof line 1 —
  `node src/main.ts get task --id $ROOT | grep -q '^reason: VerificationFailedError'`
