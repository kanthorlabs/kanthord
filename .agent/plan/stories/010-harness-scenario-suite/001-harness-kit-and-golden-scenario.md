# Story 001 - Harness Kit & Golden Scenario

Epic: `.agent/plan/epics/010-harness-scenario-suite.md`

## Goal

Assemble the deterministic lifecycle harness kit — fake clock, fake broker, temp
SQLite, temp git repo, crash/restart entrypoint — and run the golden `tdd@1` feature
end-to-end on it, with no network reachable during the run.

## Acceptance Criteria

- A `harness()` helper wires the fake clock (Epic 001), the fake broker (Epic 005),
  a temp SQLite store, a temp git feature repo, and the daemon crash/restart
  entrypoint (Epic 009) into one deterministic fixture (PRD §7.7 — the lifecycle
  harness).
- The **golden scenario** runs end-to-end: sign-off compile (Epic 002) → DAG-ordered
  dispatch respecting leases (Epic 004) → artifact handoff gate (**evaluated by Epic
  006 Story 005** — publisher exit "published" + consumer entry "consumed (hash)") →
  TDD gate pair (Epic 006 workflow) → fake deploy chain with soak (Epic 008) → feature
  complete — every step deterministic on the fake clock, no real waiting (phases.md
  gate). The handoff runs through the Epic 006 gate producer, not harness-local logic.
- The golden fixture is the **one golden scenario** that carries across phases: two
  stories, one parallel lane, an artifact handoff, a gate pair, a deploy chain
  (phases.md guiding rule).
- **No network:** a **first-installed suite-level guard** (installed **before** the
  SUT is imported) makes any use of Node network primitives — `net`, `tls`, `dns`,
  `dgram`, `http`, `https`, `http2`, and global `fetch`/Undici — throw; the golden
  scenario completes without tripping it, and a deliberate attempt on each covered
  primitive is proven to throw (phases.md — zero network access; a suite-level guard,
  honestly not "runner-level", since scripts/package.json are lane-forbidden).
- **No external credentials (gap S1):** the same guard also fails on access to
  credential sources during the run — reading credential-shaped env vars
  (`*_TOKEN`/`*_KEY`/`*_SECRET`/`*_PASSWORD`) and provider-credential file paths — so
  a scenario that reaches for a credential trips the guard; the golden run completes
  without tripping it (phases.md §72 — "no external credentials anywhere in Phase 1").
- **Temp git repo is real and trivially exercised (review B2, option i — kit
  parity):** the kit's temp git repo is a real initialized repository — `git
  rev-parse --git-dir` resolves inside it and one commit lands — and nothing more;
  no Phase-1 mechanism consumes git semantics. This names the 2A brick-swap seam
  (Epic 012 real markdown store + git) without pulling repo semantics forward.

## Constraints

- The harness reuses the **fakes built in Epics 001–009** (never new parallel fakes);
  fakes are permanent test doubles (phases.md guiding rule).
- No-network is a **suite-level guard** installed **before SUT import**, blocking all
  Node network primitives (`net`/`tls`/`dns`/`dgram`/`http`/`https`/`http2`/`fetch`),
  not just `net` — not a runner flag (engineers cannot edit `scripts/`/`package.json`).
  The guard lives in a `src/**` test helper imported first by every gate test (debate
  finding — broad + first-installed, honestly named suite-level).
- All time is the fake clock; all external effects are the fake broker (PRD §7.7 —
  injectable seams).
- The temp git repo fixture commits under **controlled local config** — explicit
  `user.name`/`user.email` and a fixed initial branch set by the fixture itself,
  never inherited from the host/CI environment (debate finding — otherwise the
  trivial-exercise assertion becomes a toolchain flake, not a kit check).

## Verification Gate

- `npm test` green for `src/harness/golden.test.ts`, network-guarded.

### Task T1 - Harness kit + no-network guard

**Input:** `src/harness/harness.ts`, `src/harness/harness.test.ts`

**Action - RED:** Write a test that `harness()` returns a fixture exposing the fake
clock, fake broker, temp store, temp git repo (narrow role: a local temp repo fixture,
no real remote/fff — Phase 2), and boot entrypoint; that the temp git repo is a real
initialized repo trivially exercised — `git rev-parse --git-dir` resolves and one
commit lands (review B2, kit parity only); that the suite-level guard makes a
deliberate attempt on **each** covered network primitive (`net`/`tls`/`dns`/`dgram`/
`http`/`https`/`http2`/`fetch`) throw; and that a deliberate read of a
credential-shaped env var / provider-credential file path also throws (S1).

**Action - GREEN:** Implement `harness()` composing the Epics 001/005/009 seams and a
first-installed suite-level guard covering all listed network primitives **and**
credential env/file access.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Golden feature end-to-end on fakes

**Input:** `src/harness/golden.ts`, `src/harness/golden.test.ts`

**Action - RED:** Write a test that runs the golden `tdd@1` fixture through
compile → dispatch → artifact handoff → gate pair → deploy soak → complete on the
harness, asserting the feature reaches complete deterministically with the guard
active (no network).

**Action - GREEN:** Wire the golden fixture and drive it through the composed
components to completion on the fake clock.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
