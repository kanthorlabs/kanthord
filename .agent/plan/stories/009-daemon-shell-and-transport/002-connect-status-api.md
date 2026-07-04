# Story 002 - Connect RPC Server: /healthz & Read-Only Status

Epic: `.agent/plan/epics/009-daemon-shell-and-transport.md`

## Goal

Prove the transport-layer seam: a Connect RPC server exposing `/healthz` and one
read-only status method that returns the current feature/task status from SQLite —
no mutating operations, no auth, no web client.

## Acceptance Criteria

- The daemon starts a Connect RPC server; `/healthz` (a **plain HTTP route** on the
  same server, per the spike, not an RPC method) returns a healthy response (PRD §3.1).
- The server binds to **loopback** (`127.0.0.1`/`::1`); a test asserts the bind
  address is **not** `0.0.0.0` (PRD §9 never-`0.0.0.0` principle; no auth in Phase 1).
- A read-only `status` method returns the current feature and task statuses derived
  from the SQLite state (the same rows the scheduler uses) (phases.md — minimal
  read-only status API).
- The surface is proven read-only by **introspecting the registered service
  descriptor** (only the allowed read method(s) present; no sign-off/approval/halt/
  mutate/control method in the descriptor) **and** by a write-counting store seam
  showing a `status` call performs **zero** writes (debate finding — descriptor-level,
  not a superficial absence).

## Constraints

- Transport is **Connect RPC** (connectrpc.com) — one server, no Envoy (PRD §3.1
  Layer 2). Uses the Connect deps + generated stubs the maintainer prerequisite
  provisioned (Epic 009 Prerequisite; engineers cannot add deps or generated code).
- Handlers are hand-written in `src/` against the generated service stubs; the
  generated code itself is out of the engineer lane (`*generated*/*` forbidden).
- Read-only only — the status method issues no writes; control actions are Phase 2
  (Epic 009 Non-Goals).
- The server reads status through the Epic 001 SQLite seam / scheduler views, not a
  second source of truth.

## Verification Gate

- `npm test` green for `src/daemon/status-server.test.ts` (server bound locally in
  the test).
- Spike findings (`connect-surface.md`) exist and are cited by the implementation.

### Task T1 - /healthz responds healthy

**Input:** `src/daemon/status-server.ts`, `src/daemon/status-server.test.ts`

**Action - RED:** Write a test that starts the Connect server on loopback and a client
call to the plain `/healthz` HTTP route returns healthy; and assert the bind address
is `127.0.0.1`/`::1` and not `0.0.0.0`.

**Action - GREEN:** Implement the Connect server bootstrap (per the spike findings)
with a plain `/healthz` HTTP route bound to loopback, started by the daemon shell.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Read-only status method over SQLite

**Input:** `src/daemon/status-server.ts`, `src/daemon/status-server.test.ts`

**Action - RED:** Write a test that, after compiling a golden feature, the `status`
method returns the feature + task statuses from SQLite; introspect the registered
service descriptor and assert only the allowed read method(s) are present (no
control/mutate method); and, using a write-counting store seam, assert the `status`
call performs zero writes.

**Action - GREEN:** Implement the read-only `status` handler reading the scheduler/
SQLite views; register only read methods on the descriptor.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
