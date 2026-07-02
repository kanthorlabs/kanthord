# Story 001 - Escalation & Approval Inbox

Epic: `.agent/plan/epics/017-approval-surface-and-metrics.md`

## Goal

Escalation events and approval-required operations become durable inbox items
with evidence attached, listable over the Connect read method, surviving daemon
restart.

## Acceptance Criteria

- A ring-1 escalation event (out-of-scope write, budget breach, secret-scan
  block) creates one open inbox item of kind `escalation` carrying the source
  event's evidence fields (task id, rule/reason, payload summary) — never the
  blocked secret value (Epic 013 rule).
- A broker escalation-needed state (timeout, reconcile-escalate) creates an
  `escalation` item referencing the `op_id` (Epic 005 boundary — broker emits,
  this Story routes).
- Submitting an `approval_required` verb creates an `approval` item while the op
  stays `pending` (Epic 005 state model); the item names the verb, tier, and
  desired effect.
- The SU6 list method returns open items with kind, created-at, and evidence
  reference; resolved items are excluded by default.
- Item ids are deterministic — derived from the source event/op id — so rebuild
  is idempotent (debate finding).
- After a daemon kill/restart (Epic 009 entrypoint), open items are rebuilt from
  durable state — same ids, same evidence references; a **resolved** item stays
  resolved after restart (resolution is durable, never recomputed away; debate
  finding).

## Constraints

- Item durability follows the division of truth (PRD §6.1): items derive from
  durable events/ledger (jsonl + markdown) and are indexed in SQLite —
  rebuildable, not SQLite-only.
- One inbox for both kinds — kind is a field, not two subsystems (simplicity;
  PRD §2 escalation events double as metric events).

## Verification Gate

- `npm test` green for `src/inbox/inbox.test.ts`.

### Task T1 - Items from escalation events and approval-required ops

**Input:** `src/inbox/inbox.ts`, `src/inbox/inbox.test.ts`

**Action - RED:** Write tests: (a) a ring-1 escalation event yields an open
`escalation` item with evidence, no secret value; (b) a broker escalation-needed
state yields an item referencing `op_id`; (c) an `approval_required` submit
yields an `approval` item while the op is `pending`.

**Action - GREEN:** Implement inbox item creation subscribed to the existing
event/state seams, persisted per the division of truth.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - List method + restart survival

**Input:** `src/inbox/inbox.ts`, `src/rpc/inbox-list.ts`, `src/inbox/inbox.test.ts`

**Action - RED:** Write tests: (a) the SU6 list method returns open items with
kind/created-at/evidence ref and omits resolved ones; (b) kill/restart rebuilds
the same open items (deterministic ids) and a resolved item stays resolved;
(c) the list call round-trips over a real loopback HTTP socket with asserted
status code and JSON shape.

**Action - GREEN:** Implement the list RPC over the SQLite index and the rebuild
path in the entrypoint wiring.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
