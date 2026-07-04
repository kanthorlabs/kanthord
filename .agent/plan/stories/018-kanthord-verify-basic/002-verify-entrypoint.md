# Story 002 - Verify Entrypoint

Epic: `.agent/plan/epics/018-kanthord-verify-basic.md`

## Goal

The operator command: `node src/cli/verify.ts --from-markdown --read-only`
runs the engine, prints the report, exits 0 on clean and non-zero on
divergence, and provably writes nothing.

## Acceptance Criteria

- Invoked with a store root + live DB path, the entrypoint prints each
  divergence (entity, field, live, shadow) and a final count; exit code 0 when
  clean, 1 when divergent (PRD §6.1 operator command).
- Both `--from-markdown` **and** `--read-only` are required in 2A: invocation
  missing either is a usage error (debate finding — the PRD names both flags;
  neither may be silently defaulted; no write mode exists yet — severities/
  repair are Phase 3).
- The live DB is opened read-only and the Epic 012 writer lock is **not**
  acquired — verify succeeds while another process holds the writer lock.
- A write-counting store seam wired in tests records zero writes across a full
  divergent run.
- A `contract-version-mismatch` from the engine exits with a distinct code (2)
  and message naming both versions.

## Constraints

- Entrypoint lives at `src/cli/verify.ts` and is invoked via `node` directly —
  no `package.json` `bin` entry (lane-forbidden; documented invocation instead).
- Output is plain text lines + the exit code — no formatting library; the
  machine-readable form is the engine's typed report, already covered by
  Story 001.
- The CLI layer contains argument parsing + rendering only; all logic stays in
  the engine (testable without spawning a process).

## Verification Gate

- `npm test` green for `src/cli/verify.test.ts`.

### Task T1 - CLI wiring, exit codes, read-only proof

**Input:** `src/cli/verify.ts`, `src/cli/verify.test.ts`

**Action - RED:** Write tests (driving the CLI's exported main with injected
seams): (a) clean ⇒ exit 0, "0 divergences"; (b) divergent ⇒ exit 1, entries
printed; (c) missing `--read-only` OR missing `--from-markdown` ⇒ usage error;
(d) version mismatch ⇒ exit 2; (e) zero writes recorded against live DB and
store, shadow temp target created and deleted; (f) runs while a writer lock is
held.

**Action - GREEN:** Implement the entrypoint over the Story 001 engine with
read-only DB open and no lock acquisition.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
