# Feedback — 027 story inputs: honest classification UI + diff policy from config

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Owning epic: 027 (fold into the inbox-loop stories).

## Input 1 — interaction classification is a first-class UI element

Every inbox response asks the operator to confirm the proposed type
(approval / clarification / correction / takeover) — §6.2.5. The Phase-3
tuning loop feeds on this data, and `takeover` is the honest capability-gap
signal. The UI must make confirming/overriding the type a deliberate,
visible step on every respond action — not a hidden default that gets
rubber-stamped. Depends on full signal coverage
(`026/session-events-and-signal-coverage.md` Input 2).

## Input 2 — read the diff-escalation policy from config

`escalate_all_diffs` stays fixed for MVP (intentional). One-line prep only:
the daemon/UI read the policy from config rather than a literal, so the
Phase-3 rubber-stamp policy knobs do not need surgery. Do not build a policy
framework now.
