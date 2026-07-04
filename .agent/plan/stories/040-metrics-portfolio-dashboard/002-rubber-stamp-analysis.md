# Story 002 - Rubber-Stamp Analysis

Epic: `.agent/plan/epics/040-metrics-portfolio-dashboard.md`

## Goal

The approvals that were never real decisions become visible as named
policy-knob candidates with their evidence — analysis that guides loosening,
never a flip.

## Acceptance Criteria

- An approval interaction classifies as a **rubber stamp** when the response
  was approve-without-modification and its latency is under the configured
  threshold (documented default; config-validated bounds).
- Rubber stamps cluster by escalation class and, where the class maps to a
  policy knob (the documented class→knob table: diff escalations →
  `escalation` knob; merge approvals → merge/deploy knob; artifact-change
  escalations → contract handler candidacy), the cluster carries the knob
  name.
- Every cluster also reports its **catch evidence** — modified approvals,
  rejections, and post-approval rework incidents correlated to the class
  where derivable (debate finding — PRD §2 frames the signal as rubber
  stamps *vs real catches*; a 96% stamp rate means nothing if the 4% prevent
  severe failures).
- A cluster whose rubber-stamp share exceeds the configured share threshold
  **and** whose sample count meets the configured minimum emits a policy-knob
  candidate: knob name, evidence counts (total, stamped, share, catches),
  and the cluster's class, **explicitly labeled a proxy/approximate signal**
  (debate finding — fast-unmodified is a proxy for "no decision value", not
  proof; PRD §2 classification is never authoritative) — both thresholds
  asserted at their boundaries (at, above, below), and the thresholds in
  force are echoed in the output with their documented default rationale
  (debate finding — analytical constants must be visible, not buried
  config).
- The candidate list is readable over an Epic 026 read method and is pure
  analysis: nothing in this story writes any policy config (asserted — config
  digest unchanged after a full analysis run).
- Interactions excluded from automation metrics (Story 001 rules) never enter
  clustering.
- The mixed fixture (fast-unmodified, slow, modified approvals across
  classes) yields exactly the expected clusters, shares, and candidate list.

## Constraints

- Consumes the Story 001 aggregation's interaction data — no separate event
  read path; class definitions from Epic 034's evidence classes (one class
  vocabulary).
- Candidates guide the Epic 041 HD1 and Epic 042 LP3 decisions — output must
  cite evidence counts (phases.md: at least one policy decision **from the
  data**).

## Verification Gate

- `npm test` green for `src/metrics/rubber-stamp.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Classification + clustering + candidates

**Input:** `src/metrics/rubber-stamp.ts`, `src/rpc/read-surfaces.ts`,
`src/metrics/rubber-stamp.test.ts`

**Action - RED:** Write tests: (a) stamp classification at the latency
boundary (at/under/over); (b) clustering by class with the class→knob table;
(c) share + minimum-sample thresholds at their boundaries; (d) the mixed
fixture's exact candidate list with evidence counts, catch evidence, proxy
label, and echoed thresholds; (e) exclusions never cluster; (f) config
digest unchanged after analysis; (g) the read method returns the list.

**Action - GREEN:** Implement classification, clustering, thresholds, and
the read method.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
