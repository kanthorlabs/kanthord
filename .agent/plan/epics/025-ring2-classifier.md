# 025 Ring-2 Classifier

## Outcome

The judgment ring: an LLM-based sensitivity/risk classifier invoked on
designated action/output checkpoints, whose model resolves from **global config
only**, whose verdicts route risk to the escalation inbox, and which **fails
conservative** — an unavailable or erroring classifier escalates rather than
approves. Ring 2 advises and escalates; it can never *loosen* ring 1 (a ring-1
block is final regardless of any classifier verdict).

## Decision Anchors

- phases.md Phase 2B Deliverable 5 — ring 2 classifier (global-config model
  only; PRD §4).
- PRD §4 ring 2 — LLM-based sensitivity/risk classification on actions and
  outputs; model assignment from global config, never overridable per-plan.
- PRD §4 — inbound external content is hostile (prompt injection): classifier
  **input is data, its instructions are system-fixed**; a payload cannot
  reconfigure the classifier.
- PRD §2 — classification is approximate, never authoritative; ring-2 verdicts
  are advisory routing, not deterministic policy (that is ring 1).

## Stories

- `001-classifier-seam-and-routing.md` — the classifier interface (checkpoint
  input → `{ risk: low|medium|high, rationale }`), invoked at the designated 2B
  checkpoints (outbound broker payloads post-ring-1, runbook appends, PR
  bodies); `high` creates an escalation inbox item; verdicts journaled;
  fail-conservative on error/timeout; model from global config via the Epic 024
  registry; a hermetic fake classifier is the test double.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for the Story suite (fake
  classifier — no model call in tests; the real call path is exercised in the
  Epic 030 live proof).
- A checkpoint whose fake classifier returns `high` produces an escalation
  inbox item carrying the rationale; `low` **creates no escalation and does not
  alter the action's pre-existing authorization state** — ring 2 never grants
  anything (journaled only; debate finding — "passes" wrongly implied approval
  semantics); `medium` is journal-plus-annotation **by explicit design**
  (attached to the feature's drill-down evidence; rationale: ring 2 is advisory
  and escalate-all-diffs already routes this phase's actions to the human — the
  destination is a recorded decision, not an accident).
- A classifier error or timeout escalates (`classifier-unavailable`) — never a
  silent pass (fail-conservative asserted) — with operational bounds (debate
  finding): retries bounded per config, **one** unavailable-escalation per
  checkpoint target (deduped by content hash, no inbox flood), and ring-2
  budget exhaustion treated as unavailable.
- **All three checkpoints are post-ring-1** (debate finding — not only the
  broker payload): broker payloads and runbook appends sit behind the Epic 013
  scan choke point, PR bodies ride broker submissions — each asserted; ring-1
  decisions are computed **before any verdict exists and take no verdict as
  input** (call-order + input-type assertion — stronger than the import
  boundary alone).
- The classifier's model resolves from global config; the Epic 024 chain
  ignores every non-global home for the role and the lint rejects plan
  overrides (cross-asserted); the classifier call path **accepts no model
  parameter** — checkpoint/context cannot smuggle an override (signature-level;
  debate finding).
- Injection posture asserted **structurally** (debate finding — a fake
  verdict alone is false confidence): the assembled provider request is
  inspected — system instructions are the fixed constant, the classified
  payload sits only in the data slot, and no payload content can reach the
  model/instruction fields; the injection-shaped fixture is classified normally
  on top of that.
- Classifier calls are charged to the **feature's** ring-2 budget line in the
  ledger (not the task's coding budget); completed calls charge once,
  failed/timeout attempts charge the provider-reported amount or zero
  (PRD §2/§8 attribution; debate finding — retry accounting defined).

## Dependencies

- **Epic 024** (provider registry + global model config), **Epic 017** (inbox
  for escalations), **Epic 013** (ledger for cost attribution), **Epic 005**
  (checkpoint placement on the broker path).

## Non-Goals

- No classifier *quality* claims — verdicts are advisory; the human is the
  authority (PRD §2).
- No per-plan or per-repo classifier tuning (PRD §4 — global only).
- No ring-2 on inbound ticket intake (MVP intake is assigned tickets;
  assumption #11) beyond what the checkpoints above cover.
- Excluded action/output surfaces, listed so the checkpoint set is a recorded
  decision (debate finding): session tool-call contents (ring-1 territory),
  journal/STATE writes (never leave the machine), agent answers surfaced to the
  human via escalations (the human reads them directly), and model prompts
  (provider channel, governed by budget + custody). Expanding the set is
  config; each addition is a decision note.

## Findings Out

- none. The checkpoint list and verdict schema are documented in the story and
  asserted by tests.
