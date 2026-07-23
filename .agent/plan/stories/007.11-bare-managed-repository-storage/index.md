# EPIC 007.11 — Bare managed repository storage — stories

Epic: `.agent/plan/epics/007.11-bare-managed-repository-storage.md`
Prereq: none. **This is the prerequisite for 007.12** — land it fully first.

Make the managed home a **bare** git repo (no working tree). Per-task workspaces
still clone from it.

## Dispatch order

- **A + B are a pair** (a bare home breaks prep until B accepts it). Do A then B,
  or one worker does both.
- **C** after A+B (its checks run against a bare home).
- **D** last.

## Stories

- A — bare home provisioning → `01-create-bare-managed-home.md`
- B — bare-aware workspace prep → `02-bare-home-aware-preparation.md`
- C — object/ref-only landing → `03-object-ref-only-landing.md`
- D — existing-home migration policy → `04-existing-home-migration-policy.md`

## Facts (needed for implementation)

- No "bare" flag in storage; repos are `resources` rows
  (`src/storage/sqlite/migrations.ts:25-32`). Shape is detected on disk via
  `inspectCheckout` (`src/workspace/local.ts:176-219`). Do **not** add a column.
- The object landing path (`preview` + `landPreviewed`, `src/landing/git.ts:275-448`)
  already exists and is already used by `ApproveTask`
  (`src/app/task/approve-task.ts:246-321`). Story C only reroutes the manual CLI
  onto it.
