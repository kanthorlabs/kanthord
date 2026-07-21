# Story 1 — N1a: honest, actionable conflict message

Epic: `.agent/plan/epics/007.5-conflict-recovery.md`

## Goal

When `approve task` hits a landing conflict, the single sanitized line the CLI
prints today (007.4 F3) is correct but unhelpful for recovery: it says a merge
conflict was detected and to "re-run after resolving", without naming the
command that actually recovers the task or which files conflicted. This story
enriches that line so a user knows exactly what to do next.

## Contract (tests assert this)

- The CLI `approve` action's `conflict` branch (`src/apps/cli/task.ts`, the
  formatter for the `{ kind: "conflict" }` outcome) prints **one** line to stderr
  that contains, in a single sanitized sentence:
  - the exact recovery command `kanthord retry task --id <taskId>`,
  - the conflicting file paths (from the outcome's `conflictFiles`, sourced from
    the landing `Integration` record 007.4 already persists), and
  - the next step in prose: re-run the daemon, then approve again.
- Exit code stays **0** for `conflict` (unchanged from F3 — a conflict is an
  expected, recoverable outcome, not a failure).
- No raw stack trace, no internal error object, no absolute workspace/temp paths
  beyond the repo-relative conflicting files. The original cause (if any) still
  goes only to the structured logger, never the user line.
- If `conflictFiles` is empty/unavailable, the line still names the recovery
  command and degrades gracefully (e.g. "conflicting files unavailable").

## Constraints

- The `ApproveTask.execute()` `conflict` outcome must carry `conflictFiles`
  through to the CLI. If the current `{ kind: "conflict", taskId, conflictFiles? }`
  shape already carries them (007.4), no use-case change is needed — assert the
  CLI reads them. If not, thread them from the landing `Integration` /
  `ChangeCandidate` record; do NOT re-query git.
- Formatting lives in the driving adapter only (`src/apps/cli/**`); the use case
  stays transport-neutral (AGENTS.md apps rule).
- Surgical: touch only the conflict formatter + whatever thin plumbing carries
  `conflictFiles` to it. Do not alter the `approved` / `landing_failed` lines.

## Verification Gate

- `node --test src/apps/cli/task.test.ts` (or the existing approve-action test
  file) — a `conflict` outcome with `conflictFiles: ["src/todo.mjs"]` produces a
  single line matching `/retry task --id/` and containing `src/todo.mjs`; exit
  code 0; asserts no stack-trace substring.
- Empty-`conflictFiles` case still names the command and exits 0.
- `npm run typecheck` 0; `npm run lint` clean.
