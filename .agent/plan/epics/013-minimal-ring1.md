# 013 Minimal Ring 1 — Outbound Secret Scan & Real-Cost Breaker Wiring

## Outcome

The two ring-1 guardrails phases.md requires **before the first external mutating
verb ships**: a **fail-closed secret-pattern scan** on every payload leaving the
machine (broker submissions and `runbook.append` content), and the Phase-1 budget
circuit-breaker (Epic 007) wired to **real cost**: conservative reservation before
each call, reconciliation against the provider-reported actual cost after, with the
durable per-task ledger still surviving respawns. This Epic is a hard ordering
constraint: Epic 014's `git.push` / `github.create_pr` may not dispatch to a real
remote until this Epic's gate is green (phases.md Security invariant).

## Decision Anchors

- phases.md Phase 2A Deliverable 2 — minimal ring 1: secret-pattern scan on
  anything leaving the machine + fail-closed cost circuit-breaker with the durable
  per-task ledger surviving respawns; lands **before** the first external mutating
  verb.
- phases.md Phase 2 Security invariant — no external mutating verb ships before
  minimal ring-1 is active **on its path**.
- PRD §4 ring 1 — secret-pattern scanning on anything leaving the machine;
  fail-closed breaker: reserve before each call, halt+escalate on breach; when
  exact cost is unavailable conservative ceilings apply and **actual cost
  reconciles after**.
- Epic 007 Non-Goals — real model cost / reconcile-after was explicitly deferred to
  Phase 2A; the breaker seam, respawn accumulation, and fail-closed semantics are
  already built and must not be rebuilt.

## Outbound surface (2A — fixed here; debate finding)

"Anything leaving the machine" needs an enumerated boundary, not an assumption.
The 2A outbound surface the scan covers, each at its **final serialized form**
(post-templating, the bytes/string the adapter will actually send):

1. **Broker submit payloads** — every verb's parameters and rendered bodies (PR
   title/body, issue text ride here), at the shared submit choke point.
2. **`git.push` content** — the diff of the pushed branch against its remote base
   (the repository content actually leaving the machine — the request JSON alone
   proves nothing about it); scanned by the push adapter's pre-submit step via
   the same scanner seam (Epic 014 Story 002 asserts it).
3. **`runbook.append` bodies** (the PRD-named cross-task injection vector).

Named non-covered surfaces, so the limitation is explicit: logs and telemetry
(local, never synced off-machine in 2A), binary blobs inside a push (scanned
best-effort as text; a binary secret is out of corpus reach — audit backstop),
and provider model calls (prompt content goes to the model provider by design;
that channel is governed by the budget ledger + ring 2 later, not the secret
scan).

## Stories

- `001-outbound-secret-scan.md` — a deterministic secret-pattern scanner invoked on
  every outbound broker payload and `runbook.append` body; a match blocks the send
  and escalates; a scanner failure blocks (fail-closed).
- `002-real-cost-reconciliation.md` — the Epic 007 ledger gains reconcile-after:
  conservative reservation is replaced by provider-reported actual cost when it
  arrives; the ceiling checks run against reserved+actual; respawn accumulation
  unchanged.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- A broker submit whose payload contains a seeded secret pattern (test-fixture key
  material) is **blocked before the adapter's `submit` runs** (the fake adapter
  records zero calls) and an escalation event is recorded naming the verb and the
  matched pattern class — never the secret value itself.
- A `runbook.append` whose body matches is blocked the same way; a clean payload
  passes.
- A scanner error (injected) blocks the send — fail-closed asserted, not fail-open.
- A fake provider reporting actual cost lower than the conservative reservation
  frees the difference in the ledger **only when the report is marked final**
  (per the SU3 cost-signal findings); a non-final report keeps the conservative
  charge (debate finding — no spend race on provisional signals).
- A reconcile that puts the cumulative total **over the ceiling halts and
  escalates immediately** — not at the next reservation attempt (debate finding —
  fail-closed means the breach acts when known); a call with no reported cost
  keeps the conservative charge (PRD §4).
- Reconciliation is idempotent and defensive: a duplicate report for the same
  reservation adjusts once; a report referencing an unknown reservation is a
  typed error + escalation; replay after respawn does not double-adjust (debate
  finding).
- Splitting the sequence across a respawn still breaches at the same cumulative
  point (Epic 007 property re-asserted through the reconcile path).
- If the pattern registry fails to load at boot, the daemon still starts but
  every outbound submit is blocked with a `scan-unavailable` escalation —
  fail-closed at the choke point, never fail-open and never a boot crash
  (debate finding — load-failure semantics defined).
- The enforcement is on the **shared broker submit path**, asserted so Epic 014's
  verbs inherit it by construction (one choke point, not per-verb calls).

## Dependencies

- **Epic 007** (breaker + ledger + escalation events — extended, not rebuilt).
- **Epic 005** (broker submit path — the scan's choke point).
- **Epic 003/012** (durable ledger storage in the task's markdown).
- **Epic 011 SU3** (the provider cost-signal shape and its finality semantics —
  Story 002 is blocked until that findings file exists; debate finding: this was
  implicit and is now a named dependency).

## Non-Goals

- No path allowlists / write-scope changes — Epic 015 (full ring 1 for agents).
- No ring-2 classifier (Epic 025) and no ring-3 approval surface (Epic 017).
- No per-feature soft warning / per-day global kill-switch enforcement — the
  per-task hard max stays the only enforced tier; finer tiers stay logged
  (PRD §9).
- The pattern set ships as a reviewed, versioned config of common credential
  shapes (cloud keys, tokens, private-key blocks); **completeness of the corpus is
  not a claim** — ring 1 is deterministic best-effort, the audit trail is the
  backstop (PRD §4).

## Findings Out

- none. The scan choke point and reconcile-after contract are documented in the
  stories and asserted by tests; Epic 014 depends on this Epic's gate.
