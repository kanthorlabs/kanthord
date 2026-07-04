# Story 001 - Drift-Handling Depth

Epic: `.agent/plan/epics/034-ticket-drift-and-escalation-evidence.md`

## Goal

Detected ticket drift becomes a handled loop: one evidence-carrying open item
per node per source hash, keep-working default, an explicit halt that parks the
subtree, and re-snapshot as the resolution that also un-halts.

## Acceptance Criteria

- A drifted task ticket detected at a phase boundary (Epic 010 Story 004
  detector) yields exactly one open drift item carrying the snapshot content,
  the current content, and their diff; item identity is the **(node,
  baseline hash, current hash) pair** (debate finding — node + current hash
  alone is history-sensitive: content oscillating back after a re-snapshot
  must raise a new item, not be swallowed by dedup); crossing further
  boundaries with the same pair adds nothing; a second distinct upstream edit
  yields a second item (asserted, including the oscillation case).
- Feature-level drift (epic ↔ its source of truth) and task-level drift
  produce distinct items naming their node — the §6.3 hierarchy.
- Default is keep-working: the drifted node's task continues; only the signal
  exists (asserted — no state change beyond the item + journal).
- The human halt response parks the drifted node and its subtree with the
  Epic 033 park semantics (debate finding — halt needs an observable state
  model, not a verb): new dispatch in the subtree suppressed, running
  sessions torn down via the park path with leases released, in-flight broker
  ops continue to their ledgered completion but wake nothing until resume;
  a sibling parallel lane is untouched; the halt is a typed interaction.
- The re-snapshot response updates frontmatter (`content_hash`,
  `snapshot_at`), **requires a journaled rationale** (debate finding —
  accepting a new baseline after work has progressed is a human judgment;
  kanthord records it, it does not validate compatibility of completed work —
  PRD §6.3, the human owns the consequence), closes the item, and — if
  halted — resumes the subtree.
- All of it survives restart: an open drift item and a halted subtree are
  intact after kill/recover (asserted on the harness restart path).

## Constraints

- Consume the Epic 010 Story 004 detector — adding a second hash-compare
  path is a review blocker (Epic 034 anchor).
- Items/responses ride Epic 017 inbox + respond; interactions typed per
  PRD §2.
- Sync stays one-directional: nothing here writes to the external tracker
  (PRD §6.3).

## Verification Gate

- `npm test` green for `src/workflow/drift-handling.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Items, dedup, hierarchy

**Input:** `src/workflow/drift-handling.ts`, `src/workflow/drift-hook.ts`,
`src/workflow/drift-handling.test.ts`

**Action - RED:** Write tests: (a) drift ⇒ one open item with
snapshot/current/diff keyed by the (node, baseline, current) pair; (b)
same-pair boundary crossings add nothing; distinct second edit ⇒ second item;
content oscillating back post-re-snapshot ⇒ new item; (c) feature vs task
drift ⇒ distinct items naming their node; (d) keep-working default asserted
(task proceeds, no extra state).

**Action - GREEN:** Implement drift-item creation over the existing detector
with per-node-per-hash identity.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Halt, re-snapshot, restart survival

**Input:** `src/workflow/drift-handling.ts`, `src/inbox/respond.ts`,
`src/workflow/drift-handling.test.ts`

**Action - RED:** Write tests: (a) halt parks node + subtree with the park
semantics (dispatch suppressed, session torn down, leases released, broker
op completes but wakes nothing), sibling lane unaffected, interaction typed;
(b) re-snapshot without a rationale is rejected; with one it updates
frontmatter fields, journals, closes the item, resumes a halted subtree;
(c) restart with an open item + halted subtree recovers both intact.

**Action - GREEN:** Implement the halt and re-snapshot response actions and
their durable state.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
