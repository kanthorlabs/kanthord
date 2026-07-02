# Story 001 - Outbound Secret Scan

Epic: `.agent/plan/epics/013-minimal-ring1.md`

## Goal

Every payload leaving the machine passes a deterministic secret-pattern scan at
one choke point; a match or a scanner failure blocks the send and escalates.

## Acceptance Criteria

- A broker `submit` whose payload matches a secret pattern is blocked **before**
  the verb adapter's `submit` executes (adapter records zero invocations), and an
  escalation event is recorded with the verb, task id, and the matched **pattern
  class** — the secret value never appears in the event or logs (PRD §4 —
  secret-pattern scanning on anything leaving the machine).
- A `runbook.append` whose body matches is blocked and escalated the same way
  (PRD §7.1.1 §6 security note — ring-1 secret scan on runbook writes).
- A clean payload passes and the adapter runs normally.
- An injected scanner error blocks the send and escalates a `scan-failed` event —
  fail-closed (PRD §4 — deterministic policy cannot be talked out of).
- A pattern-registry load failure at boot leaves the daemon running but every
  outbound submit blocked with a `scan-unavailable` escalation — fail-closed at
  the choke point, not a boot crash and not fail-open (debate finding — Epic 013
  load-failure semantics).
- The scan runs on the **shared submit path**, so any verb registered later
  inherits it without a per-verb call (asserted structurally: a second fake verb
  is blocked with no verb-specific wiring).
- The scan input is the **final serialized payload** — the string/bytes the
  adapter will send, after templating/rendering — not the pre-render structure
  (debate finding — Epic 013 outbound-surface boundary; a secret introduced by a
  template is caught).

## Constraints

- The pattern set is a versioned yaml registry loaded via the Epic 001 registry
  loader (PRD format rules — registries are yaml); patterns are regular
  expressions over common credential shapes; the registry carries a version
  string surfaced in the escalation event.
- Enforcement lives in ring-1 policy code called from the broker submit path
  (Epic 005) — not inside any verb adapter (Epic 005 escalation-ownership
  boundary: broker emits, ring 1 enforces).
- Deterministic and model-independent: no LLM involvement (PRD §4 ring 1 vs
  ring 2).

## Verification Gate

- `npm test` green for `src/ring1/secret-scan.test.ts`.

### Task T1 - Scanner + pattern registry

**Input:** `src/ring1/secret-scan.ts`, `src/ring1/secret-scan.test.ts`

**Action - RED:** Write tests: (a) fixture payloads with a seeded fake AWS-style
key, a bearer token, and a private-key block each return a match naming the
pattern class, never echoing the value; (b) clean text returns no match;
(c) a malformed pattern registry is a typed error naming the file.

**Action - GREEN:** Implement the scanner over a yaml pattern registry with a
version string.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Choke-point enforcement, fail-closed

**Input:** `src/ring1/secret-scan.ts`, `src/broker/submit.ts`, `src/ring1/secret-scan.test.ts`

**Action - RED:** Write tests: (a) a matching broker submit is blocked before the
fake adapter runs and an escalation event records verb/task/pattern-class;
(b) a matching `runbook.append` is blocked; (c) an injected scanner throw blocks
the send with a `scan-failed` escalation; (d) a second fake verb is blocked with
no verb-specific wiring; (e) with a failed registry load, submits are blocked
with `scan-unavailable` while the daemon keeps serving; (f) a secret introduced
only by payload templating (absent from the raw params) is caught — the scan
sees the final serialized form.

**Action - GREEN:** Call the scanner from the shared broker submit path (and the
runbook append path) ahead of adapter dispatch; block + escalate on match or
scanner error.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
