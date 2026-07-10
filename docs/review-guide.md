# Review guide

You were asked to review kanthord. This page saves you time: it says what is
already decided (challenge it only with new evidence), what is explicitly
non-binding, and where your feedback has the most value.

Suggested path: [`README`](../README.md) → [`glossary`](glossary.md) →
[`architecture.md`](../.agent/plan/architecture.md) →
[`phases.md`](../.agent/plan/phases.md) → [`prd.md`](../.agent/plan/prd.md),
then dip into [`epics/`](../.agent/plan/epics/) where you want depth.

## What is binding (decided, with recorded reasoning)

- **MVP scope** — PRD §11. Cross-repo orchestration is the baseline, not a
  stretch goal; support/Q&A lane, auto-merge, preview environments are out.
- **Plan file format and the compile/lint pipeline** — PRD §7.1.1 §2–§7:
  frontmatter machine layer + prose body, filename grammar, sign-off compile,
  generations.
- **The architecture invariants** — architecture.md §5: markdown = truth,
  always-async broker, three rings with no bypass, one respawn path,
  interface-first/fake-second/real-third.
- **Decided trade-offs** — PRD §14 lists ~26 of them, each with gains and
  accepted costs (e.g. always-async latency, escalate-all-diffs load,
  byte-diff artifact fallback). If you want to challenge one, argue against
  its recorded cost/benefit — "I would have chosen differently" alone
  re-litigates a closed decision.
- **Assumptions** — PRD §13. These are honest load-bearing bets (single user,
  single daemon, VPN trust, pi/fff viability). Attacking an assumption *with
  evidence* is one of the most useful reviews possible.

## What is explicitly non-binding

- **Shape plugin framework** — PRD Appendix A. Preserved thinking, not
  approved scope; MVP hardcodes `tdd@1`.
- **Parking lot** — PRD §11 (e.g. meeting-input intake). Ideas, not plans.
- **Anything in an epic marked DRAFT or BLOCKED.**
- **Example verb names / vendor choices** (Jira, Slack, k8s, SigNoz…) — the
  registry pattern is binding; the specific integrations are per-company
  work.

## Where feedback is most valuable

1. **Known design gaps** (architecture.md §6.4) — two are real holes, not
   trade-offs:
   - Cross-feature merge-order coordination: nothing lints or coordinates two
     features that touch the same repo; feature A's merged PR can invalidate
     feature B's branch base.
   - The per-day budget kill switch is global: one runaway feature can halt an
     innocent one.
2. **Open items** — PRD §12 (contract-artifact format inventory, observer
   handler logic, worktree disk verification).
3. **Operator load** — architecture.md §6: the routine catalog and the
   unknown-unknowns list. Is anything missing? Is the projected human load
   realistic for a second operator (you)?
4. **Security model** — PRD §4 and the ring-1 surfaces (architecture.md §1).
   Adversarial reading welcome: prompt-injection paths (RUNBOOK is a known
   propagation vector, PRD §14.23), credential custody, the no-bypass claim.
5. **The metrics portfolio** — PRD §2. Would you trust these numbers enough
   to loosen policy on them?

## How to file feedback

Blockers and suggestions as a bullet list, one item per bullet:

```
<B1> - <name> - <what breaks and why it blocks>
<S1> - <name> - <improvement and its trade-off>
```

Cite the section you are responding to (e.g. "PRD §7.3", "architecture §6.4
point 2"). A finding that names its section gets acted on; a general
impression gets discussed.
