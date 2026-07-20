# EPIC 007.3 — completion accounting & real landing · story index

Epic: `.agent/plan/epics/007.3-completion-accounting.md`
Findings (input): the same epic file's Appendix (post-007.2 E2E, debate-hardened).

**Authoring status (2026-07-20 — EXPANDED).** One coupled bug-fix epic: **F2**
(token/cost accounting hardcoded `0`) + **F3** (a _changed_ `generic@1` task
`completed`s without landing to the canonical branch). Stories follow the repo
convention: vertical slices, each carrying its own end-to-end assertion; the
final proof is the epic's two-part Proof block.

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. Dispatched through `/work` (engineer lanes). One story per
file; one use case per file (verb-first), per `AGENTS.md`.

> **F4 removed from 007.3 (Ulrich, 2026-07-20).** The `login` / `create project`
> reshape is NOT CLI-only — it needs a resource-management refactor (login is
> project-scoped credential creation; the DB project resource is the only
> credential store). That is its own big epic, authored later — not a story
> here. 007.3 is F2 + F3 only.

## Surfaces re-verified at expansion (2026-07-20, working tree — 4 read-only sweeps)

- **Migrations top out at version 7** (`epic-007.1-e2e-hardening`,
  `src/storage/sqlite/migrations.ts:165-231`). It already created
  `landing_candidates` (`id, task_id, repo_id, base_sha, candidate_sha, ref,
target, state`), `landing_integrations` (`candidate_id, outcome, canonical_sha,
merge_commit, conflict_files`; `outcome CHECK IN ('fast-forward','merge',
'conflict')`), and `repo_locks`. **007.3 targets ZERO new migrations** — it
  wires and fixes existing tables/ports. Slot 8 stays unused unless a TDD step
  proves a column is genuinely missing (then it is migration 8, coordinated at
  that moment).
- **F2 — `src/agent-runner/pi.ts`:** the `agent.finished` emit is
  `pi.ts:326-332`; `turns` is real (`turnCountRef` at `:324`, incremented in the
  `turn_end` subscriber at `:485-492`), but `tokensIn: "0", tokensOut: "0"` are
  literal. The file has **zero** reads of model usage. The emit is via the
  injected callback `this.#emit(taskId, type, payload)`.
- **F2 — pi `Usage`** (`node_modules/@earendil-works/pi-ai/dist/types.d.ts:248-269`):
  `{ input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens,
cost{…} }`. **`reasoning` is a subset of `output`** and **`cacheWrite1h` is a
  subset of `cacheWrite`** — neither is added separately. `AssistantMessage.usage:
Usage` (`:285`). The `turn_end` event carries `message: AgentMessage` (the
  assistant message for that turn) — usage is reachable per turn there.
- **F2 — the algorithm to mirror** is pi-coding-agent `getSessionStats()`
  (`…/pi/packages/coding-agent/src/core/agent-session.ts:3023-3076`): sum
  `usage.input / output / cacheRead / cacheWrite` across `role==="assistant"`
  entries; `reasoning` and `cacheWrite1h` are NOT summed separately.
- **F2 — daemon line:** `run-daemon.ts:93-95` logs one `task <id>: <outcome>`
  line; the emit callback (`composition.ts:285-297`) handles `agent.started` and
  `task.verification` but has **no `agent.finished` branch** — Story 2 adds one.
- **F3 — `TaskResult`** (`src/agent-runner/port.ts:20-38`): `completed | failed |
escalated` only. **No `candidate` outcome, no token/turn fields.** `escalated`
  already carries `{ workspace, branch, baseCommit, proposalCommit? }`.
- **F3 — no-change contract** (`src/agent-runner/pi-profile.ts:41-74`):
  `genericProfile.verify()` returns `accepted` when `finalDiff.hasChanges`, else
  `rejected` `NO_CHANGES`. `OutcomeEvidence = { baseCommit, finalDiff{files,
hasChanges}, finalResponse }`. There is **no** `tddProfile` (only a `tdd@1`
  binding-spec entry).
- **F3 — completion path** (`src/app/task/run-next-task.ts:127-159`): ONE
  `uow.transaction`; the `completed` arm always writes `baseCommit: null,
proposalCommit: null` and creates **no** candidate. `escalated` arm
  (`:160-187`) is the only one writing non-null base/proposal.
- **F3 — Task statuses** (`src/domain/task.ts:4-13`): `pending, running,
completed, failed, awaiting_confirmation, discarded`. **No `conflict`, no
  `escalated` status** (`escalated` is a `TaskResult.outcome` → `running →
awaiting_confirmation`). Legal transitions include `awaiting_confirmation →
{completed, pending, discarded}` (`:85-95`).
- **F3 — landing already shipped** but disconnected:
  - `src/landing/port.ts` (whole file): `LandingCandidate { id, taskId|null,
repoId, baseSHA, candidateSHA, ref, target, workspace }`, `LandingOutcome`
    (`fast-forward|merge|conflict|already-landed`), `LandingResult`,
    `LandingConflictError`, `RepositoryLanding.land(homeDir, candidate)`.
  - `src/landing/git.ts`: `GitRepositoryLanding(lockDir, landing, gitConfig)`;
    file-lock acquire/release (`:44-73`, `:227-235`); already-landed check
    (`:109-127`); crash-idempotent save (`:129-143`); ff/merge classification
    (`:145-182`) — merge runs in `cwd: homeDir`; persist outcome AFTER git
    mutation (`:214-224`) → conflict integration + reconcile-on-retry gaps.
  - `src/storage/sqlite/landing.ts`: `saveCandidate` uses `ON CONFLICT(id) DO
NOTHING` (`:18-36`) → a stuck-`pending` row on retry; `saveIntegration`
    upserts.
  - `src/app/task/approve-task.ts:42-72,109-139`: constructor already has an
    **optional** `landing?: RepositoryLanding` (6th arg); landing block hardcodes
    id `${taskId}-lc` (`:118`), `target: "main"` (`:124`), and passes
    `result.workspace` as `homeDir` (`:127`); `LandingConflictError` → emit
    `task.conflict`, return with task still `awaiting_confirmation` (`:132-135`).
  - `src/composition.ts`: `ApproveTask` built WITHOUT landing (`:233-239`);
    `GitRepositoryLanding` created + added to bundle but never injected
    (`:353-359`, `:437`); `LocalWorkspaceManager` built with `{ root }` only —
    no `lockDir` (`:277`).
  - `src/workspace/local.ts`: retry **wipes** the workspace (`:459-460`, and
    `:256-258`) → the candidate git objects vanish unless made durable;
    `Workspace = { dir, branch, baseCommit }`.

## Stories (build order = dependency order)

1. [F2 — real token accounting in the pi runner](01-f2-token-accounting.md) —
   aggregate `Usage` per assistant turn; emit real `tokensIn/tokensOut` on
   `agent.finished` for completed/failed/escalated runs.
2. [F2 — daemon accounting stdout line](02-f2-daemon-accounting-line.md) — add an
   `agent.finished` branch to the emit callback printing
   `agent finished: turns=… tokensIn=… tokensOut=…`. **Requires 1.**
3. [F3 — executor-neutral `candidate` result contract](03-f3-candidate-result-contract.md)
   — add the `candidate` outcome; `genericProfile` no-change → `completed`,
   changed → `candidate`; no `task.agent` inference.
4. [F3 — atomic candidate persistence in RunNextTask](04-f3-atomic-candidate-persistence.md)
   — one transaction: mint ULID candidate + metadata + `task_results` +
   `awaiting_confirmation`; filesystem-bound changed → `completed`.
   **Requires 3.**
5. [F3 — correct ApproveTask landing](05-f3-approve-task-landing.md) — inject
   `RepositoryLanding`; resolve the repo **home** (not workspace) + **configured
   branch** (not `main`); land under CAS; record `base_commit` (A7). Real-git
   ff/merge tests. **Requires 3, 4.**
6. [F3 — shared lock, durable candidate storage, crash recovery](06-f3-shared-lock-durable-crash-recovery.md)
   — wire the landing lock into `LocalWorkspaceManager`; make the candidate
   commit durable across a workspace wipe; crash-idempotent re-approve
   reconciles rows; cross-process lock-contention test. **Requires 5.**
7. [F3 — conflict lifecycle](07-f3-conflict-lifecycle.md) — abort-on-conflict,
   persist the `conflict` integration + candidate state, keep the task
   `awaiting_confirmation`; define retry / rejection / repeated-approval.
   **Requires 5, 6.**
8. [F3 — behavior-change disclosure sweep](08-f3-behavior-change-disclosure.md) —
   update every "generic means no gate" test / CLI / daemon-outcome / filesystem
   expectation to the gated behavior; explicit changelog note. **Requires 3–7.**

## Golden-test / canary bullets, distributed

- **Exact-arithmetic token test** (multi-turn fixture; each bucket once;
  `reasoning`/`cacheWrite1h` not double-counted; usage still summed on
  failed/escalated) → **Story 1**.
- **Atomicity crash test** (crash between transition and candidate write cannot
  leave a candidate-less `awaiting_confirmation`) → **Story 4**.
- **Real-git landing tests** (ff / merge onto the _configured_ branch of the
  _home_ repo; CAS on the named target) → **Story 5**.
- **Durability + crash-idempotent re-approve** (workspace wiped, re-approve still
  lands; already-landed reconciles candidate+integration rows) → **Story 6**.
- **Cross-process lock contention** (two approvals serialize; no orphan lock) →
  **Story 6**.
- **Typed conflict** (`git merge --abort`, integration row `outcome=conflict` +
  `conflict_files`, task stays awaiting; repeated approve re-attempts) →
  **Story 7**.

## Cross-epic amendments (annotate "superseded/extended by EPIC 007.3")

- **`src/agent-runner/port.ts`** — `TaskResult` gains a `candidate` outcome (F3).
- **`src/agent-runner/pi.ts`** — real token aggregation into the `agent.finished`
  emit (F2); `candidate` produced for changed work, `completed` for verified
  no-change (F3).
- **`src/agent-runner/pi-profile.ts`** — `genericProfile.verify()` no-change is
  no longer `rejected NO_CHANGES` on the completion path (F3).
- **`src/app/task/run-next-task.ts`** — new `candidate` arm persisting the
  candidate atomically; changed repository-bound task → `awaiting_confirmation`
  (F3).
- **`src/app/task/approve-task.ts`** — lands the pre-persisted candidate onto the
  repository's configured branch of its canonical home (F3).
- **`src/composition.ts`** — inject `RepositoryLanding` into `ApproveTask`; give
  `LocalWorkspaceManager` the shared `lockDir`; add the `agent.finished` daemon
  line (F2/F3).
- **`src/workspace/local.ts`** — candidate git objects made durable across the
  retry wipe (F3).
- **NO `Task.agent → Task.executor` rename** (EPIC 008 owns it) — stories keep
  the current `agent` field name.
- **NO `login` / `create project` change** (F4) — deferred to a future
  resource-management epic (Ulrich, 2026-07-20).
