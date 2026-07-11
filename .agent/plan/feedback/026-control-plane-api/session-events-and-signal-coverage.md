# Feedback — 026 design inputs: outbound session events + full signal coverage

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Owning epic: 026 (fold into authoring/debate).

## Input 1 — one outbound, read-only session event stream

Today `PiSessionHandle` exposes only abort/waitForIdle/reset/contextTokens;
no tool-call/message events reach the daemon. pi's Agent already emits them
(`agent.subscribe`). Not needed for daily-basic operation (diff review works
off git diffs; ring-1 blocks already produce inbox items), but it is the one
"should be extensible but can't" gap: it blocks the UI timeline, audit depth
(M1), and future ring-2-style analysis.

Decide in 026: expose a single outbound, read-only event stream (journal
sink and/or API subscription). Inbound hooks stay daemon-owned — do not
expose code extension points inside ring-1.

## Input 2 — every escalation signal must carry a proposed type

`SIGNAL_MAP` in `src/metrics/interaction-capture.ts` covers 2 signals
(`approval-tier-verb`, `budget-breach`), but architecture §6.2.3 lists ~6
(scope-violation, secret-scan block, verb timeout/reconcile, ring-2 verdict,
deploy-observer fail). Every unmapped signal reaches the operator with no
proposed classification — friction that breeds rubber-stamping, and the
whole Phase-3 tuning loop feeds on this data.

Fold in: the inbox-serving API guarantees a proposed type for every known
signal (complete the map; making it data-driven can wait).

AC shape: each signal kind emitted anywhere in the daemon has a mapped
`proposed_type`; an unmapped signal is a test failure, not a silent None.

## Built by Epic 019.5 (2026-07-11)

Both inputs are the **runtime/logic** half of `.agent/plan/epics/019.5-task-audit-timeline.md`:
- **Input 1** (outbound read-only session-event stream from pi's `agent.subscribe`) →
  Story 019.5-001 (session-event exposure through `PiSessionHandle`, spike-gated on the
  real pi surface).
- **Input 2** (complete `SIGNAL_MAP`) → Story 019.5-004 T3.
- The durable task timeline, per-model-call/account record, typed provider-error taxonomy,
  and the core `queryTaskTimeline` function are also 019.5.

Epic 026 keeps only the **wiring**: expose `ListTaskTimeline` + the outbound session-event
stream over the control-plane API (Epic 027 renders the timeline). No logic in 026/027 —
019.5 owns it (019.4 precedent).
