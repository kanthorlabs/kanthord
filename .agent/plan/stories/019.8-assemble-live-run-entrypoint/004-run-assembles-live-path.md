# Story 004 - run.ts assembles the live delivery path

Epic: `.agent/plan/epics/019.8-assemble-live-run-entrypoint.md`

## Goal

Assemble the entrypoint: from a slot, self-clone (Story 001) to a local repo root,
load the identity, build the async `buildRealDeps` (Epic 019.7: verbAdapters +
PAT), and thread `verbAdapters` + `commitsAhead` (Story 003) + the worktrees base
(Story 002) into `runDaemon` — so `run.ts` boots a daemon that can deliver a PR.
Today `run.ts` calls the sync `buildRealDeps` and treats the repo URL as a local
path.

## Acceptance Criteria

- A `bootstrapLiveRun({ slot, dataRoot, providerModel, providerStreamFn, runGit,
  ... })` function: resolves the identity file path from the slot identity +
  data root, bootstraps the local checkout (Story 001) from `slot.repo`, derives
  `featureDir`/db path from the **local checkout root** (not the URL), loads the
  identity token, calls the **async** `buildRealDeps` with `{ identity,
  identityFile, patternRegistry, repo coords, providerModel, providerStreamFn }`,
  and returns the `RunDaemonDeps` including `verbAdapters`, a `commitsAhead` bound
  to the checkout (Story 003), and the worktrees base (Story 002).
- Booting `runDaemon` with those deps produces a daemon whose dispatch → session →
  broker delivery path is fully connected (asserted by an integration test on
  doubles/local remotes: a committed session yields a push + create_pr op through
  the injected adapters).
- `node src/cli/run.ts --help` still exits 0 and lists `--slot`/`--account`/
  `--model`; the daemon fails closed with a typed error (not a crash) when the
  identity or provider account cannot be resolved.

## Constraints

- **Thin `run.ts` over a testable assembler** — the orchestration lives in
  `bootstrapLiveRun` (hermetically testable with injected `runGit` + a local bare
  remote + fake provider session); `run.ts` only parses flags, calls it, and hands
  the deps to `runDaemon` (Epic 019.2 DI split).
- **Local checkout root is authoritative** — `featureDir` and the db path derive
  from the Story 001 checkout path, never from `slot.repo` (the URL).
- **Reuse the async `buildRealDeps`** (Epic 019.7) — no new deps logic.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the assembler integration test
  passes on local remotes/doubles; `node src/cli/run.ts --help` exits 0; guard
  green.

### Task T1 - bootstrapLiveRun assembler

**Input:** `src/cli/bootstrap-live-run.ts`, `src/cli/bootstrap-live-run.test.ts`

**Action - RED:** a hermetic test provides a slot (local bare "remote" URL +
identity), a temp data root with a `0600` identity file, a fake provider session,
and injected `runGit`, then calls `bootstrapLiveRun(...)` and asserts the returned
deps: `featureDir` is under the local checkout (not the URL); `verbAdapters` has
`git.push` + `github.create_pr`; `commitsAhead` is a function; the worktrees base
is set. A follow-on assertion boots `runDaemon` with those deps + a committed
session (doubles) and confirms a push + create_pr op is submitted.

**Action - GREEN:** implement `bootstrapLiveRun` composing Story 001 checkout,
identity load, async `buildRealDeps`, Story 003 `commitsAhead`, and the worktrees
base into `RunDaemonDeps`.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/bootstrap-live-run.test.ts` green.

### Task T2 - run.ts calls the assembler

**Input:** `src/cli/run.ts`

**Action - RED:** none - GREEN-only. `run.ts` is the thin shell (Epic 019.2
pattern); its parse + boot is verified by `--help` + typecheck, and the assembly
is covered by T1.

**Action - GREEN:** replace the sync `buildRealDeps` call in `run.ts` with
`await bootstrapLiveRun({ slot, dataRoot: resolveDataRoot(), providerModel,
providerStreamFn, runGit: <real> })` and pass the resulting deps to `runDaemon`;
keep `--slot`/`--account`/`--model`/`--hold-point`/`--help` behavior; fail closed
to stderr + non-zero on a typed bootstrap error before the daemon starts.

**Action - REFACTOR:** none.

**Verify:** `npm run typecheck` exits 0; `node src/cli/run.ts --help` exits 0.
