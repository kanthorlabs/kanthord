# Story 6 — `abandon task` CLI + read view

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`
Depends on: Story 3 (`AbandonTask` + its typed errors), Story 4 (the requeue that clears the marker).

## Change

### 1. Read view — `src/app/task/get-task.ts`

Add a narrow consumer-owned source beside the existing four (lines 6-20):

```ts
interface RunningJobSource {
  listRunningJobsForTask(taskId: string): Array<{ revoked: boolean }>;
}
```

Add a **required** field to `GetTaskOutput` (after `landingCandidate`, line 43):

```ts
/** True while a revoked run drains. A marker on a `running` task, not a status. */
abandoning: boolean;
```

Constructor gains an optional 5th parameter, mirroring the existing `landing?: LandingSource` shape at line 56:

```ts
  constructor(
    tasks: TaskSource,
    results: ResultSource,
    context: ContextSource,
    landing?: LandingSource,
    jobs?: RunningJobSource,
  )
```

In `execute()`, compute it and include it in the returned object:

```ts
const abandoning =
  this.#jobs?.listRunningJobsForTask(id).some((j) => j.revoked) ?? false;
```

The 12 existing `new GetTask(` call sites in tests (`src/app/task/get-task.test.ts:89,114,130,167,206,223,248,262,314,332,343` and `src/apps/cli/get-task.test.ts:107`) keep compiling; they now assert `abandoning: false`.

`src/composition.ts:372-377` must pass `jobQueue` as the 5th argument:

```ts
const getTask = new GetTask(
  taskRepository,
  taskRepository,
  taskRepository,
  landingRepository,
  jobQueue,
);
```

### 2. `src/apps/cli/task.ts` — the handler

`runGetTask` (lines 250-337): in the non-`--json`, non-`--result` branch, push one line **only when true**, after the `status` line (line 307) — so existing expected output is unchanged for every non-abandoning task:

```ts
if (output.abandoning) lines.push("abandoning: true");
```

`--json` needs no change: it prints `JSON.stringify(output)`, which now carries `abandoning`.

Add a new exported handler, modelled on `runApproveTask` (lines 129-140):

```ts
export async function runAbandonTask(
  args: Record<string, unknown>,
  abandonTask: AbandonTask,
): Promise<HandlerResult> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  const reason = args["reason"];
  if (typeof reason !== "string" || reason === "") {
    return { ...toResult(new MissingFlagError("--reason")), stdout: [] };
  }
  try {
    const outcome = abandonTask.execute({ taskId: id, reason });
    const note =
      outcome.outcome === "abandoning"
        ? `task abandoning: ${id} (lease revoked; draining at the next turn boundary)`
        : `task already abandoning: ${id}`;
    return { exitCode: 0, stdout: [id], stderr: [note] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
```

Both outcomes exit 0 — the second `abandon` in Proof phase B must not fail.

### 3. New file `src/apps/cli/commands/abandon/task.ts`

Exact shape of `src/apps/cli/commands/reject/task.ts` (the existing `--id` + `--reason` leaf):

```ts
export function buildAbandonTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description(
      "Abandon a running task: revoke its run's lease and requeue it.",
    )
    .configureHelp({ commandUsage: () => "kanthord abandon task" })
    .requiredOption("--id <id>", "ID of the running task to abandon")
    .requiredOption("--reason <reason>", "why the run is being abandoned")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord abandon task --id task-1 --reason 'stuck on a slow tool'\n",
    )
    .action(async (opts: { id: string; reason: string }) => {
      emitResult(
        await runAbandonTask(
          { id: opts.id, reason: opts.reason },
          deps.abandonTask,
        ),
        io,
      );
    });
}
```

### 4. New file `src/apps/cli/commands/abandon.ts`

Exact shape of `src/apps/cli/commands/reject.ts:8-21` (including the `preSubcommand` `copyInheritedSettings` hook), with one `addCommand(buildAbandonTaskCommand(deps, io))`.

### 5. `src/apps/cli/index.ts`

- Add `const abandon = buildAbandonCommand(deps, io).name("abandon");` in the const block (lines 45-70), immediately after the `reject` line (line 56).
- Add `.addCommand(abandon)` immediately after `.addCommand(reject)` (line 92).
- No `.option(` / `.action(` in `index.ts` (enforced by `src/apps/cli/architecture.test.ts:34-39`).

### 6. `src/apps/cli/deps.ts`

Add `abandonTask: AbandonTask;` immediately after `rejectTask: RejectTask;` (line 173), plus the `import type { AbandonTask } from "../../app/task/abandon-task.ts";` in the type-import block (lines 1-62).

### 7. `src/apps/cli/error-map.ts`

Import the three Story-3 errors from `../../app/task/abandon-task.ts` and add them to the `toResult` union (which currently ends at line 118 with `InvalidNumericFlagError`):

```ts
    err instanceof TaskNotAbandonableError ||
    err instanceof NoRunningJobError ||
    err instanceof AmbiguousRunningJobError ||
```

Unregistered errors are rethrown (`error-map.ts:122`), so omitting any of the three crashes the CLI.

### 8. `src/apps/cli/architecture.test.ts`

- `EXPECTED_LEAF_FILE_COUNT` 65 → **66** (line 28), extending the doc comment with `013 Story 6 adds abandon/task.ts`.
- `EXPECTED_LEAF_COUNT` 67 → **68** (line 31).

## Constraints

- `--id` and `--reason` are both `requiredOption`. Do not default the reason.
- Every typed error still exits **1** with `error: <message>` on stderr — the existing single mapping at `error-map.ts:120`. Do not introduce per-error exit codes.
- `TaskNotAbandonableError`'s message must name the actual status (Story 3 fixes the text); the CLI must not rewrite it.
- `abandoning` on `get task --json` is derived from the queue only. Do not read or write `tasks.status`.
- Human-readable `get task` output for a non-abandoning task must be byte-identical to today's.

## Verify

- New file `src/apps/cli/commands/abandon/task.test.ts` — command-tree convention of `src/apps/cli/commands/retry/task.test.ts` with the `capture()` helper from `src/apps/cli/commands/mutation.test.ts:16-33`:
  - `["--id","task-1","--reason","stuck"]` calls `deps.abandonTask.execute` with exactly `{ taskId: "task-1", reason: "stuck" }`, exit code 0, stdout is `"task-1\n"`.
  - missing `--id` and missing `--reason` each exit non-zero via Commander's `requiredOption`.
- `node --test src/apps/cli/task.test.ts` — add `runAbandonTask` unit tests:
  - `already_abandoning` outcome → exit 0, stdout `[id]`, stderr mentions `already abandoning`.
  - `TaskNotAbandonableError("t1","completed")` thrown → exit 1, stderr is exactly `error: task t1 is not abandonable (status: completed)`.
  - `NoRunningJobError` and `AmbiguousRunningJobError` each → exit 1 with their message (proves they are registered in `error-map.ts`).
  - empty `--id` / empty `--reason` → `error: missing required flag --id` / `--reason`.
- `node --test src/apps/cli/get-task.test.ts src/app/task/get-task.test.ts`:
  - `--json` output includes `abandoning: false` when no `RunningJobSource` is wired and when the source reports no revoked job.
  - `--json` output includes `abandoning: true` when the source reports a running job with `revoked: true`, while `status` stays `"running"`.
  - human output gains the line `abandoning: true` only in that case, and is otherwise unchanged (existing expected-line assertions must pass untouched).
- `node --test src/apps/cli/architecture.test.ts` — the two count assertions pass at 66 / 68, and `kanthord commands` lists `abandon task` with both flags (the table is derived from the live Commander tree, `src/apps/cli/commands/commands.ts:52-60` — no extra registry).
- `node --test src/apps/cli/error-map.test.ts` — the three new errors map to `{ exitCode: 1 }`.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/abandon-run-proof.sh` runs end to end and prints `013 ok: lease revoked, run drained, task requeued, late writes fenced, re-run clean`. This story delivers phase **B**'s `abandon task` command and the `abandoning:true` / `status:running` reads, and the final `013 ok:` line.
