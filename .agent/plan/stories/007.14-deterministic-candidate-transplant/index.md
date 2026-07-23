# EPIC 007.14 — Deterministic stale-candidate transplant — stories

Epic: `.agent/plan/epics/007.14-deterministic-candidate-transplant.md`
Prereq: EPIC 007.13.

Recovering a stale-base candidate first tries a deterministic 3-way transplant
(no model); zero conflicts + gate green → new candidate needing fresh approval;
any conflict / gate fail → model rebuild.

## Dispatch order

**D-harness → A/B (one unit) → C.**

## Stories

- A — deterministic transplant in recovery → `01-deterministic-transplant-in-recovery.md`
- B — new candidate identity + `--refresh` → `02-new-candidate-identity-refresh-flag.md`
- C — approval reinvalidation → `03-approval-reinvalidation.md`
- D — `make-transplant-graph.sh` + audit wiring → `04-transplant-graph-and-audit-wiring.md`

## Facts (needed for implementation)

- `RetryTask.execute({ taskId, note?, rebuild? })` exists; `--rebuild` exists
  (007.10). `awaiting_confirmation` branch `src/app/task/retry-task.ts:89-127`
  (accepts retry when `candidate.state==="conflict"` OR `rebuild && state==="pending"`);
  failed branch `:129-140`. **`--refresh` does not exist; no transplant code
  anywhere.**
- 3-way machinery already exists for the _land_ flow: `preview`
  (`merge-tree --write-tree`, `src/landing/git.ts:275-351`), `landPreviewed`
  (`commit-tree`, `:371-448`). No rebase-onto-moved-base helper; not wired into
  `RetryTask`.
- `saveConflictSnapshot` is **not** implemented on the sqlite repo (no-op,
  `src/storage/sqlite/landing.ts`) — do not depend on it.
- Events: closed tuple (`src/domain/event.ts:3-21`); `candidate.transplanted`
  absent (Story D adds it); payload `Record<string,string>`.
- **Fake-agent turns are served identically to every task**
  (`src/agent-runner/fake-session.ts:62-75`) — not keyed per task. Story D must
  solve per-sibling region edits (env/cwd/title branching, or per-task turns).
