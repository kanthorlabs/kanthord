# Story 001 - Role Path Policy

Epic: `.agent/plan/epics/015-full-ring1-agents.md`

## Goal

Per-agent-role path allowlists/denylists are a yaml registry evaluated in
`beforeToolCall` before the write-scope check: a role-denied path is blocked and
escalated no matter what the task's `write_scope` says.

## Acceptance Criteria

- A role policy registry (yaml) declares, per role, **separate read and write
  dimensions** of allowed/denied path globs (debate finding — agents often need
  broad read + narrow write; shared confidential deny rules apply to both);
  loading a registry with an unknown role field or malformed glob is a typed
  error naming the file (PRD §4; format rules — registries are yaml).
- Policy evaluation happens on **canonicalized paths**: symlinks resolved, `..`
  segments collapsed, relative paths made absolute against the worktree; a
  symlink inside an allowed dir pointing at a denied target is blocked; a
  `../..` escape is blocked; rename/copy checks **both** paths (debate finding —
  canonicalization is the policy's foundation, asserted not assumed).
- A write to a denied path is blocked (the write does not happen) and escalated
  with role, rule, and path — even when the path is inside the task's
  `write_scope` (deny wins).
- A write outside every allowed glob for the role is blocked the same way
  (allowlist is the boundary, not just the denylist).
- An allowed-path, in-scope write passes through to the write-scope check —
  evaluation order role-policy → write-scope is observable (a role-denied call
  never reaches the write-scope check).
- Reads are subject to the same role policy (denied paths are unreadable) —
  PRD §4 protects confidential data, not only writes.

## Constraints

- Pure deterministic evaluation over (role, operation, path) — the module imports
  no model seam (PRD §4 model-independence).
- Registry loaded via the Epic 001 yaml loader; policy evaluation lives in
  `src/ring1/` alongside Epic 007's check and reuses its escalation event shape
  (one ring-1 event vocabulary).

## Verification Gate

- `npm test` green for `src/ring1/role-path-policy.test.ts`.

### Task T1 - Registry + evaluation

**Input:** `src/ring1/role-path-policy.ts`, `src/ring1/role-path-policy.test.ts`

**Action - RED:** Write tests: (a) a valid registry loads roles with separate
read/write allow/deny globs; malformed registry is a typed error naming the
file; (b) denied write path ⇒ blocked + escalation with role/rule/path, even
inside `write_scope`; (c) path outside all allows ⇒ blocked; (d) allowed path ⇒
passes; (e) a denied-path read is blocked while the same path may be
write-denied but read-allowed under a different rule set; (f) canonicalization:
a symlink into a denied target, a `../..` escape, and a rename with one denied
side are each blocked.

**Action - GREEN:** Implement the registry schema + the evaluate function over
canonicalized paths, emitting Epic 007-shaped escalations.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Ordering ahead of write-scope

**Input:** `src/ring1/role-path-policy.ts`, `src/ring1/role-path-policy.test.ts`

**Action - RED:** Write a test with an instrumented write-scope check proving a
role-denied call never reaches it, and an allowed call does.

**Action - GREEN:** Compose role policy before the Epic 007 write-scope check in
the shared `beforeToolCall` policy chain.

**Action - REFACTOR:** name the composed chain (`ring1PolicyChain`) as the single
seam Epic 016 wires into sessions.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
