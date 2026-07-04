# Story 001 - Real Observer Wiring

Epic: `.agent/plan/epics/028-deploy-observers-and-artifacts.md`

## Goal

Deploy stages run real observer verbs as configured handlers: plan-declared
predicates judge normalized observation records across the soak, pass notifies,
fail halts with evidence — and the executor stays generic.

## Acceptance Criteria

- A deploy-stage config names observer verbs (Epic 022 family) as ordered
  handlers with per-handler predicates in the Epic 028 grammar (dot-path,
  fixed operator set, AND across handlers and samples, missing-field ⇒ false,
  malformed ⇒ config error — each case asserted) and a soak duration (PRD §7.4
  — explicit success criteria as an AND).
- Handlers resolve through the Epic 022 registry + broker submit path (the
  double sits at the HTTP seam — asserted by the ops appearing in the broker
  ledger; debate finding — no story-local handler fakes).
- The soak follows the fixed semantics: first sample at start, one per
  interval, all samples healthy to pass, a sample missing past tolerance is
  unhealthy, interval > window is a config error (each asserted on the fake
  clock via the real broker poll path — not a private loop; Epic 008 gate rule
  kept).
- Healthy across the full soak ⇒ stage resolves `on_pass` and emits a
  `notify_human` event (inbox/notification record naming the stage and the
  downstream go-ahead — "backend deploy healthy, mobile PR safe to merge").
- An observer turning unhealthy mid-soak ⇒ `on_fail: halt_and_escalate` with
  the failing record, stage id, and soak-window history attached, delivered as
  an Epic 017 escalation item.
- A failed observer **verb** (service error ⇒ failed observation) is treated by
  the predicate as unhealthy — infrastructure failure cannot pass a stage.
- The executor and predicate evaluator contain no observer-specific vocabulary
  (module scan: product names like `k8s.rollout_status` appear only in config
  fixtures resolved via the registry — never imported; debate finding), and the
  evaluator consumes only the generic observation record type.

## Constraints

- Observer verbs are the Epic 022 doubles in tests; predicates are data
  (config), evaluated generically (Epic 008 rule).
- Stage configs live in the plan (deploy chain from epic frontmatter — Epic 002
  compiled rows).

## Verification Gate

- `npm test` green for `src/deploy/observer-wiring.test.ts`.

### Task T1 - Handler config + healthy soak

**Input:** `src/deploy/observer-wiring.ts`, `src/deploy/observer-wiring.test.ts`

**Action - RED:** Write tests: (a) a stage config wires two observer verbs with
predicates + soak; (b) healthy doubles across the soak ⇒ `on_pass` +
notify_human, re-polls visible as broker ops; (c) no merge/deploy verb in the
side-effect log.

**Action - GREEN:** Implement the config → handler binding over the Epic 008
executor and Epic 022 verbs.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Mid-soak failure + generic evaluator

**Input:** `src/deploy/observer-wiring.ts`, `src/deploy/observer-wiring.test.ts`

**Action - RED:** Write tests: (a) a double flipping unhealthy mid-soak ⇒ halt
+ escalation item with record/stage/soak history; (b) a service-error
observation is unhealthy; (c) the executor/evaluator modules contain no
observer product names.

**Action - GREEN:** Implement failure propagation into the Epic 017 inbox and
keep the evaluator generic.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
