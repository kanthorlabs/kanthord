# Story 001 - pi Tool Read/Write Classification

Epic: `.agent/plan/epics/019.1-pi-tool-model-alignment.md`

## Goal

The `beforeToolCall` read/write classifier recognises pi's real read-only tools so
a read on a path outside the task `write_scope` is no longer blocked. Today
`classifyOperation` decides class by an underscore-suffixed prefix heuristic
(`read_`, `get_`, `list_`, …); pi's `read`, `ls`, `grep`, `find` have no
underscore, fall through to **write**, and a read on an out-of-scope path is
wrongly blocked and escalated as a re-planning signal. After this story those four
classify as **read** (pass-through on the path branch); `edit` and `write` still
classify as **write** and still enforce write-scope exactly as before.

## Acceptance Criteria

- Driven through the real SU3 `beforeToolCall` shape with a role/write-scope where
  the target path is **outside** `write_scope`: a `read` call returns pass-through
  (`undefined`) — no block, no escalation. The same holds for `ls`, `grep`, and
  `find`.
- The same out-of-scope path under an `edit` call **and** under a `write` call is
  still blocked (`{ block: true }`) and still emits exactly one escalation carrying
  the re-planning tag — Epic 007 semantics unchanged.
- A `read`/`edit`/`write` call on a path **inside** `write_scope` passes for all
  three (in-scope writes were never blocked; this must not regress).
- **Regression (generic-name fallback):** an unknown tool named `read_file` still
  classifies as read and `write_file` still classifies as write, so the pre-existing
  `hook-binding` / `write-scope` tests stay green.

## Constraints

- **Single source of truth:** tool class comes from a new canonical taxonomy module
  `src/agent/pi-tools.ts` exporting the pi read-only set (`read`, `grep`, `find`,
  `ls`) and the pi file-mutating set (`edit`, `write`). `classifyOperation` consults
  this taxonomy **first**; only names not in it fall back to the existing
  `READ_PREFIXES` heuristic. Do not delete the heuristic — it is the documented
  fallback for unknown/generic names (Epic Non-Goals; keeps Epic 007/015 tests
  green).
- This story changes only the **input mapping** to `ring1PolicyChain`
  (`operation: classifyOperation(toolName)`). It does not change write-scope
  evaluation, the escalation event shape, or the re-planning tag — those are Epic
  007 / Epic 015 Story 002 and stay untouched (cite them; do not edit their tests
  beyond the names asserted here).
- Model-independent, deterministic — no model seam introduced (PRD §4).

## Verification Gate

- `npm test` green for `src/agent/pi-tools.test.ts` and
  `src/ring1/hook-binding.test.ts` (plus the untouched `src/ring1/write-scope.test.ts`
  and `src/ring1/role-path-policy.test.ts`); `npm run typecheck` exits 0.

### Task T1 - Canonical pi tool taxonomy module

**Input:** `src/agent/pi-tools.ts` (new), `src/agent/pi-tools.test.ts` (new).

**Action - RED:** Write a test asserting the module exports the pi read-only set
`{read, grep, find, ls}` and the file-mutating set `{edit, write}`, that `bash` is
in neither, and that a classifier helper (e.g. `classifyPiTool`) returns `"read"`
for each read-only name and `"write"` for `edit`/`write` and `undefined` for a name
it does not know (so callers can fall back).

**Action - GREEN:** Create `pi-tools.ts` with the frozen name sets and the
classifier helper returning `read`/`write`/`undefined` per the test.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for `src/agent/pi-tools.test.ts`; `npm run typecheck`
exits 0.

### Task T2 - Classifier consults the pi taxonomy before the prefix heuristic

**Input:** `src/ring1/hook-binding.ts`, `src/ring1/hook-binding.test.ts`.

**Action - RED:** Write a test that builds the real `makeRing1HookAdapter` hook with
a `write_scope` that excludes a target path, then drives the SU3 `beforeToolCall`
context for each of `read`, `ls`, `grep`, `find` with that out-of-scope `path` and
asserts pass-through (`undefined`), no `onEscalate` call. Add a paired assertion
that `edit` and `write` on the same out-of-scope path still return `{ block: true }`
and escalate exactly once with the re-planning tag. Include one regression
assertion that a `read_file` call still classifies as read (fallback).

**Action - GREEN:** In `classifyOperation`, consult `classifyPiTool` from
`src/agent/pi-tools.ts` first; if it returns a class, use it; otherwise fall back to
the existing `READ_PREFIXES` heuristic.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for `src/ring1/hook-binding.test.ts` and the untouched
`src/ring1/write-scope.test.ts` / `src/ring1/role-path-policy.test.ts`;
`npm run typecheck` exits 0.
