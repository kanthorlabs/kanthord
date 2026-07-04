# 041 Usage-Driven Additions (BLOCKED DRAFT — pending HD1; not `/work`-dispatchable)

> **Status: BLOCKED DRAFT.** This Epic deliberately has **no story files** and
> must not be dispatched or "fixed" by adding them. phases.md Phase 3
> Deliverable 6 is explicitly conditional — "Additional features, **only if
> usage demands**" — so authoring implementation stories before the usage data
> exists would violate the phase's own requirement. The Epic 027 precedent
> applies: the blocked status is the plan, not a gap. **Plan convention**
> (debate finding — the exception should be a stated rule, not lore): a
> BLOCKED-DRAFT epic is marked in its title and header, has no story files,
> and the absence of story files is the mechanical guard — the TDD loop reads
> `.agent/plan/stories/`, so there is nothing for `/work` to dispatch.

## Outcome (when unblocked)

Whichever Deliverable-6 candidate the data argues for: (a) the **first
semantic contract handler** for the company's dominant boundary format
(replacing byte-diff + escalate on that format with a semantic digest and
breaking/additive classification per PRD §7.2), and/or (b) the **first
policy-knob flip** (auto-accept additive diffs) behind config with the flip
decision recorded. Parking-lot items stay parked **unless the data argues
otherwise** (debate finding — phases.md's own wording; hard-limiting to two
would be stricter than the source): a parked candidate may enter HD1 only
through the same evidence checklist, never by preference. A recorded
decision to build **nothing** is an equally valid outcome.

## HD1 — the human decision this Epic waits on

- **Decider:** Ulrich. **Earliest:** after ≥2 completed real features,
  **including the multi-repo feature when the decision concerns a cross-repo
  boundary format** (debate finding — the handler decision without multi-repo
  evidence would be built on the wrong sample), so the decision cites
  operation data, not fixtures.
- **Inputs — the usage-demands evidence checklist (all must exist; debate
  finding — "Ulrich decides" alone is not a rubric):**
  - `.agent/plan/feedback/041-usage-driven-additions/artifact-format-inventory.md`
    (Epic 031 SU2 — the dominant boundary format, and whether a stable
    semantic-comparator approach exists for it per PRD §7.2 — integration
    readiness, debate finding);
  - `.agent/plan/feedback/040-metrics-portfolio-dashboard/knob-candidates.md`
    (Epic 040 — observed rubber-stamp candidates **with their catch
    evidence**);
  - the observed `unclassified-artifact-change` escalation share from real
    runs (dashboard/portfolio views), with its cost/time impact;
  - the `correction`/`takeover` cluster analysis from the portfolio (debate
    finding — phases.md Requirements say those clusters get fixed first; a
    feature decision must show it beats fixing them);
  - for candidate (b): a written safety analysis of auto-accepting additive
    diffs on the dominant boundary (false-negative risk — what an "additive"
    change can still break; debate finding).
- **Decision:** build (a), (b), both, **defer — insufficient data** (a
  first-class outcome naming the missing evidence and the re-evaluation
  trigger; debate finding — forcing build/neither incentivizes premature
  closure), or neither — with the checklist evidence cited. Recorded in
  `.agent/plan/feedback/041-usage-driven-additions/hd1-decision.md`.
- **After HD1:** if anything is built, this Epic is re-authored with stories
  through the normal authoring + debate process (a plan change, not an edit
  during implementation); if neither, HD1's record closes this Epic as
  decided-out; if deferred, the record names what re-opens it — and Epic 042
  treats a deferral as resolved **only** when LP3's policy-decision criterion
  is satisfied by another data-cited decision (debate finding — the gate
  must not become a paperwork bypass).

## Decision Anchors

- phases.md Phase 3 Deliverable 6 — first semantic handler for the dominant
  format; first policy-knob flips (auto-accept additive diffs) behind config;
  "candidates from the parking lot stay parked unless the data argues
  otherwise"; Requirements — interaction-type data decides priority.
- PRD §7.2 — semantic comparator design (registered handler, semantic digest,
  generator-version approval) the handler candidate would follow; §9 — the
  escalation knob's documented future flip; §12 — handlers are integration
  work at first-real-project time.

## Stories

- none — see Status. Authored only after HD1.

## Verification Gate

- HD1 recorded in `hd1-decision.md` with **every checklist input** cited
  (missing input ⇒ the decision is invalid, whatever it says — debate
  finding: the gate verifies the rubric, not just that a record exists). If
  "build": the re-authored stories land through authoring+debate before any
  dispatch. If "neither": the decision record closes the Epic. If "defer":
  the record names the missing evidence and the re-evaluation trigger.

## Dependencies

- **Epic 031 SU2**, **Epic 040** (inputs), real-project operation under
  **Epic 042 LP1** (the data source). This Epic does **not** block Epic 042 —
  042 requires HD1 to be *resolved* (built or decided-out), not built.

## Non-Goals

- More than the data argues for: additional handlers or knob flips beyond the
  HD1-decided set; the Shape plugin framework (Appendix A — extract only at
  shape #2). A parking-lot item (meeting intake etc.) enters only through the
  HD1 evidence checklist, never by preference (phases.md Deliverable 6
  wording).

## Findings Out

- `.agent/plan/feedback/041-usage-driven-additions/hd1-decision.md`.
