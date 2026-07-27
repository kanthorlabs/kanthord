# EPIC 017 — Decision workbench: cross-project queue, guidance channel, impact preview

> Routine 3, "cooperating with agents". The loop the engineer runs many times a
> day: review queue → evidence → verdict → guidance → agent re-runs → queue.
> Designed 2026-07-27 from the routine brief plus an adversarial debate on this
> epic's own draft, which caught eight real defects: a second actionability state
> table hiding behind "one module", a proof whose claimed single failure point was
> unreachable, two mutually contradictory proof phases, a `--yes` path that could
> mutate without naming damage, a staleness rule that cannot discriminate a cause
> it claimed to discriminate, an impact model that overstated initiative damage,
> a `verdicts: string[]` regression from EPIC 016's structured actions, and a
> use-case-calls-use-case architecture violation.
>
> **Depends on EPIC 016** (`src/domain/actionability.ts`, `downstream` fan-out,
> node detail), **EPIC 011 stories 1, 3 and 4** (`list project`,
> `events.projectId`, `list event --project`), and **EPIC 012**
> (`--expected-commit`, REQUIRED on objective verdicts).

## Goal

The engineer answers "what needs me, in what order, and what breaks if I say no"
without hunting. `kanthord queue` ranks every decision across **all** projects by
impact; each item carries the evidence to decide, the state-specific verdicts
that the program actually accepts, and a runnable inspect handle. Guidance flows
back through one consolidated note that **is actually persisted** — today it is
not. Every destructive verdict names the downstream damage before it commits, and
binds the confirmation to the state that was previewed.

## Scope was cut by what EPIC 016 already owns

EPIC 016 is authored **and expanded into 7 stories**
(`.agent/plan/stories/016-project-graph-read-model/`). This epic **imports** the
following and must never respecify or fork it:

- `src/domain/actionability.ts` — the closed `Action` vocabulary and the action
  table (016 epic:92-132, story 02).
- `downstream: number` per node, from the existing `dependentClosure`
  (`src/domain/graph.ts:157`).
- Node detail: `verificationRequested`, `verificationResults`, `failureReason`,
  `rejection`, `produced`, `candidate` (016 epic:134-155).
- `actionableSince` as the ULID time of the event that made the item actionable,
  never the entity id (016 epic:263-269).
- The ranking rule — `downstream` desc, then `actionableSince` asc, then lowest
  id (016 epic:270-272) — applied there **per project**, inside `get overview`.

EPIC 016 epic:436-438 states: "The cross-project decision inbox is a separate
epic. It takes no id at all, needs a cross-project ranking, and builds on
`list project` from EPIC 011." **That is this epic.**

So this epic adds exactly four things EPIC 016 does not have:

1. the **cross-project** ranked queue (no id argument);
2. a **working** guidance channel — it is broken today, see D1/D2;
3. the **impact preview** bound to a destructive verdict;
4. the **objective conflict contract**.

## Facts verified against the current tree (2026-07-27)

- Schema head is **26** (`008.4-s-provider-failover-event`,
  `src/storage/sqlite/migrations.ts:763-764`). EPICs 011, 013, 014 and 016 all
  append migrations. **Pin the migration name; derive `version` as last + 1.
  Never hardcode a number.**
- `events` has 7 columns and **no timestamp** (`migrations.ts:771-784`). Ids are
  real ULIDs (`monotonicFactory`, `src/domain/entity.ts:1-14`), so every time
  value in this epic is `decodeTime(id)`.
- `task_results` holds `task_id, workspace, branch, base_commit,
proposal_commit, commit_sha, summary, reason, rejection_resolution,
rejection_reason, evidence` (`migrations.ts:186-198`). Candidate identity
  exists; **no diff**.
- `Task.note` is one optional field (`src/domain/task.ts:24-25`), overwritten on
  each retry. **No feedback-history table exists in any of the 26 migrations.**
- `get task --json` emits `note` only when set, and **omits the key entirely**
  when unset (`src/app/task/get-task.ts:97`). Assertions must test key absence,
  not `null`.
- The only feedback channels are `retry task --note`
  (`src/apps/cli/commands/retry/task.ts:13`), `retry objective --note`
  (`src/apps/cli/commands/retry/objective.ts:13`), and
  `reject task --resolution --reason` (`src/apps/cli/commands/reject/task.ts:14-17`).
  Confirmed: nothing else.
- `apps/` declares local structural mirrors rather than importing ports
  (`src/apps/cli/deps.ts:63-78`). `eslint-plugin-boundaries` enforces it.
- `RepositoryLanding` has **`preview` and `landPreviewed` only**
  (`src/landing/port.ts:67-78`). There is **no diff method**. `PreviewOutcome`
  carries `perFile: {path, hunks}[]` but **only inside the `conflict` outcome**
  (`port.ts:44-60`) — the case where the candidate does _not_ apply.
- Since 007.12 a workspace-bound task is transitioned straight to `completed` by
  `RunNextTask` (`src/app/task/run-next-task.ts:365-402`). Task-level
  `awaiting_confirmation` is reachable by **two** paths, not one: the `escalated`
  outcome (`:404-432`) and the `candidate` outcome with a `repository` binding and
  no `workspace` binding (`:470-507`). Only the second persists a
  `ChangeCandidate`, and only the second makes `get conflict --id` resolvable.

### Four findings that change the design

**D1 (defect — this epic's first story). `retry task --note` silently discards
the note when the task is `failed`.** `RetryTask.execute` persists `note` only in
the `awaiting_confirmation` branch (`src/app/task/retry-task.ts:97-126`, write at
`:102`). The `failed` branch saves `transitionTask(task, "pending")` with **no
note** (`retry-task.ts:133-140`). `failed` is precisely the "operational failure
→ Retry with guidance" verdict. Today the CLI accepts `--note`, exits 0, and the
guidance is thrown away. **The channel this whole routine depends on does not
work.** Fixing it is story 1 and is the Proof's first phase.

**D2 (defect). `retry objective --note` reaches zero tasks in the normal case.**
The fan-out loop skips `completed` and `discarded` tasks and runs **only inside
the gate-passed branch** (`src/app/objective/retry-objective.ts:157-175`). Per
007.12 every task under a retryable objective is already `completed`, so the note
fans to **nobody**. When the gate fails, the note is dropped entirely
(`retry-objective.ts:179-182`).

**D3 (resolved by decision, not deferred). "Objective candidate → Request
changes" is removed from the verdict model.** Making it real requires re-running
completed tasks, and **`completed->pending` is not in `LEGAL_TRANSITIONS`**
(`src/domain/task.ts:97-107`); adding it touches completion accounting (007.3),
landing candidates, and content-SHA restamping (007.18). **Decision (human,
2026-07-27): objective candidates carry `Integrate` / `Discard` only.**
`decisionActions` must not emit a request-changes verdict, and a test asserts it
appears nowhere — so no client offers a button that no-ops. "I want changes" is
served by Discard plus a new objective. See the OPEN below.

**D5 (defect, found by debate). Persisting a conflict field without clearing it
creates stale data.** `transitionObjective` returns `{ ...objective, status: to }`
(`src/domain/initiative.ts:91-101`), so every diagnosis field survives a
transition. `Objective.conflictReason` is written on the gate-failure path
(`src/app/objective/retry-objective.ts:180`) but exists in **neither** the
`objectives` DDL (last rebuilt by migration 19, `migrations.ts:528-541`, 7
columns) nor the repository SQL — so it is silently discarded today. The moment
story 1 persists it, a **resolved** objective would keep reporting the conflict
cause and a stale failure reason. So story 1 both persists the fields **and**
clears `conflictCause`, `observedTipOid` and `conflictReason` when a conflict
resolves, via a pure `clearConflictDiagnosis`. `note` is deliberately kept — it is
guidance, not diagnosis. A workbench showing an obsolete failure reason is worse
than one showing none.

**D4. `dependentClosure` is task-scoped only.** It walks
`GraphNode.dependencies` (`src/domain/graph.ts:157-186`). Objective and
initiative edges are separate (`unsatisfiedObjectiveEdges` /
`unsatisfiedInitiativeEdges`, `src/domain/sequencing.ts:31-62`). The impact
preview needs **both**, because `reject objective` cascades to the initiative
(`src/app/objective/reject-objective.ts:84-102`) while the nodes that become
unsatisfiable are downstream **objectives**.

## Decision 1 — the diff read model is NOT in this epic

**Decided: excluded, and the accept path is constrained so nothing pretends
otherwise.**

Reasons:

- A real diff read model is a new `RepositoryLanding` port method, a git adapter,
  redaction, binary detection and truncation. **`preview` cannot be reused**: it
  returns per-file hunks only in the `conflict` outcome
  (`src/landing/port.ts:44-60`), which is by definition the case where the
  candidate does not apply. There is no clean-diff path to borrow.
- This epic already carries a live defect fix (D1), a cross-project query, an
  impact model over two edge kinds, and the conflict contract. Adding an SCM read
  model roughly doubles it and delays the guidance fix — the thing that is broken
  right now.

**The "no approve without a diff" finding is honoured, not waived.** kanthord
already knows every identity a `git` command needs, so every reviewable element
carries:

```ts
evidence: {
  /** Closed vocabulary. States the limit of what was actually reviewed. */
  basis: "verification-and-summary";
  /** Literal `false` until the diff epic lands. Required, never omitted. */
  diffAvailable: false;
  /** Structured — NEVER a shell string. `null` when unusable (see below). */
  inspect: { executable: "git"; args: string[] } | null;
}
```

For an objective, `args` is
`["-C", homeDir, "diff", `${parentOid}..${commitOid}`]`, from
`resolveHomeDir(initiativeId)` (`src/app/objective/approve-objective.ts:63`) and
`Objective.parentOid` / `commitOid` (`src/domain/initiative.ts:32-35`). For a
task candidate it is `base_commit`..`commit_sha` from `task_results`.

Binding sub-decisions:

- **Structured `args[]`, never a command string.** A `homeDir` containing a space
  or a shell metacharacter makes a single string unsafe to execute and unsafe to
  render. Text output renders it shell-escaped for copy-paste; JSON consumers get
  the array and never execute a concatenated string.
- **`inspect` is `null` when it would not run** — either OID missing/not a
  40-hex-or-abbreviated git OID, or the commit is not present in the named home.
  Offering an unrunnable command is worse than offering none.
- **The epic ships no `Integrate` presentation implying a diff was read.**
  `basis` and `diffAvailable: false` are required fields precisely so a later UI
  cannot quietly imply review happened.

The in-program diff read model stays its own epic.

## Decision 2 — the objective conflict contract (resolves the 3× blocker)

The blocker rested on a false premise. An **objective** conflict and a **task**
conflict are unrelated mechanisms that share a word.

**Which task owns an objective-level conflict? None — the objective owns it.**
`get conflict --id <taskId>` reads `getCandidateByTask(taskId)` and requires
`ChangeCandidate.state === "conflict"` (`src/app/task/get-conflict.ts:80-83`) —
a 007.5 task **landing** conflict with real per-file hunks.
`objective.status === "conflict"` is set by `ApproveObjective.#recordConflict`
(`src/app/objective/approve-objective.ts:135-141`) and has **no candidate row and
no task id**. Fix: add `get conflict --objective <id>` as a distinct path and
leave `--id` for tasks; the two options are mutually exclusive and exactly one is
required.

**An objective conflict is NOT a file-level merge conflict, so there are no
conflicting file paths.** It has exactly two causes, both at ref-update time:
`commitCount !== 1` (`approve-objective.ts:86-89`) and `LandingCASMismatchError`
from `casUpdateRef` (`:98-103`). Both mean _the branch moved under the squash_,
not _two edits touched one line_. **The payload must not carry a `files` key for
an objective conflict.** That assumption is what blocked this screen three times.

**The cause must be persisted, because it cannot be recomputed.** `currentTip`
is read at query time and cannot discriminate the cause: a `commitCount !== 1`
conflict can occur while the tip still equals `parentOid`, a CAS mismatch proves
the tip differed _at mutation time_ but that OID is never stored, and the branch
can move again — or back — before the query. So `#recordConflict` persists:

```ts
{ conflictCause: "non-single-commit" | "cas-mismatch"; observedTipOid?: string }
```

Live `currentTip` is then **additional evidence under an honest name**,
`tipMovedSinceAnchor: boolean` (`currentTip !== parentOid`). It is never
presented as the cause. A payload for a pre-migration row reports
`conflictCause: null` and says so.

**Can one objective have several conflict-producing candidates? No.** An
objective carries exactly one `commitOid`/`parentOid` pair, overwritten on each
retry (`retry-objective.ts:158-162`). One conflict per objective, always.

**Does `retry objective --note` fan the guidance to every requeued task? It
requeues nothing.** On a `conflict` objective it re-squashes onto the new tip and
re-runs the gate; no task is enqueued and no agent runs
(`retry-objective.ts:133-183`). The note write is a side effect reaching only
non-`completed`, non-`discarded` tasks and only on the gate-passed path — i.e.
nobody (D2). **This epic corrects the surface to match reality:** the note is
stored on the **objective** as the conflict-resolution record, on both the
gate-passed and gate-failed paths. It is **not** injected into any agent prompt,
because no agent runs on this path. Its readers are
`get conflict --objective` and the queue's evidence block.

**Discard: what breaks.** `reject objective` discards the objective's `pending`
and `failed` tasks (`reject-objective.ts:60-72`), then discards the
**initiative** iff every sibling objective is terminal and any is discarded
(`:84-102`). It never consults `unsatisfiedObjectiveEdges`, so downstream
objectives depending on it become permanently unsatisfiable **silently**. Ending
that silence is Decision 3.

## Decision 3 — one pure decision function

The debate's sharpest catch: a `verdictsFor(kindLabel)` helper would be a
**second state table** beside EPIC 016's `nodeAction`, and no grep-based test can
prove two state tables agree. "One module" is not "one function".

So `src/domain/actionability.ts` (EPIC 016's module, extended) exports one
authority:

```ts
decisionActions(context: DecisionContext): Action[];
```

- EPIC 016's `nodeAction` / `groupAction` / `initiativeAction` become **thin
  projections**: each returns `decisionActions(ctx)[0] ?? null`. EPIC 016's
  committed single-`action` contract is unchanged; only its implementation
  delegates. This is the merge that keeps one state table.
- The queue's `verdicts` is `decisionActions(ctx)` in full — **`Action[]`, not
  `string[]`**. Bare strings would drop `requiresInput`, the scoped `target`, and
  `targetDependencyId`, which is exactly the state-specific information this
  epic exists to centralise.
- `kindLabel` is **derived for display only** and is **never** a sort key
  (binding decision 5).

The complete verdict table, all five kinds, each entry reachable through a real
command today:

| `kindLabel`           | Reached when                                                 | `decisionActions` yields                                               | Required input                    |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------- |
| `task-review`         | task `awaiting_confirmation`, by **either** path — see below | `approve` task · `reject` task                                         | `resolution` + `reason` on reject |
| `operational-failure` | task `failed`                                                | `retry` task · `reject` task (`--resolution discard`)                  | `note` optional; `reason`         |
| `objective-conflict`  | objective `conflict`                                         | `retry` objective · `reject` objective                                 | `expectedCommit`; `note`          |
| `objective-candidate` | objective `awaiting_confirmation`                            | `approve` objective · `reject` objective — **no request-changes** (D3) | `expectedCommit`                  |
| `publication`         | initiative `landed`, publication `unpublished`/`diverged`    | `publish` repository                                                   | `branch`                          |

`expectedCommit` is **required, not optional**, on every objective-kind item, and
the item echoes the value so the printed command is runnable. Per EPIC 012 the
guard is REQUIRED on objective verdicts (012 epic:20-22, 42-44), so an item that
omitted it would print a command the CLI refuses.

**On the label vocabulary — the asymmetry is deliberate.** The task label is
`task-review`, not `task-candidate` (human decision, 2026-07-27): a task at
`awaiting_confirmation` may carry **no** candidate at all, because the escalated
path persists none, so "candidate" would name something that need not exist. The
objective label stays `objective-candidate`, because an objective only reaches
`awaiting_confirmation` with a `commitOid` set
(`src/app/objective/retry-objective.ts:158-162`,
`src/app/task/run-next-task.ts` objective-squash path) — there, a candidate always
exists and the word is accurate. Do not "harmonise" these two labels.

**`task-review` has two causes, and the item says which.** A task reaches
`awaiting_confirmation` from the `escalated` outcome
(`src/app/task/run-next-task.ts:404-432`) **or** from the `candidate` outcome with
a `repository` binding and no `workspace` binding (`:470-507`). The verdicts are
identical — verified, not assumed: `ApproveTask` handles a candidate-less
escalation through `#promote` and a candidate through the landing port, and
`hasPersistedCandidate` is documented there as "the precise differentiator"
(`src/app/task/approve-task.ts:161-175`, where conflating the two was the
`HUMAN_REVIEW-S2` regression). But the evidence differs, so every
`task-review` item carries `cause: "candidate" | "escalation"`, derived from
**candidate-row presence** and never from status. Only `cause: "candidate"` makes
`get conflict --id` offerable. And because the candidate path emits **no event**,
its `actionableSince` is honestly `null` — this epic does **not** add an event to
make a column non-null for sorting.

### One action authority — EPIC 016 amended, not worked around

EPIC 016 story 02 was amended on 2026-07-27 (human-approved) so that
`decisionActions(context): Action[]` holds the single rule table and
`nodeAction` / `groupAction` / `initiativeAction` are one-line projections of it.
Two consequences are binding here:

- **`resolve-conflict` is removed from `ActionKind`.** It named a problem
  category, not an operation: no CLI command is spelled "resolve conflict", and
  its `requiresInput: ["resolution"]` named a flag no objective verdict accepts.
  An objective conflict now yields concrete `retry` + `reject` verdicts.
- **No caller-dependent kinds.** An earlier draft of this epic emitted
  `resolve-conflict` through a node context and `retry` through a queue context.
  That makes an action's `kind` depend on who asked, which is precisely the drift
  the one-function rule exists to prevent. The only legitimate context-dependent
  difference is `command` presence, driven by whether `expectedCommit` is a known
  input fact.

## Decision 4 — the impact preview, bound to the verdict

`src/domain/impact.ts`, pure, zero I/O, with an **explicit typed input** — the
debate correctly noted a bare signature hides the graph and status data the rules
need:

```ts
type DiscardTarget =
  | { type: "task"; id: string }
  | { type: "objective"; id: string };

interface ImpactInput {
  target: DiscardTarget;
  tasks: { id: string; title: string; objectiveId: string;
           status: TaskStatus; dependencies: string[] }[];
  objectives: { id: string; name: string; initiativeId: string;
                status?: ObjectiveStatus; after: string[] }[];
  initiatives: { id: string; name: string;
                 status?: InitiativeStatus; after: string[] }[];
}

type Effect = "discarded-by-cascade" | "permanently-unsatisfiable" | "left-blocked";

type Damage = {
  target: { type: "task" | "objective" | "initiative"; id: string; name: string };
  effect: Effect;
};

previewDiscard(input: ImpactInput):
  { damage: Damage[]; counts: Record<Effect, number>; digest: string };
```

Rules, each traceable to a cite:

- **`discarded-by-cascade`** — for a task: the `pending` members of
  `dependentClosure` (`src/app/task/reject-task.ts:160-175`). For an objective:
  its `pending` and `failed` tasks (`reject-objective.ts:60-72`), **plus** the
  initiative only when the all-siblings-terminal-and-any-discarded rule actually
  fires (`:84-102`).
- **`permanently-unsatisfiable`** — objectives and initiatives whose `after`
  edges name a node that this discard makes terminal, via
  `unsatisfiedObjectiveEdges` / `unsatisfiedInitiativeEdges` reporting
  `neverSatisfies: true` (`src/domain/sequencing.ts:31-62`), computed
  transitively. **Initiative dependents qualify only when the initiative is
  actually cascaded to `discarded`** — not merely because one of its objectives
  was. The debate caught this overstatement; asserting damage that will not
  happen destroys trust in the preview as fast as asserting none.
- **`left-blocked`** — non-`pending` dependents that the cascade _skips and
  reports_ (`reject-task.ts:172-178`). Not discarded, not permanent. Naming them
  separately stops the preview overstating.

**Precedence and dedup are explicit and tested:** one target appears **once**,
and where it qualifies for several effects, `discarded-by-cascade` dominates
`permanently-unsatisfiable`, which dominates `left-blocked`. `damage` is sorted
by effect precedence, then by id.

**Preview and mutation call the same function.** `RejectTask` and
`RejectObjective` compute their cascade plan _from_ `previewDiscard`, so preview
text and real cascade cannot drift.

### The confirm protocol (binding decision 4, tightened)

The debate showed that separate `--dry-run` / `--yes` flags let
`reject objective … --yes` mutate **without naming damage**, which breaks the
binding rule, and left a TOCTOU window that `--expected-commit` does not cover
for tasks. So:

1. **Every destructive invocation computes and prints the structured damage
   first.** There is no path that mutates silently. `--yes` suppresses the
   interactive prompt only — never the damage output.
2. Without confirmation the command **exits 0 and writes nothing**.
3. Confirmation binds to that exact preview via `--expect-impact <digest>`, the
   `digest` returned by `previewDiscard` (a stable hash over the sorted `damage`).
4. The mutation **recomputes `previewDiscard` inside the same
   `UnitOfWork.transaction`** and refuses on mismatch — the same
   inside-the-transaction discipline EPIC 012 applies to `--expected-commit`
   (012 epic:35-38). This is the only guard `reject task` has, since it carries no
   `--expected-commit`.
5. `--dry-run` remains as the explicit no-write form and is **mutually exclusive**
   with `--yes`.

`reject objective --dry-run` still **requires** `--expected-commit` and validates
it **before** printing, so a preview can never describe a state the verdict would
refuse.

## Decision 5 — the cross-project queue

`kanthord queue [--json]`, taking **no id**. A new verb, because it is not scoped
by a parent the way every `get` / `list` leaf is.

```ts
{
  items: [{
    verdicts: Action[];                   // decisionActions(ctx), in full
    kindLabel: "task-review" | "operational-failure" | "objective-conflict"
             | "objective-candidate" | "publication";   // display only
    projectId: string; projectName: string;
    initiativeId: string; objectiveId?: string; taskId?: string;
    downstream: number;
    actionableSince: number | null;
    evidence: { basis; diffAvailable; inspect };
    expectedCommit?: string;              // REQUIRED on objective kinds
  }];
  counts: { total: number; byKind: Record<string, number> };
  truncated: boolean;
}
```

- **Ranking is EPIC 016's rule, reused verbatim**: `downstream` desc, then
  `actionableSince` asc (longest-waiting first), then lowest id. `kindLabel`
  never affects order.
- **No use case calls another use case.** The debate caught that "reuse
  `GetInitiativeGraph`'s node assembly" violates AGENTS.md. Instead the shared
  work is a **pure domain projection** — `projectDecisions(graphInput): DecisionItem[]`
  in `src/domain/decision-queue.ts` — fed by read-only sources. `GetDecisionQueue`
  iterates projects from `listProjects()` (EPIC 011 story 1) and calls the
  projection; `GetProjectOverview` (016 story 06) may call the same projection.
  Fan-out is never re-implemented.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **D1 regression, stated as the failing case.** `RetryTask.execute({taskId,
note})` on a **`failed`** task persists `note` on the saved entity — asserted
  on the saved task, not on exit code. Both branches share one note-resolution
  helper so they cannot drift again.
- **Carry-forward is off by default** (binding decision 3). Retrying with **no**
  `--note` on a task that already has one **clears** it. Asserted explicitly in
  both branches, because `note: note ?? undefined` (`retry-task.ts:102`) already
  behaves this way in the `awaiting_confirmation` branch and the two must agree.
  `--carry-note` is the opt-in that preserves it; it reads the current
  `Task.note` only and stores no history. Both directions tested.
- **D2 / objective note.** `retry objective --note` on a `conflict` objective
  stores the note on the **objective**, independent of task status. Tested with
  every task `completed` — the case that reaches zero tasks today — **and** on
  the gate-failed path, where the note must still persist.
- **Conflict diagnosis is cleared when the conflict resolves (D5).** A conflict
  objective carrying `conflictCause`, `observedTipOid` and `conflictReason`, retried
  with a passing gate → the saved objective has **none** of those three keys and
  still has `note`, `commitOid` and `parentOid`. Conversely a gate failure keeps
  them. And driving an objective into a **new** conflict drops any
  `conflictReason` from an earlier gate run. Without these, persisting the fields
  would trade a silent-loss bug for a stale-data bug.
- **One guidance rule for both retry branches.** `retryTaskWithGuidance` is pure
  and tested directly: explicit note replaces; absent note **omits the key**
  (not `undefined` — `exactOptionalPropertyTypes`); `carryNote` preserves; a
  `completed` task still throws `IllegalTransitionError`. Note that the `failed`
  branch **currently** preserves an old note by accident, through
  `transitionTask`'s spread — the clearing half of the fix is a deliberate
  behaviour change and carries its own named test.
- **Conflict cause is persisted, not inferred.** `#recordConflict` writes
  `conflictCause` for both causes: a `commitCount !== 1` case and a
  `LandingCASMismatchError` case, with `observedTipOid` captured on the CAS path.
  A test asserts `tipMovedSinceAnchor` is **never** used to derive
  `conflictCause`, and that a row with no persisted cause reports `null` rather
  than guessing.
- **`previewDiscard` is pure, and each effect is tested separately:** a task with
  a mixed dependent closure (`pending` → `discarded-by-cascade`, `running` →
  `left-blocked`); an objective whose discard leaves a downstream objective
  `permanently-unsatisfiable`; an objective discard that trips the initiative
  cascade **and one that does not**, proving initiative dependents are not
  claimed when the initiative survives; a leaf discard with empty `damage` and
  every count `0`; and a target qualifying for two effects appearing **once**
  under the dominant one. `left-blocked` is never conflated with
  `permanently-unsatisfiable`.
- **Preview and mutation share the function.** `RejectTask` / `RejectObjective`
  derive their cascade from `previewDiscard`; a test that changes a
  `previewDiscard` rule and observes the cascade change proves they are not two
  implementations.
- **The confirm protocol.** Damage is printed on **every** destructive
  invocation, including with `--yes` — asserted on stdout. Without confirmation,
  nothing is written (store whose write methods throw, plus the Proof
  fingerprint). A **stale** `--expect-impact` digest is refused **inside** the
  transaction with no mutation. `--dry-run` with `--yes` is a usage error.
- **`--dry-run` on an objective without `--expected-commit` is a usage error**,
  and with a stale `--expected-commit` is refused **before** any preview text is
  printed.
- **D3 cannot leak.** `decisionActions` for `objective-candidate` yields exactly
  `approve` and `reject`. A test asserts no `Action` anywhere carries a
  request-changes kind, and that the `Action` `kind` union has no such member.
- **One state table.** `nodeAction`, `groupAction` and `initiativeAction` each
  return `decisionActions(ctx)[0] ?? null` — asserted by the table-driven
  equivalence test in EPIC 016 story 02, extended with this epic's two new task
  rows rather than duplicated. A reviewer must be able to confirm that none of the
  three projections contains an `if`, a `switch` or a template literal.
- **`resolve-conflict` appears nowhere** — not in `ActionKind` (six members), not
  in a returned action, not in a test literal.
- **`cause` is derived from durable facts.** An `awaiting_confirmation` task with a
  persisted candidate row reports `cause: "candidate"`; without one,
  `"escalation"`. Both causes produce `deepEqual` verdicts, proving `cause` never
  enters `decisionActions`. A counting source proves the candidate lookup happens
  only for `awaiting_confirmation` tasks.
- **Queue ranking.** `downstream` desc, then `actionableSince` asc, then id, with
  one deliberate tie at each level, plus a case proving `kindLabel` does not
  affect order (a `publication` outranks an `objective-candidate` when its
  fan-out is higher).
- **`evidence.diffAvailable` is literally `false` everywhere**, `inspect` is
  structured `{executable, args}`, and `inspect` is `null` exactly when an OID is
  missing, malformed, or absent from the named home.
- **Reads write nothing.** `queue` and `get conflict --objective` take read-only
  sources.
- **`get conflict --objective` on a non-conflict objective** exits non-zero with a
  message naming the actual status — never an empty overview. **`get conflict`
  requires exactly one of `--id` / `--objective`**; both, or neither, is a usage
  error.

### Proof

`scripts/e2e/decision-workbench-proof.sh` — deterministic, no model, no network
beyond local `file://` remotes, no daemon left running. `expect_fail` copied
verbatim from `scripts/e2e/project-readiness-proof.sh:24-31`. Run from the repo
root:

```bash
scripts/e2e/decision-workbench-proof.sh
```

It must print `017 ok: …`.

**Against the current tree it fails at phase A, on the D1 note regression.** The
phase order is load-bearing and was corrected by the debate: phases A–B use
**only wiring that exists today** (`import graph`,
`run daemon --until-idle --fail`, `retry task --note`, `get task --json`), so the
first failure is a real behavioural defect rather than a missing command. Every
later phase depends on commands this epic introduces and is unreachable until
then — which is the normal state of a pre-implementation proof, and is stated
here rather than being claimed to pass.

Phases:

- **A** — **the D1 proof, first.** After `run daemon --until-idle --fail <root>`,
  the root is exactly `failed`. Then `retry task --id <root> --note "use the
anchor"` and `get task --id <root> --json` reports `note` exactly `"use the
anchor"`. **This is the single failure point against the current tree** — the
  note is dropped by `retry-task.ts:133-140`. The phase first asserts the task
  really reached `failed`, so a broken fixture cannot be mistaken for the defect.
- **B** — carry-forward default, still on existing wiring: fail the root again,
  `retry task --id <root>` with **no** `--note`, and the `note` **key is absent**
  from the JSON (not `null` — `get-task.ts:97` omits it). Then `--carry-note`
  after re-setting a note leaves it unchanged.
- **C** — `queue --json` on a fresh database: `counts.total` is exactly `0` and
  `items` is `[]`, matched on parsed JSON so a missing command fails here rather
  than false-greening on empty output.
- **D** — `queue --json` after the failure: the root appears **exactly once** with
  `kindLabel: "operational-failure"`, `verdicts` naming exactly `retry` and
  `reject` with their targets, `downstream` equal to the real dependent count, and
  `evidence.diffAvailable` exactly `false`.
- **E** — impact preview and the confirm protocol:
  `reject task --id <root> --resolution discard --dry-run` prints the four
  dependents as `discarded-by-cascade`, exits 0, and a full-table fingerprint is
  **byte-identical** before and after. Then the same verdict with `--yes` but a
  **stale** `--expect-impact` digest is refused with no mutation. Then with the
  correct digest it proceeds, prints the damage even under `--yes`, and the four
  dependents are exactly `discarded`.
- **F** — objective conflict, built the only way it is reachable: two objectives
  in one initiative, integrate the second so the branch tip moves, then
  `approve objective --id <first> --expected-commit <oid>` records
  `objective.conflict` through the `commitCount !== 1` path
  (`approve-objective.ts:86-89`). `get conflict --objective <first> --json` then
  reports `conflictCause: "non-single-commit"`, `parentOid`, `commitOid`,
  `currentTip`, `tipMovedSinceAnchor: true`, and **no `files` key**. Its
  `inspect.args` are **executed** and must exit 0 — a proof that prints an
  unrunnable command proves nothing.
- **G** — `get conflict --id <taskId>` for a task under that objective exits
  non-zero (`no conflict candidate found`), proving the task and objective paths
  are distinct and the task path was not silently repurposed. `get conflict` with
  neither option, and with both, are each usage errors.
- **H** — objective guidance: `retry objective --id <first> --note "resolve at the
new tip"`. The note is read back from the **objective** with every task still
  exactly `completed`. Because a successful retry moves the objective to
  `awaiting_confirmation` — which `get conflict --objective` refuses by contract —
  the note is read via `get objective --json`, and the conflict is **explicitly
  recreated** before any later phase asserts a conflict again. (The draft's
  phases H and I contradicted each other on exactly this point.)
- **I** — cross-project ranking: a **second project** is created and driven to a
  failure, so the "no id argument" claim is actually exercised — a one-project
  proof cannot distinguish a cross-project queue from a per-project one. Items
  from both projects appear in one `queue --json`, ordered by `downstream` then
  `actionableSince`, with `counts.byKind` matching.
- **J** — no-write fingerprint: for every table in `sqlite_master`, `SELECT *`
  ordered by `rowid` is hashed, and the concatenation of all table digests is
  captured before and after running `queue`, `get conflict --objective` and both
  `--dry-run` verdicts five times. The two fingerprints must be byte-identical.
  Row counts alone would miss an in-place `UPDATE`, and `PRAGMA data_version` is
  only meaningful compared on one open connection — across separate CLI processes
  it proves nothing.

Every assertion compares an exact expected value. No `!= missing`, no `grep -q`
on a substring that a missing command would also satisfy.

**Not provable at program level:** the `cas-mismatch` conflict cause. Reaching it
needs a concurrent ref update between `countCommitsSince` and `casUpdateRef`
(`approve-objective.ts:80-104`), which no sequential CLI invocation can stage.
It is covered hermetically only, and the Proof asserts the
`non-single-commit` cause. Recording this beats a proof phase that pretends to
reach a race.

## Stories

1. **Fix the guidance channel (D1 / D2 / D5).** Both `RetryTask` branches call one
   pure domain operation `retryTaskWithGuidance` (`src/domain/task.ts`), so the
   transition-plus-guidance invariant cannot drift again; `--carry-note` is the
   opt-in and an absent `--note` clears. A migration named
   `017-objective-decision-metadata`, **`version` derived as last + 1**, adds
   `note`, `conflictCause`, `observedTipOid` and `conflictReason` to `objectives`
   by `ALTER TABLE`. `RetryObjective` stores the note on the objective on **both**
   gate paths and calls `clearConflictDiagnosis` when the conflict resolves;
   `ApproveObjective.#recordConflict` persists the cause and drops any stale
   reason.
2. **`src/domain/impact.ts` — `previewDiscard`.** Pure, the explicit typed input,
   three effects, stated precedence and dedup, and the stable `digest`. Zero I/O.
3. **The confirm protocol on `reject task` and `reject objective`.** Damage always
   printed; `--dry-run` / `--yes` / `--expect-impact`; digest revalidated inside
   the transaction; both verdicts derive their cascade from `previewDiscard`; the
   012 `--expected-commit` guard validated before any preview prints.
4. **`decisionActions` in `src/domain/actionability.ts`.** The single state table;
   EPIC 016's three functions become projections of it; the five-kind verdict
   table; no request-changes kind (D3); the both-entry-points equivalence test.
5. **`src/domain/decision-queue.ts` — `projectDecisions`.** The pure projection
   shared by `GetDecisionQueue` and `GetProjectOverview`, so no use case calls
   another and fan-out is computed once.
6. **`GetDecisionQueue`** — `src/app/project/get-decision-queue.ts`,
   cross-project over `listProjects()`, read-only, plus `queue [--json]` as a CLI
   leaf with structural deps mirrored locally per `src/apps/cli/deps.ts:63-78` and
   the `Usage` + `Example` help the architecture test requires.
7. **`get conflict --objective <id>`** — `GetObjectiveConflict` implementing
   Decision 2, mutually exclusive with `--id`, with the structured `inspect`
   payload and no `files` key.

## OPEN blockers

- **`OPEN:` "objective candidate → Request changes" needs `completed->pending`.**
  Resolved for this epic by human decision (D3): objective verdicts are
  `Integrate` / `Discard` only. Making request-changes real is its own epic and
  must carry completion accounting (007.3), landing candidates and content-SHA
  restamping (007.18) with it.
- **`OPEN:` no feedback history.** `Task.note` and the new `Objective.note` are
  single overwritable fields (binding decision 3 accepts this). "What did I ask
  last time" is unanswerable. A `task_feedback` table is its own epic.
- **`OPEN:` the `cas-mismatch` conflict cause is not reachable from the CLI.** See
  the Proof note. A deterministic hook to stage the race is its own small epic.

## Non-goals

- **No UI and no HTTP.** This widens the CLI + use-case surface only.
- **No diff read model and no `RepositoryLanding.diff`.** Decision 1.
- **No chat surface, no live steering, no interrupt.** Binding decision 1 — the
  program can deliver neither.
- **No inline per-line review comments.** Binding decision 3.
- **No re-specification of EPIC 016's action table, node detail, fan-out, or
  per-project `decisions[]`.** This epic imports them.
- **No new event types and no change to the `events` table.** The hazard notes at
  `.agent/plan/stories/011-client-discovery-surface/03-denormalise-event-project-id.md:19-24`
  and
  `.agent/plan/stories/013-lease-fenced-run-recovery/05-task-abandoned-event-type-and-migration.md:33-44`
  are binding: a verbatim column copy in a table rebuild silently drops another
  epic's column.
- **No `completed->pending` transition.** See the OPEN.
- **No per-attempt history table.**
- **No second recovery path for a hung run.** EPIC 013's `abandon task` is it.
- **No cross-project _graph_.** The queue is a decision list, not a DAG.
