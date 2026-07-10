# Feedback — 029 design input: notification delivery is a seam + ordering note

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Owning epic: 029 (fold into authoring/debate).

## The point

The dead-man ping (§6.3.1) is the operator's only *push* signal — everything
else is inbox polling. Delivery is not seam-shaped anywhere yet. Author the
ping behind one small notifier interface (Slack DM first); otherwise the
first channel change (email, webhook, second recipient) is surgery on the
ping logic. One interface, one implementation — not a plugin framework.

AC shape: ping content/scheduling tested against a fake notifier; delivery
failure escalates loudly (already the epic's honest scope).

## Ordering note (maintainer decision)

By numbering, 029 lands after the UI (027). But the ping is a §6.3 daily
routine and the UI is only a surface — daily operation starts when the
system is routine-ready, before/with 027. Consider pulling the ping story
ahead of 027, or accept manual `getStatus` checks as the interim and record
that as a decision.
