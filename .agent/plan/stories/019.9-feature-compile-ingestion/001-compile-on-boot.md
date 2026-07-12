# Story 001 - compile the feature dir on boot

Epic: `.agent/plan/epics/019.9-feature-compile-ingestion.md`

## Goal

The daemon compiles its feature dir into the store at startup, before the first
dispatch, so `kanthord run` alone ingests authored features. Wraps the existing
`compile()`; `bootstrapLiveRun` already opens the store + derives the feature dir.

## Acceptance Criteria

- After `bootstrapLiveRun` (which opens the store at `<checkout>/.kanthord/
  db.sqlite` and derives `featureDir`), the daemon has compiled every feature in
  `featureDir` into the store: a feature markdown present in `featureDir` yields
  its `plan_generation` rows so `tick()`'s `SELECT DISTINCT feature_id FROM
  plan_generation` returns it and its tasks are dispatchable.
- **Idempotent on re-boot** — booting again against the same store + unchanged
  feature dir does not duplicate rows or error (a second compile leaves the
  dispatchable set identical).
- When `featureDir` is empty or absent, boot succeeds and the daemon simply has no
  features to dispatch (not an error).
- A feature whose markdown fails compile/lint surfaces a typed error at boot
  (fail-closed) rather than silently dispatching nothing.

## Constraints

- **Wrap `compile()` unchanged** (`src/compiler/compile.ts`) — no new
  compiler/lint logic; `CompileOptions.repoRegistry` is derived from the slot /
  configuration (single-repo default is acceptable), not hard-coded in the daemon.
- **Compile before dispatch** — the compile step runs during
  `bootstrapLiveRun`/daemon startup, before `tick()` reads `plan_generation`.
- **Idempotency via the compiler's own contract** — re-compile is made safe the
  same way the harness re-runs it (fresh/rebuilt projection), not by a bespoke
  dedup hack.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the compile-on-boot test (feature
  dir → dispatchable after boot; re-boot idempotent; empty dir ok) passes; guard
  green.

### Task T1 - compile featureDir into the store during bootstrapLiveRun

**Input:** `src/cli/bootstrap-live-run.ts`, `src/cli/bootstrap-live-run.test.ts`

**Action - RED:** a hermetic test seeds the local checkout's `featureDir` with a
minimal valid `tdd@1` feature markdown (reuse a fixture shape the harness/compiler
tests already use), calls `bootstrapLiveRun(...)`, and asserts the returned deps'
store has the feature's `plan_generation` rows (query `SELECT DISTINCT feature_id
FROM plan_generation` returns the feature; `loadTasks`/`dispatchable` yield its
tasks). Further cases: calling `bootstrapLiveRun` twice against the same store
leaves the dispatchable set identical (idempotent); an empty `featureDir` yields
zero features without error.

**Action - GREEN:** in `bootstrap-live-run.ts`, after `openStore` + `initSchema`,
call `compile(featureDir, store, compileOpts)` (repoRegistry from the slot/config)
so the feature dir is compiled into the store before deps are returned; make
re-compile idempotent per the compiler's contract; empty dir is a no-op; a
compile/lint failure throws a typed boot error.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/bootstrap-live-run.test.ts` green.
