# Story 002 - ring-1 gates the real tools

Epic: `.agent/plan/epics/019.15-real-agent-tools-via-pi-factories.md`

## Goal

Prove — and, if needed, align — that kanthord's ring-1 `beforeToolCall` hook
still gates the REAL pi tools: an out-of-worktree / out-of-scope `write` or `edit`
is blocked and escalated before the tool executes, an in-scope worktree write is
allowed, and `bash` never reaches the model. The real tools use `path` args
(resolved against the same cwd ring-1 uses), so the existing hook should apply;
this story locks that with tests and fixes any arg-shape mismatch.

## Acceptance Criteria

- With the real `write` tool + ring-1 wired (cwd == the ring-1 `worktree` root),
  a `write` whose `path` resolves **outside** the worktree, or outside the task's
  `write_scope`, returns a block from `beforeToolCall` and fires exactly one
  escalation — the tool's `execute` does not run (no file is written).
- An in-scope `write` to a path inside the worktree is allowed (hook returns
  pass-through) and the file is created.
- The same gating holds for the real `edit` tool (its `path` arg is extracted and
  policy-checked identically to `write`).
- The live tool set never contains `bash`; a pathless effectful tool remains
  blocked fail-closed (existing invariant unchanged).

## Constraints

- **Reuse the existing ring-1 seam** (`makeRing1HookAdapter` / `ring1PolicyChain`)
  — it already reads `args["path"]` and relativizes against `worktree`. Only
  extend path-arg extraction if a real tool names its path differently (verified:
  `write`/`edit` use `path`); do not rebuild the policy engine.
- **cwd == worktree invariant** (from Story 001) is what makes the tool's
  `resolveToCwd(path, cwd)` and ring-1's canonicalization agree — assert it, do
  not work around it.
- **No tool-surface or policy-semantics change** beyond arg-shape alignment.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  ring-1 (`hook-binding`, `role-path-policy`) and run-loop tests pass; guard green.

### Task T1 - ring-1 blocks/allows real write & edit tool calls

**Input:** `src/agent/pi-agent-adapter.test.ts` (or a new
`src/agent/real-tools-ring1.test.ts`), and, only if an arg-shape gap is found,
`src/ring1/hook-binding.ts`

**Action - RED:** a hermetic test drives the real `write` (and `edit`) tool
through the ring-1 `beforeToolCall` adapter (permissive role, `write_scope`,
`worktree` = a temp dir, tools built with the same dir as cwd): (a) a write to a
path outside the worktree is blocked + escalates and the file is NOT created; (b)
an in-scope write inside the worktree passes and the file IS created; (c) the same
for `edit`. Written to fail if ring-1 does not intercept the real tool's `path`.

**Action - GREEN:** if the tests already pass with the existing hook (expected,
since real tools use `path`), this is confirmation-only — no production change;
state that in the turn. If a real tool's path arg is not `path`, extend
`hook-binding.ts` path-arg extraction to cover it. Do not change policy semantics.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/agent/pi-agent-adapter.test.ts src/ring1/hook-binding.test.ts` green (adjust
path if a new test file is used).
