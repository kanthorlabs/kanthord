# 000 Milestone Setup (maintainer gate — blocks all TDD epics)

## Outcome

The toolchain and provisioning the Phase-1 TDD pipeline **cannot do itself** exists
and is verified: the `yaml` runtime dependency, a confirmed SQLite access path, the
Connect RPC deps + generated read-only service stubs, the two de-risking spikes, and
CI wiring for the gate suite. After this Epic, every `src/**` RED/GREEN story in Epics
001–010 can run without hitting a missing dependency or an unresolved runtime surface.

## Why this is a gate, not RED/GREEN tasks (read this first)

`lane-check.sh` **denies `package.json`, `package-lock.json`, `tsconfig*.json`,
`scripts/**`, and `*generated*/*` for every engineer role** (test/software/reviewer).
A dependency install, a proto codegen, or a CI edit therefore **cannot** be a
`### Task` — `/work` would dispatch it to an engineer the lane check then blocks, on
every attempt. So this Epic is a **maintainer-executed checklist**, **not dispatched
through `/work`**, using `Setup item → Action → Verify` (no RED/GREEN). Its
"Verification Gate" is the set of Verify commands; all must pass **before** `/work`
runs any other epic.

## Setup items

### SU1 — `yaml` runtime dependency  *(unblocks Epic 001 stories 002, 004; and 005 frontmatter)*
- **Action (maintainer):** add `yaml` to `package.json` dependencies and update the
  lockfile.
- **Verify:** `node --input-type=module -e "await import('yaml'); console.log('ok')"`
  prints `ok` and exits 0.

### SU2 — SQLite access path + spike  *(unblocks Epic 001 story 005; consumed by 002/003/004/009)*
- **Action (maintainer):** run the `node:sqlite` spike on Node 24 — open a temp DB,
  set `journal_mode=wal` + `busy_timeout`, run a `PRAGMA` read, exercise
  `exec`/`prepare`; if unusable (experimental-flag/blocking-warning), evaluate
  `better-sqlite3` as the fallback. Write findings to
  `.agent/plan/feedback/001-foundations-seams-and-storage/sqlite-access.md`
  (chosen lib, any required runtime flag, the exact API calls, observed WAL/busy_timeout).
- **Verify:** that findings file exists and names the chosen library + flag; a probe
  shows WAL + busy_timeout take effect (or records the `better-sqlite3` decision).

### SU3 — Connect RPC deps + generated read-only stubs  *(unblocks Epic 009 story 002)*
- **Action (maintainer):** add `@connectrpc/connect`, `@connectrpc/connect-node`, and
  the protobuf runtime to `package.json`; define the minimal service schema (a read-only
  `status` method; health is a plain HTTP route, not an RPC); run codegen into a
  generated dir and commit it. The descriptor must contain **only** read methods — no
  sign-off / approval / halt / write / mutate / enqueue / lease / control RPC.
- **Verify:** the generated stubs import cleanly; introspecting the service descriptor
  lists only the allowed read method(s) and no control/mutate method.

### SU4 — Connect-on-Node-24 spike  *(unblocks Epic 009 story 002)*
- **Action (maintainer):** confirm on Node 24 / ESM the server bootstrap, that
  `/healthz` is a plain HTTP route on the same server, the loopback bind
  (`127.0.0.1`/`::1`, never `0.0.0.0`), the generated import path + descriptor name,
  and how the registered method set is inspectable. Write findings to
  `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`.
- **Verify:** that findings file exists and answers each of those points.

### SU5 — CI runs the gate suite under the guards  *(unblocks the Epic 010 Phase-1 gate "in CI")*
- **Action (maintainer):** wire CI to run `npm test` (the full harness suite) with the
  Epic 010 suite-level network + credential guard active (CI config is toolchain,
  lane-forbidden to engineers).
- **Verify:** a CI run executes the suite and reports it green; the run shows the
  no-network / no-credential guard active.

## Verification Gate

- SU1–SU5 Verify checks all pass. Until then, downstream TDD epics are **blocked**
  (their first RED test would fail on module resolution / an unresolved runtime
  surface, not on the intended behavior).

## Dependencies

- None — this is the first thing done in Phase 1, before any `/work` dispatch.

## Non-Goals

- No product behavior — this Epic installs/verifies toolchain only; all behavior is in
  Epics 001–010.
- Not run through `/work` — it is a maintainer checklist (see the gate rationale above).

## Findings Out

- `.agent/plan/feedback/001-foundations-seams-and-storage/sqlite-access.md` (SU2) and
  `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md` (SU4) — the
  two spike findings the downstream stories code against.
