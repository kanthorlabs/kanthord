# 026 Connect Control-Plane API (full), Auth & No-Bypass Invariant

## Outcome

The complete daemon-side control plane the dashboard renders: **read surfaces**
(features list + per-feature drill-down with live task status, DAG progress,
in-flight broker ops, STATE/JOURNAL views; broker in-flight/pending/expiring +
read-only verb registry with tiers; repo slots with strategy/leases/sessions;
budgets + breaker state; daemon ops with health, dead-man status, verify
trigger + report), **control verbs** (plan sign-off, halt feature/task,
re-planning diff approval, budget override — rate-limited and recorded as an
interaction), **auth** (Basic auth over TLS, bound to the VPN interface, never
`0.0.0.0`), and the **no-bypass invariant**: every control action goes through
the same seams and the same three rings as any other caller — the API has no
privileged path, and ring-1 deterministic policy cannot be switched off from it
(sole exception: the PRD §4 budget override, rate-limited + recorded).

## Decision Anchors

- phases.md Phase 2B Deliverable 6 — the control-plane surfaces list, "no
  privileged bypass", the budget-override sole exception, Basic auth over TLS
  bound to the VPN interface; planning/registry editing stays out (read-only
  views).
- PRD §3 Layer 2/3 — Connect RPC one server (gRPC / gRPC-Web / HTTP-JSON);
  PRD §9 — Basic auth + TLS, VPN-only, never `0.0.0.0`.
- PRD §4 — the budget override is rate-limited and recorded as an interaction;
  ring 1 is model- and caller-independent.
- PRD §7.5 — re-planning: plan diff → human approves → affected gates re-open.
- Epic 020 SU5/SU6 — TLS material + binding findings; the generated stubs.

## Stories

- `001-read-surfaces.md` — the read API: features + drill-down (tasks, DAG
  progress, ops, STATE/JOURNAL), broker views, repo-slot views, budget views,
  daemon-ops view (health, dead-man status, last verify report); registries and
  plan files render **read-only**.
- `002-control-verbs.md` — sign-off (compile via Epic 002, results returned in
  planner vocabulary), halt (feature/task through Epic 004), re-planning diff
  approval (diff of authored files + recompile on approve, PRD §7.5), budget
  override (rate-limited, recorded as an interaction, ledger-annotated).
- `003-auth-and-no-bypass.md` — Basic auth over TLS on the VPN-interface bind
  (never `0.0.0.0`); unauthenticated/badly-authenticated calls rejected; the
  no-bypass invariant asserted structurally (the RPC layer holds no reference
  to enforcement internals — module boundary + behavioral probes).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites
  (in-process + loopback-TLS socket tests; no VPN in CI — the bind policy is
  config-driven and asserted by refusing forbidden binds).
- Every 2B dashboard surface named in phases.md maps to a listed read method
  (checklist in Story 001, asserted method-by-method against the SU6
  descriptor) — and the checklist is presence-level only; the **semantics** of
  each surface are gated by the golden-fixture field-by-field assertions, not
  the name mapping (debate finding — a name is not a contract).
- Registry/plan-file read-only is proven two ways: no write method in the
  descriptor AND the write-counting seam across all read methods (descriptor
  absence alone is not sufficient — debate finding).
- `daemon.verify` is a **control-adjacent method with one declared operational
  write** (its report record) — it is not on the zero-write read list (debate
  finding: calling it read-only while it stores a report was a contradiction);
  the verify *engine* run stays read-only per Epic 018, and the report write is
  the method's only write (scoped write-count asserted).
- Sign-off on an invalid plan returns the Epic 002 planner-vocabulary
  diagnostics verbatim; on a valid plan it compiles and stamps a generation
  (composed assertion).
- Halt on a running task parks it through the Epic 004 transition and is
  journaled with actor; a second halt is a typed conflict.
- A re-planning approval applies the authored-file edit set through the store
  (plan commit class), recompiles, and re-opens exactly the affected gates
  (PRD §7.5 — asserted on a fixture where one downstream task's gate re-opens
  and an unaffected one does not).
- A budget override beyond the rate limit is rejected; an accepted override is
  **scoped** (debate finding — the exception must not become a ratchet):
  per-task, a one-shot ceiling raise with a mandatory reason string, expiring
  with the task, counted against the rate limit and the per-day cap; recorded
  as an interaction event (typed, actor + amount + reason) and ledger-annotated
  — and it is the **only** call that can raise a ceiling (descriptor +
  behavioral sweep: no RPC-reachable seam mutates ring-1 config outside the
  override flow, including injected-dependency routes — debate finding).
- TLS + Basic auth: a plaintext call is refused; wrong credentials ⇒ 401-class
  error via **timing-safe comparison** against custody-stored credentials,
  never logged (debate finding); bind policy distinguishes modes: **production
  exposure accepts only the configured VPN-interface address; loopback is
  dev/test mode by explicit config flag** (debate finding — loopback must not
  become a production loophole); `0.0.0.0`/`::`/foreign binds fail startup with
  a typed error (PRD §9 — never `0.0.0.0`).
- `plan.approveReplan` is hardened (debate finding — "path + new content" was
  too powerful): allowed paths are covered plan files under the feature dir
  only (traversal/symlink/generated paths rejected typed); the diff declares
  the **base generation** and a mismatch with the live generation is a typed
  conflict (no blind apply); apply + recompile is atomic — a failed compile
  rolls the store back to the pre-apply commit.
- No-bypass: an out-of-scope write attempted via a control-triggered path is
  still blocked by ring 1; the RPC modules import no ring-1-internal mutation
  surface (module-boundary assertion).

## Dependencies

- **Epic 020 SU5/SU6** (TLS/bind findings; stubs — blocks all stories),
  **Epics 002/004/012** (sign-off, transitions, store), **Epic 017** (the 2A
  inbox methods this API supersets; interaction capture for the override),
  **Epic 013** (ledger), **Epic 018** (verify trigger), **Epic 029** (dead-man
  status field — read side lands here, the ping itself is 029).

## Non-Goals

- No web client — Epic 027 renders this API.
- No plan-file or registry **editing** endpoints — planning is external; yaml
  is git-disciplined on disk (phases.md 2B deliverable 6 "out by design").
- No token/mTLS auth — Basic-over-TLS-in-VPN is the recorded MVP knob
  (PRD §9); flip criteria stay in the PRD. The actor on every journaled call is
  the authenticated Basic-auth username (debate finding — actor identity
  defined).
- No rate limiting beyond the budget-override rule — an explicit accepted risk
  (debate finding): expensive read methods and failed-auth storms can load the
  daemon locally; VPN is the perimeter, not abuse protection; revisit in
  Phase-3 hardening.
- Error-model conventions (typed error mapping, unary-only methods, naming) are
  fixed in the SU6 schema findings and followed here — not re-designed per
  story (debate finding — one convention, one place).

## Findings Out

- none. The method list lives in the SU6 descriptor; Epic 027 consumes it.
