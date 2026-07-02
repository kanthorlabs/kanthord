# Story 003 - Observer Verb Family

Epic: `.agent/plan/epics/022-remaining-broker-verbs.md`

## Goal

The read-only observer verbs (`k8s.rollout_status`, `sentry.new_issues`,
`signoz.query`, `k8s.logs`) form a distinct verb family: no idempotency, no
approval, re-read as reconcile, results normalized into the generic observation
record the deploy-chain executor consumes.

## Acceptance Criteria

- Each observer verb has a registry entry with a family marker `read_only:
  true`, per-verb timeout/backoff/rate-limit, `idempotency: n/a`,
  `desired_effect: n/a`, `reconcile: re_read`, `regression: n/a` — the family
  stays **inside** the broker lifecycle with its dimensions explicitly declared
  (complete contract, Epic 014 rule; debate finding — never "no reconcile").
- A read-only verb cannot be registered at a mutating tier and cannot declare a
  desired-effect hash — either is a load error naming the verb (the family's
  properties are structural).
- Reconcile for an interrupted observer op is a re-read; retries are **bounded
  by the registry entry** and every read produces an audit entry — no free
  resubmit storms (debate finding).
- Each result normalizes into the generic observation record `{ verb, target,
  observed_at, outcome, payload }` — the Epic 008 executor consumes this shape
  without knowing any product name (Epic 008's generic-outcome rule; PRD §7.4).
- Stored payloads pass **inbound sanitation**: size-capped (oversize truncated
  with a marker) and secret-pattern scanned (Epic 013 corpus reused) — a seeded
  token in a fake `k8s.logs` payload is redacted in the stored record (debate
  finding — observers ingest hostile external data, credential redaction alone
  is too narrow).
- A failing read (service error per the double) resolves `failed` with the
  taxonomy reason — auth failure, permission denied, not-found, rate limit, and
  transient server error each mapped (debate finding — branches enumerated);
  the executor sees a failed observation, not a thrown error.

## Constraints

- Doubles implement only the SU3-recorded response shapes; no k8s/Sentry/SigNoz
  client SDKs in 2B — the read endpoints go through the injected HTTP seam
  (handler *logic* is Epic 028 / integration work).
- No credentials in any observation record (redaction sweep).

## Verification Gate

- `npm test` green for `src/broker/verbs/observers.test.ts`.

### Task T1 - Family registration rules + one reference adapter

**Input:** `src/broker/verbs/observers.ts`,
`broker/verbs/k8s.rollout_status.yaml`, `src/broker/verbs/observers.test.ts`

**Action - RED:** Write tests: (a) the family entry loads with `read_only:
true` and `n/a` declarations; (b) mutating-tier or desired-effect declarations
⇒ load error; (c) `k8s.rollout_status` against its double returns a normalized
observation record; (d) interrupted op re-reads on reconcile.

**Action - GREEN:** Implement the family base + the rollout-status adapter +
registry entry.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Remaining observers + failure normalization

**Input:** `src/broker/verbs/observers.ts`, `broker/verbs/sentry.new_issues.yaml`,
`broker/verbs/signoz.query.yaml`, `broker/verbs/k8s.logs.yaml`,
`src/broker/verbs/observers.test.ts`

**Action - RED:** Write tests: (a) each remaining verb returns the normalized
record from its double; (b) service errors resolve `failed` across the
enumerated taxonomy branches, consumable as failed observations; (c) inbound
sanitation: an oversize payload truncates with a marker and a seeded token is
redacted in the stored record; (d) bounded retries per registry.

**Action - GREEN:** Implement the three adapters over the family base.

**Action - REFACTOR:** extract shared normalization if duplication emerged.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
