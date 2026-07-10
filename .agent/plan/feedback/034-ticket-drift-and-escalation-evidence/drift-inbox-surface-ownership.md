# Feedback — 034 design input: drift items in the operator inbox — settle surface ownership

Recorded 2026-07-10 during the operator-routines UI review (Ulrich + debate
engine). Owning epic: 034 (fold into authoring/debate). Companion:
`.agent/plan/feedback/027-web-dashboard/daily-usage-operator-loop.md`
Input 9.

§6.2.7 demands same-day drift response with two actions (keep working /
halt subtree). Drift must land in the **same operator queue** as every
other human-required item (debate finding — a separate drift surface is bad
daily ergonomics), but no Epic 027 story names the drift item type. Decide
at 034 authoring: the 027 inbox renders generic API-supplied escalation
types; drift-specific response actions belong to 034 unless the Epic 026
contract already carries them.

UX constraint (decided now): "halt subtree" is destructive — it takes the
DESIGN §7 alert-dialog weight, never an equal sibling button of "keep
working".
