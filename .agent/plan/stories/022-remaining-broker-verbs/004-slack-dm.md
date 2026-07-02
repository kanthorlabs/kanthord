# Story 004 - slack.dm

Epic: `.agent/plan/epics/022-remaining-broker-verbs.md`

## Goal

`slack.dm` delivers a direct message through the broker exactly once per
idempotency key — the delivery channel the Epic 029 dead-man ping stands on.

## Acceptance Criteria

- Registry entry: `tier: auto_with_audit`, idempotency required, timeout,
  retry/backoff and rate-limit behavior per the SU3 findings.
- Submit posts the message on the double and records the Slack message
  timestamp id as correlation; a retried submit with the same key resolves
  `done` without a second post.
- Reconcile of an interrupted send uses the **exact lookup surface the SU3
  findings recorded** (conversation-history read by timestamp/marker); if the
  findings show no reliable lookup, the declared fallback is
  resubmit-with-the-same-embedded-marker plus escalate-on-ambiguity, decision-
  recorded (debate finding — timestamp correlation must be a proven reconcile
  key, not write-only audit data). Message found ⇒ done; reliably absent ⇒
  idempotent resubmit.
- A rate-limited response backs off per registry on the fake clock; exhausted
  retries resolve `failed` + escalation-needed (a dead-man ping that cannot
  send must surface loudly — Epic 029 depends on this).
- Message content passes the Epic 013 outbound scan.

## Constraints

- The Slack double implements the SU3-recorded DM surface; injected HTTP seam;
  credential redaction per Epic 014.

## Verification Gate

- `npm test` green for `src/broker/verbs/slack-dm.test.ts`.

### Task T1 - Send, idempotency, reconcile, failure surface

**Input:** `src/broker/verbs/slack-dm.ts`, `broker/verbs/slack.dm.yaml`,
`src/broker/verbs/slack-dm.test.ts`

**Action - RED:** Write tests: (a) send + timestamp correlation; (b) same-key
retry ⇒ `done`, one post; (c) reconcile branches; (d) rate-limit backoff then
exhaustion ⇒ `failed` + escalation-needed; (e) a seeded secret in the message is
blocked.

**Action - GREEN:** Implement the adapter + registry entry.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
