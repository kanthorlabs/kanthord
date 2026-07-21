# Story 3 — S3: guided note + marker-free agent context + snapshot

Epic: `.agent/plan/epics/007.6-guided-conflict-resolution.md`

## Goal

007.5 made `retry task --id <t>` recover a conflicted candidate. This story lets
the user **guide** the rebuild: `retry task --id <t> --note "<guideline>"` carries
a free-text note into the re-run, alongside a **marker-free structured conflict
context** so the agent rebuilds on a clean base with full knowledge of what clashed
— **without ever seeing a `<<<<<<<`/`>>>>>>>` marked file** (debate B3; the whole
point of "don't fix dirty conflict"). The existing `getPriorRejection` prompt hook
(`composition.ts:309`, injected at `pi.ts:451-459`) already threads a rejection
reason into the re-run prompt; we generalize that one channel to carry the note +
conflict context. The retry also **durably snapshots** `{candidateOID, targetOID,
conflictContext}` onto the recovery attempt so the rebuild prompt is deterministic
and auditable and does not depend on a git object surviving GC (debate B4/B5/S1).

## Contract (tests assert this)

- CLI: `retry task` (`src/apps/cli/commands/retry/task.ts`) gains an optional
  `--note <text>`. `runRetryTask` (`src/apps/cli/task.ts:114-118`) passes it
  through as `retryTask.execute({ taskId: id, note })`.
- `RetryTask.execute` (`src/app/task/retry-task.ts:60`) accepts an optional
  `note`. On a **conflict recovery** (the 007.5 `awaiting_confirmation` +
  `state==="conflict"` path), within the existing `uow.transaction`:
  - persist the `note` so it surfaces on `get task --json` (the Proof asserts
    `get task --id <t> --json | grep -q "keep both handlers"`), and so the prompt
    hook can read it back;
  - durably **snapshot** `{ candidateOID, targetOID, conflictContext }` onto the
    recovery attempt (per-attempt metadata, NOT a new lifecycle state). The
    `conflictContext` is the **marker-free** structured slices computed from S1's
    `preview` conflict outcome: target-side / candidate-side / base slices, labeled
    — assembled here (or via a small domain helper) from the hunk data, **never**
    the raw `<<<<<<<` blob.
  - `failed`-retry path (no conflict candidate) → `note` may still be persisted;
    no conflict snapshot (there is none). Existing `failed` behavior unchanged.
- Generalize the prompt hook. Rename `getPriorRejection` → `getPriorFeedback`
  across the runner seam (`src/agent-runner/pi.ts:278`, `:300`, `:453`) and the
  composition wiring (`src/composition.ts:309-317`). Its return type widens from
  `{ reason; summary?; proposalCommit? }` to
  `{ note?: string; conflictContext?: string; priorSummary?: string } | undefined`
  (the old `reason` is subsumed by `note`; `summary` → `priorSummary`).
- Prompt builder (`pi.ts:451-459`): when `getPriorFeedback(task.id)` returns a
  value, append a feedback block to the user prompt containing the `note` (if any)
  AND the `conflictContext` (if any). The injected text MUST NOT contain any
  `<<<<<<<`/`=======`/`>>>>>>>` sequence (debate B3) — the block is the labeled
  slices, not a marked file.

## Constraints

- Reuse the existing single hook, do not add a second prompt channel — generalize
  `getPriorRejection` in place (rename + widen). Keep the "no feedback → no block"
  behavior (`pi.ts:454` guard) intact.
- Marker-free is a hard invariant: the assertion "injected payload contains no
  `<<<<<<<`/`>>>>>>>`" is the acceptance test — the agent never receives markers.
- Snapshot is per-attempt metadata for determinism/audit (debate B4/B5) — reuse
  the existing `task_results` / candidate persistence; do NOT invent a new durable
  task lifecycle state (Non-goals).
- Keep `retry` and `reject` distinct (007.5 constraint): `retry --note` is conflict
  guidance (no `task.rejected`); it does not route through `RejectTask`.
- Hermetic: fakes for store/queue/feed and the runner's `getPriorFeedback`; no real
  git, no network.

## Verification Gate

- `node --test src/app/task/retry-task.test.ts`:
  - conflict recovery with `--note "keep both handlers"` → task `pending`, note
    persisted (readable back for `get task --json`), and a snapshot
    `{candidateOID, targetOID, conflictContext}` recorded on the recovery attempt;
    still no `task.rejected` event (007.5 regression).
  - `failed`-retry still transitions to `pending` (regression); no snapshot.
- `node --test src/agent-runner/pi.test.ts` — rename the two `getPriorRejection`
  cases to `getPriorFeedback`:
  - hook returns `{ note, conflictContext }` → the user prompt contains the note
    and the context AND (assert) contains **no** `<<<<<<<` / `>>>>>>>` sequence.
  - hook returns `undefined` → prompt has no feedback block (unchanged).
- `node --test src/apps/cli/task.test.ts` — `retry task --id <t> --note "<x>"` →
  exit 0 and the note reaches `RetryTask.execute` (fake asserts the arg).
- `node --test src/composition.test.ts` — the wired `getPriorFeedback` reads the
  persisted note back (composition regression for the rename).
- `npm run typecheck` 0; `npm run lint` clean.
