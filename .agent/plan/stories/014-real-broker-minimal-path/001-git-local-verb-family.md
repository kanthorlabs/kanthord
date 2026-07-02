# Story 001 - Git Local Verb Family

Epic: `.agent/plan/epics/014-real-broker-minimal-path.md`

## Goal

`git.clone`, `git.fetch`, `git.branch`, and `git.commit` run as real broker verbs
over the git CLI, normalized through the always-async lifecycle, with typed
failures surfaced from git's exit-code/stderr contract.

## Acceptance Criteria

- Each verb has a yaml registry entry declaring the complete PRD §5 contract —
  `tier: auto`, per-verb timeout, retry, `idempotency`, `rate-limit: n/a`,
  `regression: n/a` — explicit values, no dimension by omission (debate
  finding) — and registers cleanly against the Epic 005 adapter interface.
- Each mutating verb declares its **desired effect** for reconcile (debate
  finding): `git.branch` = ref exists at the named point; `git.commit` = the
  branch head's **tree hash** equals the staged content's tree (content
  identity — a retried commit re-creating the same tree reconciles `done`, it
  does not stack a second commit); `git.clone`/`git.fetch` are re-run-safe by
  nature and declare it.
- Submitting `git.branch` then `git.commit` through the broker on a temp repo
  produces the branch and commit on disk, with completion rows written via the
  Epic 005 poll lifecycle — the caller only ever sees `op_id` + completion
  (always-async, PRD §5).
- `git.clone` from a local bare remote path materializes the work tree;
  `git.fetch` updates refs from it.
- A failing git command (e.g. committing with nothing staged, cloning a missing
  path) resolves the op `failed` with a typed error carrying git's stderr summary
  — never an unhandled throw (PROFILE.md error handling).

## Constraints

- Git is invoked exactly per the Epic 011 SU1 findings
  (`.agent/plan/feedback/014-real-broker-minimal-path/git-cli.md`); one invocation
  seam shared with Epic 012's store (do not add a git library).
- The git seam runs **isolated**: private `HOME`/`XDG_CONFIG_HOME`,
  `GIT_CONFIG_NOSYSTEM`, hooks disabled, no inherited credential helpers, fixed
  author identity — real git without ambient user config (debate finding —
  hermetic is not automatic; per the SU1 env-sanitization findings).
- Local-only: every test remote is a bare repo on a temp path — no network
  (PROFILE.md hermetic tests; the live remote appears only in Epic 019).
- These are **local** ops: `reconcile` inspects the local repo state (the
  ledger's desired-effect hash vs actual ref/commit) — still mandatory (Epic 005:
  a verb with no reconcile path cannot be async).

## Verification Gate

- `npm test` green for `src/broker/verbs/git-local.test.ts`.

### Task T1 - Registry entries + branch/commit adapters

**Input:** `src/broker/verbs/git-local.ts`, `broker/verbs/git.branch.yaml`,
`broker/verbs/git.commit.yaml`, `src/broker/verbs/git-local.test.ts`

**Action - RED:** Write tests: (a) the registry loads `git.branch`/`git.commit`
entries with tier `auto`; (b) submit branch+commit on a temp repo yields the
branch and commit on disk with completion rows via the poll lifecycle; (c) commit
with nothing staged resolves `failed` with the stderr summary.

**Action - GREEN:** Implement the two adapters over the SU1 invocation seam and
their registry entries.

**Action - REFACTOR:** extract the shared "run git, map exit/stderr to typed
result" helper used by all four verbs.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - clone/fetch adapters + local reconcile

**Input:** `src/broker/verbs/git-local.ts`, `broker/verbs/git.clone.yaml`,
`broker/verbs/git.fetch.yaml`, `src/broker/verbs/git-local.test.ts`

**Action - RED:** Write tests: (a) `git.clone` from a local bare path
materializes the tree; (b) `git.fetch` updates refs after the bare remote gains a
commit; (c) reconcile on an interrupted `git.commit` resolves `done` when the
branch head's tree hash matches the desired tree (even though the commit sha
differs from any prediction) and `resubmit` when it does not — a resubmit after
a completed-but-unrecorded commit does not stack a second commit.

**Action - GREEN:** Implement clone/fetch adapters and the local-state reconcile
for the family.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
