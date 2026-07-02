# Story 003 - Model Policy Chain

Epic: `.agent/plan/epics/024-real-tdd-workflow-model-policy.md`

## Goal

Every session's model resolves deterministically through the five-level chain
(task override → feature default → repo slot → role default → system default),
with `model@version` recorded for attribution and the classifier model
protected from plan override.

## Acceptance Criteria

- With all five levels configured, the task override wins; removing levels one
  at a time falls through in the PRD §8 order to the system default (each step
  asserted).
- The chain resolves to a **symbolic model name**; `model@version` (= registry
  model name + registry entry version, one definition — debate finding) is
  stamped at dispatch into the task frontmatter and onto the task's
  interaction/metric events (PRD §8 — without attribution, "6 corrections"
  can't distinguish bad plan from bad model).
- Resolution is pure data → data: same inputs, same result; no model call, no
  I/O beyond config reads.
- The classifier role resolves **only** from global config by construction —
  the chain ignores task/feature/slot entries for that role (asserted with a
  config that declares them); a plan that sets the classifier model
  additionally fails shape lint with a planner-vocabulary diagnostic
  (PRD §8/§4 — global config only; debate finding — structural plus lint).
- A resolution ending at a model name unknown to the provider registry is a
  typed error naming the chain step that produced the name (Story 004
  composition).

## Constraints

- The chain levels map to existing config homes: plan frontmatter (task/
  feature — Epic 002 compiled rows), repo slot yaml (Epic 016), role/system
  defaults in daemon config; no new config stores.
- The lint addition lands in the Epic 002 shape-lint module as a new rule (a
  locked-plan note: Epic 002 is extended by a new rule, recorded here as the
  authorizing decision).

## Verification Gate

- `npm test` green for `src/models/policy-chain.test.ts`.

### Task T1 - Five-level resolution + attribution

**Input:** `src/models/policy-chain.ts`, `src/models/policy-chain.test.ts`

**Action - RED:** Write tests: (a) full-config ⇒ task override wins; (b) the
four fall-through steps in order; (c) `model@version` lands in frontmatter and
on metric events; (d) purity (same inputs twice ⇒ identical result, no I/O
seam touched).

**Action - GREEN:** Implement the chain over the existing config homes.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Classifier-override lint rule

**Input:** `src/compiler/shape-lint.ts` (new rule only), `src/models/policy-chain.test.ts`

**Action - RED:** Write a test that a plan fixture overriding the classifier
model fails shape lint with a diagnostic naming the offending task and the
rule.

**Action - GREEN:** Add the lint rule to the Epic 002 shape-lint module.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
