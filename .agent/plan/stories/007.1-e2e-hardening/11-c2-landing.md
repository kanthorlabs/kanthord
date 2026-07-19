# Story 11 — C2/A7: `RepositoryLanding` port — local landing under a lock + durable SHA

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

A `completed` same-repo task today means only that the proposal ref was promoted
inside the agent's workspace (`ApproveTask.#promote`). It never lands to the home
canonical branch, so a dependent task clones `main` and cannot see the prior
work — the C2 bug. Separately, `task_results.base_commit` is never written —
the A7 bug — because `PiAgentRunner` captures `workspace.baseCommit` but the
value is not persisted.

This story defines a narrow **local** port `RepositoryLanding` (synchronous git)
and its adapter. Landing acquires a **cross-process per-repo+branch lock** so
multiple concurrent approve operations cannot race on the same canonical branch.
Before mutating any ref, the adapter records durable candidate metadata (base SHA,
candidate SHA, target branch, state) so a crashed mid-land process can recover
idempotently on retry. The outcome is classified as fast-forward, merge, or typed
conflict (conflict is NOT an executor failure — dependents are blocked until a
human resolves). After a successful land, `task_results.base_commit` is populated
(A7).

`ApproveTask` is rewired: after promoting the workspace ref it calls
`RepositoryLanding.land`, completing the task only when landing succeeds or the
result is `already-landed`.

Domain state/artifacts (`ChangeCandidate`, `Acceptance`, `Integration`,
`LandedChange`) are modelled in `src/domain/landing.ts` — pure, no I/O.
The landing port belongs to `src/landing/port.ts`; the git adapter to
`src/landing/git.ts`. No `merge@1` executor, no integration graph node.

**Depends on story 01** (D2 `Repository.remoteUrl` + `auth` union; `GIT_ASKPASS`
infrastructure in `LocalWorkspaceManager`).

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/domain/landing.ts — NEW (pure domain types, zero I/O)

export type CandidateState = "pending" | "landed" | "conflict";

export interface ChangeCandidate {
  id: string; // ULID minted at approve time
  taskId: string;
  repoId: string;
  baseSHA: string; // SHA of canonical branch HEAD at approve time (fixes A7)
  candidateSHA: string; // proposal commit to be landed
  ref: string; // task branch: "kanthord/<taskId>"
  target: string; // canonical branch, e.g. "main"
  state: CandidateState;
}

export interface Acceptance {
  candidateId: string;
  approvedBy: string; // "human" (or future automated policy name)
  approvedAt: string; // ISO timestamp
}

export interface Integration {
  candidateId: string;
  outcome: "fast-forward" | "merge" | "conflict";
  canonicalSHA: string; // final HEAD after landing; candidateSHA for conflict
  mergeCommit?: string; // set only for "merge" outcome
  conflictFiles?: string[]; // set only for "conflict" outcome
}

export interface LandedChange {
  candidateId: string;
  canonicalSHA: string;
  landedAt: string; // ISO timestamp
}

// Creates a new ChangeCandidate (pending state).
export function newChangeCandidate(input: {
  taskId: string;
  repoId: string;
  baseSHA: string;
  candidateSHA: string;
  ref: string;
  target: string;
}): ChangeCandidate;
```

```ts
// src/landing/port.ts — NEW

export interface LandingCandidate {
  id: string; // ChangeCandidate.id (pre-persisted; used for idempotency key)
  taskId: string;
  repoId: string;
  baseSHA: string;
  candidateSHA: string;
  ref: string; // "kanthord/<taskId>"
  target: string; // "main"
}

export type LandingOutcome =
  | { kind: "fast-forward" }
  | { kind: "merge"; mergeCommit: string }
  | { kind: "conflict"; files: string[] }
  | { kind: "already-landed"; canonicalSHA: string };

export interface LandingResult {
  candidate: LandingCandidate;
  outcome: LandingOutcome;
  canonicalSHA: string; // home target HEAD after a successful land; unchanged for conflict
}

// Thrown when a landing attempt results in a git conflict.
// Conflict is NOT an executor failure; dependents are blocked, not failed.
export class LandingConflictError extends Error {
  readonly candidate: LandingCandidate;
  readonly conflictFiles: string[];
  constructor(candidate: LandingCandidate, conflictFiles: string[]);
  // name = "LandingConflictError"
}

export interface RepositoryLanding {
  // Synchronous git: acquires the per-repo+branch lock, checks for prior
  // landing (idempotent), classifies ancestry, executes ff or merge onto
  // the home canonical branch, persists durable metadata, releases lock.
  // Throws LandingConflictError on conflict (caller decides how to surface it).
  land(homeDir: string, candidate: LandingCandidate): Promise<LandingResult>;
}
```

```ts
// src/storage/port.ts — new repository method for landing candidates
// (add to TaskRepository or a new LandingRepository)
export interface LandingRepository {
  saveCandidate(candidate: ChangeCandidate): void;
  getCandidate(id: string): ChangeCandidate | undefined;
  updateCandidateState(id: string, state: CandidateState): void;
  saveIntegration(integration: Integration): void;
  getIntegration(candidateId: string): Integration | undefined;
}
```

```ts
// src/storage/sqlite/migrations.ts — additions to migration 7
// (appended to the same DDL block as story 01's migration 7)
//
// CREATE TABLE landing_candidates (
//   id             TEXT PRIMARY KEY,
//   task_id        TEXT REFERENCES tasks(id),
//   repo_id        TEXT NOT NULL,
//   base_sha       TEXT NOT NULL,
//   candidate_sha  TEXT NOT NULL,
//   ref            TEXT NOT NULL,
//   target         TEXT NOT NULL,
//   state          TEXT NOT NULL DEFAULT 'pending'
//                  CHECK (state IN ('pending','landed','conflict'))
// );
// CREATE TABLE landing_integrations (
//   candidate_id   TEXT PRIMARY KEY REFERENCES landing_candidates(id),
//   outcome        TEXT NOT NULL CHECK (outcome IN ('fast-forward','merge','conflict')),
//   canonical_sha  TEXT NOT NULL,
//   merge_commit   TEXT,
//   conflict_files TEXT   -- JSON array of file paths, NULL unless conflict
// );
// CREATE TABLE repo_locks (
//   repo_id    TEXT NOT NULL,
//   branch     TEXT NOT NULL,
//   pid        INTEGER NOT NULL,
//   locked_at  TEXT NOT NULL,
//   PRIMARY KEY (repo_id, branch)
// );
```

```ts
// src/landing/git.ts — new adapter
export class GitRepositoryLanding implements RepositoryLanding {
  constructor(
    lockDir: string, // directory for per-repo+branch lock files
    landing: LandingRepository, // storage for durable SHA metadata
    gitConfig: { name: string; email: string }, // for merge commits
  );
  land(homeDir: string, candidate: LandingCandidate): Promise<LandingResult>;
}
// Lock mechanism: flock-style via Node.js `open(path, 'wx')` on a
// lock file `<lockDir>/<repoId>-<branch>.lock`; exponential-backoff retry
// up to 30s; stale PID detection clears orphaned locks.
```

```ts
// src/app/task/approve-task.ts — rewired constructor
// ApproveTask gains a RepositoryLanding dependency.
// After #promote succeeds (or proposalCommit is null),
// it calls RepositoryLanding.land and persists base_commit in task_results.
// LandingConflictError → task stays awaiting_confirmation; feed gets a
// new "task.conflict" event (caller may re-surface to human).
```

```ts
// src/apps/cli/router.ts — new CLI commands
// "repo land": calls a new thin LandCandidate use case or directly invokes
//   RepositoryLanding.land with ids from --repository, --workspace,
//   --base (branch), --candidate (SHA).
// Output (stdout JSON): { outcome, canonicalSHA }
```

## Constraints

- `src/domain/landing.ts` imports nothing outside `src/domain/`. Pure TS — no
  Date calls; `newChangeCandidate` receives timestamps as input when needed.
- `src/landing/port.ts` imports `src/domain/landing.ts` types only.
  `GitRepositoryLanding` (`src/landing/git.ts`) imports `landing/port.ts` and
  `storage/port.ts` only. No direct SQLite in the adapter.
- The cross-process lock is a file lock in `lockDir`; this dir is provisioned by
  the composition root (`buildDeps`). Tests use `tmp` dirs. The lock covers the
  full landing operation: record metadata → git ops → update state → release.
- The durable SHA protocol: write `landing_candidates` row (state=`pending`)
  BEFORE any `git` mutation. On crash, a retry finds the `pending` row, checks
  whether `candidateSHA` is already an ancestor of target (idempotent), and
  either marks `landed` or restarts the merge.
- `already-landed` outcome: if `candidateSHA` is already reachable from
  `target` HEAD, return `already-landed` immediately (no mutation, no lock held
  past the check). This is the crash-idempotent path.
- `ApproveTask` must NOT call `RepositoryLanding.land` for filesystem-sourced
  tasks (no repository binding → skip silently). Detect via
  `task_context.type='repository'` presence.
- A conflict outcome from `land` puts the task in a new `conflict` sub-state (or
  keeps `awaiting_confirmation` with a `task.conflict` event). Story does NOT
  auto-fail the task. The CLI `repo land` command exits non-zero on conflict.
- Story 01 must be complete: `Repository.remoteUrl` + `auth` union must exist.
- **Do not** rename `Task.agent` → `Task.executor` (EPIC 008 owns that).

## Verification Gate

`node --test src/domain/landing.test.ts` green; `node --test src/landing/git.test.ts`
green (real `git` in temp dirs — ff, merge, typed conflict, crash-idempotent,
cross-process lock contention); `node --test src/app/task/approve-task.test.ts`
green (fake `RepositoryLanding`); `npm run typecheck` exit 0; `npm run lint` clean.

---

### Task T1 — domain: `ChangeCandidate`, `Acceptance`, `Integration`, `LandedChange` + `newChangeCandidate`

**Requires:** nothing beyond `src/domain/`.

**Input:** `src/domain/landing.ts` (new file), `src/domain/landing.test.ts` (new file).

**Action — RED:** tests: (a) `newChangeCandidate` returns a `ChangeCandidate`
with `state: "pending"` and all supplied fields; (b) the returned object is a
fresh value (input not mutated); (c) TypeScript types for `Acceptance`,
`Integration`, `LandedChange` are importable without error (compile test).
Fails today: file does not exist.

**Action — GREEN:** create `src/domain/landing.ts` with the locked types and
`newChangeCandidate` factory. No imports outside `src/domain/`.

**Action — REFACTOR:** none.

**Output:** pure domain types and factory for the landing lifecycle.

**Verify:** `node --test src/domain/landing.test.ts` green; `npm run typecheck` 0.

---

### Task T2 — port: `RepositoryLanding`, `LandingCandidate`, `LandingResult`, `LandingConflictError`

**Requires:** T1.

**Input:** `src/landing/port.ts` (new file), `src/landing/` directory (create).

**Action — RED:** a compile test that imports
`{ RepositoryLanding, LandingConflictError }` from `./port.ts` and a fake
`class FakeLanding implements RepositoryLanding` with a `land` stub. Also: a
test that `new LandingConflictError(candidate, [])` has `name ===
"LandingConflictError"` and `.candidate` set. Fails today: file does not exist.

**Action — GREEN:** create `src/landing/port.ts` with the locked types. No
imports outside `src/domain/`.

**Action — REFACTOR:** none.

**Output:** port interface and error class; `FakeLanding` in tests.

**Verify:** `npm run typecheck` 0; `npm run lint` clean.

---

### Task T3 — migration 7: `landing_candidates`, `landing_integrations`, `repo_locks` tables

**Requires:** Story 01 T3 (migration 7 must already exist with the
`epic-007.1-e2e-hardening` entry). This task **appends DDL** to that migration's
`up` body.

**Input:** `src/storage/sqlite/migrations.ts`,
`src/storage/sqlite/migrations.test.ts`.

**Action — RED:** extend the existing migration test: after running migration 7,
assert that `landing_candidates`, `landing_integrations`, and `repo_locks` tables
exist with the correct columns (check `PRAGMA table_info`). Also assert
`landing_candidates.state` constraint rejects values outside
`pending|landed|conflict`. Fails today: these tables do not exist.

**Action — GREEN:** add the three `CREATE TABLE` statements to the migration 7
`up` callback (append to the existing `db.exec(...)` call). Existing rows and
story 01 columns are unaffected.

**Action — REFACTOR:** none.

**Output:** migration 7 includes all landing tables; fresh DB has them after
`db migrate`.

**Verify:** `node --test src/storage/sqlite/migrations.test.ts` green; `npm run verify` green.

---

### Task T4 — `LandingRepository` SQLite adapter + `GitRepositoryLanding` adapter

**Requires:** T1, T2, T3.

**Input:** `src/landing/git.ts` (new file), `src/storage/sqlite/landing.ts` (new file),
`src/landing/git.test.ts` (new file).

**Action — RED:** real-git tests in temp dirs: (a) landing a commit that is a
direct ancestor of home `main` (fast-forward) succeeds with
`outcome.kind === "fast-forward"` and home `main` HEAD equals `candidateSHA`; (b)
landing a commit that diverged from home `main` succeeds with
`outcome.kind === "merge"` and home `main` is a merge commit containing both; (c)
landing a commit with a conflicting change to the same file returns
`LandingConflictError` with the conflicting file listed; (d) crashing between the
`saveCandidate` write and the git mutation (simulate by throwing after write):
re-calling `land` with the same candidate finds `pending` row, sees
`candidateSHA` is NOT an ancestor of target, and completes the landing cleanly; (e)
calling `land` with a candidate whose SHA is already reachable from target returns
`outcome.kind === "already-landed"` without mutation; (f) two concurrent `land`
calls on the same repo+branch run sequentially under the lock (one waits; both
complete; no lock file left behind). Fails today: adapter and lock do not exist.

**Action — GREEN:** implement `GitRepositoryLanding` using `execFile` (no shell).
Lock file path: `<lockDir>/<repoId>-<branch>.lock`. Lock protocol: `open(path,
flags.O_CREAT | flags.O_EXCL)` for exclusive create; exponential-backoff retry
up to 30s (initial 50ms, factor 1.5). Stale PID: if lock file exists and PID is
not alive (`kill(pid, 0)` throws), delete and retry. After acquiring: write
candidate row (`state=pending`); check `git merge-base --is-ancestor candidateSHA
target` for idempotency; classify ancestry (`git merge-base target candidateSHA`
→ if equal → ff; otherwise merge); execute the git op; update row state; release
(delete lock file). Implement `SqliteLandingRepository` in `storage/sqlite/landing.ts`
implementing `LandingRepository`.

**Action — REFACTOR:** extract `acquireLock` / `releaseLock` as module-internal
helpers.

**Output:** `GitRepositoryLanding` passes all real-git tests; idempotency and
lock contention proven.

**Verify:** `node --test src/landing/git.test.ts` green; typecheck 0; lint clean.

---

### Task T5 — rewire `ApproveTask` + A7 `base_commit` population

**Requires:** T1, T2, T4.

**Input:** `src/app/task/approve-task.ts`, `src/app/task/approve-task.test.ts`,
`src/composition.ts`.

**Action — RED:** tests using a `FakeLanding`: (a) `ApproveTask.execute` with a
task that has a `repository` context binding calls `landing.land` with the
correct `baseSHA` (from `task_results.base_commit` set by `PiAgentRunner`) and
`candidateSHA` (from `task_results.proposal_commit`); (b) after a successful
`fast-forward` land, `task_results.base_commit` is set (was null pre-story); (c)
`LandingConflictError` from the fake → task stays `awaiting_confirmation`, a
`task.conflict` event is emitted, `execute` does NOT throw; (d) a task with no
`repository` binding in `task_context` skips `land` entirely and still completes
(filesystem-sourced task). Fails today: `ApproveTask` has no `RepositoryLanding`
dependency; `base_commit` is never written.

**Action — GREEN:** add `RepositoryLanding` as a constructor parameter of
`ApproveTask` (optional; skipped when not supplied, for filesystem tasks). After
`#promote`, if `task_context` contains a `repository` row: call
`landing.land(homeDir, candidate)` where `homeDir` is derived from the workspace
manager's home directory for that repo. On `LandingConflictError`: emit
`task.conflict` event, do NOT transition to `completed`, return early. On
success: persist `base_commit` into `task_results` before the transaction. Wire
`GitRepositoryLanding` into `buildDeps` in `composition.ts`.

**Action — REFACTOR:** none.

**Output:** `ApproveTask` lands to home `main`; `base_commit` is populated; A7
fixed; conflicts surface as events.

**Verify:** `node --test src/app/task/approve-task.test.ts` green; typecheck 0.

---

### Task T6 — CLI: `repo land` command

**Requires:** T4, T5.

**Input:** `src/apps/cli/router.ts`, `src/apps/cli/repo.ts` (new or extend).

**Action — RED:** a test that calls the `"repo land"` command handler with
`{ repository: repoId, workspace: wsDir, base: "main", candidate: sha }`, a fake
`RepositoryLanding` that returns `fast-forward`, and asserts `exitCode: 0` and
stdout JSON `{ outcome: "fast-forward", canonicalSHA: <sha> }`. A conflict fake
→ `exitCode: 1`, stdout JSON `{ outcome: "conflict", files: ["file.ts"] }`.
Re-landing the same SHA → `exitCode: 0`, `{ outcome: "already-landed" }`.
Fails today: command does not exist.

**Action — GREEN:** add `"repo land"` to `COMMANDS` in `router.ts`. Implement
the handler in `repo.ts`: parse flags, look up the `Repository` by id (to get
`homeDir`), call `RepositoryLanding.land`, emit JSON to stdout. Non-zero exit on
conflict (not a throw — conflict is expected).

**Action — REFACTOR:** none.

**Output:** `repo land` is a real CLI command; proof command in the epic script
passes.

**Verify:** handler unit test green; typecheck 0; lint clean.
