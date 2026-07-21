# Story 3 — F3: discriminated approve outcomes

Epic: `.agent/plan/epics/007.4-landing-robustness.md`

## Goal

`ApproveTask` handles landing errors at the wrong level. On conflict it appends
`task.conflict` and `return`s (`src/app/task/approve-task.ts:233-236`) — so the
CLI sees a normal return and can report apparent success; on any other landing
error it `throw err` (`:237`) which escapes as an uncaught exception (raw Node
stack trace, non-zero exit, task left inconsistent). This story makes the use
case return a **discriminated result** and moves formatting to the driving
adapter (debate B6/B7).

## Contract (tests assert this)

- `ApproveTask.execute()` returns one of:
  - `{ kind: "approved", taskId, canonicalSHA }` — landed (ff or merge); task
    `completed`, dependents released (existing behavior).
  - `{ kind: "conflict", taskId, conflictFiles? }` — `LandingConflictError`
    caught; task stays `awaiting_confirmation`; `task.conflict` event recorded.
    **Only** report `conflict` if the `feed.append(task.conflict)` succeeds — if
    recording fails, do NOT report success (debate S9); surface as
    `landing_failed`.
  - `{ kind: "landing_failed", taskId, message, cause }` — any other landing
    error: `message` is safe user text (redacted), `cause` is the original error
    retained for structured logging (debate B9). Task left recoverable (still
    `awaiting_confirmation`), NOT `completed`.
- The three outcomes are distinct — an expected conflict and an infra/git failure
  must not collapse into one generic path (debate S8).
- CLI action (`src/apps/cli/**` approve command): maps outcome → exit code + a
  single sanitized line — `approved` (0), `conflict` (0, actionable message),
  `landing_failed` (non-zero, `error: <safe msg>`). No raw stack trace ever
  reaches stdout/stderr. The original `cause` goes to the structured logger, not
  the user line.
- No new durable task state (debate S7) — `awaiting_confirmation` + typed
  outcome + event is the whole model.

## Constraints

- Keep the transactional completion block (`approve-task.ts:244-279`) intact for
  the `approved` path.
- Document land re-run safety: after a `landing_failed`, re-approving must be
  safe given the existing crash-idempotent candidate store + per-repo lock (note
  the assumption; deep phase-aware partial-failure recovery is out of scope —
  Appendix B8).
- Hermetic — fakes for the landing port; real git only where already used.

## Verification Gate

- `node --test src/app/task/approve-task.test.ts` — fake landing returns/raises
  to drive all three outcomes; conflict keeps `awaiting_confirmation` + records
  the event + no throw; `feed.append` failure on conflict → `landing_failed`, not
  `approved`; generic error → `landing_failed` with safe text + retained cause.
- CLI action test — each outcome → correct exit code + single sanitized line.
- `npm run typecheck` 0; `npm run lint` clean.
