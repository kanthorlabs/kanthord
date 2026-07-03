# Story 002 - Escalation Evidence Contract

Epic: `.agent/plan/epics/034-ticket-drift-and-escalation-evidence.md`

## Goal

Every escalation class carries its declared, size-bounded evidence payload,
exposed on inbox reads — an evidence-less escalation becomes unrepresentable.

## Acceptance Criteria

- The **canonical escalation-class registry is one exported enum/module**
  and both the union and every emitter key off it (debate finding — prose
  enumeration in two places invites naming drift; the exhaustiveness test
  protects the code registry, and this Story's list follows it): the classes
  and payloads are: scope-violation → blocked path + attempted-write
  summary; budget-breach → ledger excerpt (reservation history tail);
  verb-failure/reconcile-anomaly → op ledger chain + last external
  observation; drift → the Story 001 content diff; deploy-failure → per-stage
  observation evidence (Epic 028 shape); unclassified-artifact-change →
  artifact id + before/after hashes + byte-diff summary; replan → the proposed
  change summary (Epic 033 signal payload); dead-man-ping-failure → the send
  attempt record (Epic 029).
- **Strict on write, tolerant on read** (debate finding — one compatibility
  story, not two): constructing/writing a new escalation without its class's
  evidence fails at the type level and a runtime guard rejects a malformed
  payload on any dynamic write path; a historical item read without evidence
  normalizes to an explicit `missing-evidence` payload (rendered as such),
  never a crash or a silent pass.
- Evidence is size-bounded per class; the bounds are named constants in one
  module with the unit fixed as **UTF-8 bytes**, and tests assert the
  constants' enforcement (debate finding — unnamed "documented bounds" let
  tests invent them). Truncation is **class-aware**: structural fields —
  ids, hashes, the final observation, the first and last ledger rows —
  survive; only body/diff content is cut, with the explicit truncation
  marker set (debate finding — naive truncation can destroy exactly the
  fields the human needs to act).
- Inbox reads (Epic 017 list + Epic 026 read surface) return the evidence
  payload with the item; existing consumers keep working (shape is additive).
- An exhaustiveness test constructs every class and fails compilation/run if
  a class is added without an evidence declaration.

## Constraints

- One evidence union at the escalation type definition — classes must not
  carry ad-hoc `details` blobs alongside it (the union is the contract).
- Additive change to the Epic 017/026 item shape; no version break to the
  control-plane methods (Epic 026 contract discipline).
- The ring-1 secret-pattern scan runs **at evidence capture, before store**
  (debate finding — evidence can embed secrets from diffs/observations the
  moment it is built, not only when it leaves the machine): matches are
  redacted in the stored payload with a redaction marker (PRD §4).

## Verification Gate

- `npm test` green for `src/inbox/evidence.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - The union + guards + bounds

**Input:** `src/inbox/evidence.ts`, `src/inbox/inbox.ts`,
`src/inbox/evidence.test.ts`, and for the REFACTOR the existing emitter
modules: `src/ring1/*.ts`, `src/broker/reconcile.ts`, `src/deploy/chain.ts`,
`src/workflow/drift-handling.ts`, `src/replan/signal.ts`,
`src/ops/deadman-ping.ts` (debate finding — Task Input is authoritative; the
named cleanup needs its files named)

**Action - RED:** Write tests: (a) each class constructs only with its
declared payload (type-level via `@ts-expect-error` fixtures + runtime guard
rejection on write); (b) the exhaustiveness test over the canonical class
registry; (c) class-aware truncation at the named byte bounds — structural
fields survive, marker set; (d) a well-formed item round-trips through the
inbox store with evidence intact; (e) a legacy evidence-less item reads as
the `missing-evidence` payload; (f) a secret planted in a diff is redacted at
capture.

**Action - GREEN:** Implement the evidence union, runtime guard, and bounded
truncation in the inbox item path.

**Action - REFACTOR:** Fold each emitter's existing ad-hoc detail fields into
its class's typed evidence (named cleanup — emitters in ring1, broker,
deploy, drift, replan modules).

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Read-surface exposure

**Input:** `src/rpc/read-surfaces.ts`, `src/inbox/evidence.test.ts`

**Action - RED:** Write tests: inbox list/read methods return items with the
evidence payload and truncation marker field; a pre-existing consumer fixture
(item without optional new fields) still parses (additive shape).

**Action - GREEN:** Expose evidence through the read methods.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
