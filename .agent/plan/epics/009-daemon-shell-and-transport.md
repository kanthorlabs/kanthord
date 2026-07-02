# 009 Daemon Shell, Connect RPC & Crash/Restart Entrypoint

## Outcome

**One reviewable outcome — the daemon shell as a lifecycle + transport seam:** a
single process that wires every Phase-1 component together and owns both a
**boot/crash-restart lifecycle** (start / stop / restart-from-durable-state) and a
**Connect RPC server** (`/healthz` + a minimal read-only status API). The boot path
rebuilds runtime state **from markdown** (Epic 003) and reconciles in-flight ops from
the **ledger** (Epic 005) so a kill + restart reconstructs the recovery state from
durable truth, not RAM. The transport is proven with `/healthz` + read-only status,
no web client. Still no LLM, no network egress (the server binds to loopback only,
never `0.0.0.0`); everything downstream is fakes.

**Crash model:** Phase 1 proves **deterministic crash-equivalence recovery** — state
comes from durable markdown/ledger, not memory — via an in-process simulated kill. It
does **not** claim to prove OS process-death semantics (signal handling, unflushed
transactions, socket cleanup); a real child-process kill is deferred (debate finding
— name the limitation).

## Decision Anchors

- PRD §3.1 — single long-running process; `/healthz` on the Connect server;
  structured logs. Layer 2 Transport = Connect RPC (connectrpc.com) — one server
  serving gRPC / gRPC-Web / HTTP-JSON, no Envoy.
- PRD §5, §6.1 — on restart the broker rebuilds from the ledger and the queue
  rebuilds from frontmatter statuses (the entrypoint composes Epic 003 rebuild + Epic
  005 reconcile).
- PRD §7.7 — the crash/restart entrypoint is a required, injectable part of the
  lifecycle harness (respawn-equivalence is asserted through it).
- phases.md Phase 1 Deliverable 7 — daemon shell wiring + Connect server with
  `/healthz` + minimal read-only status API; "prove the transport seam, no web client
  yet."

## Prerequisite — Connect RPC toolchain (Epic 000 SU3 + SU4)

The Connect deps + generated read-only stubs (**Epic 000 SU3**) and the
Connect-on-Node-24 spike (**Epic 000 SU4**) are owned by the Epic 000 maintainer gate,
because the TDD lane cannot edit `package.json`/`scripts`/`*generated*` (lane-
forbidden). **Story `002` is blocked until SU3 + SU4 are verified green.** Story `001`
(crash/restart entrypoint) has **no** Connect dependency and can proceed without them.

What SU3/SU4 must guarantee for this Epic's Story 002 (recorded in the SU4 findings):
the descriptor contains **only** read methods (a `status` read; `/healthz` is a plain
HTTP route on the same server, not an RPC) — no control/mutate RPC; the loopback bind
(`127.0.0.1`/`::1`, never `0.0.0.0`); the generated import path + descriptor name; and
how the registered method set is inspectable (so Story 002 can introspect it).

## Stories

- `001-crash-restart-entrypoint.md` — the daemon boot path: wire components, rebuild
  runtime state from markdown + reconcile ledger on start; kill + restart reproduces
  the pre-crash state.
- `002-connect-status-api.md` — the Connect RPC server with `/healthz` and a minimal
  read-only status method over the SQLite state.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- Booting the daemon on a feature dir wires the components and, after a simulated kill
  (discard in-memory runtime, keep markdown + ledger), a restart reproduces the
  pending-task set, lease ownership, in-flight-op reconciliation state, **and the
  current workflow phase + injected STATE of resuming tasks** (the last two via the
  Epic 006 respawn coordinator) — the full §7.7 recovery invariant the harness drives
  (asserted against Epic 004/005/006 views).
- `/healthz` (a plain HTTP route on the Connect server) returns healthy; the server is
  bound to **loopback** (`127.0.0.1`/`::1`) and a test asserts it is **not** `0.0.0.0`
  (PRD §9 never-`0.0.0.0` principle).
- The read-only status method returns the current feature/task status derived from
  SQLite; the read-only surface is proven by **introspecting the registered service
  descriptor** (only allowed read method names present; no control/mutate method in
  the descriptor) **and** by a write-counting store seam showing a `status` call
  performs zero writes (debate finding — not a superficial negative).
- The daemon wires a **structured logger** seam (pino per PROFILE.md) that receives
  structured records for boot, recovery summary, and server-listen (PRD §3.1 —
  structured logs; no rotation/dead-man ping in Phase 1).
- The spike findings file exists and settles the `/healthz`-as-HTTP-route, bind
  address, descriptor name, and method-introspection questions.

## Dependencies

- **All prior epics (001–008)** — the shell wires them; the entrypoint composes Epic
  003 rebuild + Epic 005 reconcile + Epic 004 scheduler + Epic 006 respawn.
- **Epic 000 SU3 + SU4** (Connect deps + generated read-only stubs + the
  Connect-on-Node-24 spike) — blocks Story `002` only.

## Non-Goals

- No **web client / dashboard UI** — Phase 2B (phases.md). Phase 1 proves the
  transport seam with `/healthz` + a read-only status method only.
- No **mutating** RPC (sign-off, approvals, halt) — the Phase-1 API is read-only;
  control actions are Phase 2 (phases.md).
- No **auth** (Basic auth / TLS / VPN binding) — Phase 2 (PRD §9; phases.md). The
  Phase-1 server binds locally for the test only.
- No launchd/systemd supervision, log rotation, or dead-man ping — Phase 2B/3
  (PRD §3.1; phases.md).

## Findings Out

- `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md` — produced
  by **Epic 000 SU4** (maintainer gate, not a TDD Task). Consumed by Story `002`.
