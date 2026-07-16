# Story 03 — Workspace preparation (local home + task clones)

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The D1 two-level model: a Repository's `path` is its **local home** (cloned
from the constructed remote when missing, identity-checked when present);
every task gets an isolated clone of the home on branch
`kanthord/<task-id>`. Filesystem sources become git repos too, so every
workspace has a `baseCommit`.

## Acceptance Criteria

- `src/workspace/port.ts`: `Workspace = { dir: string; branch: string;
  baseCommit: string }`; `WorkspaceManager { prepare(taskId: string, source:
  Repository | Filesystem): Promise<Workspace> }` (domain imports only);
  `WorkspacePreparationError { message }`.
- `src/workspace/local.ts` `LocalWorkspaceManager` ctor `{ root: string;
  buildRemoteUrl?: (repo: Repository, name: string) => string }` (default
  builder: `https://github.com/<organization>/<name>.git` — injectable per
  the D1 debate so hermetic tests use local paths without weakening
  production):
  - **Home ensure (repository sources):** `source.path` missing → `git
    clone <url> <path>.tmp-<random>` then rename into place (atomic;
    partial-clone safe); exists and is a git repo → `git remote get-url
    origin` must equal the constructed URL, else
    `WorkspacePreparationError` naming both; exists and is not a git repo →
    `WorkspacePreparationError` naming the path. No fetch ever (snapshot
    semantics, documented). The home is never written to after the initial
    clone.
  - **Task workspace:** `git clone --branch <source.branch> <path>
    <root>/<taskId>` then `git switch -c kanthord/<taskId>`;
    `baseCommit = git rev-parse HEAD`. Missing branch in the home →
    `WorkspacePreparationError`.
  - **Filesystem sources:** `fs.cp` recursive into `<root>/<taskId>`, then
    `git init` + `git add -A` + initial commit (kanthord identity) +
    `git switch -c kanthord/<taskId>` — uniform `branch`/`baseCommit`.
  - **Retry:** an existing `<root>/<taskId>` is removed first (clean
    attempt).
- git via `execFile('git', …)`; every commit carries
  `-c user.name="kanthord" -c user.email="kanthord@localhost"`. No new
  dependency.

## Constraints

- Adapter tests use real git on temp dirs (no network — clone sources are
  local paths through the injected URL builder); they must pass on a
  machine with no global git identity.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — port + home ensure + repository clone path

**Requires:** S01-T1 (Repository shape).

**Input:** `src/workspace/port.ts`, `src/workspace/local.ts` (+ test), all
new.

**Action — RED:** temp-dir tests with real git and an injected
`buildRemoteUrl` returning a local seed-repo path: (a) home missing →
prepared; the home dir now exists (no `.tmp-` leftover), its `origin` is
the built URL; workspace is on `kanthord/t1` with `baseCommit` = the seed
HEAD; (b) home pre-seeded with matching `origin` → reused, seed repo
untouched; (c) pre-seeded home with a different `origin` →
`WorkspacePreparationError` naming both URLs; (d) home path exists as a
plain dir → `WorkspacePreparationError`; (e) `--branch` missing in the
home → `WorkspacePreparationError`. Fails today: module absent.

**Action — GREEN:** implement home ensure (temp+rename, origin check) +
task clone + branch.

**Action — REFACTOR:** none.

**Output:** identity-checked homes; isolated per-task clones on the task
branch.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — filesystem sources + wipe-on-retry

**Requires:** T1.

**Input:** `src/workspace/local.ts` (+ test).

**Action — RED:** tests: (a) filesystem source → files copied, the
workspace is a git repo on `kanthord/<id>` with a `baseCommit` covering all
copied files (`git status --porcelain` clean); (b) second `prepare` for the
same taskId → fresh dir (attempt-1 marker file gone); (c) source path
missing → `WorkspacePreparationError` naming it. Fails today: paths
absent.

**Action — GREEN:** implement copy + git init/commit/branch +
rm-then-create.

**Action — REFACTOR:** none.

**Output:** both source kinds yield uniform git workspaces; retries start
clean.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
