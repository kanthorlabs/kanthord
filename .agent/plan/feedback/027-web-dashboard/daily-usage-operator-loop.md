# Feedback — 027 story inputs: daily-usage operator loop (glance → triage → act → continue)

Recorded 2026-07-10 during the operator-routines UI review (Ulrich + debate
engine; one adversarial pass, each input judged individually). Owning epic:
027. Source: architecture.md §6 — the daily rhythm is the §6.2 inbox loop
(diff review dominant, time-boxed passes, often from an iPhone) plus the
§6.3 daily checks. The debate's governing finding, adopted: daily smoothness
on a phone comes from **fewer decisions per item** — scannable rows, clear
defaults, low-friction confirmation — not from more controls or ceremony.

Fold-in map: Inputs 1–5 → Story 003; Inputs 5–6 → Story 000; Input 7 →
Story 006; Inputs 6+8 also need a DESIGN.md §P4 pass (toolchain-decision
entry + §11 changelog) **before Story 000 dispatches**; Input 9 is
cross-epic with 034.

## Input 1 — classification confirm is visible but low-friction (Story 003)

Refines `honest-classification-and-diff-policy.md` Input 1: the proposed
interaction type renders **inline** on the respond control, with "Accept
suggested: <type>" as the primary action and "Override" as a deliberate
secondary path. NO extra modal per response (debate finding — ceremony on
every item trains mechanical tapping, which poisons the very takeover
signal this exists to protect). The existing DESIGN §7 destructive-confirm
rule is untouched.

## Input 2 — scannable inbox, not a grouped one (Story 003)

`unclassified-artifact-change` is noisy-by-design (§6.2.4) and must not bury
real escalations in a flat table. Shape (debate finding — grouping sections
waste 390px vertical space and hide mixed urgency): a type/severity badge
per row (§4 domain vocabulary), a stable deterministic default sort, a
simple type filter, and a visually distinct badge for
unclassified-artifact-change — no per-type section grouping in MVP.

## Input 3 — diff evidence renders as a real diff (Story 003)

Diff review is THE dominant in-loop load (§6.2.1); the DESIGN §5 diff pane
is currently wired only to Story 002 plan flows. Escalation evidence of
diff type renders in the diff-pane pattern with **file boundaries
preserved** and additions/deletions colored via semantic tokens (debate
finding — a bare `card + scroll-area + <pre>` dump is too low a bar for the
dominant workflow). Scope guard: no full code-review UI (no comments, no
per-hunk actions).

## Input 4 — "Next open item" after a response (Story 003)

Supports the time-boxed batch pass (§6.2.1). On response success the UI
shows a success state with "Next open item" as the primary action and
"Back to inbox" secondary. NEVER auto-navigate (debate finding —
auto-advance disorients on mobile and hides the resolution confirmation).
"Next" is deterministic: the next open item under the current sort/filter.

## Input 5 — stable deep-link URLs (Story 000 + Story 003)

Notifications arrive outside the dashboard (Slack); a link must land on the
item, not the nav root. Split deliberately (debate finding — this is
routing + auth work, not one AC): Story 000 owns the route foundation and
auth-redirect preservation (unauthenticated open of a deep link →
auth-required → the original target); Story 003 owns a stable URL per inbox
item; a resolved/expired/missing item at a deep link renders an explicit
state — never a silent dump back to the list.

## Input 6 — Inbox pending-count badge in the nav (Story 000; DESIGN §P4)

The AppShell nav Inbox item carries an open-items count badge, and the
collapsed mobile shell shows an indicator on the menu toggle (debate
finding — a badge inside off-canvas nav is invisible exactly when mobile
needs it). MVP keeps a single plain count — no urgency split, and this is
not a substitute for an overview page. Needs a §P4 DESIGN §6 amendment
(AppShell badge slot) before Story 000 dispatches.

## Input 7 — dead-man card shows "N tasks processed today" (Story 006)

§6.3.1's dangerous line is N==0 with everything "up" (silent-idle). The
daemon-ops surface renders last ping time + outcome **and the processed
count** as one compact glanceable health card (debate finding — a table row
is not glanceable at 390px). Depends on the Epic 026/029 API exposing the
count; if it does not, that gap routes as cross-epic feedback to 026/029 —
never a silent story edit here.

## Input 8 — data-freshness pattern (DESIGN §P4, §7 + §6 templates)

No surface owns freshness today; phone tabs re-open hours stale. One
pattern, owned by the page templates: a compact header/toolbar slot —
"Updated HH:MM" (client fetch time) + a refresh affordance — plus the rule
that a successful mutation refetches the affected view (debate finding —
post-mutation reconciliation matters more than the manual button). No
polling, no push in MVP. Needs a §P4 pass (one §7 row + template note).

## Input 9 — ticket-drift items in the inbox (cross-epic: 034)

§6.2.7 demands same-day drift response with two actions (keep working /
halt subtree), but no 027 story names the type and Epic 034 owns drift.
Decision owed at 034 authoring: the 027 inbox renders generic API-supplied
escalation types; drift-specific actions belong to 034 unless Epic 026
already carries them. UX constraint recorded now: "halt subtree" is
destructive and takes the DESIGN §7 alert-dialog weight — never an equal
sibling of "keep working". Pointer filed in
`.agent/plan/feedback/034-ticket-drift-and-escalation-evidence/`.

## Rejected for MVP (debated, deliberate)

- No home/overview page (Input 6's badge + Input 7's card cover the need).
- No keyboard shortcuts, no bulk-approve (bulk actively undermines Input 1).
- No auto-refresh/live push (Input 8 is the smallest complete change).
- No mobile card-collapse tables (DESIGN §6 tables-stay-tables stands).
