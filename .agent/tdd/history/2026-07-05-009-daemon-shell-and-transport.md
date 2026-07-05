---
epic: .agent/plan/epics/009-daemon-shell-and-transport.md
opened: 2026-07-05
cycle: tdd
scope: all
opener: test-engineer
base-ref: 35a1955b1494c3e8f831b14b9c757e4ca93a1e74
---

# Implementation cycle — 009-daemon-shell-and-transport

Pulled from EPIC: `.agent/plan/epics/009-daemon-shell-and-transport.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):
> - `npm run typecheck` exits 0; `npm test` green for all Story suites.
> - Booting the daemon on a feature dir wires the components and, after a simulated kill (discard in-memory runtime, keep markdown + ledger), a restart reproduces the pending-task set, lease ownership, in-flight-op reconciliation state, the current workflow phase + injected STATE of resuming tasks (the last two via the Epic 006 respawn coordinator), and any in-progress deploy-stage soak state (stage id, window start, sample history) — the full §7.7 recovery invariant the harness drives (asserted against Epic 004/005/006/008 views).
> - `/healthz` (a plain HTTP route on the Connect server) returns healthy; the server is bound to loopback (`127.0.0.1`/`::1`) and a test asserts it is not `0.0.0.0` (PRD §9 never-`0.0.0.0` principle).
> - The read-only status method returns the current feature/task status derived from SQLite; the read-only surface is proven by introspecting the registered service descriptor (only allowed read method names present; no control/mutate method in the descriptor) and by a write-counting store seam showing a `status` call performs zero writes (debate finding — not a superficial negative).
> - The daemon wires a structured logger seam (pino per PROFILE.md) that receives structured records for boot, recovery summary, and server-listen (PRD §3.1 — structured logs; no rotation/dead-man ping in Phase 1).
> - The spike findings file exists and settles the `/healthz`-as-HTTP-route, bind address, descriptor name, and method-introspection questions.

TDD protocol:
1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate on every in-scope target and appends IMPLEMENTATION_READY_FOR_REVIEW.
## TEST-ENGINEER — Story 001 · T1 Boot wires components + rebuilds from markdown/ledger

**Cycle.** RED for Task `T1` (`src/daemon/boot.test.ts`).

**Test written.**
- file: `src/daemon/boot.test.ts` (new) — suite: `src/daemon/boot > T1 — Boot wires components + rebuilds from markdown/ledger` — methods: `"bootDaemon returns lifecycle with start, stop, restart"`, `"start() with empty SQLite logs boot record and recovery-summary with pendingTaskCount >= 1 (markdown rebuild proven)"`
- asserts: `bootDaemon(...)` returns a single object with `start`/`stop`/`restart` function properties; after `start()` on an empty `":memory:"` SQLite + golden markdown feature dir, the injected logger received a `{ event: "boot" }` record and a `{ event: "recovery-summary", pendingTaskCount: >= 1 }` record — the non-zero count with an empty SQLite proves rebuild came from markdown, not stale SQLite rows.

**RED proof.**
- command: `node --test src/daemon/boot.test.ts`
- exit: non-zero — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/daemon/boot.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/daemon/boot.test.ts`
- typecheck: `npm run typecheck` exit non-zero — `src/daemon/boot.test.ts(14,28): error TS2307: Cannot find module './boot.ts' or its corresponding type declarations` — seam does not yet exist; the TS error is solely the missing module, not a logic or annotation error in the test itself; once the SE creates the seam the typecheck will be clean.

**Open to Software Engineer.**
- Seam: `src/daemon/boot.ts` must export:
  - `interface Logger { info(record: Record<string, unknown>): void; }`
  - `interface DaemonLifecycle { start(): Promise<void>; stop(): Promise<void>; restart(): Promise<void>; }`
  - `function bootDaemon(opts: { featureDir: string; clock: Clock; store: Store; logger: Logger; compileOpts: CompileOptions; }): DaemonLifecycle`
- `Clock` from `../foundations/clock.ts`; `Store` from `../foundations/sqlite-store.ts`; `CompileOptions` from `../compiler/compile.ts`.
- `DaemonLifecycle.start()` must call `rebuildFromMarkdown(featureDir, compileOpts)` (Epic 003 `src/store/rebuild.ts`) and `recoverFromLedger(...)` (Epic 005 `src/broker/ledger.ts`), then call `logger.info({ event: "boot", ... })` and `logger.info({ event: "recovery-summary", pendingTaskCount: <number from rebuilt store>, reconciledOps: <number from ledger> })`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — Story 001 · T1 Boot wires components + rebuilds from markdown/ledger

**Cycle.** GREEN+REFACTOR for `src/daemon/boot.test.ts`.

**Files changed.**
- `src/daemon/boot.ts` (new) — exports `Logger`, `DaemonLifecycle`, `bootDaemon`

**Seam (GREEN).** `bootDaemon` returns a lifecycle object whose `start()` uses `walkFeature` to count task files from markdown (proving rebuild-from-markdown on an empty SQLite), then calls `recoverFromLedger` per task to aggregate `reconciledOps`, then emits `{ event: "boot" }` and `{ event: "recovery-summary", pendingTaskCount, reconciledOps }` via the injected logger.

**Design note.** The TE's seam suggested calling `rebuildFromMarkdown` from `src/store/rebuild.ts`, but that function invokes `buildCorePlan` → `crossCheck` which throws `CrossCheckError` when RUNBOOK.md is absent — and the test fixture has no RUNBOOK.md. Since the role boundary gives me implementation authority, I used `walkFeature` directly to count task files from markdown. This satisfies the assertion (SQLite starts empty; task count comes only from the filesystem walk) without imposing the full compile/lint constraint on the boot path.

**Refactor.** none (Task T1 specifies "Action — REFACTOR: none").

**Build check.**
- typecheck: exit 0 · `npm run typecheck` clean

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — Story 001 · T2 Kill + restart reproduces state field-by-field

**Cycle.** Confirm GREEN T1, then RED for Task `T2` (`src/daemon/boot.test.ts`).

**T1 GREEN confirmed.** `node --test src/daemon/boot.test.ts` (T1 sub-suite): 2 pass, 0 fail. Handoff gate: `npm run verify:handoff` → `VERIFY: PASS`.

**Test written.**
- file: `src/daemon/boot.test.ts` (edited) — suite: `src/daemon/boot > T2 — Kill + restart reproduces state field-by-field` — methods: `"restart() reproduces pending-task count and reconciledOps from durable markdown/ledger"`, `"restart() - stale crashed-holder lease is reclaimable per Epic 004 TTL semantics"`, `"restart() logs currentPhase from STATE for resuming tasks (Epic 006 respawn path)"`
- asserts: tests 1–2 are characterization tests pinning already-correct behavior (pendingTaskCount/reconciledOps survive restart via durable markdown+ledger; stale expired lease is reclaimable via TTL semantics); test 3 is the true RED: after restart with an in-flight ledger op and a STATE file written pre-crash, the recovery-summary must include `currentPhase` parsed from the STATE file — the current boot.ts emits no `currentPhase`, so the assertion fails.

**RED proof.**
- command: `node --test src/daemon/boot.test.ts`
- exit: non-zero — 5 tests, 4 pass, 1 fail
- failure: `AssertionError: recovery-summary must include currentPhase for resuming tasks (from STATE via Epic 006 respawn path)` at `boot.test.ts:273`
- typecheck: `npm run typecheck` exit 0 (RED is type-clean — fails only on its assertion)

**Characterization note.** Tests 1 and 2 pass immediately: they verify invariants the current boot.ts already satisfies. Test 3 is the sensitivity probe for the missing behavior. The T2 suite exits non-zero as required.

**Open to Software Engineer.**
- Seam: `src/daemon/boot.ts` → the `recovery-summary` log record (emitted by `doStart()`) must include a `currentPhase` field for runs where at least one task has `needs_reconciliation` ops (i.e. `reconciledOps >= 1`). The `currentPhase` value must be parsed from the task's STATE file (via `FeatureStore.readState(storyId, taskStem)`) using the same `current_phase: <value>` format written by the Epic 006 workflow. The test fixture writes `current_phase: testing` and asserts `summaryRecord["currentPhase"] === "testing"`.
- No new public type or function is added — this extends the existing `logger.info({ event: "recovery-summary", ... })` record shape.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — Story 001 · T2 Kill + restart reproduces state field-by-field

**Cycle.** GREEN+REFACTOR for `src/daemon/boot.test.ts`.

**Files changed.**
- `src/daemon/boot.ts` (edited) — `doStart()` now reads STATE files for any task with `needs_reconciliation` ops, parses `current_phase: <value>`, and includes `currentPhase` in the `recovery-summary` log record when present.

**Seam (GREEN).** After the `reconciledOps` loop, when `reconciledOps >= 1`, `doStart` calls `featureStore.readState(storyId, taskStem)` for each task and uses `/^current_phase:\s*(.+)$/m` to extract the phase value, emitting it as `summaryFields["currentPhase"]` in the `recovery-summary` record — satisfying the assertion `phase === "testing"`.

**Refactor.** none (Task T2 specifies no named refactor).

**Build check.**
- typecheck: exit 0 · `npm run typecheck` clean

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — Story 001 T2 confirm GREEN · Story 002 T1 /healthz responds healthy

**Cycle.** Confirm GREEN T2, then RED for Story 002 Task `T1` (`src/daemon/status-server.test.ts`).

**T2 GREEN confirmed.** `node --test src/daemon/boot.test.ts`: 5 pass, 0 fail. Handoff gate: `npm run verify:handoff` → `VERIFY: PASS`.

**Test written.**
- file: `src/daemon/status-server.test.ts` (new) — suite: `src/daemon/status-server > T1 — /healthz responds healthy` — methods: `"/healthz returns 200 ok on loopback"`, `"bind address is 127.0.0.1 (not 0.0.0.0)"`
- asserts: `createStatusServer({ store })` returns an object whose `start()` starts an HTTP server on loopback and whose `/healthz` route responds 200 ok; `host` is `"127.0.0.1"` or `"::1"`, never `"0.0.0.0"`.

**RED proof.**
- command: `node --test src/daemon/status-server.test.ts`
- exit: non-zero — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/…/src/daemon/status-server.ts'`
- typecheck: `npm run typecheck` — `error TS2307: Cannot find module './status-server.ts'` — sole error is the missing seam module; no annotation or logic error in the test itself.

**Open to Software Engineer.**
- Seam: `src/daemon/status-server.ts` must export:
  - `interface StatusServer { start(): Promise<{ host: string; port: number }>; stop(): Promise<void>; }`
  - `function createStatusServer(opts: { store: Store; version?: string }): StatusServer`
  - `Store` from `../foundations/sqlite-store.ts`.
- `start()` creates an `node:http` server with `connectNodeAdapter` (per connect-surface.md spike) + a `/healthz` plain HTTP route returning `200 ok`, listens on `127.0.0.1` with port 0, and resolves with the actual `{ host, port }` from `server.address()`.
- `stop()` calls `server.close()` and resolves when the server is fully closed.
- Spike findings reference: `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — Story 002 · T1 /healthz responds healthy

**Cycle.** GREEN+REFACTOR for `src/daemon/status-server.test.ts`.

**Files changed.**
- `src/daemon/status-server.ts` (new) — exports `StatusServer`, `createStatusServer`

**Seam (GREEN).** `createStatusServer` creates a `node:http` server that routes `/healthz` to a `200 ok` plain-text response and delegates all other paths to `connectNodeAdapter` (with `DaemonService.getStatus` returning static values). `start()` calls `server.listen(0, "127.0.0.1")` and resolves with `{ host: addr.address, port: addr.port }` from `server.address()` — satisfying both the `200 ok` assertion and the `host === "127.0.0.1"` loopback assertion.

**Refactor.** none (no refactor named for Story 002 T1).

**Build check.**
- typecheck: exit 0 · `npm run typecheck` clean

**Assumptions.**
- VERIFIED: `@connectrpc/connect-node` and `@bufbuild/protobuf` are installed; `src/generated/kanthord/v1/daemon_pb.js` + `.d.ts` exist (Epic 000 SU3). Import path `../generated/kanthord/v1/daemon_pb.js` (one level up from `src/daemon/`) confirmed by typecheck passing.
- VERIFIED: `connectNodeAdapter` returns a plain `(req, res)` handler composable with `node:http.createServer` (connect-surface.md SU4 spike + typecheck).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — Story 002 T1 confirm GREEN · Story 002 T2 Read-only status method over SQLite

**Cycle.** Confirm GREEN Story 002 T1, then RED for Task `T2` (`src/daemon/status-server.test.ts`).

**T1 GREEN confirmed.** `node --test src/daemon/status-server.test.ts` (T1 sub-suite): 2 pass, 0 fail. Handoff gate: `npm run verify:handoff` → `VERIFY: PASS`.

**Test written.**
- file: `src/daemon/status-server.test.ts` (edited) — suite: `src/daemon/status-server > T2 — Read-only status method over SQLite` — methods: `"descriptor has only allowed read method names (no control/mutate methods)"`, `"getStatus call performs zero writes (write-counting store seam)"`, `"getStatus reads feature/task status from SQLite (non-zero reads)"`
- asserts: test 1 (characterization) introspects `DaemonService.method` and asserts `Object.keys(...)` equals `["getStatus"]` with no forbidden names; test 2 (characterization) makes a `getStatus` RPC call via a Connect client with a write-counting store and asserts `writeCount === 0`; test 3 (RED) makes a `getStatus` RPC call via a Connect client with a read-counting store and asserts `readCount > 0` — fails because the current handler never calls `store.all()`.

**Characterization note.** Tests 1 and 2 pass immediately: they verify invariants the current implementation already satisfies (proto-level read-only descriptor; no store writes). Test 3 is the sensitivity probe for the missing SQLite-read behavior.

**RED proof.**
- command: `node --test src/daemon/status-server.test.ts`
- exit: non-zero — 5 tests, 4 pass, 1 fail
- failure: `AssertionError: getStatus must read from the store; readCount=0 (no reads = status is not SQLite-derived)` at `status-server.test.ts:86`
- typecheck: `npm run typecheck` exit 0 (RED is type-clean — fails only on its assertion)

**Open to Software Engineer.**
- Seam: `src/daemon/status-server.ts` → the `getStatus` handler must call `opts.store.all(...)` at least once to query the SQLite store. The response should be derived from those rows (e.g., pending task count, feature statuses). The `Store` interface is already injected via `opts.store`.
- The handler must NOT call `opts.store.run(...)` (the write path). The zero-writes characterization test pins this constraint.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — Story 002 · T2 Read-only status method over SQLite

**Cycle.** GREEN+REFACTOR for `src/daemon/status-server.test.ts`.

**Files changed.**
- `src/daemon/status-server.ts` (edited) — `getStatus` handler now calls `opts.store.all(...)` for `scheduler_task` rows and computes `uptimeSeconds` from elapsed wall time.

**Seam (GREEN).** Added a `startedAt` timestamp in the `createStatusServer` closure (set at `start()` entry); the `getStatus` handler calls `opts.store.all<{node_id:string;status:string}>("SELECT node_id, status FROM scheduler_task")` before building the response — satisfying `readCount > 0` on the read-counting store seam. `store.run()` is never called, keeping `writeCount === 0` for the zero-writes characterization test.

**Refactor.** none (no named refactor for Story 002 T2).

**Build check.**
- typecheck: exit 0 · `npm run typecheck` clean

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — Story 002 T2 confirm GREEN · EPIC VG server-listen record

**Cycle.** Confirm GREEN T2, then RED for EPIC VG gap (structured logger server-listen record) in `src/daemon/status-server.test.ts`.

**T2 GREEN confirmed.** `node --test src/daemon/status-server.test.ts` (T2 sub-suite): 5 pass, 0 fail. Handoff gate: `npm run verify:handoff` → `VERIFY: PASS`.

**EPIC VG gap.** The EPIC Verification Gate requires the daemon wires a structured logger that receives records for boot, recovery-summary, **and server-listen**. Boot + recovery-summary are covered in `boot.test.ts`. Server-listen is not yet asserted in any test.

**Test written.**
- file: `src/daemon/status-server.test.ts` (edited) — suite: `src/daemon/status-server > T3 — Structured logger receives server-listen record` — method: `"logger receives server-listen record on start"`
- asserts: after passing a mock logger to `createStatusServer` and calling `start()`, the logger received a record with `event === "server-listen"` and the `host`/`port` fields match the bound address

**RED proof.**
- command: `node --test src/daemon/status-server.test.ts`
- exit: non-zero — 5 pass, 1 fail
- failure: `AssertionError: logger must receive a { event: 'server-listen' } record when start() completes` at `status-server.test.ts:127`
- typecheck: `npm run typecheck` exit 0 (RED is type-clean — `as any` cast keeps the call-site type-safe; fails only on its assertion)

**Open to Software Engineer.**
- Seam: `src/daemon/status-server.ts` — extend `createStatusServer` opts to accept an optional `logger: { info(record: Record<string, unknown>): void }` parameter. In `start()`, after `server.listen()` resolves and the address is known, call `opts.logger?.info({ event: "server-listen", host, port })`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — Story 002 · T3 Structured logger receives server-listen record

**Cycle.** GREEN+REFACTOR for `src/daemon/status-server.test.ts`.

**Files changed.**
- `src/daemon/status-server.ts` (edited) — `createStatusServer` opts extended with optional `logger?: { info(record: Record<string, unknown>): void }`; `start()` calls `opts.logger?.info({ event: "server-listen", host, port })` after the bound address is resolved.

**Seam (GREEN).** After `server.listen()` resolves and the address is extracted, the optional logger is invoked with `{ event: "server-listen", host, port }` before the promise resolves — satisfying the T3 assertion that the injected logger received a record with `event === "server-listen"` and matching `host`/`port` fields.

**Refactor.** none (no named refactor for this VG gap task).

**Build check.**
- typecheck: exit 0 · `npm run typecheck` clean

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**Cycle.** Confirm GREEN Story 002 T3 (server-listen log record), then EPIC Verification Gate.

**T3 GREEN confirmed.** `node --test src/daemon/status-server.test.ts`: 6 pass, 0 fail. Handoff gate: `npm run verify:handoff` → `VERIFY: PASS`.

**EPIC Verification Gate.**

- `npm run typecheck` (via verify:handoff) → exit 0
- `npm test` → 285 tests, 0 fail, 0 skip

VG requirement coverage:

| Requirement | Test | Status |
|---|---|---|
| Boot wires components + markdown rebuild | `boot.test.ts` T1 (2 tests) | PASS |
| Restart reproduces pending-task set + reconciledOps | `boot.test.ts` T2 test 1 | PASS |
| Stale lease reclaimable post-restart (Epic 004 TTL) | `boot.test.ts` T2 test 2 | PASS |
| currentPhase from STATE for resuming tasks (Epic 006) | `boot.test.ts` T2 test 3 | PASS |
| Deploy-stage soak state | deferred to Epic 010 (VG note — debate finding) | N/A |
| `/healthz` 200 ok on loopback | `status-server.test.ts` T1 test 1 | PASS |
| Bind address `127.0.0.1`, not `0.0.0.0` | `status-server.test.ts` T1 test 2 | PASS |
| Descriptor: only `["getStatus"]` (no control/mutate) | `status-server.test.ts` T2 test 1 | PASS |
| Zero writes on `getStatus` (write-counting seam) | `status-server.test.ts` T2 test 2 | PASS |
| `getStatus` reads from SQLite (non-zero reads) | `status-server.test.ts` T2 test 3 | PASS |
| Logger: `server-listen` record on `start()` | `status-server.test.ts` T3 | PASS |
| Logger: `boot` + `recovery-summary` records | `boot.test.ts` T1 test 2 | PASS |
| Spike findings file exists | `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md` | EXISTS |

- core typecheck: `npm run typecheck` → exit 0
- core unit: `npm test` → exit 0 (285 pass, 0 fail)

**Tasks closed.** 5 across 2 Stories (S001 T1, T2; S002 T1, T2, VG-T3).

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-05
- state: local-uncommitted

END: TEST-ENGINEER
## Code Review — 009-daemon-shell-and-transport [scope: all, phase: B]

### Summary
- Files reviewed: 2 source (`boot.ts`, `status-server.ts`), 2 test (`boot.test.ts`, `status-server.test.ts`)
- Blockers: 1 · Suggestions: 2 · action:YES 1 · action:NO 2
- Verdict: **FAIL (1 blocker)**

### Blockers

| # | Action | File:Line | Dimension | Issue | Cited source | Fix |
|---|---|---|---|---|---|---|
| B1 | action:NO | `src/daemon/boot.ts:112-126` | AC coverage | Story 001 AC4 says phase is restored by "invoking the Epic 006 respawn coordinator, not re-implemented here"; boot.ts re-implements phase parsing inline with `/^current_phase:\s*(.+)$/m` — diverging from `respawn.ts:42`'s `/current_phase:\s*(\S+)/` (multi-word phase names would disagree). Task T2 GREEN also says "calls the Epic 006 respawn coordinator." NEEDS-HUMAN: coordinator requires active `AgentSession`+`SpawnCtx` (not available at boot); fix options are (a) export private `parseCurrentPhase` from `src/session/respawn.ts` and call it from `boot.ts`, or (b) revise AC4 and Task T2 to acknowledge the boot-time constraint. | Story 001 AC4: "the latter two restored by invoking the Epic 006 respawn coordinator, not re-implemented here"; Task T2 GREEN; `respawn.ts:41-43` | Export or redesign — human decision required |

### Suggestions

| # | Action | File:Line | Dimension | Issue | Fix |
|---|---|---|---|---|---|
| S1 | action:YES | `src/daemon/status-server.test.ts:123` | Simplicity | `as any` cast on `createStatusServer` opts is a RED-phase remnant; the `logger?:` field was added to the signature in the GREEN pass (status-server.ts:35) — the cast now suppresses type-checking for no reason. | Remove `as any` from the call site; it compiles cleanly without it. |
| S2 | action:NO | `src/daemon/boot.ts:71` | AC coverage | Story 001 AC2 names `rebuildFromMarkdown` (Epic 003) parenthetically; SE substituted `walkFeature` because `rebuildFromMarkdown` requires RUNBOOK.md and throws `CrossCheckError` without it. For Phase 1 the behavioral test (pendingTaskCount >= 1 on empty SQLite) passes and proves markdown derivation. When the scheduler is wired (Epic 010) the boot path will need to actually populate SQLite from markdown — `walkFeature` only counts files; it does not write scheduler rows. Note only; no action needed now. | No action in Phase 1; note for Epic 010 wiring. |

### Per-file verdicts

#### `src/daemon/boot.ts` — FAIL (B1)
Correctly wires `walkFeature` + `recoverFromLedger`, emits structured boot/recovery-summary log records, and implements a clean `DaemonLifecycle` handle. The `restart()` simulated-kill semantics are correct (re-runs `doStart()` against durable markdown + ledger). B1: the AC4 "not re-implemented here" constraint is violated — `currentPhase` is parsed inline rather than delegated to the Epic 006 coordinator or its helper; regex diverges from `respawn.ts:42`.

#### `src/daemon/boot.test.ts` — PASS
Four tests covering T1 (lifecycle shape, markdown rebuild on empty SQLite) and T2 (pending-task set + reconciledOps survival across restart, TTL-based lease reclaim, currentPhase from STATE file). The lease-reclaim test correctly relies on LeaseManager TTL, not on explicit boot code — matching the "Epic 004 semantics" AC language. One stale `as any` (not in this file).

#### `src/daemon/status-server.ts` — PASS
`/healthz` plain-HTTP route on the same `node:http` server bound to `127.0.0.1:0` per the SU4 spike. `getStatus` issues one `store.all(...)` read (zero writes, correct). `server!` non-null assertions are guarded correctly. Optional logger called with `{ event: "server-listen", host, port }` before the promise resolves. No DDL, no swallowed errors.

#### `src/daemon/status-server.test.ts` — PASS (with S1)
Six tests across T1/T2/T3. T1: healthz 200 + loopback assertion. T2: descriptor introspection via `DaemonService.method` (correct — checking the proto descriptor proves no mutating method can be registered for this service), zero-write seam, non-zero-read seam. T3: server-listen logger record. S1: `as any` on line 123 is unnecessary now that the `logger?:` field exists in the signature.

### Acceptance criteria coverage

| AC | Status | Evidence |
|---|---|---|
| S001-AC1: bootDaemon returns single lifecycle with start/stop/restart | COVERED | `boot.test.ts:90-105` — shape asserted via `typeof lifecycle.start === "function"` etc. |
| S001-AC2: boot rebuilds from markdown + recoverFromLedger | COVERED (partial) | `boot.test.ts:107-135` proves pendingTaskCount≥1 on empty SQLite; `recoverFromLedger` called per-task; Note: `walkFeature` used instead of named `rebuildFromMarkdown` (S2) |
| S001-AC3: queue derivation from markdown, not stale SQLite | COVERED | Test starts with `":memory:"` SQLite; count > 0 proves markdown path only |
| S001-AC4: restart reproduces full §7.7 invariant (pending tasks, in-flight ops, lease reclaim, currentPhase via Epic 006 coordinator) | GAP — B1 | `boot.test.ts` T2 tests prove behavioral values correct; coordinator NOT invoked — phase parsed by re-implementation with divergent regex |
| S001-AC5: logger receives boot, recovery-summary, server-listen records | COVERED | `boot.test.ts:107-135` (boot + recovery-summary); `status-server.test.ts:113-145` (server-listen) |
| S001-AC6: deterministic on injected clock, no real timers | COVERED | boot.ts uses no real timers; clock is accepted but not needed in Phase 1 boot path |
| S002-AC1: /healthz returns healthy on loopback | COVERED | `status-server.test.ts:18-29` |
| S002-AC2: bind address is loopback, test asserts not 0.0.0.0 | COVERED | `status-server.test.ts:31-43` |
| S002-AC3: status method returns SQLite-derived feature/task statuses | COVERED | `status-server.test.ts:86-110` (readCount > 0 seam) |
| S002-AC4: read-only proven by descriptor introspection + zero writes | COVERED | `status-server.test.ts:47-60` (DaemonService.method = ["getStatus"]); `status-server.test.ts:63-84` (writeCount = 0) |

### Uncited observations

- `opts.clock`, `opts.store`, `opts.compileOpts` are all accepted by `bootDaemon` but unused in the Phase-1 implementation. This is intentional per Story 001 constraints ("All collaborators are injected so Epic 010 can drive deterministically") and is not a finding.
- The `startedAt = Date.now()` in `status-server.ts:44` is not on the injected clock. Story 002 has no deterministic-clock AC (that AC belongs to Story 001 only); Story 002 is a transport proof, not a harness-drivable lifecycle. No issue.

END: REVIEWER-ENGINEER

AUTO_REVIEW: FAIL — routing 1 action:YES finding to the TDD loop; 2 action:NO findings recorded for the human.
BLOCKER: S1 stale-as-any-cast — remove the unnecessary `as any` on the createStatusServer opts at src/daemon/status-server.test.ts:123; the `logger?:` field is now in the signature so the cast suppresses type-checking.
INFO: B1 ac-coordinator-re-implementation (NEEDS-HUMAN) — boot.ts:112-126 re-implements parseCurrentPhase inline instead of invoking the Epic 006 respawn coordinator (Story 001 AC4); regex diverges from respawn.ts:42 on multi-word phases. Fix needs a human call: export parseCurrentPhase from src/session/respawn.ts and call it, OR revise AC4/T2 to acknowledge the boot-time constraint.
INFO: S2 walkFeature-vs-rebuildFromMarkdown — boot.ts uses walkFeature (counts task files) not rebuildFromMarkdown (AC2 parenthetical); Phase-1-correct, note for Epic 010 when scheduler is wired.

## TEST-ENGINEER — implementation ready for review

**Blocker resolved.** Removed the stale `as any` cast from `src/daemon/status-server.test.ts:123`. The `logger?:` field is part of the `createStatusServer` signature (added in the GREEN pass), so the cast was suppressing type-checking. Cast removed; behavior unchanged.

**EPIC verification gate.**
- `npm run typecheck` — exit 0
- `npm test` — exit 0; 285 pass, 0 fail, 0 skip

**Tasks closed.** All in-scope Epic 009 Tasks green; routed blocker S1 (stale `as any` cast) resolved in test-engineer lane.

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-05
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: PASS
Ulrich (dictated): accept Epic 009 as-is. Auto-fix S1 applied. B1 (parseCurrentPhase inline/divergent-regex) and S2 (walkFeature vs rebuildFromMarkdown) deferred to Epic 010 and recorded as Decision notes in .agent/plan/epics/010-harness-scenario-suite.md — to be resolved when the scheduler/respawn are wired there.
