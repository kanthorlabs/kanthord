# Story S3 — daemon-failure observability

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decision 4)
Depends on: Story S2 (wraps the host S2 builds)

## Change

### 1. `src/apps/cli/serve-host.ts` — handle a rejected loop

S2 starts `promise = daemon.execute(...)` without awaiting it. An unawaited
rejection is an `unhandledRejection` and would kill the process. Attach a handler
at start:

```ts
promise.catch((err: unknown) => {
  failed = true;
  deps.logger.error(
    `daemon loop failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  cancelRenew();
  deps.daemonLease().release(ownerId);
  stopHeartbeat?.();
});
```

Release order is deliberate: the lease first, so a replacement claims it
immediately instead of waiting out the TTL; the heartbeat after, so readiness
reports `stopped` once the last beat goes stale.

Expose `readonly failed: boolean`. `stop()` after a failure must be safe: the
`#stopped` guard plus a `failed` check means release and heartbeat teardown run
exactly once.

### 2. `src/main.ts` — the `KANTHORD_DAEMON_FAIL_AT` seam

Mirror the `KANTHORD_MAX_TURNS` validate-and-exit shape at `src/main.ts:32-43`,
placed immediately after it:

```ts
// E2E seam (off by default): KANTHORD_DAEMON_FAIL_AT=<n> makes the hosted daemon
// loop reject on its nth dispatch, so a Proof can drive the failure path without
// a real fault. Used by scripts/e2e/http-daemon-ownership-proof.sh phase E.
const rawFailAt = process.env.KANTHORD_DAEMON_FAIL_AT;
let daemonFailAt: number | undefined;
if (rawFailAt !== undefined) {
  const parsed = Number(rawFailAt);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    process.stderr.write(
      `KANTHORD_DAEMON_FAIL_AT must be a positive integer, got: ${rawFailAt}\n`,
    );
    process.exit(1);
  }
  daemonFailAt = parsed;
}
```

Pass it through `buildDeps(dbPath, { maxTurns, sessionFactory, daemonFailAt })`
at `:73`.

### 3. `src/composition.ts` — inject the fault into the loop

Widen the `buildDeps` options type (`:186-189`) with `daemonFailAt?: number`.

Inside `buildDaemon` (`:488-621`), when `daemonFailAt !== undefined`, wrap the
`runNext` collaborator passed to `RunDaemon` at `:610`:

```ts
let dispatches = 0;
const runNextMaybeFailing =
  daemonFailAt === undefined
    ? runNext
    : {
        execute: async () => {
          dispatches += 1;
          if (dispatches >= daemonFailAt) {
            throw new Error(
              `KANTHORD_DAEMON_FAIL_AT=${daemonFailAt}: injected daemon failure`,
            );
          }
          return runNext.execute();
        },
      };
```

`runNext` is chosen over `enqueueReady` because its rejection propagates out of
`RunDaemon.execute()` unguarded.

## Constraints

- The seam is **off by default**: with the env var unset, `buildDaemon` must
  return the byte-identical wiring it returns today.
- The HTTP server must stay up. Do not call `server.close()`, do not
  `process.exit()`, do not set a non-zero exit code from the failure path.
- Release the lease BEFORE stopping the heartbeat. Reversed, a replacement sees a
  stale heartbeat with a still-held lease.
- Do not add an event type — Decision 10.

## Verify

- `node --test src/apps/cli/serve-host.test.ts` — add:
  - a `buildDaemon` whose `execute()` rejects gives `host.failed === true`,
    `release` called exactly once with the owner id, heartbeat stopped;
  - the rejection is consumed (the test completes and `logger.error` recorded the
    message), so no `unhandledRejection` escapes;
  - `stop()` after a failure does not release or stop the heartbeat twice;
  - a replacement `startServeHost` against the same fake lease store CLAIMS
    successfully immediately after the failure, **with no clock advance** — this
    is the assertion that distinguishes release-on-failure from expiry.
- `node --test src/composition.test.ts` — `buildDeps(path, {daemonFailAt: 1})`
  produces a daemon whose `execute()` rejects; with the option absent it does not.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-daemon-ownership-proof.sh` phase **E** — a daemon
  started with `KANTHORD_DAEMON_FAIL_AT=1` keeps answering reads, readiness goes
  `stopped`, and a fresh `serve` claims the lease and completes `probe 3`.
