# Story S2 — the execution host: `serve` runs the daemon

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decisions 2, 3)
Depends on: Story S1 (claims the lease S1 creates)

## Change

### 1. `src/apps/cli/serve-host.ts` (new) — the testable seam

`buildServeCommand` has no test (`src/apps/cli/serve.test.ts` covers only
`parsePort`), so host logic must not live inside the Commander action. Mirror
`src/apps/cli/daemon.ts`: a plain exported function over injected collaborators.

```ts
export interface ServeHostDeps {
  buildDaemon: (
    failTaskIds: string[],
    failTransient?: Record<string, number>,
    logger?: Logger,
  ) => RunDaemon;
  daemonLease: () => DaemonLeaseRepository;
  heartbeat: { start(): () => void };
  logger: Logger;
  now: () => number;
  pid: number;
  ttlMs: number;
  /** Injected so tests drive renewal without real timers. */
  schedule: (fn: () => void, ms: number) => { cancel(): void };
  /** Bounded drain, default 30_000. */
  drainTimeoutMs?: number;
}

export interface ServeHost {
  readonly running: boolean;
  readonly failed: boolean;
  readonly reason?: string;
  stop(): Promise<void>;
}

export function startServeHost(deps: ServeHostDeps): ServeHost;
```

Behaviour, in this exact order:

1. `ownerId = daemonInstanceId(deps.pid, startedAtMs)` — reuse
   `src/app/task/daemon-heartbeat.ts:40-42`, so lease owner and heartbeat row
   share one identity.
2. `daemon = buildDaemon([], {}, logger)` BEFORE the `try`, mirroring
   `daemon.ts:68`, so a throwing factory never leaves a started heartbeat.
3. `claim({ownerId, pid, nowMs: now(), ttlMs})`. On `false`, read the row and
   return `{running: false, failed: false, reason: "another daemon owns the lease (pid <n>)"}`.
   **The HTTP server still starts.** No throw, no non-zero exit.
4. On a win: `stopHeartbeat = heartbeat.start()` as the FIRST statement inside the
   `try`, exactly as `daemon.ts:84-85`.
5. `promise = daemon.execute({untilIdle: false})` — started, not awaited. Retain it.
6. Renew on `schedule(..., Math.floor(ttlMs / 3))`, calling
   `daemonLease().renew({ownerId, nowMs: now(), ttlMs})`.
7. `stop()`: `daemon.stop()`, await `promise` under `drainTimeoutMs`, cancel the
   renew schedule, `daemonLease().release(ownerId)`, then `stopHeartbeat()` LAST,
   mirroring `daemon.ts:120-126`. A `#stopped` flag makes a second call a no-op.

`ttlMs` is supplied by the caller as
`resolveStaleMs(process.env["KANTHORD_HEARTBEAT_STALE_MS"])` — one knob for both
liveness signals, and both Proofs already set it.

### 2. `src/apps/cli/commands/serve.ts` — the flag and the wiring

Add after the `--port` option (`:15-19`):

```ts
    .option("--no-daemon", "serve the API only; do not run the execution loop")
```

Commander maps `--no-daemon` to `opts.daemon === false`, defaulting `true`.

In the action, after `startHttpServer` (`:88-91`) and BEFORE the signal block,
start the host when `opts.daemon !== false`; log the outcome through
`deps.httpLogger` so it lands in `serve.log` as JSON.

Replace the signal block at `:93-97`:

```ts
let shuttingDown = false;
const stop = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.removeListener("SIGTERM", onSignal);
  process.removeListener("SIGINT", onSignal);
  await host?.stop();
  await server.close();
};
const onSignal = (): void => {
  void stop();
};
process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);
```

`host` is `undefined` under `--no-daemon`.

### 3. `src/apps/cli/commands/run/daemon.ts` — the CLI daemon claims too

Decision 3: the claim lives in the startup path shared by both, or a terminal
daemon still races. `runDaemon` (`src/apps/cli/daemon.ts:17-22`) gains an
optional 5th parameter
`lease?: { claim(): boolean; release(): void; reason(): string }`. When supplied
and `claim()` returns false, return
`{exitCode: 1, stdout: [], stderr: ["error: another daemon owns the lease: <reason>"]}`
**before** `buildDaemon` is called (`:68`). On a win, `release()` goes in the
existing `finally` at `:120-126`, before `stopHeartbeat?.()`.

`buildRunDaemonCommand` passes it, built from `deps.daemonLease()`.

### 4. The three fixture proofs — same commit

Add `--no-daemon` to the single `serve` launch line in each:
`scripts/e2e/http-serve-proof.sh:103`, `http-reads-proof.sh:142`,
`http-writes-proof.sh:178`, each becoming

```bash
( cd "$PD" && exec node "$ROOT/src/main.ts" serve --no-daemon --port 0 ) >"$PD/serve.log" 2>&1 &
```

If 022's and 025's proofs also start `serve`, they get the same flag.

## Constraints

- **Bounded drain.** `RunDaemon.stop()` (`src/app/task/run-daemon.ts:93-95`) only
  sets a flag and does NOT interrupt the poll sleep at `:204`, so awaiting the
  promise can take one `pollIntervalMs` plus the in-flight task. `stop()` races
  the await against `drainTimeoutMs`; on timeout it logs a warning, releases the
  lease, and continues shutting down. It must never hang the process.
- **Call `heartbeat.start()` exactly once** — it is not idempotent at composition
  level (`src/composition.ts:725-742`).
- Losing the lease is NOT an error for `serve` (exit 0, API still serves). It IS
  an error for `run daemon` (exit 1) — that command has no other purpose.
- Do not print to stdout from the host. All three fixture proofs grep
  `serve.log` for `{"msg":"listening","port":N}`; use `deps.httpLogger`.
- Surgical: do not touch the `HttpDeps` literal at `serve.ts:39-86`.

## Verify

- `node --test src/apps/cli/serve-host.test.ts` (new; fully hermetic, all fakes,
  mirroring `src/apps/cli/daemon-heartbeat-bracket.test.ts:1-39`):
  - order is `claim → heartbeat.start → execute`, asserted via an events array;
  - `stop()` order is `daemon.stop → await execute → release → heartbeat stop`;
  - a lost claim returns `{running: false}` with a reason naming the holder's pid,
    and neither `heartbeat.start` nor `execute` runs;
  - `stop()` twice runs teardown once;
  - a rejected `execute()` still releases the lease and stops the heartbeat;
  - a throwing `buildDaemon` leaves no started heartbeat;
  - the injected `schedule` fires renewal with the same `ownerId`;
  - a drain that never settles hits `drainTimeoutMs`, releases, and resolves.
- `node --test src/apps/cli/daemon.test.ts` — add: `runDaemon` with a lease whose
  `claim()` returns false exits 1, writes the stderr line, and never calls
  `buildDaemon`. Existing tests stay green (the parameter is optional).
- `scripts/e2e/http-serve-proof.sh`, `http-reads-proof.sh`,
  `http-writes-proof.sh` all still pass with `--no-daemon`.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-execution-proof.sh` phases **B**, **C**, **I**;
  `scripts/e2e/http-daemon-ownership-proof.sh` phases **B**, **C**, **D**.
