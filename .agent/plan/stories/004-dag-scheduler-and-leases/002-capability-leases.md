# Story 002 - Capability Leases (expiry + heartbeat)

Epic: `.agent/plan/epics/004-dag-scheduler-and-leases.md`

## Goal

Serialize colliding tasks by capability lease — write-scope paths and declared
`resources` — with expiry and heartbeat so disjoint work runs concurrently, shared
work serializes, and a crashed holder's lease is reclaimed rather than held forever.

## Acceptance Criteria

- Two tasks with **disjoint** `write_scope` (e.g. `ios/**` vs `macos/**`) can both
  acquire their leases at once (PRD §7.3 — disjoint scopes run concurrently).
- Two tasks that both declare a shared capability — an overlapping `write_scope`
  prefix, or the same `resources` entry (e.g. `ports:5432`) — cannot both hold; the
  second blocks until the first releases (PRD §7.3 — serialize on any shared
  capability).
- A lease carries an expiry; a holder renews it by heartbeat. If `now()` (fake
  clock) passes the expiry with no heartbeat, the lease is reclaimable and a waiting
  task can then acquire it (PRD §7.3 — expiry + heartbeat, crashed task must not
  hold forever).
- A heartbeat before expiry extends the lease and keeps the waiter blocked.
- Releasing a lease frees it for a waiter within the **same poll pass** (asserted:
  release then poll → the waiter is dispatchable in that pass, no extra tick).
- **Write-scope overlap is by normalized path prefix**, tested at the edges:
  `ios/**` overlaps `ios/foo/**`; `ios/**` does **not** overlap `ios2/**`; `ios` and
  `ios/` canonicalize to the same scope; the empty/root scope overlaps everything.
  Resource keys serialize by **exact canonical key**, never by prefix.
- **Multi-capability acquisition is atomic (all-or-nothing):** a task needing
  `write_scope=A` **and** `resources=ports:5432` that cannot get `ports:5432`
  acquires **neither** — no partial lease rows remain for it (debate finding).

## Constraints

- Leases are **per capability, not per repo**; `write_scope` is one capability,
  each `resources` entry another; the manager serializes on any shared capability
  (PRD §7.3). Overlap for paths is prefix-based (matching Epic 002 shape-lint
  disjointness).
- Leases are never plain boolean flags — every lease has `holder`, `expires_at`,
  and a heartbeat timestamp (PRD §7.3).
- Expiry is evaluated against the injected Epic 001 clock; tests advance the fake
  clock to cross expiry with no real waiting.
- The guarantee is stated **negatively**: leases prevent concurrent writes to
  *declared* resources only; they do not prove runtime independence (PRD §7.3) —
  cited, not tested (no sandbox in Phase 1).

## Verification Gate

- `npm test` green for `src/scheduler/leases.test.ts` on the fake clock.

### Task T1 - Acquire/serialize on shared capability, concurrency on disjoint

**Input:** `src/scheduler/leases.ts`, `src/scheduler/leases.test.ts`

**Action - RED:** Write tests: (a) disjoint `write_scope` → both acquire; (b)
`ios/**` vs `ios/foo/**` overlap → second blocks; (c) `ios/**` vs `ios2/**` → both
acquire; (d) `ios` and `ios/` canonicalize equal (overlap); (e) same `resources`
entry → second blocks; (f) after the first releases, the second acquires **within
the same poll pass**; (g) atomic acquisition — a task needing `A` + `ports:5432`
that fails on `ports:5432` holds neither (no partial rows).

**Action - GREEN:** Implement `LeaseManager.acquire(taskId, capabilities)` /
`release(taskId)` with normalized-prefix write-scope overlap + exact-key resource
serialization, acquiring all capabilities atomically or none.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Expiry + heartbeat reclaim

**Input:** `src/scheduler/leases.ts`, `src/scheduler/leases.test.ts`

**Action - RED:** Write tests on the fake clock: (a) advancing past `expires_at`
with no heartbeat makes the lease reclaimable and a waiter acquires it; (b) a
heartbeat before expiry extends the lease and the waiter stays blocked.

**Action - GREEN:** Add `heartbeat(taskId)` (extends `expires_at`) and expiry
evaluation against the injected clock in acquire/reclaim.

**Action - REFACTOR:** Extract the expiry check into a named predicate if reused;
otherwise `none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
