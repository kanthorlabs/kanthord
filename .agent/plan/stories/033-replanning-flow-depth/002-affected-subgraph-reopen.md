# Story 002 - Affected-Subgraph Re-Open

Epic: `.agent/plan/epics/033-replanning-flow-depth.md`

## Goal

After the human's approved recompile mints `G+1`, exactly the affected part of
the plan re-opens — computed by one exported affected-set seam that Epic 037
will reuse — and everything else keeps its state.

## Acceptance Criteria

- The affected-set seam takes (old generation, new generation) and returns a
  verdict **keyed by stable frontmatter id** (debate finding — filenames are
  position, ids are identity; renames must not break keying):
  `unaffected | changed | downstream | invalidated | added | removed`.
  `changed` = the node's own definition changed (frontmatter, body, or
  filename — same id, new position); `downstream` = reachable from a changed
  node via edges or a consumer of a changed artifact; `invalidated` = swept
  in only because a feature-level invariant (epic Acceptance / policies)
  changed (debate finding — a distinct verdict, not overloaded `downstream`,
  so Epic 037's continuation can treat it explicitly); `added`/`removed` =
  present in only one generation (debate finding — deletes/adds must be
  representable; a removed node's consumers are `downstream`).
- On approval (via the Epic 026 `plan.approveReplan` path) and successful
  recompile: affected in-flight tasks park with a `rebase` marker — the
  session is torn down through the Epic 004/006 park path (STATE
  checkpointed) and the task's leases are released (debate finding — parking
  has session/lease consequences, named here); affected `done` tasks' exit
  gates re-open and the tasks re-enter `pending` with a `rework` marker, and
  their published **artifacts are invalidated for consumers** — a consumer's
  entry gate no longer passes on the stale hash until re-publication (debate
  finding — re-opening a publisher without invalidation would let consumers
  run against stale handoffs); `invalidated`-verdict tasks follow the same
  park/re-open rules as `downstream`; unaffected tasks keep their state and
  (if running) their pinned generation — each asserted by node id against
  both the seam output and observed scheduler behavior.
- The re-open application is **idempotent behind a durable apply marker**
  (debate finding): the approval durably records the affected-set snapshot
  before any mutation; re-running the application (e.g. after a crash
  mid-apply) converges to the same end state with no duplicated journal
  events and no half-re-opened subgraph (asserted by crashing mid-application
  and re-applying).
- Re-opened and parked tasks carry the plan diff reference in their journal
  (why they re-opened is reconstructable).
- Rejecting the diff leaves the execution-affecting state — generation, gate
  states, task states, lease ownership — field-by-field identical to the
  pre-signal snapshot (journals/inbox records/timestamps exempt; the
  rejection is itself journaled — debate finding).
- A recompile that fails lint/compile leaves the feature in `replanning`
  (halted) with the diagnostics on the replan item — never a partial re-open.
- The seam is importable by other modules and classifies fixtures per the
  verdict table above (its purity and export shape are Constraints, not
  behavior — debate finding).

## Constraints

- One affected-set implementation, exported as a named module with a
  documented contract comment, pure over compiled plan rows with no
  scheduler dependencies, consumed by Epic 037 (Epic 033 Findings note;
  Epic 037 anchor — forking it is a review blocker).
- Re-open mechanics ride the existing gate/state machinery from Epics
  002/004/006 — no parallel task-state store.
- Recompile is the Epic 002 sign-off compile; `G+1` semantics per PRD §7.1.1.

## Verification Gate

- `npm test` green for `src/replan/affected-set.test.ts` and
  `src/replan/reopen.test.ts`; `npm run typecheck` exits 0.

### Task T1 - Affected-set seam

**Input:** `src/replan/affected-set.ts`, `src/replan/affected-set.test.ts`

**Action - RED:** Write tests over compiled-plan fixtures: (a) node-text edit
⇒ that node `changed`; (b) edge-downstream nodes ⇒ `downstream`; (c) artifact
consumers of a changed publisher output ⇒ `downstream`; (d) epic Acceptance
edit ⇒ every node `invalidated`; (e) untouched parallel lane ⇒ `unaffected`;
(f) filename-only rename (same id) ⇒ `changed`; (g) a node added in `G+1` ⇒
`added`; a node deleted ⇒ `removed`, with its consumers `downstream`.

**Action - GREEN:** Implement the pure seam over plan rows with the contract
comment.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Re-open transitions

**Input:** `src/replan/reopen.ts`, `src/rpc/control-verbs.ts`,
`src/replan/reopen.test.ts`

**Action - RED:** Write tests: (a) approval + recompile ⇒ affected in-flight
parks `rebase` with session torn down + leases released, affected done
re-opens `rework` with exit gate reset + artifact invalidation for its
consumers, unaffected untouched — by id; (b) journals carry the diff
reference; (c) rejection ⇒ execution-affecting snapshot equality;
(d) failed recompile ⇒ still `replanning`, diagnostics attached, no re-open;
(e) crash mid-application + re-apply converges (idempotent, no duplicate
journal events).

**Action - GREEN:** Implement the re-open transition driven by the T1 seam,
wired into the approveReplan flow.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
