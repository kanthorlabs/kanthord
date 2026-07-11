# Story 005 - timeline query (core) + CLI + references

Epic: `.agent/plan/epics/019.5-task-audit-timeline.md`

## Goal

Make the timeline usable now and UI-ready later: a core `queryTaskTimeline(taskId)`
function + a minimal CLI to read a task's timeline and jump to the failing step; plus
reference notes so Epic 026 exposes it over the API and Epic 027 renders it (wiring only).

## Acceptance Criteria

- `queryTaskTimeline(taskId)` returns the task's ordered timeline (Story 002 events joined
  with the per-call records and failure signals), including per-event `observed_failure_signal`
  and, for model-call events, `account_id` + `model`.
- A filter returns only the failing step(s) for a task (events whose
  `observed_failure_signal` is set), so an operator lands on the root-cause step directly.
- A minimal CLI (`kanthord timeline <taskId> [--failures]`) prints the ordered timeline /
  the failing steps, reading via the core function, without network.
- A `docs/` page documents reading a task timeline, the machine-signal vocabulary vs
  human-confirmed cause, and the multi-account per-call attribution.
- Reference notes: Epic 026 exposes `ListTaskTimeline` + the outbound session-event stream
  over the API; Epic 027 renders the timeline — **wiring only, no logic** (added during
  authoring for 026's feedback file; the docs page is this story's implementation).

## Constraints

- **Query logic is core here; 026/027 wire only** — `queryTaskTimeline` is a core function
  the CLI drives now and Epic 026 exposes over the API later (019.4 precedent). This story
  builds the function + CLI + docs, not the API transport or UI.
- **Read-model only** — the query reads durable timeline/per-call/attribution records; it
  writes nothing.
- **Docs path named explicitly** so the lane check allows it ([[lane-check-docs-gap]]).
- **No plan-file edits in implementation** — the 026 reference note is a plan-authoring
  change made when this epic is authored, not during the TDD build.

## Verification Gate

- `npm test` green for the query + CLI suites; typecheck 0; zero-network guard green.
- Ordered timeline, failing-step filter (with `account_id`/`model` on model-call events),
  and the CLI read path are asserted against a seeded timeline; the docs page exists.

### Task T1 - queryTaskTimeline core function

**Input:** `src/metrics/timeline-query.ts`, `src/metrics/timeline-query.test.ts`

**Action - RED:** a seeded timeline (events + per-call records + signals) asserts
`queryTaskTimeline(taskId)` returns them ordered with signals and, on model-call events,
`account_id` + `model`; a `--failures` filter returns only signal-bearing events.

**Action - GREEN:** implement the read-model join over the Story 002/003/004 records.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/timeline-query.test.ts` — T1 cases green.

### Task T2 - `kanthord timeline` CLI

**Input:** `src/cli/timeline.ts`, `src/cli/timeline.test.ts`

**Action - RED:** a test runs the CLI for a seeded task and asserts it prints the ordered
timeline and, with `--failures`, only the failing step(s), via the core function, no
network.

**Action - GREEN:** implement the CLI over `queryTaskTimeline`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/cli/timeline.test.ts` — T2 cases green.

### Task T3 - operator doc (GREEN-only)

**Input:** `docs/md/task-audit-timeline.md`

**Action - RED:** none - GREEN-only. Documentation has no behavior test; behavior is
covered by T1/T2 and Stories 001-004.

**Action - GREEN:** write `docs/md/task-audit-timeline.md` — reading a timeline, the
machine-signal vs human-confirmed-cause distinction, multi-account per-call attribution,
and the 026/027 wiring-only framing.

**Action - REFACTOR:** none.

**Verify:** the page exists and matches the shipped CLI behaviour.
