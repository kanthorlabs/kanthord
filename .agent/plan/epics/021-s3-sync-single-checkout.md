# 021 S3 Sync (backup/replication) & `single_checkout` Park/Resume

## Outcome

Two independent 2B bricks sharing this Epic because both extend Phase-2A
durability mechanics: (1) **one-way S3 sync** of the markdown store — the synced
copy is backup/replication under the single-writer invariant, never multi-master —
with integrity verification and a resumable sync cursor; (2) the
**`single_checkout` repo-slot strategy** with the WIP-commit park/resume protocol
(`wip(task): checkpoint <ts>` commits, resume via checkout + `git reset --soft`,
squash before PR) for repos where worktrees are too heavy (PRD §3.3).

**Independence note (debate finding):** the two stories share no code and are
independently shippable — a blocker on one (e.g. S3 credentials) must not stall
the other; `/work` may close them in either order.

**Backup-safety invariants (fixed here; debate findings — a backup that can
destroy itself is worse than none):**
- **Allowlist, not denylist:** only the store's covered plan files and
  operational markdown/jsonl (STATE/journal/RUNBOOK) sync — anything else under
  the root (SQLite, locks, temp, future runtime files) is excluded by not being
  on the allowlist.
- **Soft deletes:** a locally-removed file's remote object moves to a
  `trash/<ts>/` prefix, never a hard delete — a corrupted or torn local state
  cannot destroy backup history.
- **Own digests:** integrity uses a content digest stored in object metadata by
  the uploader — never the provider ETag (unreliable across multipart/providers,
  per the SU1 findings).
- **Cursor ordering:** upload first, verify, then advance the cursor — a crash
  re-uploads idempotently; a skipped upload is impossible by construction.
- **Remote-newer defined:** a remote object whose digest differs from both the
  local file and the manifest's last-uploaded digest — unexpected content,
  reported never applied (no `LastModified` clock semantics).

## Decision Anchors

- phases.md Phase 2B Deliverable 1 — S3 sync (backup/replication, single-writer)
  and `single_checkout` with WIP-commit park/resume.
- PRD §6.1 — markdown is the sole thing synced; S3 sync is backup/replication,
  not multi-master; SQLite is never synced; request IDs never synced.
- PRD §3.3 — `single_checkout`: one lease for the whole slot; park/resume via
  WIP commits, **never stash**; squash before PR; `max_concurrent_tasks` implied 1.
- Epic 020 SU1 findings — the S3 client surface and error taxonomy.
- Epic 012 — the git store root being synced; Epic 016 — the slot/worktree layer
  the strategy extends.

## Stories

- `001-s3-one-way-sync.md` — sync the markdown store to the bucket under a
  prefix per the backup-safety invariants above: allowlisted upload, soft
  deletes, digest integrity, ordered cursor; never downloads over local truth.
- `002-single-checkout-strategy.md` — the `single_checkout` slot strategy: one
  slot-wide lease; park = WIP commit (`add -A` semantics) on the task branch;
  resume = checkout + `reset --soft` (content-level restoration); WIP-only
  squash before the PR push; failure windows typed + escalated.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (S3 via an
  in-process double built from the SU1 findings; git on temp repos — hermetic).
- After a store mutation set, sync uploads exactly the changed allowlisted
  files (with the digest in object metadata) and soft-deletes removed ones to
  the `trash/` prefix; an interrupted sync resumes from its cursor without
  re-uploading everything, and a crash between upload and cursor advance
  re-uploads idempotently (ordering invariant asserted).
- Only allowlisted files ever appear in the double's object set — a planted
  stray file (log, cache, hidden file) under the root does not sync (allowlist
  asserted positively and negatively).
- Sync is strictly one-way: no code path downloads remote content over local
  files; a remote object with an unexpected digest (per the epic's definition)
  is reported, never applied (single-writer invariant).
- Credentials appear in no log, event, cursor/manifest file, or typed error
  (redaction sweep extended to sync state — debate finding).
- On a `single_checkout` slot: dispatching a second task while one is active
  waits on the slot lease; parking the active task creates a
  `wip(<task>): checkpoint <ts>` commit with `add -A` semantics (modified,
  deleted, and untracked files; ignored files excluded) and leaves a clean
  checkout for the next task; resuming checks the branch out and `reset
  --soft`s the WIP commit away — restoration is **content-level** (file
  contents match the parked tree; the staged/unstaged distinction is not
  preserved — accepted and documented, debate finding); the pre-PR squash
  collapses **only WIP commits** (into the preceding real commit, or into one
  task-titled commit if only WIP commits exist) — real commits are preserved
  (debate finding — a naive full squash was underdefined).
- Failure windows are typed + escalated (debate finding): a park whose WIP
  commit fails leaves the slot lease held (no second task dispatches onto a
  dirty tree); a resume onto a branch whose head is not the recorded WIP sha
  (externally modified) escalates instead of resetting; a failed post-park
  checkout for the next task escalates with the slot held.
- `git stash` is never invoked (PRD §3.3 — WIP commits, never stash; asserted
  on the git seam's command log).

## Dependencies

- **Epic 012** (git store root — the sync source; the store's atomic writes make
  file-level sync coherent; set-level tearing is accepted because deletes are
  soft and the next pass heals — debate finding, stated), **Epic 016** (slot
  registry + strategy field; if the slot interface lacks park/resume/pre-PR
  lifecycle hooks the strategy needs, adding them is an **additive seam
  extension with a decision note**, Epic 012 precedent — debate finding),
  **Epic 020 SU1** (S3 findings + credentials), **Epic 001** (clock for sync
  scheduling).

## Non-Goals

- No multi-master, no conflict resolution, no restore-from-S3 tooling — backup
  only; restore is a documented manual operation (PRD §6.1; assumption #2).
- No sync of SQLite, request IDs, or runtime state (PRD §6.1).
- No `single_checkout` disk-usage verification experiment (PRD §12 — optional,
  the default stands regardless).

## Findings Out

- none. The sync object layout and the WIP-commit message format are documented
  in the stories and asserted by tests.
