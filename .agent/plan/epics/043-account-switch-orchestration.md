# 043 Account/Model Switch Orchestration

> **Status: authored from the decided + debate-hardened design (2026-07-11).**
> Design is settled (Ulrich B6 + debate); one open question remains (OQ-1, below).
> Run the standard authoring debate pass before locking/building.

## Outcome

kanthord can **switch a long-running task from one provider account (or model) to
another** — safely, at a boundary, with the operator's consent rules — so a task
that hits a rate-limit, quota exhaustion, or auth failure on its bound account can
continue on another account instead of stalling. The switch **updates the durable
per-task binding** Epic 019.4 writes (`task → {accountId, modelId}`); the resolver
already reads that binding on every spawn, so a switched task keeps running on the
new account across respawn and daemon restart. Every switch is an **audit event**
(on the Epic 019.5 timeline) plus an **operator notification** of the implications
(context-window, capability, and cost deltas). When no account satisfies the
operator's rules, the task **pauses** rather than switching unsafely.

Switching is **boundary-only** — applied at a respawn/retry boundary, never
mid-stream or during a partial tool call. It is **not** a free-form rule engine:
the operator declares **consent boundaries** and picks one of a small set of
**built-in strategies**. This keeps the decision safe because operators lack the
real-time quota/window/capability signals a free-form auto-switch would need.

## Decision Anchors

- **Ulrich B6 (2026-07-11)** — the *act of switching* was trimmed out of Epic 019.4
  into this epic. 019.4 delivers only account **resolution + a durable binding**;
  043 **updates** that binding. 019.4 must not promise automatic or mid-session
  switching. ([[phase2-epic-019-4-status]].)
- **Built-in strategies, not a rule DSL (debate-hardened)** — the operator picks one
  of: `manual_only` | `same_model_account_failover` | `same_family_with_approval` |
  `never_cross_provider_auto`. Operators cannot see live quota/window/capability, so
  a free-form auto-switch rule DSL is unsafe. **OQ-1 (open):** how far, if at all, to
  move toward user-authored rules beyond these built-ins — unresolved (Ulrich to
  decide; keep it a Non-Goal until then).
- **Boundary-only, tiered safety (debate-hardened)** — switch only at a respawn/retry
  boundary, never mid-stream/partial-tool-call. **Same model across accounts** is the
  safest tier (context + capability preserved); **same family** needs approval;
  **cross-provider auto** is disallowed unless the operator explicitly opted in, and
  otherwise requires **manual approval**.
- **Durable binding is the source of truth (Epic 019.4 Story 003)** — the switch
  writes the new `{accountId, modelId}` to the daemon-owned per-task binding (run/task
  metadata, **not** `STATE.md`); it does **not** mutate a live Agent's model in place.
  pi's in-memory `setModel()` (neutral `AgentMessage[]` + per-turn `convertToLlm`) is
  real but manual-only and in-memory — insufficient for kanthord's **durable**
  respawn continuity. A raw in-place swap would desync the budget ledger, per-account
  audit, and checkpoint metadata (debate finding). So the switch flips the durable
  binding and takes effect at the next spawn.
- **Typed provider-error taxonomy is the trigger source (Epic 019.5)** — the trigger
  set is gated on the shared taxonomy `rate_limited | quota_exhausted | auth_failed |
  transient | fatal` defined in Epic 019.5 (`003-per-model-call-record.md`). kanthord
  has no such taxonomy today (`budget.ts` is model-independent), so **019.5 is a hard
  prerequisite**. Only `rate_limited` / `quota_exhausted` / `auth_failed` are
  switch-worthy; `transient` retries in place; `fatal` does not switch.
- **Auditable + notified (Epic 019.5)** — every switch emits a timeline event
  (`{task_id, attempt, from_account, to_account, from_model, to_model, trigger,
  strategy}`) and an operator notification stating the window/capability/cost
  implications. 019.5 makes the switch auditable; 043 produces the event.
- **No safe candidate → pause** — if no account satisfies the active strategy +
  consent boundaries, the task pauses (a distinct, observable state) and notifies the
  operator; it never switches outside the declared rules.
- **Reuses the 019.4 engine** — account registry, credential custody, and
  `buildProviderSession` are unchanged; 043 adds the switch decision + binding update,
  not a new provider mechanism.

## Stories

> First-cut slices; finalize during the authoring debate pass.

- **Consent boundaries + built-in strategy model** — persist the operator's chosen
  strategy + consent boundaries (per repo/slot/task scope); typed, validated, no DSL.
- **Switch trigger from the typed error taxonomy** — map a bound-account model-call
  failure (`rate_limited`/`quota_exhausted`/`auth_failed`) to a switch candidacy at a
  respawn/retry boundary; `transient` retries in place, `fatal` does not switch.
- **Candidate selection + tier guards** — pick the next account under the active
  strategy (same-model-account safest → same-family-with-approval → cross-provider
  only if opted in); no safe candidate → pause.
- **Binding update + apply at boundary** — write the new `{accountId, modelId}` to the
  durable per-task binding so the next spawn resolves the switched account; never
  mutate a live Agent mid-stream.
- **Audit event + operator notification** — emit the 019.5 timeline switch event and
  the implications notice (window/capability/cost delta); pause is observable.
- **Docs + hermetic gate + maintainer live proof.**

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green; zero-network guard green (taxonomy,
  triggers, and account calls all faked / a pi-ai `Models` double).
- **Trigger correctness:** a model-call failure typed `rate_limited` (and
  `quota_exhausted`, `auth_failed`) on the bound account makes the task a switch
  candidate **at a boundary only**; a `transient` failure retries the same account; a
  `fatal` failure does not switch.
- **Strategy + tier guards:** under `same_model_account_failover`, a switch selects a
  **different account serving the same model** and updates the binding; under
  `manual_only` / `never_cross_provider_auto`, a cross-provider switch is **not**
  applied automatically (manual approval required); no eligible candidate → the task
  enters the observable **paused** state.
- **Binding update is durable:** after a switch, a spawn, a respawn, and a spawn after
  a simulated daemon restart all resolve the **new** account from the binding (asserted
  on durable state, no real call); no live-Agent model mutation occurs.
- **Audit + notification:** each switch produces the 019.5 timeline switch event with
  from/to account+model, trigger, and strategy, plus an operator notification carrying
  the window/capability/cost implication; a pause produces its own event.
- **Gate closes when** the hermetic checks are green AND a maintainer live proof (two
  real accounts of the same kind, inside Podman) shows a task switching from a
  rate-limited/quota-exhausted account to a second account and continuing.

## Dependencies

- **Epic 019.4** — the multi-account engine: account registry, credential custody, the
  durable per-task binding this epic updates, and `buildProviderSession` the resolver
  uses on each spawn.
- **Epic 019.5** — the typed provider-error taxonomy (trigger source) and the audit
  timeline (switch/pause events). **Hard prerequisite.**
- **Epic 019.2/019.3** — the respawn/retry boundary the switch applies at (the durable
  continuity loop).

## Non-Goals

- **No mid-session / mid-stream / partial-tool-call switching.** Boundary-only.
- **No free-form auto-switch rule DSL.** Built-in strategies + consent boundaries only,
  until OQ-1 is decided.
- **No in-place mutation of a live Agent's model.** The switch flips the durable
  binding; it takes effect at the next spawn (avoids budget/audit/checkpoint desync).
- **No new provider mechanism, taxonomy, or timeline.** Those are 019.4 / 019.5; 043
  consumes them.
- **No automatic cross-provider switching** unless the operator explicitly opted in;
  otherwise cross-provider requires manual approval.

## Findings Out

- `.agent/plan/feedback/043-account-switch-orchestration/` — the resolved shape of OQ-1
  (built-in strategies vs any user-authored rules), where consent boundaries + active
  strategy are persisted relative to the 019.4 binding, and the exact respawn/retry
  boundary hook the switch applies at. If none, `none`.
