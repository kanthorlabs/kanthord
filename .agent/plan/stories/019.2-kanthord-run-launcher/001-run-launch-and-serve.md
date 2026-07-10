# Story 001 - kanthord run: launch, serve, shut down

Epic: `.agent/plan/epics/019.2-kanthord-run-launcher.md`

## Goal

A dependency-injected `runDaemon(deps)` boots Core and serves: it runs
`initSchema` + the bootDaemon ledger recovery, starts the Epic 017 status/respond
HTTP surface on a configured loopback port, honours the broker hold-point config
flag, idles when nothing is dispatchable, and shuts down cleanly on signal. A thin
CLI shell `src/cli/run.ts` constructs the real adapters and calls it.

## Acceptance Criteria

- Given injected deps and a slot whose feature dir has no dispatchable task,
  `runDaemon(deps)` boots and the status HTTP surface answers `200` on the status
  endpoint bound to `127.0.0.1:<port>` (the configured port), and **no** pi
  session is spawned and **no** broker op is created (idle).
- Boot emits the Epic 009 structured `boot` and `recovery-summary` log records
  (recovery runs before the loop starts).
- With the hold-point config flag **set**, a broker verb submitted at the
  `pre-submit` cutpoint is recorded `held` and its adapter is **not** called; with
  the flag **unset** (default) the same verb reaches its adapter.
- On `stop()` (and on SIGTERM/SIGINT), the HTTP surface stops listening and
  `runDaemon` resolves with no dangling timer/handle keeping the process alive.
- `node src/cli/run.ts --help` prints usage naming the slot, port, and hold-point
  flags and exits `0`.

## Constraints

- **Full dependency injection** (cite Epic 009 `boot.ts` DI pattern / PRD §7.7):
  `runDaemon` receives every effect — slot loader, keyring, clock, pi surface,
  broker adapter set, and the status-server factory — as injected deps. Real
  adapters are constructed **only** in `src/cli/run.ts`. No `runDaemon` code path
  constructs a real network/model/keyring effect directly.
- **Loopback bind only** — the status surface binds `127.0.0.1`, never `0.0.0.0`
  (cite `src/daemon/status-server.ts` existing rule).
- **Hold-point reuse** — the LP4 cutpoint is the existing broker hold-point
  (`src/broker/hold-point.ts` wired in `submit.ts`), toggled by config; no new
  pause mechanism (cite Epic 019 hold-point).

## Verification Gate

- `npm test` green for `src/daemon/run-loop.test.ts`; `npm run typecheck` exits 0.
- The boot/serve/idle/shutdown and hold-point-flag behaviors above are asserted on
  a temp slot with doubles (no real network, no model call).

### Task T1 - boot, serve, idle

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test constructs `runDaemon(deps)` with injected doubles (fake
clock, a slot whose feature dir has no dispatchable task, a status-server factory,
a spy pi surface, spy broker adapters) and asserts: the status endpoint returns
`200` on `127.0.0.1:<port>`, no `spawnAgent` call occurred, no broker op row
exists, and the `boot`/`recovery-summary` log records were emitted.

**Action - GREEN:** `src/daemon/run-loop.ts` exports `runDaemon(deps)` that runs
`initSchema(store)`, performs the bootDaemon recovery, starts the injected
status-server on the configured loopback port, and enters an idle run-loop that
spawns nothing when the scheduler reports no dispatchable task.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T1 case green.

### Task T2 - graceful shutdown

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test starts `runDaemon`, calls the returned `stop()` (and
simulates a SIGTERM handler), and asserts the HTTP surface no longer accepts a
connection and the `runDaemon` promise/lifecycle resolves with no open handle.

**Action - GREEN:** `runDaemon` returns a lifecycle whose `stop()` closes the
status server and clears the run-loop timer; SIGTERM/SIGINT handlers call `stop()`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T2 case green; no leaked
handle (test process exits).

### Task T3 - hold-point config flag

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test boots `runDaemon` with the hold-point flag set and submits
a broker verb through the loop's broker path at the `pre-submit` cutpoint; asserts
the op is recorded `held` and the spy adapter's `submit` was not called. A second
case with the flag unset asserts the adapter **is** called.

**Action - GREEN:** the run-loop threads the config hold-point flag into the broker
`submit` `options.holdPoint` (reusing `src/broker/hold-point.ts`).

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T3 both cases green.

### Task T4 - CLI shell

**Input:** `src/cli/run.ts`, `package.json`

**Action - RED:** none - GREEN-only. Coverage of the shell's behavior is owned by
the T1–T3 run-loop tests (which exercise `runDaemon`) plus the maintainer LP1–LP4
runs; the shell only parses args and constructs the real adapters it injects.

**Action - GREEN:** `src/cli/run.ts` parses `--slot`, `--port`, `--hold-point`,
and `--help`; constructs the real deps (slot loader `src/slots/repo-slot.ts`,
keyring `src/git/keyring.ts`, system clock, real pi surface, real broker adapter
set) and calls `runDaemon(deps)`; installs SIGTERM/SIGINT → `stop()`. Add the
`start`/`run` script to `package.json` (named in Input so the lane check allows it).

**Action - REFACTOR:** none.

**Verify:** `node src/cli/run.ts --help` exits `0` and prints usage; `npm run
typecheck` exits 0.
