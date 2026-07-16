# Story 09 — End-to-end smoke test

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

One hermetic test drives the full epic Proof sequence through the real
composition root against a temp DB — the wiring lesson encoded as a regression.
This story proves CLI → use case → port → SQLite end to end (each command
story already wired its slice; this consolidates the whole Proof).

## Acceptance Criteria

- `src/apps/cli/e2e-smoke.test.ts` sets `KANTHORD_DB` to a temp file, runs
  `db migrate`, then reproduces the epic Proof through `dispatch()` (not a
  shelled-out process): `create project` → capture ULID; `create repository`;
  `create initiative`; `create objective`; `create task` (api);
  `create task` (deploy `--depends-on` api); `list task --initiative`.
- Asserts: each create returns exit 0 + a single ULID line; `list task` shows
  `implement api` ready and `deploy` blocked (waiting: implement api), exit 0.
- Re-arrange leg: `create task` (spike auth) → `add dependency --task <api>
  --depends-on <prep>` → `list task` now shows `spike auth` ready and
  `implement api` blocked (waiting: spike auth); then a cycle-closing
  `add dependency` → exit 1, named cycle error, graph unchanged.
- Negative leg: `create task --objective <task-id>` → `WrongTypeReferenceError`,
  exit 1, one `error:` line, no stack trace.
- Uses the SAME `deps` bundle `main.ts` builds (import the composition factory),
  so a wiring regression fails the test.

## Constraints

- Hermetic: temp DB, no network. Real SQLite adapters here (this is the wiring
  proof — fakes are NOT allowed, unlike the unit stories).
- Drives `dispatch()` with `argv` arrays; asserts on the returned
  `{ exitCode, stdout, stderr }`, not captured process output.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — composition factory extraction

**Requires:** S01-T2.

**Input:** `src/main.ts`, `src/composition.ts` (new, if extracted).

**Action — RED:** test imports `buildDeps(dbPath)` and asserts it returns a
`deps` bundle exposing the registered use cases / repos. Fails today: factory
absent.

**Action — GREEN:** extract `buildDeps(dbPath)` from `main.ts`; `main.ts` calls
it.

**Action — REFACTOR:** none.

**Output:** a `buildDeps(dbPath)` factory used by both `main.ts` and the smoke
test.

**Verify:** `npm test` green; `npm run typecheck` exit 0; existing commands
still route.

### Task T2 — full Proof smoke test

**Requires:** T1; S03; S04; S05; S06; S07 (all Proof commands live).

**Input:** `src/apps/cli/e2e-smoke.test.ts` (new).

**Action — RED:** implement the sequence above against a temp DB via
`dispatch`; assert the ULID captures, the ready/blocked listing, the re-arrange
result, the cycle rejection, and the wrong-type negative case. Fails until
every command is wired.

**Action — GREEN:** fix any wiring gap the test exposes.

**Action — REFACTOR:** none.

**Output:** a green end-to-end regression reproducing the epic Proof.

**Verify:** `npm test` green; `npm run typecheck` exit 0. The epic Proof (the
real shell block) is run by the maintainer as the epic gate.
