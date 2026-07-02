# 029 Dead-Man Ping & Per-Feature Metrics Summary

## Outcome

The two daily-operation readiness pieces phases.md pulls forward into 2B: the
**dead-man ping** — a daily "alive, N tasks processed" Slack DM sent through the
broker (`slack.dm`), whose content makes an alive-but-idle day detectable and
whose delivery failure escalates loudly — honestly scoped (debate finding): it
detects **alive-but-silent**, not daemon death; a dead daemon sends nothing, and
that failure mode belongs to the crash-restart supervisor (Phase 3
launchd/systemd) and ultimately the human noticing absence (PRD §3.1 separates
the two) — and the **per-feature metrics summary** — "4 human interactions,
$11" — aggregated from the Epic 017 interaction events and the budget ledger,
readable over the control-plane API.

**Fixed semantics (debate findings — boundary conditions are the correctness):**
- **Schedule:** once per calendar day in the configured ops timezone at the
  configured HH:MM; if the daemon was down at the boundary, send at startup iff
  no successful ping exists for the current ops day; first boot with no
  last-ping state sends one at startup.
- **Accounting window = scheduled day boundary, independent of delivery:** a
  failed Monday ping's counts stay Monday's; Tuesday's ping covers Tuesday and
  notes "previous ping failed to deliver" — content never silently rolls up.
- **Idempotency key = daemon instance id + ops date.**
- **Failure escalation is broker-independent:** a failed send records a durable
  open escalation in the local inbox store (readable via Epic 026) — never only
  another Slack attempt (the watchdog's failure path does not depend on the
  failing channel).
- **Recipient:** the configured operator DM target; a missing target is a
  config load error (the ping is a required 2B deliverable, not optional).
- **Counts defined:** pending + in_flight per the Epic 005 state model, global;
  open escalations = open inbox items; if a count source fails, the ping sends
  with a "counts unavailable" marker instead of blocking.

## Decision Anchors

- phases.md Phase 2B Deliverable 8 — dead-man ping required **here, not Phase
  3**: 2B already runs real external side effects, so silent-idle detection
  must exist before daily operation; Deliverable 9 — the per-feature summary
  readable in the web client (raw capture from 2A made visible).
- PRD §3.1 — daily "alive, N tasks processed" message to a channel the human
  actually reads (Slack DM via broker); crash-restart handles death, the ping
  handles the worse failure: up but silently idle.
- PRD §2 — the per-feature human-readable summary ("4 human interactions,
  $11"); the portfolio/trends stay Phase 3.
- phases.md 2B success criteria — ping observed firing on schedule; an induced
  silent-idle day detectable **from the ping content**.

## Stories

- `001-deadman-ping.md` — a daily schedule on the injectable clock composes the
  ping ("alive, N tasks processed since last ping", plus pending-op and
  open-escalation counts) and submits `slack.dm`; N==0 renders as an explicit
  idle warning; send failure after retries raises an escalation; last-ping
  status feeds the Epic 026 daemon-ops view.
- `002-per-feature-summary.md` — aggregate interaction events (count by
  confirmed type, exclusion-flag aware) + ledger cost into a per-feature
  summary served by a read method; matches the PRD's "4 human interactions,
  $11" shape.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (fake
  clock; slack double; fixture events/ledger — hermetic).
- Advancing the fake clock across a day boundary fires exactly one ping; the
  message contains the tasks-processed count since the previous ping, pending
  ops, and open escalations; two day-boundaries ⇒ two pings, disjoint counts.
- A day with zero processed tasks renders the explicit idle-warning form —
  distinguishable from a busy day by content, not absence (phases.md — the
  induced silent-idle day is detectable from ping content).
- A `slack.dm` failure (double exhausts retries) raises an escalation naming
  the ping (the watchdog's own failure is loud); the ping schedule survives a
  daemon restart (next fire time derived from durable last-ping state, not
  RAM).
- The daemon-ops read surface reports last-ping time + outcome (Epic 026 field
  populated).
- The per-feature summary headline **excludes** flagged interactions (debate
  finding — "never poisoning the headline" means the headline is the included
  count): a fixture with 5 interaction events, 1 excluded, and $11 of net
  ledger cost returns headline 4 ("4 human interactions, $11"), the by-type
  breakdown of the included 4, and `excluded: 1` reported separately; a
  feature with no events returns an explicit empty summary.
- Cost = the Epic 013 **net cumulative total** (a reservation superseded by its
  final reconcile counts once — never reservation + reconcile added; debate
  finding — no double-counting wording survives).
- The ping body and the summary response have documented example shapes the
  tests assert against (stable, human-readable — debate finding).

## Dependencies

- **Epic 022 Story 004** (`slack.dm`), **Epic 001** (clock), **Epic 017**
  (interaction events), **Epic 013** (ledger), **Epic 026** (read surface +
  daemon-ops field), **Epic 009** (restart path for schedule durability).

## Non-Goals

- No portfolio trends, rubber-stamp analysis, or cross-feature views — Phase 3
  (PRD §2; phases.md Phase 3 Deliverable 5).
- No configurable notification channels beyond the Slack DM (the PRD names the
  channel the human actually reads; more channels are Phase 3 polish).
- No alerting middleware — the ping is a broker verb like any other.

## Findings Out

- none. The ping message format and summary schema are documented in the
  stories and asserted by tests.
