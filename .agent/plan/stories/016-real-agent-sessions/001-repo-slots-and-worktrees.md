# Story 001 - Repo Slots & Worktrees

Epic: `.agent/plan/epics/016-real-agent-sessions.md`

## Goal

Repo slots load from per-repo yaml config; the worktree strategy creates a
worktree per dispatched task and removes it at completion; slot concurrency is
enforced through the existing capability-lease mechanism.

## Acceptance Criteria

- A per-repo yaml (`repo`, `strategy: worktree`, `max_concurrent_tasks`,
  `workflows_allowed`, `identity`) loads into a typed slot; unknown strategy,
  missing repo, or an `identity` not present in the keyring (Epic 014 Story 000) is
  a typed error naming the file (PRD §3.3 config shape; multi-account keyring —
  Ulrich 2026-07-05).
- Registering a path that is not a git repository fails at registration with a
  typed error — unsupported, not silently accepted (PRD assumption #5).
- Dispatching a task on a slot creates a git worktree on a task-named branch
  under the slot's worktree area; **completing** the task removes the worktree
  (the branch survives); **parking keeps the worktree** — it holds uncommitted
  state and the session teardown must not destroy it (debate finding; WIP-commit
  park/resume is the `single_checkout` protocol, Phase 2B).
- Branch naming is deterministic and sanitized from the task id; a pre-existing
  branch of the same name that is **not** this task's branch is a typed error,
  not a silent reuse (debate finding — collision handling defined).
- A worktree removal that fails (dirty/blocked) is a typed error + escalation,
  never a silent force-delete (debate finding).
- Slot concurrency is a capability lease: with `max_concurrent_tasks: 1`, a
  second task on the slot is not dispatched until the first releases; with `2`,
  both run (PRD §3.3 — lease per worktree, capped).
- A crashed task's worktree is safe to recreate on re-dispatch (idempotent
  create-or-reuse for the same task+branch).

## Constraints

- Worktree operations go through the Epic 011 SU1 git seam (`git worktree
  add/remove`) — no direct child_process calls outside it.
- Concurrency uses Epic 004 capability leases (slot capacity is a `resources:`
  capability) — no new locking mechanism (PRD §7.3 one lease manager).
- Tests use temp git repos; slot yaml fixtures live beside the tests.

## Verification Gate

- `npm test` green for `src/slots/repo-slot.test.ts`.

### Task T1 - Slot registry + registration validation

**Input:** `src/slots/repo-slot.ts`, `src/slots/repo-slot.test.ts`

**Action - RED:** Write tests: (a) a valid slot yaml loads typed; (b) unknown
strategy / missing repo ⇒ typed error naming the file; (c) non-git path ⇒ typed
registration error.

**Action - GREEN:** Implement the slot registry over the Epic 001 yaml loader
with git-repo validation via the git seam.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Worktree lifecycle + lease-capped concurrency

**Input:** `src/slots/worktree.ts`, `src/slots/worktree.test.ts`

**Action - RED:** Write tests: (a) dispatch creates a worktree on a sanitized
task branch; completion removes the worktree, branch remains; (b) parking keeps
the worktree with its uncommitted file intact; (c) `max_concurrent_tasks: 1`
serializes two tasks via the lease (second dispatches after release);
(d) re-dispatch after a simulated crash reuses/recreates the same task worktree
without error; (e) a foreign same-name branch is a typed error; (f) a blocked
removal is a typed error + escalation.

**Action - GREEN:** Implement worktree create/remove bound to the task lifecycle
(remove on complete, keep on park) and register slot capacity as a lease
capability.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
