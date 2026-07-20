# Story 03 — Mutation verbs (10 leaves)

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`
Requires: Story 01 (shell). Independent of Story 02.

## Goal

Migrate the simple state-changing routes, each in its own file, composed under
its verb parent, wired into `buildProgram`:
`rename project|initiative|objective`, `pause initiative`, `resume initiative`,
`add dependency`, `remove dependency`, `retry task`, `approve task`,
`reject task`. Same handlers, same argument values, Commander only.

## Locked contracts

```ts
// commands/rename/{project,initiative,objective}.ts  — each --id <id> --name <name>
buildRenameProjectCommand /
  buildRenameInitiativeCommand /
  buildRenameObjectiveCommand;
buildRenameCommand(deps, io); // commands/rename.ts

// commands/pause/initiative.ts  --id <id>      -> buildPauseInitiativeCommand ; buildPauseCommand
// commands/resume/initiative.ts --id <id>      -> buildResumeInitiativeCommand ; buildResumeCommand
// commands/add/dependency.ts    --task --depends-on   -> buildAddDependencyCommand ; buildAddCommand
// commands/remove/dependency.ts --task --depends-on   -> buildRemoveDependencyCommand ; buildRemoveCommand
// commands/retry/task.ts        --id           -> buildRetryTaskCommand ; buildRetryCommand
// commands/approve/task.ts      --id           -> buildApproveTaskCommand ; buildApproveCommand
// commands/reject/task.ts       --id --resolution <retry|discard> [--reason] -> buildRejectTaskCommand ; buildRejectCommand
```

Follow the cross-cutting mapping rule from Story 02 (kebab keys: `add
dependency` / `remove dependency` handlers read `args["depends-on"]`; document
`--resolution` values in help, no `.choices()`).

## Verification Gate

`node --test src/apps/cli/commands/mutation.test.ts` green; existing
`initiative.test.ts`, `objective.test.ts`, `project.test.ts`, `dependency.test.ts`,
`task.test.ts` still green; `npm run typecheck` 0; `npm run lint` clean.

---

### Task T1 — `rename` parent + 3 leaves

**Requires:** Story 01 T4.

**Input:** `commands/rename.ts`, `commands/rename/{project,initiative,objective}.ts`
(new), `commands/mutation.test.ts` (new),
`src/apps/cli/{project,initiative,objective}.ts` (handlers).

**Action — RED:** for each leaf, build with a spy, `parseAsync
["--id","x","--name","y"]`, assert the spy got `{ id:"x", name:"y" }` and `cap`
captured the result; missing `--id` rejects. `--help` shows the route + example.
Fails today: modules do not exist.

**Action — GREEN:** create the three leaves (required `--id`/`--name`, example,
action → `emitResult(await runRenameX(args, deps.renameX), io)`) and `rename.ts`
composing them.

**Action — REFACTOR:** none.

**Output:** `rename project|initiative|objective` migrated.

**Verify:** `node --test src/apps/cli/commands/mutation.test.ts` green.

---

### Task T2 — `pause` / `resume` initiative

**Requires:** Story 01 T4.

**Input:** `commands/pause.ts`, `commands/pause/initiative.ts`,
`commands/resume.ts`, `commands/resume/initiative.ts` (new),
`commands/mutation.test.ts`, `src/apps/cli/initiative.ts`.

**Action — RED:** `pause initiative --id x` calls `runPauseInitiative({id:"x"},
deps.pauseInitiative)`; `resume initiative --id x` calls `runResumeInitiative`.
Assert spies + `cap`; missing `--id` rejects. Fails today: modules missing.

**Action — GREEN:** create both single-leaf verb groups per the pattern.

**Action — REFACTOR:** none.

**Output:** `pause initiative` and `resume initiative` migrated.

**Verify:** `node --test src/apps/cli/commands/mutation.test.ts` green.

---

### Task T3 — `add` / `remove` dependency

**Requires:** Story 01 T4.

**Input:** `commands/add.ts`, `commands/add/dependency.ts`,
`commands/remove.ts`, `commands/remove/dependency.ts` (new),
`commands/mutation.test.ts`, `src/apps/cli/dependency.ts`.

**Action — RED:** `add dependency --task t --depends-on d` calls
`runAddDependency` with `{ task:"t", "depends-on":"d" }` (kebab key); same for
`remove dependency`/`runRemoveDependency`. Assert spies + `cap`. Fails today:
modules missing.

**Action — GREEN:** create both verb groups; map `--depends-on` → the
`"depends-on"` key.

**Action — REFACTOR:** none.

**Output:** `add dependency` and `remove dependency` migrated.

**Verify:** `node --test src/apps/cli/commands/mutation.test.ts` green; existing
`dependency.test.ts` still green.

---

### Task T4 — `retry` / `approve` / `reject` task

**Requires:** Story 01 T4.

**Input:** `commands/retry.ts`, `commands/retry/task.ts`, `commands/approve.ts`,
`commands/approve/task.ts`, `commands/reject.ts`, `commands/reject/task.ts`
(new), `commands/mutation.test.ts`, `src/apps/cli/task.ts`.

**Action — RED:** `retry task --id x` → `runRetryTask`; `approve task --id x` →
`runApproveTask`; `reject task --id x --resolution discard --reason "why"` →
`runRejectTask` with `{ id, resolution, reason }`. Assert spies + `cap`; reject
documents `--resolution` values in `--help`. Fails today: modules missing.

**Action — GREEN:** create the three single-leaf verb groups; `reject` has
optional `--reason`, required `--id`/`--resolution` (values documented, not
`.choices()`).

**Action — REFACTOR:** none.

**Output:** `retry|approve|reject task` migrated.

**Verify:** `node --test src/apps/cli/commands/mutation.test.ts` green; existing
`task.test.ts` still green.

---

### Task T5 — wire all mutation verbs into `buildProgram`

**Requires:** T1–T4.

**Input:** `src/apps/cli/index.ts`, `src/apps/cli/index.test.ts`.

**Action — RED:** `buildProgram` `--help` lists `rename`, `pause`, `resume`,
`add`, `remove`, `retry`, `approve`, `reject`; parsing `["approve","task",
"--id","x"]` runs `runApproveTask`. Fails today: not added.

**Action — GREEN:** `program.addCommand(...)` for each of the eight mutation verb
parents in `index.ts`.

**Action — REFACTOR:** none.

**Output:** all mutation verbs reachable from the root.

**Verify:** `node --test src/apps/cli/index.test.ts` green; `npm run typecheck`
0; `npm run lint` clean.
