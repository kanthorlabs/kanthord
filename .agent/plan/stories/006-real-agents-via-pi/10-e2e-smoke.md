# Story 10 — End-to-end smoke test

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The epic's Proof as a hermetic regression test: real wiring, real tools,
real git, fake model — through the composition root against temp
everything, covering the happy path, the escalation round trip, and the
credential failure path.

## Acceptance Criteria

- The smoke harness's composition entry accepts a deps override for the
  session factory (test-only injection at the composition root — the single
  new seam; no env flags).
- **Phase 1 (happy):** temp sandbox git repo (README + initial commit,
  `origin` set to the constructed URL); EPIC 004-style setup +
  `create ai-provider --provider openai --model gpt-5.5` +
  `create credential --provider openai --value test-key` +
  `create repository --organization kanthorlabs --branch main --path
  <sandbox>`; task (default `--agent generic@1`) with the three context
  bindings; scripted session edits README then finishes → `daemon run
  --until-idle` exit 0; `get task --id` shows completed +
  workspace/branch/commit_sha/summary; the commit exists on
  `kanthord/<task-id>` in the workspace clone and the sandbox home is
  untouched; `events --after 0` shows per-task order `task.started →
  agent.started → agent.progress ≥ 1 → agent.finished → task.completed`.
- **Phase 2 (escalation round trip — agent-decided):** a second task with
  a dependent third task; the scripted session edits a file then calls
  `escalate({ reason: 'need human review' })` → `daemon run --until-idle`
  exit 0 + the `1 task(s) awaiting confirmation` line; the task is
  `awaiting_confirmation`, its proposal commit exists on
  `kanthord/proposal/<id>`, the `task.escalated` payload carries the
  reason, the dependent is still `pending`; `approve task <id>` →
  completed, `kanthord/<id>` at the proposal commit; a second `daemon run
  --until-idle` runs the dependent to completion; events show
  `task.escalated → task.approved → task.completed`.
- **Phase 3 (rejection, both resolutions):** (a) an escalated task
  rejected `--resolution retry` → it is `pending` with NO `task.failed`
  event; the next `daemon run --until-idle` re-runs it and the fake
  session's recorded prompt contains the rejection feedback block; it
  completes; (b) another escalated task with a dependent, rejected
  `--resolution discard` → `discarded`, `task.discarded` +
  `task.blocked` events, the dependent never runs, `daemon run
  --until-idle` still exits 0, and `get task --id` on the dependent names
  the discarded dependency.
- **Phase 4 (credential failure):** a task whose credential's `provider`
  mismatches the ai-provider's → `daemon run --until-idle` exit 1
  (EPIC 005 exit contract); task failed; the `task.failed` payload reason
  starts `CredentialError`; no workspace dir was created; no output
  anywhere contains the credential `value`.

## Constraints

- Hermetic: temp DBs, temp git repos, FakeSessionFactory, no network, no
  timers. The manual Proof block in the epic stays the human-run
  verification (real key, real model); this test is its CI twin.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — Proof-sequence smoke test

**Requires:** all of S01–S08; EPIC 005 S10 (smoke harness).

**Input:** `src/apps/cli/agent-smoke.test.ts` (new); the harness entry
(deps-override extension).

**Action — RED:** the four phases as ordered tests sharing setup helpers,
asserting exit codes, statuses, git state, and event order per the AC.
Fails today: test does not exist.

**Action — GREEN:** none expected — this is the integration gate; fix
whatever it flushes out.

**Action — REFACTOR:** none.

**Output:** the EPIC 006 Proof (minus the live API call) green in CI on
every commit.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
