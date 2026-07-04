# 034 Ticket-Drift Handling & Escalation Evidence

## Outcome

The two "the human can actually act on it" polish pieces of Deliverable 1:
**ticket-drift handling** grows from detection to a full handling loop —
hierarchical re-hash at every phase boundary, a drift escalation that carries
the old/new content diff, keep-working default, an explicit halt path, and
re-snapshot as the resolution — and **escalations carry typed evidence**: every
escalation class has a declared evidence payload (diff, ledger excerpt,
observation evidence, drift diff, …) exposed over the control-plane API and
rendered per-class in the dashboard inbox, so no escalation ever demands
log-diving to answer.

## Decision Anchors

- phases.md Phase 3 Deliverable 1 — "ticket-drift handling at every phase
  boundary (§6.3); escalation UX with evidence attached".
- PRD §6.3 — clone-on-sign-off; re-hash at every workflow phase boundary; on
  drift: signal the human, keep working unless halted; human owns
  communication; hierarchy (feature ↔ epic, task ↔ sub-ticket).
- Epic 010 Story 004 — the phase-boundary hash-drift mechanism exists; this
  Epic adds the *handling*, never a second detector.
- PRD §7.4 (`on_fail: halt_and_escalate` **with observation evidence
  attached**) and §7.2 (`unclassified-artifact-change` escalation) — evidence
  was always the contract; this Epic makes it a typed, asserted payload.
- Epic 017/026/027 — inbox, read surface, dashboard inbox; this Epic extends
  their item shape, no parallel channel.

## Stories

- `001-drift-handling-depth.md` — hierarchical drift (feature and task level)
  raises one open drift item per node per source hash (no spam), carrying the
  snapshot/current content diff; default keep-working; human halt parks the
  node's subtree; re-snapshot (new `content_hash + snapshot_at`, journaled)
  resolves the item and unblocks a halted subtree.
- `002-escalation-evidence-contract.md` — a typed evidence union per
  escalation class (scope-violation: blocked path + attempted write summary;
  budget-breach: ledger excerpt; verb-failure/reconcile: op ledger chain +
  last external observation; drift: ticket content diff; deploy-failure:
  per-stage observation evidence; unclassified-artifact-change: artifact id +
  before/after hashes + byte-diff summary; replan: proposed plan diff) —
  size-bounded with an explicit truncation marker, exposed on inbox reads.
- `003-evidence-rendering.md` *(web)* — the dashboard inbox renders each
  class's evidence (diff view for diffs, table for ledger excerpts, stage list
  for observations), with the truncation marker visible when applied.

## Verification Gate

- `npm run typecheck` and `npm run typecheck:web` exit 0; `npm test` and
  `npm run test:web` green for the Story suites (hermetic; web on the fake
  generated client).
- A drifted task ticket at a phase boundary yields exactly one open drift item
  containing the content diff, keyed by the (node, baseline hash, current
  hash) pair (debate finding); crossing another boundary with the same pair
  adds none; a second distinct edit — including content oscillating back
  after a re-snapshot — yields a second item (asserted).
- Feature-level drift and task-level drift produce distinct items naming their
  node (hierarchy per §6.3).
- Halt parks the node's subtree (children included, unaffected lanes not);
  re-snapshot updates frontmatter (`content_hash`, `snapshot_at`), journals the
  resolution, and resumes a halted subtree.
- Every escalation class emitted anywhere in the daemon carries its declared
  evidence type, keyed off **one canonical class registry module** (debate
  finding — no prose-enumerated taxonomy) — an exhaustiveness test constructs
  each class and rejects an evidence-less escalation on any write path;
  legacy items read as an explicit `missing-evidence` payload
  (strict-write/tolerant-read, debate finding).
- Oversized evidence is truncated **class-aware** at named UTF-8-byte bounds
  (structural fields — ids, hashes, final observation, boundary ledger rows —
  survive) with the marker set, never dropped silently (asserted per debate
  finding).
- Web: for each class, the inbox item renders its evidence via
  locator-registry selectors; the truncated case shows the marker (component
  tests on fixture items).

## Dependencies

- **Epic 031** (setup gate).
- **Epic 010 Story 004** (drift detector — consumed), **Epic 006/024**
  (workflow phase boundaries), **Epic 017** (inbox + typed interactions),
  **Epic 026** (read surface), **Epic 027** (dashboard shell + web pipeline
  bootstrap — the web story rides the SU7-validated toolchain), **Epic 013**
  (ledger excerpts), **Epic 028** (observation evidence shape).

## Non-Goals

- No outward ticket sync changes — sync stays one-directional and shallow
  (PRD §6.3); the human owns communication with the change's author.
- No new escalation classes — this Epic types and renders the existing ones.
- No E2E web suite growth — component tests suffice; `web e2e` stays
  story-gated and no story here names it.

## Findings Out

- none. The evidence union is documented at its type definition and asserted
  by Story 002's exhaustiveness test.
