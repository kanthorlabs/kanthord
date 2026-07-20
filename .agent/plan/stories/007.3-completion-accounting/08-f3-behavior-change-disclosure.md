# Story 8 — F3: behavior-change disclosure sweep

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

Stories 3–7 change a **public** behaviour: a _changed_ `generic@1` task bound to
a repository no longer goes straight to `completed` — it stops at
`awaiting_confirmation` with a candidate and requires `approve task` (the human
gate) before it lands and completes. Any test, CLI output, daemon outcome, or
filesystem-backed expectation that still encodes "generic means no gate → changed
completes immediately" is now wrong. This story updates every such surface
**explicitly** (not silently) and records the change in a changelog note, so the
behaviour change is disclosed rather than discovered.

## Scope of the sweep

- **Tests asserting changed → `completed`** for a repository-bound generic task
  (in `run-next-task`, daemon, CLI, and any e2e/integration fixtures) → update to
  expect `awaiting_confirmation` + a candidate, then `completed` after approve.
- **Daemon outcome line** (`run-daemon.ts:93-95`): a changed repository-bound task
  now reports `awaiting_confirmation` (not `completed`) — update any test/snapshot
  asserting the old outcome.
- **CLI output**: `get task` / `get task --result` and any status listing that
  documented or asserted the old immediate-complete flow.
- **Filesystem-bound tasks**: confirm and assert they still `completed` directly
  on change (no candidate) — Story 4's carve-out — so the sweep does not
  over-correct.
- **No-change tasks**: confirm they `completed` directly (Story 3), and that any
  prior test expecting `failed NO_CHANGES` is updated.
- **Changelog note**: add a short, explicit entry (README/CHANGELOG or the
  established project changelog location) stating the gated-landing behaviour
  change for changed repository-bound `generic@1` tasks.

## Constraints

- This is a disclosure/alignment story: change **expectations and docs to match
  the new intended behaviour**, not the new behaviour itself (that is Stories
  3–7). Do NOT weaken a Story 3–7 assertion to make an old test pass — update the
  old test.
- Surgical: touch only surfaces that encode the old completion behaviour. Do not
  refactor unrelated tests.
- Keep the `Task.agent` field name (no EPIC 008 rename).

## Verification Gate

`npm run verify` fully green (typecheck + test + verify:handoff + lint + db
status) — i.e. the whole suite passes under the new gated behaviour with no
lingering old-behaviour assertion. The changelog note is present.

---

### Task T1 — align every old-behaviour surface + changelog note

**Requires:** Stories 3, 4, 5, 6, 7.

**Input:** the failing tests/fixtures surfaced by `npm run verify` after Stories
3–7 (across `src/app/task/`, `src/apps/cli/`, daemon and e2e fixtures), the CLI
output files, and the changelog location.

**Action — RED:** run `npm run verify`; the failures are exactly the surfaces
still encoding immediate-complete-on-change. Enumerate them (list in the story
discussion) — this is the RED list.

**Action — GREEN:** update each to the gated behaviour: changed repository-bound
generic task → `awaiting_confirmation` + candidate → `completed` after `approve
task`; filesystem-bound changed → `completed`; no-change → `completed`. Add the
explicit changelog note.

**Action — REFACTOR:** none (surgical edits only).

**Output:** the whole suite reflects and passes under the disclosed gated
behaviour; the change is documented.

**Verify:** `npm run verify` green; the changelog note present.
