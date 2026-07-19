# Story 12 — D5: authenticated fetch + reconcile (shared lock + SHA CAS) + `sync`

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

After the initial clone, `LocalWorkspaceManager.prepareFromRepository` never
fetches `origin` again. Tasks run against stale code indefinitely — the D5 bug.
Separately, concurrent landing and prepare operations can race on the home
canonical branch with no coordination.

This story extends `prepareFromRepository` so that **every online prepare**:

1. Acquires the same per-repo+branch lock introduced by story 11.
2. Resolves D2 auth fresh (reads the credential from storage; does not reuse a
   cached token).
3. Fetches `origin/<target>` using `GIT_ASKPASS` (story 01 infrastructure).
4. Classifies ancestry (local `main` vs `origin/main`):
   — **behind** (ff): advance local `main` to `origin/main` via a compare-and-swap
   fast-forward reset.
   — **ahead** (local has unmerged landings not yet visible on origin): keep local
   `main`; no mutation.
   — **diverged**: record the divergence, do NOT auto-resolve; block the prepare
   with a `DivergenceError` unless the caller passes a cached-mode policy.
5. Records the canonical SHA (local `main` HEAD after step 4) as `baseSHA` in
   `task_results` (before cloning the workspace — fixes A7 for the fetch path too).
6. Clones the workspace from the **recorded canonical SHA** (not `HEAD` at clone
   time) before releasing the lock.

An explicit `repo sync` command reconciles divergence: clean divergence →
merge commit; content conflict → typed error requiring human resolution.
No auto-rebase, no separate integration branch.

Offline/auth-fail path: `prepare` fails with `FetchError` unless the repository
has an explicit `CachedMode` policy row. When a `CachedMode` policy exists,
`prepare` uses the stored canonical SHA and skips the fetch; `lastFetchedAt` and
`lastFetchedOriginSHA` are recorded so stale-cache age is visible.

**Depends on stories 01 and 11.**
Story 01 provides `Repository.remoteUrl + auth` and `GIT_ASKPASS` infrastructure.
Story 11 provides the `per-repo+branch lock`, `LandingRepository`, and the
`landing_candidates` / `repo_locks` migration tables.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/workspace/port.ts — additions

// Thrown when a fetch against origin fails (network error or auth failure)
// and no CachedMode policy permits offline operation.
export class FetchError extends Error {
  readonly repoId: string;
  readonly cause: unknown;
  constructor(repoId: string, cause: unknown);
  // name = "FetchError"
}

// Thrown when local main and origin/main have diverged (neither is an ancestor
// of the other) and no explicit sync has been requested.
export class DivergenceError extends Error {
  readonly repoId: string;
  readonly localSHA: string;
  readonly originSHA: string;
  constructor(repoId: string, localSHA: string, originSHA: string);
  // name = "DivergenceError"
}

// Records the cached-mode policy for a repository.
export interface CachedModePolicy {
  repoId: string;
  lastFetchedOriginSHA: string;
  fetchTime: string; // ISO timestamp of last successful fetch
  baseSHA: string; // canonical SHA used for offline workspaces
}
```

```ts
// src/workspace/local.ts — behaviour change (interface unchanged)
// WorkspaceManager.prepare signature is UNCHANGED.
// The internal prepareFromRepository gains:
//   - lockDir: string (injected via constructor options)
//   - landingRepo: LandingRepository (to read/write CachedMode policies and baseSHA)
//   - credentialStore: (repoId: string) => Promise<string | undefined>
//     (resolves the credential value for https-token auth fresh per call)
// Changed LocalWorkspaceManagerOptions:
export interface LocalWorkspaceManagerOptions {
  root: string;
  lockDir: string; // for per-repo+branch lock (shared with GitRepositoryLanding)
  getCredential?: (credentialId: string) => Promise<string | undefined>;
  getCachedPolicy?: (repoId: string) => Promise<CachedModePolicy | undefined>;
  saveCachedPolicy?: (policy: CachedModePolicy) => Promise<void>;
}
```

```ts
// src/storage/sqlite/migrations.ts — additions to migration 7
// (appended to the story 11 landing tables; same migration 7 DDL block)
//
// CREATE TABLE workspace_cached_policies (
//   repo_id                 TEXT PRIMARY KEY,
//   last_fetched_origin_sha TEXT NOT NULL,
//   fetch_time              TEXT NOT NULL,
//   base_sha                TEXT NOT NULL
// );
```

```ts
// src/app/workspace/sync-repository.ts — NEW use case

export interface SyncRepositoryInput {
  repositoryId: string;
}

export type SyncOutcome =
  | { kind: "up-to-date" }
  | { kind: "merged"; mergeCommit: string }
  | { kind: "conflict"; files: string[] };

export class SyncConflictError extends Error {
  readonly files: string[];
  constructor(files: string[]);
  // name = "SyncConflictError"
}

export class SyncRepository {
  constructor(
    workspaceRoot: string,
    lockDir: string,
    landing: LandingRepository, // for cached policy read/write
    getRepository: (id: string) => Repository | undefined,
    getCredential: (id: string) => Promise<string | undefined>,
    gitConfig: { name: string; email: string },
  );
  execute(input: SyncRepositoryInput): Promise<SyncOutcome>;
  // 1. Acquire per-repo+branch lock.
  // 2. Fetch origin/<target> with fresh auth.
  // 3. Classify ancestry.
  // 4. up-to-date or ahead → return "up-to-date".
  // 5. behind → ff reset → return "up-to-date".
  // 6. diverged + clean merge → merge commit → return "merged".
  // 7. diverged + conflict → throw SyncConflictError (human must resolve).
}
```

```ts
// src/apps/cli/router.ts — new command
// "repo sync": calls SyncRepository.execute with --repository <id>.
// Exits 0 for up-to-date/merged; exits 1 for conflict with file list.
```

## Constraints

- `WorkspaceManager.prepare` interface (`src/workspace/port.ts`) is UNCHANGED.
  The new options are constructor-level; callers (composition root, tests) pass
  them; the port stays simple.
- The lock used in `prepareFromRepository` is the **same lock mechanism** as
  story 11's `GitRepositoryLanding`: same lock file path
  `<lockDir>/<repoId>-<branch>.lock`, same stale-PID detection. Lock must be
  held from the start of the fetch through the workspace clone, then released.
- Compare-and-swap update of local `main`: after a successful fetch, read local
  `main` SHA before the reset, then execute `git fetch origin <target>` + `git
update-ref refs/heads/<target> origin/<target> <old-sha>` (atomic CAS). If the
  CAS fails (another process won the race), retry the ancestry check and proceed
  with the new SHA.
- Workspace is cloned at the **recorded canonical SHA** (the value after step 4
  above), using `git clone --branch <target> <homeDir> <wsDir>` followed by `git
checkout <canonicalSHA>` if canonicalSHA differs from branch HEAD (detached
  head in workspace is acceptable).
- `CachedModePolicy` is stored in `workspace_cached_policies` (migration 7); the
  SQLite adapter provides `getCachedPolicy` / `saveCachedPolicy`.
- "Fresh" credential resolution: call `getCredential(auth.credentialId)` on every
  online prepare; do NOT cache the token value across prepare calls. The cache key
  is the normalized `remoteUrl`, not the credential.
- Fetch on every online prepare — no TTL initially. The TTL may be added by a
  later story without changing the interface.
- `SyncRepository` lives in `src/app/workspace/` (follows the use-case convention:
  verb-first, one file, one class, one `execute()`). It imports
  `src/landing/port.ts` for the lock and `src/workspace/port.ts` for errors.
- Story 11 must be complete: the lock mechanism and `LandingRepository` must
  exist before `prepareFromRepository` can acquire them.
- Story 01 must be complete: `GIT_ASKPASS` env builder must be present.

## Verification Gate

`node --test src/workspace/local.test.ts` green (real `git` + `file://` remotes;
fetch + CAS update + clone at canonical SHA; offline path with and without cached
policy; lock contention between concurrent prepares); `node --test
src/app/workspace/sync-repository.test.ts` green (real `git`; ff, merge, conflict);
`npm run typecheck` exit 0; `npm run lint` clean.

---

### Task T1 — `FetchError`, `DivergenceError`, `CachedModePolicy` in workspace port

**Requires:** nothing beyond `src/workspace/`.

**Input:** `src/workspace/port.ts`.

**Action — RED:** tests: (a) `new FetchError("R1", err)` has `name ===
"FetchError"` and `.repoId === "R1"`; (b) `new DivergenceError("R1", sha1, sha2)`
carries both SHAs; (c) `CachedModePolicy` interface fields are importable
(compile test). Fails today: these exports do not exist.

**Action — GREEN:** add the three types to `src/workspace/port.ts` as in Locked
contracts. No other changes.

**Action — REFACTOR:** none.

**Output:** port exports the error classes and policy interface.

**Verify:** `npm run typecheck` 0.

---

### Task T2 — migration 7: `workspace_cached_policies` table

**Requires:** Story 11 T3 (migration 7 must already include the landing tables).

**Input:** `src/storage/sqlite/migrations.ts`,
`src/storage/sqlite/migrations.test.ts`.

**Action — RED:** extend the migration test: after migration 7, assert
`workspace_cached_policies` exists with columns `repo_id, last_fetched_origin_sha,
fetch_time, base_sha`, and `repo_id` is a PRIMARY KEY. Fails today: table absent.

**Action — GREEN:** append `CREATE TABLE workspace_cached_policies (…)` to the
migration 7 `up` DDL block.

**Action — REFACTOR:** none.

**Output:** migration 7 includes the cached-policy table.

**Verify:** `node --test src/storage/sqlite/migrations.test.ts` green.

---

### Task T3 — `LocalWorkspaceManager`: fetch + CAS + clone at canonical SHA

**Requires:** T1, T2, Story 01 T4 (GIT_ASKPASS infrastructure), Story 11 T4
(lock mechanism and `LandingRepository` adapter available).

**Input:** `src/workspace/local.ts`, `src/workspace/local.test.ts`,
`src/workspace/port.ts` (extended options).

**Action — RED:** real-git tests in temp dirs: (a) `prepare` on a repo whose
home `main` is behind `origin/main` (origin has a new commit): succeeds,
workspace is cloned at the advanced canonical SHA, home `main` HEAD equals
`origin/main`; (b) home `main` is AHEAD of `origin/main` (local has a landing
origin doesn't know about): `prepare` keeps home `main` unchanged, workspace
cloned at current local `main` SHA; (c) diverged (neither ancestor of other) with
NO cached policy: `prepare` throws `DivergenceError`; (d) diverged WITH a
`CachedModePolicy`: `prepare` uses the stored `baseSHA`, skips the fetch, clones
workspace at `baseSHA`; (e) fetch fails (auth error simulated via wrong askpass
file) with NO cached policy: throws `FetchError`; (f) two concurrent `prepare`
calls on the same repo+branch run sequentially (lock), both succeed, each
returning the same canonical SHA; (g) workspace `baseCommit` equals the recorded
canonical SHA (not `HEAD` at arbitrary clock time). Fails today: `prepare` never
fetches; no lock; no CAS; no cached-policy path.

**Action — GREEN:** add `lockDir`, `getCredential`, `getCachedPolicy`,
`saveCachedPolicy` to `LocalWorkspaceManagerOptions`. In
`prepareFromRepository`: (1) acquire lock (`<lockDir>/<repoId>-<branch>.lock`
via the same helper as story 11); (2) resolve credential fresh via `getCredential`;
(3) try `git fetch origin <branch>` with `buildGitEnv` (story 01); on failure, check
`getCachedPolicy` — if present, use `baseSHA` and skip to step 6; else throw
`FetchError`; (4) classify ancestry via `git merge-base --is-ancestor`; (5) if
behind: CAS-reset local `<branch>` to `origin/<branch>` (`git update-ref
refs/heads/<branch> <originSHA> <oldLocalSHA>`; retry on CAS failure); if
diverged: throw `DivergenceError`; (6) record canonical SHA; clone workspace at
canonical SHA; release lock; return `Workspace { dir, branch, baseCommit:
canonicalSHA }`.

**Action — REFACTOR:** extract `classifyAncestry` and `casUpdateBranch` as
module-internal async helpers.

**Output:** every online prepare fetches, CAS-updates, and clones at the
canonical SHA; offline fallback via cached policy; lock prevents racing.

**Verify:** `node --test src/workspace/local.test.ts` green (all listed cases);
typecheck 0; lint clean.

---

### Task T4 — `SyncRepository` use case + real-git tests

**Requires:** T3, Story 11 T4 (lock and landing repo).

**Input:** `src/app/workspace/sync-repository.ts` (new),
`src/app/workspace/sync-repository.test.ts` (new).

**Action — RED:** real-git tests: (a) home `main` up-to-date with origin (or
ahead): returns `{ kind: "up-to-date" }`; (b) home `main` behind origin: fetches,
ff-resets, returns `{ kind: "up-to-date" }`; (c) diverged, clean merge (no
conflict): creates a merge commit on home `main`, returns `{ kind: "merged",
mergeCommit: <sha> }`; (d) diverged, content conflict: throws `SyncConflictError`
with the conflicting files listed; home `main` is left at its pre-sync HEAD (abort
and restore). Fails today: class does not exist.

**Action — GREEN:** create `SyncRepository` as in Locked contracts. Acquire
lock; fetch; classify; handle each outcome:
— up-to-date / ahead → release lock, return `"up-to-date"`.
— behind → CAS ff-reset → release lock, return `"up-to-date"`.
— diverged → attempt `git merge --no-ff origin/<branch>` inside the home dir.
On exit 0: read merge commit SHA → release lock → return `"merged"`.
On exit non-zero: `git merge --abort` → release lock → throw `SyncConflictError`
with files from `git diff --name-only --diff-filter=U`.

**Action — REFACTOR:** none; the fetch + classify logic is shared with
`LocalWorkspaceManager` via the extracted helpers from T3 (pass them as
dependencies or inline for simplicity given this is the only consumer).

**Output:** `SyncRepository` resolves divergence with a merge commit or surfaces
a typed conflict; no auto-rebase, no integration branch.

**Verify:** `node --test src/app/workspace/sync-repository.test.ts` green;
typecheck 0; lint clean.

---

### Task T5 — CLI: `repo sync` command + composition wiring

**Requires:** T3, T4.

**Input:** `src/apps/cli/router.ts`, `src/apps/cli/repo.ts` (extend),
`src/composition.ts`.

**Action — RED:** a handler unit test for `"repo sync"` with
`{ repository: repoId }`: fake `SyncRepository` returning `{ kind: "up-to-date" }`
→ `exitCode: 0`, stdout `"up to date"` or similar; `{ kind: "merged", … }` →
`exitCode: 0`, stdout mentions `merge`; `SyncConflictError` → `exitCode: 1`,
stderr lists conflicting files. Fails today: command does not exist.

**Action — GREEN:** add `"repo sync"` to `COMMANDS`. Implement handler: parse
`--repository <id>`, call `syncRepository.execute`, format output. Wire
`SyncRepository` into `buildDeps` in `composition.ts` — inject `lockDir` (same
dir as `GitRepositoryLanding`), `getCredential` callback, and `getRepository`
from the resource repo.

**Action — REFACTOR:** none.

**Output:** `repo sync --repository <id>` is a real CLI command.

**Verify:** handler unit test green; `npm run typecheck` 0; `npm run lint` clean.
