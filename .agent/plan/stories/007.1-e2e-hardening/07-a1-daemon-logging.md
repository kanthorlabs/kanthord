# Story 07 — A1: daemon lifecycle logging (Logger port → stdout)

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

`daemon run` logs nothing today — all trace lives in the `events` table. This
story adds a `Logger` capability port and wires a `StdoutLogger` into the daemon
path so the operator sees each lifecycle transition on stdout as it happens:
task claimed, agent started, verification running + result, and final
outcome + reason. Local machine = sensitive-ok; full-detail lines are fine (layer
2 per the epic design notes).

The `Logger` port follows hexagonal rules: the use case takes the port; the CLI
provides the stdout sink. Tests use `NullLogger`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/logger/port.ts  (NEW)
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
```

```ts
// src/logger/null.ts  (NEW)
export class NullLogger implements Logger {
  info(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
}
```

```ts
// src/logger/stdout.ts  (NEW)
export class StdoutLogger implements Logger {
  info(message: string): void; // process.stdout.write(message + "\n")
  warn(message: string): void; // process.stderr.write("[warn] " + message + "\n")
  error(message: string): void; // process.stderr.write("[error] " + message + "\n")
}
```

```ts
// src/app/task/run-daemon.ts — RunDaemonDeps gains logger
interface RunDaemonDeps {
  recover: Recover;
  enqueueReady: EnqueueReady;
  runNext: RunNextTask;
  sleep: (ms: number) => Promise<void>;
  logger: Logger; // NEW — use NullLogger in tests that don't inspect lines
}
// RunDaemon.execute() logs after each non-idle runNext result:
//   "task <taskId>: claimed"       — logged before runNext returns
//                                    (see composition wiring note below)
//   "task <taskId>: agent started" — from the agent.started emit callback
//   "task <taskId>: verifying"     — from the task.verification start emit
//   "task <taskId>: verification <pass|fail|timeout>"  — from task.verification end
//   "task <taskId>: completed"
//   "task <taskId>: failed — <reason>"
//   "task <taskId>: escalated"
// RunDaemon itself logs the final outcome line from the runNext result.
// The finer lines (agent started, verifying) arrive via the composition emit hook.
```

```ts
// src/composition.ts — buildDeps emit extension
// The existing `emit` callback (passed to PiAgentRunner and used by RunNextTask)
// is extended to also call logger.info(...) for these event types:
//   agent.started     → "task <taskId>: agent started"
//   task.verification + phase:"start" → "task <taskId>: verifying"
//   task.verification + phase:"end"   → "task <taskId>: verification <exitClass>"
// The logger instance is threaded through buildDeps and the buildDaemon factory.
// The buildDaemon factory signature changes to accept a Logger:
//   buildDaemon(failTaskIds: string[], logger?: Logger): RunDaemon
//   (defaults to NullLogger when logger is absent — backwards-compatible)

// src/apps/cli/daemon.ts — runDaemon receives a Logger
// function runDaemon(
//   args: Record<string, unknown>,
//   buildDaemon: (failTaskIds: string[], logger?: Logger) => RunDaemon,
//   logger: Logger,   // NEW — daemon run CLI passes new StdoutLogger()
// ): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>
```

## Constraints

- `Logger` is a plain interface — capability-named, no `I`-prefix, no vendor name.
- No `console.log` or `process.stdout.write` in use cases (`run-daemon.ts`,
  `run-next-task.ts`, `PiAgentRunner`). All output goes through the `Logger`
  port or the existing `#emit` → composition hook.
- The `RunDaemon` class logs only what `RunNextResult` gives it: the outcome and
  taskId. It does NOT query a task repo for the task title; the log line uses the
  id only. Finer-grained lines come from the emit hook in `composition.ts`.
- `NullLogger` is the test double for tests that don't care about log output.
  Tests that inspect lines use a simple array-collecting stub (defined inline in
  the test — no separate `SpyLogger` class in production code).
- The `buildDaemon` factory change (`logger?` parameter) is backwards-compatible:
  `RouterDeps.buildDaemon` type signature is updated accordingly.

## Verification Gate

- `node --test src/logger/logger.test.ts` — `StdoutLogger.info` writes to
  `process.stdout`; `NullLogger` does not throw.
- `node --test src/app/task/run-daemon.test.ts` — `RunDaemon` with a capturing
  logger stub records `"task T1: completed"` after `runNext` returns
  `{ outcome: "completed", taskId: "T1" }`.
- `node --test src/apps/cli/daemon.test.ts` — existing daemon tests pass with
  the updated `runDaemon` signature (logger parameter added); a new test asserts
  that a `StdoutLogger` passed to `runDaemon` is forwarded to `buildDaemon`.
- `npm run typecheck && npm run lint` clean.

---

### Task T1 — Logger port + NullLogger + StdoutLogger

**Requires:** Nothing beyond the existing codebase.

**Input:** (new files) `src/logger/port.ts`, `src/logger/null.ts`,
`src/logger/stdout.ts`, `src/logger/logger.test.ts`.

**Action — RED:** In `src/logger/logger.test.ts`: (a) `new NullLogger().info("x")`
does not throw and returns `undefined`; (b) constructing a `StdoutLogger` and
calling `.info("hello")` invokes a spy on `process.stdout.write` with `"hello\n"`.
Use `mock.method` from `node:test` (or a `WritableMock` stub) for the write spy.
Fails today: files do not exist.

**Action — GREEN:** Create the three files per the Locked contracts. `StdoutLogger`
uses `process.stdout.write` for `info` and `process.stderr.write` for `warn`/`error`.
Keep it to 3 one-liner method bodies; no buffering.

**Action — REFACTOR:** None.

**Output:** `Logger` port + `NullLogger` + `StdoutLogger` implemented; test green.

**Verify:** `node --test src/logger/logger.test.ts` green; `npm run typecheck` 0.

---

### Task T2 — Logger in RunDaemon + outcome lifecycle lines

**Requires:** T1, Story 06 (task.verification event type exists).

**Input:** `src/app/task/run-daemon.ts`, `src/app/task/run-daemon.test.ts`.

**Action — RED:** In `src/app/task/run-daemon.test.ts`: create a `RunDaemon` with
a capturing logger stub (a plain object `{ lines: string[], info(m){this.lines.push(m)},
warn(){}, error(){} }`); inject a `runNext` that returns `{ outcome: "completed",
taskId: "T1" }`; run `execute({ untilIdle: true })`; assert `logger.lines` contains
at least one entry matching `/task T1.*completed/`. Also test `outcome: "failed"`:
assert the line contains `"failed"`. Fails today: `RunDaemonDeps` has no `logger`
field.

**Action — GREEN:** Add `logger: Logger` to `RunDaemonDeps` interface and to the
`RunDaemon` constructor (store as `#logger`). In `execute()`, after each non-idle
`runNext` result, call:

- `this.#logger.info(\`task ${r.taskId}: ${r.outcome}\`)`for`completed`/`escalated`/`skipped`.
- `this.#logger.info(\`task ${r.taskId}: failed\`)`for`failed`(reason detail
comes from the emit hook, not from`RunNextResult`which does not carry reason).
Update all existing`RunDaemon`test instantiations to pass`logger: new NullLogger()`.

**Action — REFACTOR:** None.

**Output:** `RunDaemon` logs each task outcome via the port; tests green.

**Verify:** `node --test src/app/task/run-daemon.test.ts` green; typecheck 0.

---

### Task T3 — Composition emit hook + CLI wire-up

**Requires:** T1, T2, Story 06 (task.verification + agent.started event types).

**Input:** `src/composition.ts`, `src/apps/cli/daemon.ts`,
`src/apps/cli/daemon.test.ts`, `src/apps/cli/router.ts`.

**Action — RED:** In `src/apps/cli/daemon.test.ts`: add a test that passes a
capturing logger to `runDaemon` via the updated signature; run against a fake
`buildDaemon` that immediately idles (returns `{ exitCode: 0, escalatedCount: 0 }`);
assert the logger's `info` method was called (i.e., the logger flows through).
Also assert `runDaemon` still accepts calls without the logger parameter (logger
defaults to `NullLogger`). Fails today: `runDaemon` has no logger parameter.

**Action — GREEN:**

1. In `src/apps/cli/daemon.ts`: add `logger: Logger = new NullLogger()` as the
   third parameter to `runDaemon`. Pass it through to `buildDaemon(failTaskIds, logger)`.
2. In `src/composition.ts`: update the `buildDaemon` factory to accept an optional
   `logger?: Logger` (default `new NullLogger()`). Extend the `emit` closure that
   feeds `PiAgentRunner`:
   - When `type === "agent.started"`: `logger.info(\`task ${taskId}: agent started\`)`.
   - When `type === "task.verification"` and `payload.phase === "start"`:
     `logger.info(\`task ${taskId}: verifying\`)`.
   - When `type === "task.verification"` and `payload.phase === "end"`:
     `logger.info(\`task ${taskId}: verification ${payload.exitClass ?? "?"}\`)`.
Pass `logger`down to`new RunDaemon({ ..., logger })`.
3. In `src/apps/cli/router.ts`: the `daemon run` COMMANDS handler calls `runDaemon`
   with `new StdoutLogger()` as the logger argument.
4. Update `RouterDeps.buildDaemon` type to `(failTaskIds: string[], logger?: Logger) => RunDaemon`.

**Action — REFACTOR:** If the emit closure is long, extract a
`makeLifecycleLogger(logger: Logger): EmitFn` helper in `composition.ts`.

**Output:** `daemon run` emits lifecycle lines to stdout for all task transitions.
Existing tests remain green (NullLogger default).

**Verify:** `node --test src/apps/cli/daemon.test.ts` green; `npm run verify` clean.
