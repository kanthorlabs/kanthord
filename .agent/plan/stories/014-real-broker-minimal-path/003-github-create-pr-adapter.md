# Story 003 - github.create_pr Adapter

Epic: `.agent/plan/epics/014-real-broker-minimal-path.md`

## Goal

`github.create_pr` runs the full PRD §5 async contract against the GitHub REST
API (via an in-process HTTP double in tests): create with
idempotency-by-head-branch, poll PR state, back off on rate limits, escalate on
timeout, and reconcile an interrupted create by looking the PR up by head branch.

## Acceptance Criteria

- Registry entry: `tier: auto_with_audit`, `idempotency: required`, per-verb
  timeout + retry/backoff (PRD §5 MVP verb families).
- Submit creates the PR on the double and records `{ head_branch, pr_number }`
  as external correlation; `poll_status` advances the op to `done` when the
  double reports the PR exists/open.
- **Idempotency-by-head-branch:** a create hitting "PR already exists for this
  head" (the SU2-recorded error shape) resolves to the existing PR — `done` with
  its number as correlation — not `failed`.
- A rate-limited response (SU2-recorded shape) causes backoff per the registry
  entry on the fake clock, then retry; retries never exceed the registry `retry`
  policy.
- A double that never reaches terminal hits the per-verb timeout and the op emits
  the escalation-needed state (Epic 005 boundary — the broker emits, it does not
  route).
- Reconcile of an interrupted create: double already holds an **open** PR for the
  head branch ⇒ `done` (no second PR created — asserted via the double's request
  log); no PR ⇒ idempotent `resubmit`; PR exists but was closed externally ⇒
  `failed(closed-externally)` **plus an escalation-needed state** — the same
  classification the poll path gives an open→closed transition (debate finding —
  one closed-externally semantic for both poll and reconcile, and a human closing
  a PR is always surfaced, never a silent `failed`).
- Every request the adapter sends carries the token from daemon credential
  custody (SU4) — asserted against the double's captured headers; the token
  appears in **no** ledger entry, event, journal line, typed error message, log
  record, or escalation payload (a redaction sweep over every captured output of
  a failing run — debate finding: ledger+events alone was too narrow).

## Constraints

- HTTP double is a hand-written in-process fake implementing only the SU2-
  recorded surfaces (create, get-by-number, list-by-head, rate-limit response) —
  no recording library, no real network (PROFILE.md; Epic 014 Non-Goals).
- The adapter talks to an injected HTTP seam so the double replaces the transport
  (PROFILE.md DI style); endpoint paths and error shapes come from
  `.agent/plan/feedback/014-real-broker-minimal-path/github-api.md`.
- Observed state **can regress** (a PR can be closed externally) — the registry
  entry declares it, and poll treats an open→closed transition as terminal
  `failed(closed-externally)` + escalation-needed with the observed state
  attached (PRD §5 regression declaration; same semantic as the reconcile
  branch).

## Verification Gate

- `npm test` green for `src/broker/verbs/github-create-pr.test.ts`.

### Task T1 - Submit/poll/idempotency against the double

**Input:** `src/broker/verbs/github-create-pr.ts`,
`broker/verbs/github.create_pr.yaml`, `src/broker/verbs/github-create-pr.test.ts`

**Action - RED:** Write tests: (a) submit creates the PR and records correlation;
poll advances to `done`; (b) "already exists" resolves to the existing PR;
(c) the auth header is present on captured requests and absent from ledger/events;
(d) open→closed during poll resolves `failed` with observed state.

**Action - GREEN:** Implement the adapter (submit/poll_status/terminal states)
over an injected HTTP seam + the registry entry; build the minimal double as a
test helper.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Backoff, timeout escalation, reconcile branches

**Input:** `src/broker/verbs/github-create-pr.ts`,
`src/broker/verbs/github-create-pr.test.ts`

**Action - RED:** Write tests: (a) rate-limit response ⇒ backoff per registry on
the fake clock, bounded by `retry`; (b) never-terminal ⇒ per-verb timeout ⇒
escalation-needed state; (c) reconcile: existing open PR ⇒ done with zero create
requests on the double's log; none ⇒ resubmit; closed-externally ⇒
`failed(closed-externally)` + escalation-needed (matching the poll-path
classification); (d) a redaction sweep over all captured outputs of a failing
run finds no token.

**Action - GREEN:** Implement backoff/timeout handling and the
reconcile-by-head-branch path.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
