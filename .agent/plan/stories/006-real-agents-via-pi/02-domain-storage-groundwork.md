# Story 02 — Domain & storage groundwork (Task.agent + spec, status, events, migration 5)

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

Every domain/storage contract the rest of the epic builds on lands here in
one slice: `Task.agent` (versioned ref), the task-specification fields
(`instructions`, `ac`), the `awaiting_confirmation` status + edges, the six
new event literals, migration 5, the `TaskRepository` extensions, and
create-time agent-ref validation through the `AgentCatalog` port. (No
acceptance-policy field: escalation is solely the agent's decision — Ulrich,
2026-07-16; the trigger is the `escalate` tool, story 05.)

Task specification (Ulrich, 2026-07-16, debate-reviewed): a task needs more
than a `title` for a real agent. `instructions: string` (prose body — the
"how", including any advisory "files likely to touch" hints) and
`ac: string[]` (acceptance criteria) are added as REQUIRED pure data. No
`approach` field and no single `spec` blob (debate: over-structuring / issue
tracker). Both are carried + rendered into the user prompt (story 05); `ac`
is NOT yet an input to `verify()` — that wiring is future.

**Consequence — title-only task creation is superseded here (Ulrich,
2026-07-16):** `newTask` now requires non-empty `instructions` and a non-empty
`ac`, and the CLI `--instructions`/`--ac` flags become required. This
**supersedes** the title-only `create task` used by EPIC 005 — the same kind
of cross-epic supersession as EPIC 006 removing `daemon run --runner`: EPIC
005's Proof was valid at its own epoch (these fields did not exist yet) and is
NOT retro-edited; from this story on, every task-creating command — including
the `fake@1` tasks in EPIC 006's own Proof and story-10 smoke — passes
`--instructions`/`--ac`. Migration 5's NOT NULL DEFAULTs (below) cover any
pre-006 rows; validation is enforced only in `newTask` (creation), so the
repository reconstructs old rows without re-validating.

## Acceptance Criteria

- Domain (`src/domain/task.ts`, `src/domain/event.ts` — supersedes EPIC 002
  S003/S004/S006, annotated there):
  - `Task` gains `agent: string` (required non-empty — `newTask` throws a
    named validation error on empty; NO default in the domain).
  - `Task` gains `instructions: string` and `ac: string[]` (both REQUIRED;
    `newTask` throws a named validation error on empty `instructions` or empty
    `ac` — same rule as `agent`). Reconstruction from storage does NOT
    re-validate (pre-006 backfilled rows may hold placeholders).
  - `Task` gains `verification?: string[]` (OPTIONAL — D6, Ulrich,
    2026-07-17, debate-reviewed): exact shell commands that verify the work;
    the runner executes them after an accepted verdict (story 06) and their
    captured results are the task's `evidence`. Optional because
    Objective/Initiative-level verification is done by explicitly appending a
    **Verification Task** at the end (verification usually only succeeds after
    all work is done) — Objective and Initiative deliberately carry NO
    verification field. When present, items must be non-empty strings; absent
    → no runner verification step.
  - `TASK_STATUSES` gains `awaiting_confirmation` and `discarded`
    (terminal); `transitionTask` legal edges gain exactly:
    `running→awaiting_confirmation`, `awaiting_confirmation→completed`
    (approve), `awaiting_confirmation→pending` (reject-to-retry — D4: a
    review decision is not an execution failure, so no path through
    `failed`), `awaiting_confirmation→discarded` (reject-to-discard).
    `discarded` has NO outgoing edges. Everything else still throws
    `IllegalTransitionError`.
  - `EVENT_TYPES` gains exactly (in this order, appended): `task.escalated`,
    `task.approved`, `task.rejected`, `task.discarded`, `task.blocked`,
    `agent.started`, `agent.progress`, `agent.finished`.
- Migration 5 (appended to the ordered migration list — same lane caveat as
  EPIC 004 S05: if the lane denies the list append, split it as a
  maintainer sub-task):
  - `tasks.agent TEXT NOT NULL DEFAULT 'generic@1'` (backfill for rows from
    earlier epics),
  - `tasks.instructions TEXT NOT NULL DEFAULT ''` and `tasks.ac TEXT NOT NULL
DEFAULT '[]'` (`ac` JSON-encoded string array — same idiom as
    `dependencies`). The NOT NULL DEFAULTs backfill pre-006 rows; the domain
    non-empty rule lives in `newTask`, not the DB, so backfilled placeholders
    round-trip without error,
  - `tasks.verification TEXT` (nullable, JSON-encoded string array; NULL
    round-trips to the field being absent — the field is optional, so no
    backfill default),
  - `task_results(task_id TEXT PRIMARY KEY REFERENCES tasks(id), workspace
TEXT, branch TEXT, base_commit TEXT, proposal_commit TEXT, commit_sha
TEXT, summary TEXT, reason TEXT, rejection_resolution TEXT,
rejection_reason TEXT, evidence TEXT)` (`evidence` = nullable JSON array
    of the runner's verification-command results `{ command, exitCode,
output }[]` — D6, written by story 06, NEVER human-authored;
    `reason` = the agent's escalation reason;
    `proposal_commit` NULL for no-change escalations;
    `rejection_resolution`/`rejection_reason` = the human's durable
    rejection decision — D4 idempotency + next-attempt feedback). If the
    EPIC 003 `tasks.status` column carries a CHECK constraint, migration 5
    extends it with the two new statuses.
- `TaskRepository`: `agent` round-trip on save/get;
  `saveTaskResult(taskId, row)` (upsert) / `getTaskResult(taskId)`.
- `AgentCatalog` port in `src/agent-runner/port.ts`:
  `{ has(ref: string): boolean }`.
- `CreateTask` gains an `agent?` input: unknown agent ref (per the injected
  `AgentCatalog`) → `UnknownAgentError { agent }`, exit 1 one line.
- `CreateTask` gains required `instructions` and `ac` inputs, passed straight
  to `newTask` (which enforces non-empty), plus an optional `verification?`
  input.
- CLI `create task` gains `[--agent <ref>]` (defaults to `generic@1` at the
  CLI boundary — D2 debate: the default is CLI sugar, not domain).
- CLI `create task` gains REQUIRED `--instructions <text>` and repeatable
  REQUIRED `--ac <text>` (each `--ac` appends one criterion → `string[]`; at
  least one required). Missing either → exit 1 one-line error. It also gains
  repeatable OPTIONAL `--verification <cmd>` (each appends one command;
  omitted → field absent). Supersedes EPIC 004 S05 (annotated there).

## Constraints

- Domain stays pure — the catalog is consulted by the use case, never the
  domain.
- `task_results` rows are written only by `RunNextTask` tx2 / `ApproveTask`
  (stories 06/07) — this story only provides the table + repo methods.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — domain amendments

**Requires:** EPIC 002 S003-T2, S004-T1, S006-T1.

**Input:** `src/domain/task.ts`, `src/domain/event.ts` (+ existing tests).

**Action — RED:** tests: (a) `newTask({ objectiveId, title, agent:
'generic@1', instructions: 'do X', ac: ['builds'] })` carries agent +
instructions + ac; empty/missing `agent`, empty/missing `instructions`, and
empty/missing `ac` each throw the named validation error; a passed
`verification: ['npm test']` is carried, omitted → absent, and a present
array with an empty-string item throws the named validation error; (b)
`transitionTask`
allows the four new edges and still
rejects `pending→awaiting_confirmation`, `awaiting_confirmation→running`,
`awaiting_confirmation→failed`, `discarded→pending`, `discarded→running`,
`failed→discarded`; (c) `EVENT_TYPES` deep-equals the fourteen literals
(six old + eight new, in order); `newEvent('task.discarded', { taskId })`
and `newEvent('task.blocked', { taskId })` are constructible. Fails today:
fields/edges/literals absent.

**Action — GREEN:** implement per the AC.

**Action — REFACTOR:** none.

**Output:** the amended domain: agent-carrying tasks, the confirmation
status machine, the full event vocabulary.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — migration 5 + TaskRepository extensions

**Requires:** T1; EPIC 003 (migration runner); EPIC 005 S02.

**Input:** the ordered migration list module,
`src/storage/port.ts`, `src/storage/sqlite/task-repository.ts` (+ tests).

**Action — RED:** temp-DB tests: (a) `db migrate` creates the `agent`,
`instructions`, `ac`, `verification` columns + `task_results`; a
pre-migration task row reads back with `agent 'generic@1'`, `instructions
''`, `ac []`, `verification` absent (defaults/NULL applied); (b) save/get
round-trips `agent`, `instructions`, `ac` (JSON array), `verification`
(JSON array and NULL→absent), and a task saved with status `discarded`
round-trips; (c) `saveTaskResult` + `getTaskResult` round-trip all eleven
columns (including NULL `proposal_commit`, the rejection pair, and
`evidence` as a JSON array and as NULL); upsert overwrites. Fails today:
DDL/methods absent.

**Action — GREEN:** append migration 5; extend the repo + port.

**Action — REFACTOR:** none.

**Output:** the epic's storage surface on a temp DB.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — AgentCatalog + CreateTask/CLI

**Requires:** T2; EPIC 004 S05-T2/T3.

**Input:** `src/agent-runner/port.ts` (extend),
`src/app/task/create-task.ts`, `src/apps/cli/task.ts` (+ tests).

**Action — RED:** hermetic tests with a fake catalog `{ has: ref => ref ===
'generic@1' }`: (a) `create task … --agent generic@1 --instructions "do X"
--ac "builds"` → ULID, persisted agent + instructions + ac `['builds']`; (b)
omitted `--agent` → persisted `generic@1` (CLI default); (c) `--agent nope@1`
→ exit 1 `error: unknown agent: nope@1`; (d) two `--ac` flags → `ac` has both,
in order; (e) missing `--instructions` or missing `--ac` → exit 1 one-line
error; (f) two `--verification` flags → `verification` has both, in order;
omitted → absent. Fails today: inputs absent.

**Action — GREEN:** extend `CreateTask` (catalog check) + the CLI handler
flag.

**Action — REFACTOR:** none.

**Output:** agent-addressed task creation.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
