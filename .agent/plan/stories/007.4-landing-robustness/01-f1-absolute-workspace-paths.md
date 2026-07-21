# Story 1 — F1: absolute workspace paths + landing validation

Epic: `.agent/plan/epics/007.4-landing-robustness.md`

## Goal

On a default install, landing is dead. `ApproveTask` → `GitRepositoryLanding.land`
runs `git fetch <candidate.workspace> <sha>` with `cwd = homeDir` (the absolute
mirror) at `src/landing/git.ts:103-107`. `candidate.workspace` is RELATIVE
(`.data/workspaces/<taskId>`) because
`workspaceRoot = process.env["KANTHORD_WORKSPACE_ROOT"] ?? join(dirname(dbPath), "workspaces")`
(`src/composition.ts:376-378`) and the default `dbPath` is the relative
`.data/kanthord.db` (`src/main.ts:6`). git resolves the relative remote against
the mirror dir → `fatal: '.data/workspaces/<id>' does not appear to be a git
repository`. The 007.3 `scripts/e2e/landing-proof.sh` hid this by exporting an
ABSOLUTE `KANTHORD_DB=$(mktemp -d)/kanthord.db`.

This story makes the workspace-management boundary the single source of path
truth: it emits **absolute** candidate workspace paths, and landing **validates**
(does not repair) them.

## Contract (tests assert this)

- `LocalWorkspaceManager` constructed with a RELATIVE `root` still returns a
  `Workspace` whose `dir` is absolute (`isAbsolute(ws.dir) === true`). Resolve
  the root once in the constructor (`resolve(root)`), so every
  `join(root, taskId)` is absolute (`src/workspace/local.ts:265`, `:226`).
- `composition.ts` resolves the root to absolute at wiring time:
  `resolve(process.env["KANTHORD_WORKSPACE_ROOT"] ?? join(dirname(dbPath), "workspaces"))`
  (`src/composition.ts:376-378`). Single place; do NOT also `resolve()` inside
  `landing/git.ts` against ambient cwd (debate B1/B2 — a restart from another
  directory would reinterpret an old row).
- `GitRepositoryLanding.land` asserts `isAbsolute(candidate.workspace)` before
  the fetch and throws a typed invariant error (e.g. `LandingInvariantError`)
  when it is not — it must NOT shell a doomed `git fetch`
  (`src/landing/git.ts:101-107`). The error is caught by S3's `landing_failed`
  path (until S3 lands, it surfaces as a clear message, not the current
  `does not appear to be a git repository`).
- Legacy relative rows in an existing DB: resolve against the explicit
  configured `workspaceRoot` base (a small backfill in S2's migration or a
  documented "unsupported" note) — never a bare ambient `resolve()` (debate S3).

## Constraints

- Surgical: change path construction only; do not alter clone/prepare logic.
- No behavior change when `KANTHORD_WORKSPACE_ROOT` is already absolute.
- Hermetic — no network. Landing tests use real git in temp dirs.

## Verification Gate

- `node --test src/workspace/local.test.ts` — new case: relative root → absolute
  `ws.dir`.
- `node --test src/landing/git.test.ts` — new cases: (a) relative
  `candidate.workspace` → typed invariant error, no `git fetch` spawned;
  (b) real land with a relative-root manager in a temp cwd succeeds (ff).
- `npm run typecheck` 0; `npm run lint` clean.
