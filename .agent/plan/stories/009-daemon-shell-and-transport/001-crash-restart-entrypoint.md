# Story 001 - Daemon Wiring & Crash/Restart Entrypoint

Epic: `.agent/plan/epics/009-daemon-shell-and-transport.md`

## Goal

The daemon boot path: wire the Phase-1 components into one process, and on start
rebuild runtime state from markdown + reconcile in-flight ops from the ledger, so a
kill and restart reproduces the pre-crash state. This is the entrypoint the §7.7
lifecycle harness drives.

## Acceptance Criteria

- `bootDaemon({ featureDir, clock, store, logger, ... })` returns a **single
  lifecycle object** with `start` / `stop` / `restart` semantics and injected
  collaborators — not a bag of ad-hoc initializers (debate finding — the "single
  process" property must be observable, not implied) (PRD §3.1).
- On boot the entrypoint rebuilds the queue/derived state **from markdown**
  (Epic 003 `rebuildFromMarkdown`) and marks interrupted ops needs-reconciliation
  **from the ledger** (Epic 005 `recoverFromLedger`) (PRD §5, §6.1).
- **Queue derivation is from markdown, provably not from stale SQLite** (debate
  finding): the restart test starts from an **empty/absent** SQLite (or recomputes and
  compares) so a pass proves rebuild-from-markdown, never "load stale derived rows."
- After a **simulated kill** (discard the in-memory runtime, keep markdown + ledger),
  a restart reconstructs the **full §7.7 recovery invariant** — the pending-task set
  (Epic 004), the in-flight-op reconciliation state (Epic 005), lease ownership
  **re-established per Epic 004 semantics** (a crashed holder's lease is reclaimable/
  re-acquired by the resuming task, not a stale row preserved byte-identical), **and
  the current workflow phase + injected STATE of any resuming task** — the latter two
  restored by **invoking the Epic 006 respawn coordinator**, not re-implemented here
  (gap B2: phases.md requires restart to reproduce phase + injected STATE, which the
  boot path previously did not own). All equal to the durable pre-kill state (PRD §7.7;
  §7.3 lease reclaim).
- The injected **structured logger** receives records for boot, the recovery summary,
  and (Story 002) server-listen (PRD §3.1 — structured logs).
- Boot is deterministic on the injected clock — no real timers or waits (PRD §7.7).

## Constraints

- The crash/restart entrypoint, the compaction respawn (Epic 006), and task-boundary
  respawn are the **same recovery philosophy** (PRD §3.2) — boot recovery reuses the
  Epic 003 rebuild + Epic 005 reconcile paths, not a parallel implementation.
- All collaborators are injected (clock, store, fake broker) so the harness (Epic 010)
  can drive kill/restart deterministically (PRD §7.7).
- No Connect dependency here (that is Story 002) — this Story is pure in-process boot.

## Verification Gate

- `npm test` green for `src/daemon/boot.test.ts`.

### Task T1 - Boot wires components + rebuilds from markdown/ledger

**Input:** `src/daemon/boot.ts`, `src/daemon/boot.test.ts`

**Action - RED:** Write a test that `bootDaemon` on a compiled golden feature dir with
an **empty** SQLite rebuilds the queue from markdown (proving markdown-not-SQLite) and
marks any in-flight ledger op needs-reconciliation, returns a single lifecycle object
with `start`/`stop`/`restart`, and the injected logger received a structured boot +
recovery-summary record.

**Action - GREEN:** Implement `bootDaemon` returning the lifecycle object, wiring the
components, calling `rebuildFromMarkdown` (Epic 003) + `recoverFromLedger` (Epic 005)
on start, and logging structured boot/recovery records.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Kill + restart reproduces state field-by-field

**Input:** `src/daemon/boot.ts`, `src/daemon/boot.test.ts`

**Action - RED:** Write a test that captures the pending-task set, in-flight-op
reconciliation state, current workflow phase, and injected STATE of a resuming task
mid-run, discards the in-memory runtime (simulated kill) and the SQLite derived rows,
re-boots from the same markdown + ledger, and asserts: the pending-task set and
reconciliation state equal the durable pre-kill values; lease ownership is
re-established per Epic 004 semantics (re-acquired, stale lease reclaimable); and the
current phase + injected STATE equal their pre-kill values via the Epic 006 respawn
coordinator.

**Action - GREEN:** Ensure `bootDaemon` reconstructs solely from durable markdown +
ledger and, for resuming tasks, calls the Epic 006 respawn coordinator to restore
current phase + injected STATE — deferring to Epic 004 lease reclaim semantics.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
