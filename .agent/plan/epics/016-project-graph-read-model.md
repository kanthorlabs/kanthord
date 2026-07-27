# EPIC 016 — Initiative graph read model & project overview

> Routine 2, "what is going on with my project". Designed 2026-07-27 from two UX
> debates plus an adversarial debate on this epic's own draft, which caught four
> real defects: a per-node action contract that had no home for `approve`, a
> critical path reduced to an integer, an undefined oracle for decision age, and
> a no-write check (`PRAGMA data_version`) that proves nothing across processes.
>
> **Depends on EPIC 011 stories 3 and 4** (`events.projectId` +
> `list event --project`). Independent of 012, 013, 014, 015.

## Goal

An operator or a programmatic client answers "what is going on with my project"
in **two calls, with no rules duplicated on the client**.

`kanthord get graph --initiative <id> --json` returns that initiative's whole DAG
in one payload: task nodes with status, readiness, **why** a node is blocked and
**whether that block can ever clear**, downstream fan-out, the candidate identity
the node produced, full node detail (everything except the diff), objectives as
groups with their repositories, the remaining critical path as a node sequence,
and a **scoped action** on every element naming what a human can do right now.

`kanthord get overview --project <id> --json` is the "where do I look" call:
initiatives with per-status task counts, objective/repository lanes, a decision
list ranked by downstream fan-out then by how long it has been waiting, and an
activity digest **since an explicitly acknowledged cursor** — advanced only by
`kanthord ack project`, never by reading.

The overview serves UX zones 1–3 (digest, decisions, lanes); the graph serves
zones 4–5 (collapsed active graph plus critical path, frontier detail). Binding
decision 1 makes the initiative the unit of context, so zones 4–5 are
per-initiative by construction — the overview does not attempt a project-wide DAG.

## Facts verified against the current tree (2026-07-27)

- `events` has **7 columns and no timestamp** — `id, type, taskId, payload,
objectiveId, initiativeId, repositoryId` (`src/storage/sqlite/migrations.ts:771-784`,
  asserted at `src/storage/sqlite/migrations.test.ts:156-164`). Ids are real
  ULIDs (`monotonicFactory`, `src/domain/entity.ts:1-14`), so every time value in
  this epic is `decodeTime(id)`.
- `paused` is a separate `INTEGER` column on `initiatives`; `status` is
  `CHECK (status IN ('building','landed','discarded'))`
  (`src/storage/sqlite/migrations.ts:542-550`; `src/domain/initiative.ts:4`).
- `task_results` holds `task_id, workspace, branch, base_commit, proposal_commit,
commit_sha, summary, reason, rejection_resolution, rejection_reason, evidence`
  (`src/storage/sqlite/migrations.ts:186-198`). Candidate identity exists; no diff.
- `apps/` declares local structural mirrors rather than importing ports
  (`src/apps/cli/deps.ts:63-78`, and again at `:82-110`).
- Schema head is **26** (`008.4-s-provider-failover-event`,
  `src/storage/sqlite/migrations.ts:763`). EPICs 011, 013 and 014 all append
  migrations. **Pin the migration name; derive `version` as last + 1. Never
  hardcode a number.**
- **No key/value, settings, or cursor table exists** in any of the 26 migrations.

Five findings that change the design:

1. **No task-edge `neverSatisfies` exists.** `unsatisfiedInitiativeEdges` /
   `unsatisfiedObjectiveEdges` are initiative/objective only
   (`src/domain/sequencing.ts:31-62`); `readiness()` returns `waiting: string[]`
   with no permanence flag (`src/domain/graph.ts:184-211`). This is a new domain
   function, not a reuse.
2. **`approve` is objective-scoped, not task-scoped.** A task carrying a
   `workspace` binding is transitioned straight to `completed` by `RunNextTask`;
   the human gate is `approve objective` (`src/app/task/run-next-task.ts:365-402`,
   documented at `scripts/e2e/landing-proof.sh:60-66`). Task-level
   `awaiting_confirmation` is reachable only via escalation (`:404-412`).
3. **`reject task` REFUSES a `pending` task.** The guard accepts only
   `awaiting_confirmation`, or `failed` with `resolution=discard`
   (`src/app/task/reject-task.ts:86-92`); `retry task` requires `failed`
   (`src/app/task/retry-task.ts:129-130`). So a permanently blocked `pending`
   task's only reachable action is `remove dependency`, which is legal precisely
   because `assertDependenciesEditable` requires `pending`
   (`src/app/task/remove-dependency.ts:71`, `src/domain/task.ts:139-148`).
4. **`dependentClosure` already exists** (`src/domain/graph.ts:157`), used today
   only by `RejectTask` (`src/app/task/reject-task.ts:172`). Downstream fan-out is
   a field, not an algorithm — so it belongs in this epic, not a later one.
5. **The repository is bound per _task_.** `resolveInitiativeRepository` returns
   the **first** task's `task_context['repository']` for the whole initiative
   (`src/composition.ts:687-697`), and `GetObjective` reports that single value as
   the objective's integration (`src/app/objective/get-objective.ts:46-64`).
   Reusing it for swimlanes would label a genuinely cross-repo initiative as
   single-repo, defeating the purpose of groups.

## Contract

The `--json` payloads are the stable contract. A dashboard consumes the
structure; it never parses text and never re-derives a rule.

### Scoped action — every element carries one

```ts
type Action = {
  kind:
    | "retry"
    | "approve"
    | "reject"
    | "resolve-conflict"
    | "publish"
    | "resume-initiative"
    | "remove-dependency";
  target: {
    type: "task" | "objective" | "repository" | "initiative";
    id: string;
  };
  /** A second id the action needs, e.g. the dead dependency to remove. */
  targetDependencyId?: string;
  requiresInput: string[]; // [] when nothing is needed
  command?: string; // present ONLY when every value is known
} | null;
```

Every **node** carries `action`, and so do groups and the initiative. A completed
task inside an objective awaiting approval carries
`{kind:"approve", target:{type:"objective", id:<objectiveId>}}` — **not** `null`.
This is how the binding per-node-action decision and finding 2 are both honoured:
the field is on the node, the target names what is really acted on. `requiresInput`
plus optional `command` mirror EPIC 014's `next` shape, so `publish` and
`resolve-conflict` are never a bare verb with no operand.

The action table, each entry reachable through a real command:

| Condition                                                   | `kind`              | target                                           | command                                            |
| ----------------------------------------------------------- | ------------------- | ------------------------------------------------ | -------------------------------------------------- |
| task `failed`                                               | `retry`             | task                                             | `retry task --id <t>`                              |
| task `awaiting_confirmation`                                | `approve`           | task                                             | `approve task --id <t>`                            |
| objective `awaiting_confirmation`                           | `approve`           | objective                                        | `approve objective --id <o>`                       |
| objective `conflict`                                        | `resolve-conflict`  | objective                                        | absent — `requiresInput: ["resolution"]`           |
| task `pending` and `blockedForever`                         | `remove-dependency` | task, `targetDependencyId` = the dead dependency | `remove dependency --task <t> --dependency <d>`    |
| initiative `paused`                                         | `resume-initiative` | initiative                                       | `resume initiative --id <i>`                       |
| initiative `landed`, publication `unpublished`/`diverged`   | `publish`           | repository                                       | `publish repository --repository <r> --branch <b>` |
| task `running`, `completed`, `discarded` with nothing above | `null`              | —                                                | —                                                  |

### Node detail — field to source

| Payload field                         | Source                                                                                                            | Note                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `instructions`, `ac`, `agent`, `note` | `tasks` columns                                                                                                   | `note` **is** the retry note (`Task.note`)                     |
| `verificationRequested`               | `tasks.verification`                                                                                              | the commands the task declares                                 |
| `verificationResults`                 | `task_results.evidence` — `Array<{command, exitCode, output}>`                                                    | requested and observed are never conflated; see the note below |
| `failureReason`                       | `task_results.reason`                                                                                             | `null` when absent                                             |
| `rejection`                           | `{resolution, reason}` from `task_results.rejection_*`                                                            | separate from `failureReason`                                  |
| `produced`                            | `{summary, evidence}` from `task_results`                                                                         | the answer for a successful non-code task                      |
| `candidate`                           | `landing_candidates` row when present, else `{candidateSHA: commit_sha ?? proposal_commit, source:"task_result"}` | the payload states which source it came from                   |

**Verification results come from `task_results.evidence`, never from events.** The
`task.verification` events carry only `verifierKind`, `phase`, `exitClass`,
`durationMs` and `timedOut` (`src/agent-runner/pi.ts:730,738`) — no command text,
no exit code, no output — so they cannot serve this field. `evidence` is the only
store of per-command outcomes: written from the runner's `completed` outcome
(`src/app/task/run-next-task.ts:399`, serialised at
`src/storage/sqlite/sqlite-task-repository.ts:513`) and `null` on every other write
path (`run-next-task.ts:430,466,506,549`). A failed or escalated task therefore
reports `verificationResults: []`, which is the honest value — not a gap to paper
over with event metadata.

### Graph payload shape

```ts
{
  projectId: string;                 // breadcrumb: a deep-linked node needs it
  initiative: { id, name, status, paused, branch, action };
  groups: [{ id, name, status, repositories: string[], commitOid?, conflictReason?,
             after: string[], waiting: UnsatisfiedEdge[], action }];
  nodes: [{ id, groupId, title, status,
            dependencyState: "ready" | "blocked",
            executionState: "runnable" | "paused",
            dependencies: string[],
            waiting: UnsatisfiedEdge[],      // per-edge neverSatisfies
            blockedForever: boolean,
            downstream: number,
            lastEventId: string | null, lastEventAtMs: number | null,
            action, /* plus every detail field in the table above */ }];
  edges: [{ from: string; to: string }];
  criticalPath: { metric: "remaining-node-count"; nodeIds: string[]; length: number };
  counts: { pending, running, completed, failed, awaiting_confirmation, discarded,
            blocked, blockedForever, actionable };
}
```

`dependencyState` and `executionState` are two fields on purpose. A single
`state: "ready"` plus a footnote lets a client offer a run action on a paused
initiative by forgetting the second rule.

`criticalPath` keeps the agreed name but `metric` states the honest unit: there
is no duration data in the schema, so the path is counted in remaining nodes.
`nodeIds` is what the UI highlights — a length alone cannot draw a path.

### Overview payload shape

```ts
{
  projectId: string;
  initiatives: [{ id, name, status, paused, taskCounts: {...}, needsHuman: number,
                  lastEventId, lastEventAtMs, action }];
  lanes: [{ repositoryId: string | null; objectiveIds: string[]; initiativeIds: string[] }];
  decisions: [{ action, initiativeId, objectiveId?, downstream: number,
                actionableSince: number | null }];
  digest: { since: string|null; latest: string|null;
            totalCount: number; byType: Record<string, number>;
            events: Event[]; hasMore: boolean; pageCursor: string|null };
}
```

`totalCount` and `byType` are aggregates over **all** matching rows; `events` is
a capped page. Both statements stay true at any history size.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **Task edge permanence, precisely scoped.** New `unsatisfiedTaskEdges` and
  `taskEdgeSatisfied` in `src/domain/sequencing.ts`, beside the existing
  initiative/objective pair. Satisfied ⇔ dependency is `completed`.
  `neverSatisfies` ⇔ dependency is `discarded` (terminal — no `discarded->*`
  entry in `LEGAL_TRANSITIONS`, `src/domain/task.ts:96-107`) **or** the dependency
  is itself permanently blocked, computed transitively. A `failed` dependency is
  `neverSatisfies: false`, because `failed->pending` is legal.
  **The documented meaning is: "cannot clear through task status transitions
  alone, given the current dependency graph."** The qualifier is required —
  `remove dependency` is legal while a task is `pending`, so no edge is permanent
  against graph edits, and a flag that claimed otherwise would overstate.
  Tested: direct discard; two-hop transitive discard; failed-not-permanent; a
  diamond with one dead arm and one live arm; a node with two dead arms; and that
  `validateGraph`'s existing cycle and unknown-dependency rejections still fire
  before any graph is assembled.
- **`blockedForever` is a node field**, never a client inference, and is `false`
  for every node that is not `pending`.
- **`criticalPath` returns the sequence.** `longestRemainingChain(nodes)` in
  `src/domain/graph.ts`: the longest dependency chain among nodes not `completed`
  and not `discarded`, counted in nodes. Deterministic tie-break by lowest id.
  Tested: empty graph → `nodeIds: []`, `length: 0`; a fully completed graph →
  `[]`; two equal-length chains → the lowest-id chain.
- **One action authority.** `src/domain/actionability.ts` exports
  `nodeAction`, `groupAction`, `initiativeAction` — pure, zero I/O, with the
  closed `kind` vocabulary above. Every row of the action table is unit-tested,
  plus these must-not-regress cases: a `running` node is `null`; a `discarded`
  node is `null`; a completed task under an `awaiting_confirmation` objective
  targets the **objective**, not itself; a `pending` + `blockedForever` node is
  `remove-dependency` carrying `targetDependencyId`, and is **never** `reject`
  (`reject task` refuses `pending` — finding 3); a `resolve-conflict` action
  carries no `command` because the resolution is a human decision.
- **Paused is never hidden.** A paused initiative makes every node report
  `executionState: "paused"` while `dependencyState` keeps its true value, and the
  initiative action is `resume-initiative`. Tested paused and unpaused.
- **Groups carry every repository their own tasks name**, deduplicated and
  sorted. A group whose tasks name two repositories reports both; a group whose
  tasks name none reports `[]`. `resolveInitiativeRepository` is **not** used —
  it would collapse a cross-repo initiative to one value (finding 5).
- **Reads write nothing.** Both use cases take read-only sources; no `save*`, no
  event append. Asserted with sources whose write methods throw.
- **Ack is explicit, monotonic and bounded.** `AckProject` rejects a
  non-ULID cursor **and rejects a cursor greater than the project's latest event
  id** — otherwise `ack project --cursor <future ULID>` blinds the digest
  forever. A backwards ack keeps the stored maximum. `AckProject` is the only
  writer of `project_acks`; `GetProjectOverview` never writes.
- **Digest arithmetic.** With no stored cursor, `totalCount` counts the project's
  whole history; `totalCount` and `byType` are aggregates while `events` is capped
  and `hasMore` reports the cap; `since` and `latest` are echoed so a client can
  ack exactly what it saw.
- **Decision age has a defined oracle.** `actionableSince` is the ULID time of
  the **event that made the item actionable** — `task.failed`, `task.escalated`,
  `objective.awaiting_confirmation`, `objective.conflict` for the respective
  kinds — and **never** the entity id, which can be days older than the failure.
  Tested: an old task that just failed ranks as new; a young task that failed long
  ago ranks as old; when no such event exists `actionableSince` is `null` and the
  item sorts last.
- **Decision ranking.** `decisions[]` sorted by `downstream` descending, then
  `actionableSince` ascending (longest-waiting first), then lowest id. One
  deliberate tie at each level.
- **Cross-initiative task edges cannot exist**, so one graph call is always
  complete. `AddDependency` validates the proposed graph against
  `listByInitiative(objective.initiativeId)`
  (`src/app/task/add-dependency.ts:73-79`), so a foreign task id is not in the
  node set and `validateDag` rejects it as `UnknownDependencyError`
  (`src/domain/graph.ts:55-62`); the import path resolves dependency refs only
  within one package (`src/app/graph/create-graph.ts:206-210`). A regression test
  asserts `add dependency` across two initiatives is refused, so the invariant
  this epic relies on cannot be silently removed. Enforcement is **incidental**
  today and the error names the wrong cause — `OPEN:` a dedicated
  `SequencingScopeError` for task edges is a small correctness epic, not this one.
- `get graph` on an unknown initiative id exits non-zero with a
  `no initiative with id` message — never an empty graph.

Proof: `scripts/e2e/initiative-graph-proof.sh` — deterministic, no model, no
network, no daemon left running. Run from the repo root:

```bash
scripts/e2e/initiative-graph-proof.sh
```

It must print `016 ok: …`. Phases:

- **A** — an unknown initiative id is a clear error, matched on
  `no initiative with id`. Matched precisely: a bare `unknown` would also match
  `unknown command 'graph'`, so a missing command would false-green this phase.
- **B** — a freshly imported graph: `nodes` count equals `list task --initiative`,
  `projectId` equals the real project id (breadcrumb), every `node.groupId` exists
  in `groups`, `edges` count equals the fixture's edge count **and every edge's
  direction is asserted** — `from` is the dependency and `to` is the dependent, so
  the fixture's four edges all carry `from = <root>` and four distinct `to` values
  (a count alone would pass with the direction reversed), `criticalPath.metric`
  is `remaining-node-count` with `length` 2 and the root first, `counts.actionable`
  is exactly `0`, the root is `dependencyState: "ready"` and every dependent
  `"blocked"`, and the root's `downstream` equals the real dependent count.
- **C** — after `run daemon --until-idle --fail <root>`: the root is exactly
  `failed` with `action.kind: "retry"` targeting itself; each dependent is exactly
  `pending`, `dependencyState: "blocked"`, `waiting` contains the root with
  `neverSatisfies: false`, and `blockedForever: false`.
- **D** — after `reject task --id <root> --resolution discard`: the root is
  exactly `discarded`, and the four dependents are exactly `discarded` too,
  because `RejectTask` cascades over the pending dependent closure
  (`src/app/task/reject-task.ts:160-175`). Their action is `null`.
- **E** — the permanent block, built the only way it is reachable: a new task `W`
  created after the discard, then `add dependency --task W --dependency <root>`
  onto the already-discarded root. `W` is exactly `pending`,
  `dependencyState: "blocked"`, `waiting` is `[{root, neverSatisfies: true}]`,
  `blockedForever` is `true`, and `action.kind` is `remove-dependency` with
  `targetDependencyId` equal to the root and a runnable `command`. This is the
  case a red circle destroys.
- **F** — a second initiative run to success: the objective reaches exactly
  `awaiting_confirmation`, the **group** carries `action.kind: "approve"`
  targeting the objective, its completed task nodes carry the same approve action
  targeting that objective (not `null`, not themselves), and the root node's
  `candidate.candidateSHA` equals the real git OID in the managed mirror.
- **G** — `pause initiative`: every node reports `executionState: "paused"` while
  `dependencyState` is unchanged, and the initiative action is
  `resume-initiative`. After `resume initiative` both revert.
- **H** — overview and cursor: with no ack, `digest.totalCount` equals the
  project's full event count and `digest.since` is `null`; `decisions[]` is ranked
  and non-empty; `ack project --cursor <latest>` then makes `digest.totalCount`
  exactly `0`; a second `get overview` still reports `0`, proving reading did not
  re-arm; a backwards ack does not resurrect events; and a cursor above the
  latest event id is refused with a non-zero exit.
- **I** — no-write fingerprint: for every table in `sqlite_master`, `SELECT *`
  ordered by `rowid` is hashed, and the concatenation of all table digests is
  captured before and after running `get graph` and `get overview` five times.
  The two fingerprints must be byte-identical. Row counts alone would miss an
  in-place `UPDATE`, and `PRAGMA data_version` is only meaningful compared on one
  open connection — across separate CLI processes it proves nothing.

Every assertion compares against an exact expected value; no `!= missing`, no
`grep -q` on a substring that a missing command would also satisfy. `expect_fail`
is copied verbatim from `scripts/e2e/project-readiness-proof.sh:24-31` so an
expected non-zero exit does not print a misleading `FAILED` line.

**Not provable at program level:** a single objective spanning two repositories.
`import graph --bind source=<repo>` binds one repository per initiative and no
CLI writes per-task context, so the cross-repo group cannot be constructed
through real commands today. The `repositories: string[]` field is therefore
covered hermetically only, and `OPEN:` per-task repository binding is its own
epic. Recording this beats a proof phase that asserts a shape the program cannot
reach.

## Stories

1. **Task edge permanence + critical path (domain, pure).**
   `taskEdgeSatisfied` and `unsatisfiedTaskEdges` in `src/domain/sequencing.ts`
   with transitive permanence; `longestRemainingChain` in `src/domain/graph.ts`.
   Zero I/O.

2. **`src/domain/actionability.ts` — the single action authority.** `nodeAction`,
   `groupAction`, `initiativeAction` over the closed vocabulary and the action
   table above. Pure. Nothing else in the codebase may re-derive "what can a human
   do".

3. **`GetInitiativeGraph`** — `src/app/initiative/get-initiative-graph.ts`.
   Assembles `projectId`, `initiative`, `groups`, `nodes`, `edges`,
   `criticalPath` and `counts` from the task, initiative, result, context, landing
   and publication read sources; calls stories 1 and 2; returns node detail per
   the field-to-source table. Read-only.

4. **`get graph --initiative <id> [--json]`** — CLI leaf
   `src/apps/cli/commands/get/graph.ts`, registered in `get.ts` beside the eight
   existing leaves, with the `Usage` + `Example` help the architecture test
   requires. Structural deps mirrored locally per `src/apps/cli/deps.ts:63-78`.
   Compact text table plus the `--json` contract.

5. **Ack cursor.** Migration named `016-s5-project-acks` with **`version`
   derived as last + 1**, creating
   `project_acks(projectId TEXT PRIMARY KEY REFERENCES projects(id), cursor TEXT NOT NULL)`;
   repository read/write methods; the `AckProject` use case with the ULID,
   monotonic and not-in-the-future guards; and the
   `ack project --id <id> --cursor <ulid>` CLI leaf.

6. **`GetProjectOverview`** + `get overview --project <id> [--json]`.
   Initiative rows with per-status task counts and `needsHuman`, `lanes[]`,
   `decisions[]` ranked by fan-out then `actionableSince`, and the digest over
   EPIC 011's project-scoped event query.

7. **`get task` reuses the same functions.** `GetTaskOutput` gains `waiting:
UnsatisfiedEdge[]`, `blockedForever`, `downstream` and `action`, sourced from
   stories 1 and 2. The existing `dependencyStatus` field stays. One node's answer
   is then identical whether it arrives via the graph or via `get task` — this
   story is what closes the divergence risk, not a convenience.

## Decisions

- **The ack cursor is per project, within one database.** Named accurately: two
  clients sharing one `KANTHORD_DB` share acknowledgement state. That is accepted,
  because no user or device identity exists in the 26 migrations, so a device
  column would be a speculative field with no writer. One cursor per database is
  rejected outright — acking project A would silently mark project B read, which
  is the digest-destroying failure one level up.
- **Opening a project acknowledges nothing.** `get overview` is a pure read. Only
  `ack project --cursor <ulid>` moves the cursor, and the client must echo the
  exact cursor it displayed. A server that acks on read cannot be replayed by a
  second client, and marking-on-open destroys the digest's whole value.
- **Actions live in one pure domain module and are NOT merged with EPIC 014's
  `next`.** They answer different questions: 014's `next` is _configuration_
  readiness (no repository, no provider, no initiative), while this epic's action
  is a _work_ decision on an element that already exists. Merging them yields one
  function with two unrelated input sets and a confused return type. What is
  binding is the no-second-copy rule: when `check project` wants a "N decisions
  waiting" field it must import `nodeAction` / `groupAction`, never re-derive.
- **The action field lives on the node and names a scoped target.** This is how
  the per-node contract survives finding 2. A bare verb string would be unusable
  for `publish` and `remove-dependency`, which need operands.
- **A permanently blocked pending task's action is `remove-dependency`, not
  `reject`.** `reject task` refuses `pending` (finding 3). An action the CLI
  refuses is worse than no action, because the UI would offer a button that always
  errors.
- **Node detail is inline; the diff is the only exclusion.** An initiative holds
  tens of tasks and every detail field is short text already in SQLite. "One call"
  was the requirement; a round trip per click is not it.
- **`criticalPath` keeps the name, `metric` keeps it honest**, and `nodeIds`
  keeps it drawable.
- **Fan-out is exposed here, not deferred.** `dependentClosure` already exists and
  the decision ranking is meaningless without it.
- **Groups support multiple repositories.** Constraining an objective to exactly
  one repository, or promoting repository to objective metadata, are both schema
  changes and belong in their own epic. Today the binding is per task, so a group
  reports what its own tasks actually name.
- **The cross-project decision inbox is a separate epic.** It takes no id at all,
  needs a cross-project ranking, and builds on `list project` from EPIC 011 — a
  different shape from this epic's two id-taking queries.
- **The diff query is a separate epic.** It needs a new SCM read model.

## Non-goals

- **No UI and no HTTP.** This widens the CLI + use-case surface only.
- **No diff query and no SCM read model.**
- **No cross-project decision inbox.**
- **No new event types and no third change to the `events` table.** The hazard
  notes at `.agent/plan/stories/011-client-discovery-surface/03-…:19-24` and
  `.agent/plan/stories/013-lease-fenced-run-recovery/05-…:33-44` are binding: a
  verbatim column copy in a table rebuild silently drops another epic's column.
- **No auto-acknowledge, no "mark all read", no notification delivery.**
- **No duration model, estimates, or time-weighted critical path.**
- **No per-attempt history.** One `task_results` row exists per task, so an
  attempt timeline needs a new table — a separate epic, not a silent omission.
- **No per-task repository binding.** See the OPEN above.
- **No mutation of any kind from `get graph` or `get overview`.**
