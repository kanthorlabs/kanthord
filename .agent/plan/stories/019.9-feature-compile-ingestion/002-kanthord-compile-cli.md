# Story 002 - `kanthord compile` CLI

Epic: `.agent/plan/epics/019.9-feature-compile-ingestion.md`

## Goal

An operator can compile/ingest a feature into the daemon's store without booting
the daemon — to validate a feature's markdown and populate `plan_generation`
ahead of a run. Thin CLI over `compile()` + the same store-open path
`bootstrap-live-run` uses.

## Acceptance Criteria

- `node src/cli/compile.ts --slot <path>` (or `--feature-dir <path>` +
  `--checkout <path>`) opens the store at the checkout's
  `.kanthord/db.sqlite`, runs `compile(featureDir, store, opts)`, prints a summary
  (compiled feature id(s) + task count), and exits `0`.
- On a compile/lint error the CLI prints the typed error and exits **non-zero**;
  the store is not left half-written in a way that dispatches a broken feature
  (the compiler's own transaction/rebuild contract governs this).
- `node src/cli/compile.ts --help` exits `0` and documents the flags.
- The command performs **no network call** (pure local compile) and prints no
  secret.

## Constraints

- **Reuse `compile()` + the `bootstrap-live-run` store-open/featureDir derivation**
  — the CLI shares the resolution so the compiled store is exactly the one
  `kanthord run` reads. No duplicate compile logic.
- **Thin shell (Epic 019.2 pattern)** — arg parse + resolve + `compile()` + report;
  the compile behavior is the compiler's, covered by its tests.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the CLI test passes; guard green.
- `node src/cli/compile.ts --help` exits 0 and lists the flags.

### Task T1 - compile CLI resolution + report

**Input:** `src/cli/compile.ts`, `src/cli/compile.test.ts`

**Action - RED:** a hermetic test drives the compile command's core (a testable
`runCompileCommand({ featureDir, checkoutDir/store, opts, out })` seam) against a
temp checkout whose `featureDir` holds a valid `tdd@1` feature, and asserts: it
compiles the feature into the store (query confirms `plan_generation` rows), the
summary output names the feature id + a task count, and it returns exit code `0`;
a feature dir with invalid markdown returns a non-zero code and the typed error in
the output, no plan dispatchable.

**Action - GREEN:** implement `runCompileCommand` + a thin `main(argv)` in
`src/cli/compile.ts` that parses `--slot`/`--feature-dir`/`--checkout`/`--help`,
resolves the store + featureDir via the shared `bootstrap-live-run` helper, calls
`compile()`, prints the summary, and exits with the right code. Executed only when
run directly.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/compile.test.ts` green; `node src/cli/compile.ts --help` exits 0.
