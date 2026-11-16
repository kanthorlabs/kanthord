# Worker node execution: chain design

Status: design proposal for the EM, after one independent review (`review.md` in this directory). No code and no page changes yet.
Sources: `facts.md` in this directory, and the engine code at `engine/src/worker/unit/` and `engine/src/apps/worker/` at engine commit `2797a453`. This document names each code fact that it adds to `facts.md`, with its file.

Code facts added to `facts.md`:

- `ExecutionRun.halt` cancels `operationContext` with the stop. `stopOnEnd` aborts the pi session on that cancel (`native-method.ts`). A revoke from a timer thus aborts a model turn and a verification command at once.
- The verification runner stops at the first command that does not pass (`verification.ts:414`).
- Push is a fast-forward `git push origin refs/heads/<b>:refs/heads/<b>` (`repository/connector.ts:665`).
- The release obligation of the Mission Service accepts any evidence of the execution whose repository assets cover the binding set (`mission/transitions.ts` `hasEvidence`). The reviewer takes the newest support evidence with a repository asset as the snapshot (`evaluation-input.ts` `snapshotOf`). A new evidence with repository assets thus changes both rules.
- `prepareStepsWorkspace` reads `.kanthord/affected-tests.json` at `origin/<base>` and skips an invalid file. `runAffected` stops with `environment_failed affected_invalid` only in the release gate, after every agent turn (`affected.ts:826-839`).
- One slot runs per instance (`worker-service.impl.md`, the tree pool). An Agent tree per address thus serves one execution at a time.
- `execution.setup.get` and `execution.link_update.get` belong to the Worker Service (`worker/contract.ts:1900`, `:1965`).
- The worker heartbeat runs every 60 s (`apps/worker/registration.ts` `HEARTBEAT_INTERVAL_MS`).
- Node 24 ships `AsyncDisposableStack`.
- Gate G resets `state.unchangedTurns` after a gate commit (`turn-gate.ts:145`). `runUnits` resets the counter at each unit only in the planned round, and once after that round (`steps-implement.ts:385`, `:451`). Routed release rounds carry the counter from round to round. `verdictTurnRetried` puts back the value from before the turn (`:555`), so a commit that leaves the verdict rule unmet resets nothing. The release gate writes `state.lastVerification` (`release-gate.ts:211`).
- `refreshAtClaim` merges each checkout in binding order, `base_branch` before `upstream_branch`, and runs the conflict turn before the next merge (`base-refresh.ts:62-136`). Gate G in conflict mode checks every checkout. Another checkout with an open merge fails with `worker.turn.git_in_progress`.
- `isAncestor` in `base-refresh.ts` runs 2 processes: `rev-parse` and `merge-base` (`local-git.ts:879`).
- `writeDoneRecord` writes a record only on a checkout whose head is a commit of the unit run. With no such commit, it logs `done record skipped` (`done-record.ts`). `readDoneRecords` reads only `origin/<base_branch>..HEAD`.
- Evaluation turns every budget end into the stop `assessment_absent` (`evaluation.ts` `endedByBudget` and `runAffectedStep`, `evaluation-input.ts` `setUpReview`). Examine releases with `further_work: true` and no stop (`steps-examine.ts:107-129`). A budget end in implement Prepare throws the stop `budget_end/wall_time` (`steps-implement.ts:782`).
- Before `runStepsImplement`, a stop goes to `releaseStop` with no checkpoint and no push. `checkpointOnStop` covers only the start phase and later (`steps-implement.ts:317-340`).
- The implement agent opens after Prepare and before the base merge (`native-method.ts:158`). `openSession` sets `noContextFiles` (`agent/agent-session.ts:112`), so the open reads no workspace file.
- After any stop, `run.call` and `run.checkClaim` throw the stored stop (`requireActive`). `checkpointOnStop` thus uses `run.cleanupContext()` (`steps-implement.ts:290`).
- The release gate maps the first failed result index to its owner unit (`release-gate.ts:188`, `firstFailedIndex`). A release tree is scrubbed, so a later command can need the output of an earlier command (`worker-service.impl.md`, the verification memo).
- `assessment.submit` can close the execution (`evaluation.ts:661`).
- `git checkout --force -B <b> origin/<ref>` sets an upstream under the default `branch.autoSetupMerge` (`repository/connector.ts:544`, `pushRuleStart`). `git status --branch` then counts ahead and behind commits, unless it gets `--no-ahead-behind`.
- The node branch prefix is `kanthord/` (`repository/node-branch.ts:4`). The affected declaration path is `.kanthord/affected-tests.json`. Both live in the user repository.
- A stop order (`human_paused`, `instance_archived`) and a unit stop (`worker_stopped`) cancel the joined `stop` context with an `ExecutionStop` (`apps/worker/index.ts:528`, `apps/worker/unit.ts:249-255`, `:363-369`). `ExecutionRun.halt` takes that requested stop before the code of the step (`execution-run.ts:295-310`). The Scheduler refuses a release with an ordered reason and no stop order (`scheduler/release.ts:87-101`, `ORDERED_STOP_REASONS`).
- `submitAssessment`, `release` and `releaseStop` settle the credentials, close the agent traces and flush the spans for 5 s before the server call (`execution-run.ts:430-444`, `:476-478`, `:515-528`, `:561-562`).
- `checkpointOnStop` uses `run.cleanupContext()`. `settleImplement`, the restore after a live verification and gate G after a turn use `budget.cleanupContext(operationContext)`. Both are bounded by `expired_at`, not by the wall budget (`steps-implement.ts:193`, `:290`, `:917`, `turn-gate.ts:141`).
- Evaluation and examine turn a thrown `ContextCancelled` or `DeadlineExceeded` into the budget end when the budget is exhausted and `operationContext` is not aborted (`evaluation.ts:425-442`, `steps-examine.ts:152-161`).
- Examine runs only the node commands, with no rerun, no copy, no baseline and no infrastructure or environment stop. It skips the run when no checkout exists (`steps-examine.ts:70-97`).
- `runNativeExecution` selects the method from the worker declaration. A declaration with no method stops with `operation_failed` and no code (`native-method.ts:103-104`, `:146-149`).

## 1. Decisions

### EM ideas

- **D0 (idea 0): use a typed staged pipeline with middleware, not a Chain of Responsibility.** Reason: every step runs in order and adds data; a Chain of Responsibility passes one request until one handler takes it, so it does not fit.
- **D1 (idea 1): each step declares `reads`, `writes` and `stops`. The step type gives each step only its `reads` slice. `build()` rejects a read with no earlier writer, two parallel branches that write one key, and an exit node that reads a key that the exit point can lack. A test builds each chain.** Reason: a move, an insert or a removal that breaks a contract then fails in a unit test, not in a live run. A type-level key check across loops, parallel groups and exits costs more than it gives.
- **D2 (idea 2): share a step when its contract is the same in each chain. Share a service when the contract differs.** Shared steps: `revision.read`, `attempt_evidence.read`, `env.setup`, `verify.all`, `affected.run`, `agent.open`, `execution.release`. Shared services: tree acquisition (pool take, guards, clone, fetch), the setup runner, the verification runner, gate G. Reason: the node checkout, the review tree and the examine base head have different refs and guards; one step for all three hides that difference.
- **D3 (idea 3): order each chain as static, then server and git, then shell, then LLM. Run git and server work in parallel. Keep shell commands serial. Keep each local merge serial.** Reason: commands of one node share ports, build directories and the pnpm store, so parallel commands give false failures and break the flaky-pass rule. A merge can open a conflict turn, and gate G refuses an open merge in another checkout.
- **D4 (idea 4): replace the per-turn claim check with a `ClaimWatch` timer. The timer fires 60 s after the last proof of the claim, and each proven server call moves it. A fence reads the claim before each push. The watch ends at the first fence and before each final call.** Reason: the timer cancels `operationContext`, which aborts the pi session in the middle of a turn, so the stop is faster per call and the call count drops. First signal (EM ruling 2026-11-15, audit S4): `endLiveClaim` queues a stop order with reason `revoked` for every revoked claim except a human pause; the worker reads it at the next heartbeat (15 s) and calls `run.revoke()` with no release. `ClaimWatch` is the fallback for a lost heartbeat.
- **D5 (idea 5): replace the `Kanthord-Done` trailer with a unit record in the Worker Service. `execution.setup.get` returns the records. A new `worker.execution.unit_record.put` writes one record after each unit pass that made a gate commit. A record binds to the content digest and to each commit of the unit run that is a checkout head at the pass.** Reason: the record leaves the user repository, the amend and the head change go away, and the setup read already happens, so the read costs no round trip.
- **D6 (idea 6): replace the 14 to 19 git processes of gate G with one `git status --porcelain=v2 --branch --no-ahead-behind` before and one after, plus file checks on cached operation paths.** Reason: one status gives the branch, the head, the index state and the untracked files, which are the facts of the removed processes.

### Own ideas

- **D7 (own idea): run per-checkout git work in parallel.** This covers gate G, the restore sequence, the base fetch, the release tree build and the push. Merges stay serial (D3). Reason: the checkouts are separate repositories; the wall time becomes the maximum, not the sum.
- **D8 (own idea): run the Read context reads in parallel with each other and with Prepare.** A read that the verdict precedence can skip runs only when the precedence needs it. Reason: no read depends on Prepare, and the first consumer is in Start; the read latency hides behind the clone and the fetch.
- **D9 (own idea): validate `.kanthord/affected-tests.json` at `origin/<base>` in Prepare. Stop with `environment_failed affected_invalid` before the first LLM turn.** Reason: the agent cannot fix a file at the base, so the release gate stop after all agent turns wastes the whole budget.
- **D10 (own idea): a failed `unit_record.put` that is not `revoked` logs `unit record failed` and does not stop the execution. The unit then counts as not recorded.** Reason: a record only saves turns of a later execution, and a transient server error must not end work in progress.
- **D11 (own idea): keep the coder release gate and the reviewer verification as two separate runs, each in plan order.** Reason: the clean-clone check before push and the independent reviewer verification are invariants. A scrubbed tree needs the output of each earlier command, and the owner of a failure comes from its plan index.
- **D12 (own idea): cut the restore sequence after a live verification from 9 git processes to 4 per checkout. Cache the tree id of each commit for the verification memo.** Reason: the 5 assert processes collapse into one status, and a tree id never changes for a commit.
- **D13 (own idea): at a budget end in a conflict turn, `markers.check` runs once more on the open merge. No marker: the checkpoint gate runs the conflict-mode checks and concludes the merge. Markers left: the D23 failure path runs.** Reason: today a complete resolution that ends with the budget is lost; the marker rule still blocks every bad merge.
- **D14 (own idea): add `unit_id`, `template` and a redacted `agent_reason` of at most 512 characters to the `no_progress` detail. The detail fitting cuts `agent_reason` before `command`.** Reason: a human reads a counted stop with no reason today.
- **D15 (own idea): the chain runner opens one `worker.phase` span per phase and one new `worker.step` span per step, for all three chains. The `worker.gate` span gets `kanthord.git.process_count`.** Reason: today only `implement` has phase spans; middleware gives the spans to every step with no step code. The process count proves the D6 and D12 savings in production.
- **D16 (own idea): place the reviewer assets in parallel with the review setup, with at most 4 downloads at a time, streamed to disk.** Reason: the downloads do not depend on the setup, the placement directory is outside each review tree (a workspace with no checkout runs no setup), and `arrayBuffer()` holds a whole object in memory.
- **D17 (own idea): keep the tree pool size. Add `source` (`pool` or `clone`) and the duration to the workspace step span.** Reason: one slot per instance means one free Agent tree per address covers sequential executions; measure the misses before a change.
- **D18 (own idea): keep one pi session per execution.** Reason: an execution runs on any instance, the prompt cache does not live across executions, and the Read context already carries the memory.
- **D19 (own idea): each step that takes a resource registers its release on one `AsyncDisposableStack`. The runner disposes the stack once.** Reason: success, budget end and stop then share one cleanup path; Node 24 ships the type.
- **D20 (EM ruling 2026-11-14, audit S1): in implement, run `env.setup(live)` after `base.refresh(claim)`, on the merged heads, in parallel with `units.plan`.** `agent.open` runs in prepare, in parallel with `workspace.static`, because the conflict turn needs the session. The conflict turn runs with no live setup; the marker check and the release gate decide correctness. Reason: the agent always works on an environment that matches the merged code.
- **D22 (EM ruling 2026-11-14): measure and improve the `Conflict` prompt during the refactor.** Keep one `swe@1` turn and add no second agent. Record per turn the conflicted file count, the model turns, the end, and a release gate failure on a command whose owner touched a conflicted file. Candidate: add the base-side log and diff since the merge base per conflicted file, cut at a byte limit. Compare before it becomes the default. Reason: the prompt asks to keep the base change intact but does not show it. HANDOFF holds the item under the Worker Service.
- **D23 (EM ruling 2026-11-14): loop the conflict turn on a programmatic marker check.** The `conflict.revisions` loop runs `conflict.turn`, then `markers.check` (`conflictMarkerFiles` over the files of `openMerge`). Markers left: keep the merge open, commit nothing, and send a conflict turn that lists the files with markers. No marker: gate G in conflict mode commits the merge. Bound: a turn that leaves the same marker files with the same content adds one to the marker counter of this merge; at 2 the resolution fails. A failed resolution loses no work (EM ruling 2026-11-14): the worker submits a conflict report evidence with the content of each conflicted file and the files that still hold markers, aborts the merge, and releases with a stop that closes the attempt into `Blocked` through a new Mission transition `Executing -> Blocked`. A budget end while markers are left takes the same path: report evidence, merge abort, node `Blocked` (EM ruling 2026-11-14). Blocked release (EM ruling 2026-11-14, audit B8): the stop reason and the transition rule are `conflict_unresolved`; `recordStop` moves the node to `Blocked` with no failure count. `onStop` pushes the branch at the last gate commit first. The conflict report is a produced asset only. The marker counter belongs to one merge, separate from the no-progress counter. The cause is the `merge_base` git step. Reason: today the first check with markers left ends the execution, and the work of the turn is lost.
- **D24 (EM ruling 2026-11-14): semantic branch names and commit messages with no id.** Commit: keep the header `<type>: <unit name>` and drop the id body. Branch: a name chosen once per attempt start and stored with the start point; the push guard checks the `node_branch` of the claim. Branch rule (EM ruling 2026-11-14): `<commit_type>/<node name slug>`, slug lower-case kebab, at most 50 characters; a `-2`, `-3` counter when the remote holds the name; a new attempt from the base gets the next free counter. Branch ownership (EM ruling 2026-11-14, audit B5 and B6): the server reserves each name per binding and never gives it out twice. The first push of an attempt uses `--force-with-lease=refs/heads/<branch>:` and expects the branch to be absent. On a refused first push, the worker takes the next free counter. The worker never starts from a remote branch that the attempt did not push. Commit attribution (EM ruling 2026-11-14, audit B9): when gate G commits, the `worker.gate` span ends with `kanthord.unit.id` and `kanthord.git.commit`; the rule of worker-service.md:419 becomes attribution through that span. The create-only first push does not overwrite a branch, so the rule text becomes "No act deletes, renames or overwrites a node branch". `.kanthord/*` stays as the project configuration directory (EM ruling 2026-11-14, S16).
- **D25 (gap found by Ulrich 2026-11-14): make credentials part of every chain.** A shared `claim` phase runs before `prepare`: `credentials.handover`, then `setup.read`, because the first handover writes the prompt pin that the setup read uses. Chain resources: `credential.store` (pi auth, refresh lease and report) and `ssh.access` (handed key or relay signer per binding). Every final call settles the credentials once before the call (audit B2). Dispose discards every credential, clears SSH access and zeroes the handover key. Section 5.4 holds the rules.
- **D26 (gap found by Ulrich 2026-11-14): make the agent tool set part of the `agent.open` contract.** The step reads the agent declaration (`tools`, `host_tools`) and writes the tool allowlist, the host tools and the hook list. Section 5.5 holds the rules.
- **D27 (EM ruling 2026-11-14): confine the `re@1` read tools.** `agent.open` in the evaluation chain adds `checkoutConfinement`. The allowed roots are the review checkouts and the `evidence` directory. A workspace with no checkout places the assets in the workspace directory itself, so that directory is the root (`evaluation-input.ts:524-527`). Reason: `re@1` has no `bash`, so the hook is its only path boundary; today it can read every file of the worker user.
- **D28 (EM ruling 2026-11-14, audit S2): retry an indeterminate answer with the same idempotency key.** `run.call` keeps one key for all tries. It retries `Indeterminate` and 409 `gateway.idempotency.conflict` with `Backoff` for at most 30 s and never past `expired_at`. It stops at once on `closed` and on a stop of the run. After the bound it stops with `operation_failed`. `retryIndeterminate` takes the key outside its loop. Reason: the gateway replays a recorded answer by key, so a lost response must not cost a counted failure.
- **D29 (EM ruling 2026-11-15, audit S10): submit one coder report per unit, directly after the unit passes.** The subject is `Coder report of unit <unit id>`. The reviewer keeps the newest coder report of each unit id of the pinned revision. Reason: today the report waits for the end of the execution, a budget end submits none, and the reviewer reads only the newest report, so the units of a budget-end execution never reach the reviewer.
- **D30 (EM ruling 2026-11-16, audit S15): the commit identity is a property of the repository.** The repository binding config holds `commit_identity: { name, email }`, required for the first live binding of a `resource_identity`, copied for the next ones, and cascaded to every live binding of that `resource_identity` on a change. `execution.setup.get` sends it per repository; the worker sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*` per checkout. `DEFAULT_IDENTITY` and the four identity names of `KEPT_GIT_VARIABLES` are deleted. Reason: the default `kanthord <kanthord@localhost>` puts the product name into user repositories, and the identity belongs to the repository, not to the worker host.
- **D21 (own idea): deliver in layers. Each layer passes the full engine suite before the next layer starts.**
  1. Gate G and restore reduction on the current code (D6, D12).
  2. Unit record, then removal of the trailer code (D5, D10).
  3. `ClaimWatch` and push fence (D4).
  4. Chain runner and middleware. Port the current steps with no behavior change. A test prints each built chain in the notation of section 4 and compares it with a golden file.
  5. Parallel groups and fail-early order (D7, D8, D9, D16, D20).
  6. Checkpoint merge, telemetry and stop detail (D13, D14, D15).

  Reason: layers 1 to 3 each change one file group (`turn-gate.ts` and `local-git.ts`, `done-record.ts`, `execution-run.ts`) and give the cost cut that the EM asks for with no runner. Layer 4 then ports verified behavior, and the golden file keeps section 4 equal to the code.

### Invariants

| Invariant | Status |
| --- | --- |
| The execution is the only commit author. | Kept. Gate G still soft-resets agent commits and commits once per turn. The amend goes away. |
| Gate violations (`worker.turn.*`) | Kept, with the same precedence. Section 5.3 maps each check to its new source. |
| Verdict rule semantics | Kept. The `rev-list` command and the judged-commit history check do not change. |
| No-progress rule | Kept. The counter lives in the release-round scope with the reset rules of section 2. |
| Independent reviewer verification | Kept (D11). |
| Clean-clone check before push | Kept. `release.gate` stays the only entry to `further_work: false`. |
| Trusted-link filtering | Kept. The server filters at read time; a parallel read does not change it. |
| Stop accounting codes | Kept. Evaluation still turns a budget end into `assessment_absent`. Examine still releases a budget end with no stop. Implement still sends `budget_end` only when no unit completed. A stop order or a unit stop still releases with its own reason (section 2, rule 5a). D14 only adds fields to the `no_progress` detail JSON. D23 adds `conflict_unresolved`. |
| No checkpoint and no push before the start phase | Kept. `onExit` and `onStop` of implement arm at the start phase. |
| Claim check at every model turn | Replaced. Guarantee: a revoke stops spend within 60 s plus one round trip and one abort, and no push starts after a revoke that the server reports before the fence. |
| Done record in the node branch | Replaced. Guarantee: a record counts only when its content digest matches and each recorded commit is in `origin/<base_branch>..HEAD` of its checkout. The release gate still decides correctness. |

## 2. Chain model

The runner is a staged pipeline. A step reads a typed slice of the context and returns a patch of its declared keys. Middleware wraps each step. Loops, parallel groups and nested phases are nodes of the chain, not step code.

```ts
type ChainId = "implement" | "examine" | "evaluation";
type Phase = "prepare" | "start" | "tasks" | "release_gate" | "finish" | "verify" | "judge" | "work";
type WorkKind = "static" | "git" | "shell" | "server" | "llm";
type StopCode = `${EndReason}` | `${EndReason}/${string}`;

interface ExecutionCtx {
  claim: MethodClaim;
  setup: ExecutionSetup;
  revision: Revision;
  attemptEvidence: readonly Evidence[];
  prior: Prior;
  reviewRound: ReviewRound;
  dependencies: DependencyRead;
  checkouts: readonly CheckoutRef[];
  heads: ReadonlyMap<BindingId, Commit>;
  gitPaths: ReadonlyMap<BindingId, OperationPaths>;
  setupEntries: readonly SetupEntry[];
  setupPending: boolean;
  setupInstruction: string | null;
  baseHead: BaseHead;
  memo: VerificationMemo;
  affectedTests: readonly AffectedTest[];
  refreshed: RefreshResult;
  openMerge: ConflictMerge | null;
  agent: NativeAgent;
  plan: UnitPlan;
  currentUnit: TaskContent | null;
  unitsEnd: UnitsEnd;
  route: ReleaseRoute;
  reviewWorkspace: ReviewWorkspace;
  placedAssets: readonly PlacedAsset[];
  verification: VerificationRun;
  affected: AffectedStep | null;
  evidenceIds: readonly EvidenceId[];
  judgement: Judgement;
  report: string;
}
type Key = keyof ExecutionCtx;

interface ProgressCtx {
  planned: boolean;
  unchangedTurns: number;
  lastVerification: VerificationFacts;
}

interface UnitCtx {
  progress: ProgressCtx;
  unit: TaskContent;
  verdict: NodeInstruction | null;
  instruction: string | null;
  template: PromptTemplate;
  turnStartUnchanged: number;
  changed: boolean;
  revisionCount: number;
  commits: ReadonlySet<Commit>;
  passed: boolean;
}

const ChainExit = { BudgetEnd: "budget_end", Settled: "settled" } as const;
type ChainExit = (typeof ChainExit)[keyof typeof ChainExit];

type StepResult<W extends Key> =
  | { kind: "next"; patch: Pick<ExecutionCtx, W> }
  | { kind: "exit"; exit: ChainExit; patch: Partial<Pick<ExecutionCtx, W>> };

const DeadlineKind = { Work: "work", Cleanup: "cleanup" } as const;
type DeadlineKind = (typeof DeadlineKind)[keyof typeof DeadlineKind];

interface StepIo {
  run: ExecutionRun;
  budget: ExecutionBudget;
  context: CancellationContext;
  deadline: number;
  signal: AbortSignal;
  resources: AsyncDisposableStack;
  spans: SpanRecorder;
}

interface Step<R extends Key, W extends Key> {
  id: StepId;
  work: WorkKind;
  deadline: DeadlineKind;
  reads: readonly R[];
  writes: readonly W[];
  stops: readonly StopCode[];
  run(ctx: Readonly<Pick<ExecutionCtx, R>>, io: StepIo): Promise<StepResult<W>>;
}

interface LoopStep<S, R extends Key, W extends Key> {
  id: StepId;
  reads: readonly R[];
  writes: readonly W[];
  stops: readonly StopCode[];
  run(ctx: Readonly<Pick<ExecutionCtx, R>>, scope: S, io: StepIo): Promise<{ scope: S; patch: Partial<Pick<ExecutionCtx, W>>; exit: ChainExit | null }>;
}

type ChainNode =
  | { kind: "step"; step: Step<Key, Key> }
  | { kind: "parallel"; id: string; branches: readonly (readonly ChainNode[])[] }
  | { kind: "loop"; id: string; frame: LoopFrame<unknown> }
  | { kind: "phase"; phase: Phase; nodes: readonly ChainNode[] };

interface LoopFrame<S> {
  init(ctx: ExecutionCtx, outer: unknown): S | null;
  body: readonly (Step<Key, Key> | LoopStep<S, Key, Key> | ChainNode)[];
  next(ctx: ExecutionCtx, scope: S): S | null;
}

type Middleware = <R extends Key, W extends Key>(step: Step<R, W>, phase: Phase) => Step<R, W>;

interface Chain {
  id: ChainId;
  phases: readonly { phase: Phase; nodes: readonly ChainNode[] }[];
  armedFrom: Phase;
  onExit: Readonly<Partial<Record<ChainExit, readonly ChainNode[]>>>;
  onStop: readonly ChainNode[];
  budgetEnd: { kind: "exit" } | { kind: "stop"; reason: EndReason };
  middleware: readonly Middleware[];
}

interface ChainBuilder {
  phase(phase: Phase): ChainBuilder;
  step(step: Step<Key, Key>): ChainBuilder;
  parallel(id: string, ...branches: ((b: ChainBuilder) => ChainBuilder)[]): ChainBuilder;
  loop<S>(id: string, frame: (b: ChainBuilder) => LoopFrame<S>): ChainBuilder;
  armedFrom(phase: Phase): ChainBuilder;
  onExit(exit: ChainExit, nodes: (b: ChainBuilder) => ChainBuilder): ChainBuilder;
  onStop(nodes: (b: ChainBuilder) => ChainBuilder): ChainBuilder;
  build(): Chain;
}

declare function chain(id: ChainId, middleware: readonly Middleware[]): ChainBuilder;
declare function runChain(chain: Chain, seed: Pick<ExecutionCtx, "claim" | "setup">, io: StepIo): Promise<ExecutionEnd>;
```

Rules of the runner:

1. **Context.** The seed holds `claim` and `setup` from the pull loop. A step gets a shallow-frozen slice of its `reads`. A resource key (`agent`, `baseHead`, `memo`) holds a live object. The runner merges the patch into the context. A step never mutates a context object other than a resource. `heads` replaces the in-place `checkout.head` writes of today.
2. **Build check.** `build()` walks every path of the chain. It rejects a read with no earlier writer on that path, two parallel branches that write one key, and an `onExit` or `onStop` node that reads a key that the earliest armed point can lack.
3. **Loop scope.** A `LoopFrame` gets the scope of its outer loop in `init`. `ProgressCtx` lives in the `release_rounds` scope. `UnitCtx` lives in the `units` scope and holds a reference to `ProgressCtx`. A `LoopStep` returns its scope and a patch of its declared keys.
4. **Progress resets.** These rules keep the current no-progress behavior:
   - In the planned round, each unit starts with `unchangedTurns = 0`.
   - After the planned round, the counter resets once and `planned` becomes false.
   - In a routed round, the counter carries from unit to unit and from round to round.
   - A turn with a gate commit resets the counter, except a verdict turn that leaves the verdict rule unmet. That turn puts back `turnStartUnchanged`.
   - A revision turn with no gate commit adds one. A verdict turn that leaves the rule unmet adds one. A first Work turn never adds one.
   - At 2, `progress.rule` stops with `no_progress`, and the detail holds `lastVerification`.
   - `verify.own` and `release.route` write `lastVerification`.
5. **Stop.** A step calls `io.run.stop(reason, code, detail)`. The throw ends the phase. The first stop wins, as in `ExecutionRun.halt` today. For a stop that is not `revoked`, the runner first aborts the agent. When the chain reached `armedFrom`, it runs the `onStop` nodes. It then always runs `execution.release(stop)` (`releaseStop`). An `onStop` failure logs `checkpoint failed` and does not replace the stop. For `revoked`, the runner runs no `onStop` node and ends the execution.
5a. **Requested stop.** A stop order (`human_paused`, `instance_archived`) and a unit stop (`worker_stopped`) cancel the joined `stop` context with an `ExecutionStop`. The runner adopts that abort reason through `run.stopOf` as the stop. It wins over the code of the step that it aborted, because `ExecutionRun.halt` reads the requested stop first. The `ClaimWatch` ends, `onStop` runs as in rule 5, and `execution.release(stop)` carries the ordered reason. The Scheduler accepts it, because the stop order exists. One test per reason proves the release reason. A stop order with reason `revoked` (D4) is not a requested stop: it calls `run.revoke()`, and rule 7 applies.
6. **Budget end.** A step returns `exit: budget_end`, or the `budgetGuarded` middleware returns it before an `llm` step when the budget is exhausted. A step that throws `ContextCancelled` or `DeadlineExceeded` while `budget.exhausted()` holds and `operationContext` is not aborted also gives a budget end: `stopMapped` maps it, as `endedByBudget` and `endedByBudgetExhaustion` do today. `Chain.budgetEnd` decides the result:
   - `implement`: before `armedFrom`, the stop `budget_end/wall_time`. From `armedFrom`, the exit runs `onExit.budget_end`.
   - `examine`: the exit runs `onExit.budget_end`, which releases with `further_work: true` and no stop.
   - `evaluation`: the stop `assessment_absent`, as `endedByBudget` does today.
7. **Revoke.** `ClaimWatch` calls `run.revoke()`. This sets the stop and cancels `operationContext`. The running step sees an aborted `io.signal`. The runner reads the stored stop and ends with `revoked`.
8. **Parallel group.** The runner gives each branch a child `AbortSignal` and awaits all branches with `Promise.allSettled`. When one branch stops, the runner aborts its siblings. The first stop in time wins, because `run.stop` stores it. A step that must name one code for several branches collects the branch results first, then calls `run.stop` once. Gate G does this for its violations.
9. **Telemetry.** The `spanned` middleware opens `worker.step` with `kanthord.step.id`, `kanthord.step.work` and the outcome `next`, `exit` or `stop`. The runner opens a phase span for each phase. The nested `release_gate` phase keeps the current `worker.release_gate` span. Every current span and attribute stays with the owning step of section 5.6. `worker.step` nests under the enclosing `worker.task`, `worker.phase` or `worker.evaluation` span. An `agent.turn` span becomes a child of the `worker.step` span of its LLM step.
10. **Resources.** A step that takes a tree, a base head or an agent session calls `io.resources.defer(...)`. The runner disposes the stack after the final call (rule 12). This replaces the `finally` blocks of `runStepsImplement` and `runEvaluation`.
11. **Composition.** A chain file lists phases and steps with the builder. A step file holds one step. A test runs one step with a fake `StepIo` and a context slice. A golden test prints each built chain in the notation of section 4. The golden test also asserts the set of log messages of section 3 (`Logs:` of each step).
12. **Final call.** `assessment.submit`, `execution.release` and `execution.release(stop)` are runner actions outside every phase. Before each final call, the runner does these steps in order:
    1. End every open step span and phase span.
    2. Settle the credentials once (section 5.4).
    3. Close the agent traces (`run.onTraceClose`), with `Error` for `execution.release(stop)` and `Ok` otherwise.
    4. Flush the spans for at most 5 s.
    5. Send the final call.

    The runner disposes the agent after the final call. After `assessment.submit`, `actions.request` and `execution.release` run with the traces closed, as today.
13. **Deadline.** The runner builds `io.context` and `io.deadline` from `Step.deadline`:
    - `work`: `operationContext`, and the wall deadline of the budget (`budget.wallDeadline()`), or the agent deadline for an LLM step.
    - `cleanup`: a fresh context bounded by `expired_at`. In phases and in `onExit`, it is `budget.cleanupContext(operationContext)`. In `onStop`, it is `run.cleanupContext()`, because the stop already cancelled `operationContext`.

    `gate.g`, `checkout.restore`, `checkpoint.gate`, `claim.fence`, `branch.push` and the final calls are `cleanup` steps. Every other step is a `work` step.

Standard middleware, outermost first: `spanned`, `stopMapped`, `budgetGuarded` (only `llm` steps). `stopMapped` maps `ContextCancelled` and `DeadlineExceeded` to the chain budget end when `budget.exhausted()` holds and `operationContext` is not aborted (rule 6). It maps an abort with an `ExecutionStop` reason to that stop (rule 5a). It maps every other unknown error to `run.stopOf`.

## 3. Step catalogue

Stop code notation: `<EndReason>` or `<EndReason>/<code>`. Every server step can also raise `revoked` and `operation_failed/<server code>` through `run.call`; the entries do not repeat these two. Every LLM step can raise `provider_failed/*` and a budget end. `Chain.budgetEnd` turns a budget end into an exit or a stop (section 2, rule 6). The entries write "budget end" for it.

Fail-early class: F0 static, F1 server or git, F2 shell, F3 LLM, F4 publish.

`Logs:` names the log messages that the step writes today. The golden test asserts this set (section 2, rule 11). The host writes `credential handover received` (S43) and `execution ended` (host end, section 5.4). The span sink writes `telemetry write failed`, and the run writes `telemetry faults` at the trace close (rule 12).

### C0 `claim.watch` (chain resource)
- Phase: all, up to the first `claim.fence` or the first final call (`assessment.submit`, `execution.release`, `releaseStop`). Chains: implement, examine, evaluation (shared).
- Problem: detect a revoke with fewer calls than one per model turn.
- Reads: `claim`. Writes: none.
- Work: server timer (section 5.2).
- Stops: `revoked`, through `run.revoke()`.
- Parallel: runs beside every step.
- Fail-early: starts before the first step.

### S01 `revision.read`
- Phase: prepare. Chains: implement, examine, evaluation (shared).
- Problem: get the pinned revision.
- Reads: `claim`. Writes: `revision`.
- Work: server (`execution.pinnedRevision.get`).
- Stops: none extra.
- Parallel: sibling of `prior.read`, `attempt_evidence.read`, `review_round.read`, `dependencies.read`.
- Fail-early: F1, group 1.

### S02 `attempt_evidence.read`
- Phase: prepare. Chains: implement, evaluation (shared).
- Problem: implement needs the pushed binding set; evaluation needs the snapshot and the support evidence.
- Reads: `claim`. Writes: `attemptEvidence`.
- Work: server, paged (`execution.evidence.list`).
- Stops: none extra.
- Parallel: pages stay serial (cursor). Sibling of S01.
- Fail-early: F1, group 1.

### S03 `prior.read`
- Phase: prepare. Chains: implement.
- Problem: build the verdict and the cleared text, the only memory across executions.
- Reads: `claim`, `setup`. Writes: `prior`.
- Work: server. First parallel group: failed checks, rework assessment, link updates; today each execution reads all three. Then, by result, as today: review round (when rework exists); else cleared outcome, then change requests (when the outcome is external-failed), then cleared assessment (when no change request text exists). A read that the precedence skips today stays unread, so its failure cannot stop the execution.
- Stops: none extra.
- Parallel: inside as above; sibling of S01, S02 and the workspace branch.
- Fail-early: F1, group 1. The precedence of `readUnblockPrior` stays in one pure function over the read results.

### S04 `review_round.read`
- Phase: prepare. Chains: evaluation. Implement calls the same read inside S03.
- Problem: get the round number, findings and review base.
- Reads: `claim`. Writes: `reviewRound`.
- Work: server. Stops: none extra.
- Parallel: sibling of S01, S02.
- Fail-early: F1, group 1.

### S05 `dependencies.read`
- Phase: prepare. Chains: examine, evaluation (examine intent).
- Problem: get dependencies, outcomes and dependency evidence.
- Reads: `claim`. Writes: `dependencies`.
- Work: server, 3 paged reads, in parallel with each other.
- Stops: none extra.
- Parallel: sibling of S01 and the workspace branch.
- Fail-early: F1, group 1. Today it runs after the setup.

### S06 `workspace.node`
- Phase: prepare. Chains: implement.
- Problem: give each binding a coder checkout at the node branch.
- Reads: `claim`, `setup`, `attemptEvidence`. Writes: `checkouts`, `heads`, `gitPaths`.
- Work: git and network. Shared tree service: node-key reuse with a pending push, else Agent pool tree, else clone; `fetchAndCheckout`; `git fetch --prune origin`; one `git rev-parse --git-path` per checkout for `gitPaths`; restore to head.
- Hygiene, before the checkouts: give the leftover release trees of the node key back to the Command pool; `keepOnly` keeps the push record of the node branch and the checkout directories of the bindings and `.kanthord-scratch/`. After the checkouts: restore the scratch store of the node branch (one checkout: move the saved `.kanthord-scratch/` back; several checkouts: drop it when it belongs to another branch). Each new tree gets the `.kanthord-scratch/` line in `.git/info/exclude`.
- Stops: `operation_failed/repository.node_checkout.pending_rebuild`, `operation_failed/repository.node_branch.missing`, `operation_failed/repository.connector.git_failed`.
- Keep rule: on `repository.node_branch.missing`, the step keeps the created directories. On any other failure, it removes them (`workspace.ts:320-330`). The kept checkout protects unpushed work.
- Dispose: give each coder tree back to the Agent pool, except a tree with a pending or unreadable push record; store the scratch of the node branch first.
- Logs: `tree prepared`, `tree deleted`, `scratch not stored`.
- Parallel: per checkout. Runs after S02 in the same branch, beside S01 and S03.
- Fail-early: F1, group 1.

### S07 `workspace.review`
- Phase: prepare. Chains: evaluation.
- Problem: give each binding a review tree at the tested commit, and prove that the remote serves it.
- Reads: `setup`, `attemptEvidence`, `reviewRound`. Writes: `reviewWorkspace`, `checkouts`, `heads`.
- Work: git and network, shared tree service (`refreshSnapshot`, scrub). Before the trees, it gives the leftover review trees back to the Agent pool and removes the review key.
- Workspace kind: implement intent with a snapshot of every binding gives the review trees. Implement intent with no snapshot gives an execution workspace with no checkout; `tested_input` then falls back to the newest placed asset (`evaluation-input.ts:497-499`). Examine intent gives examine trees at the base heads.
- Stops: `operation_failed` (a snapshot for some bindings but not for all), `operation_failed` (no tested input), `operation_failed/repository.connector.git_failed`.
- Dispose: give each review tree back to the Agent pool, then remove the review key.
- Logs: `tree prepared`, `tree deleted`.
- Parallel: per checkout.
- Fail-early: F1, after group 1.

### S08 `workspace.examine`
- Phase: prepare. Chains: examine.
- Problem: give each binding a tree at its base head.
- Reads: `setup`. Writes: `checkouts`, `heads`.
- Work: git and network, shared tree service.
- Stops: `operation_failed/repository.connector.git_failed`.
- Parallel: per checkout; sibling of S01 and S05.
- Fail-early: F1, group 1.

### S09 `affected.declaration`
- Phase: prepare. Chains: implement. The evaluation chain keeps the read inside `affected.run`, which runs before its only LLM step.
- Problem: read and validate `.kanthord/affected-tests.json` at `origin/<base>`.
- Reads: `checkouts`, `setup`. Writes: `affectedTests`.
- Work: git (`git show`) and static parse.
- Stops: `environment_failed/affected_invalid` (new position, D9).
- Parallel: per checkout; sibling of S10.
- Fail-early: F0 after the workspace, before any shell step.

### S10 `setup.entries`
- Phase: prepare. Chains: implement, examine, evaluation (shared).
- Problem: resolve the devcontainer setup scripts of each checkout.
- Reads: `checkouts`, `setup`. Writes: `setupEntries`.
- Work: static.
- Stops: `environment_failed/setup_failed` on a parse failure.
- Parallel: per checkout; sibling of S09.
- Fail-early: F0.

### S11 `env.setup`
- Phase: prepare (live, review, examine) and release_gate (release). Chains: all (shared, target given by the chain).
- Problem: run `updateContentCommand` and `postCreateCommand` on the target heads; on a node failure, run the base head.
- Reads: `setupEntries`, `heads`, `baseHead`. Writes: `setupPending` and `setupInstruction` (implement), or a setup failure in `verification` (evaluation), or a stop (examine).
- Work: shell.
- Stops: `environment_failed/setup_failed`; a budget end gives `budget_end/wall_time` (implement prepare), `assessment_absent` (evaluation), or a release with no stop (examine).
- Logs: `environment setup` (implement), `setup failed on the node head` (implement, evaluation), `tree prepared` and `tree deleted` (base tree).
- Parallel: serial across checkouts. Sibling of S16 `assets.place` in evaluation, and of S15 `units.plan` in implement (D20).
- Fail-early: F2, the first shell step, before any LLM step.

### S12 `agent.open`
- Phase: prepare (implement), judge (evaluation), work (examine). Chains: all (shared).
- Problem: open the pi session with the prompt layers.
- Reads: `claim`, `setup`, `checkouts`. Writes: `agent`.
- Work: static, and the model runtime of the credential. No model call. No workspace file read (`noContextFiles`).
- Stops: `operation_failed`.
- Parallel: sibling of `workspace.static` in implement (D20).
- Fail-early: F0, before the first LLM step.

### S13 `base.merge` (loop step)
- Phase: start (claim) and release_gate (release). Chains: implement.
- Problem: merge `origin/<base_branch>`, then `upstream_branch`, into one checkout.
- Reads: `checkouts`, `heads`, `setup`. Writes: `heads`, `refreshed`, `openMerge`.
- Work: git. The ancestor check is one `git merge-base --is-ancestor origin/<b> HEAD`, not 2 processes. On a conflict, it writes `openMerge` with the directory, the merged commit and the unmerged files.
- Stops: `operation_failed/repository.connector.git_failed`. The merge runs inside `worker.git` with the git step mark `merge_base`, which gives the stop cause.
- Logs: `base merged`.
- Parallel: none. The `base.refresh` loop runs one frame per checkout and merged branch, in binding order. The `conflict.revisions` loop and `gate.g(conflict)` run inside the frame before the next merge (D3).
- Fail-early: F1.

### S14 `conflict.turn` (LLM, loop step)
- Phase: start and release_gate. Chains: implement.
- Problem: let `swe@1` resolve the conflicts of one checkout. The first turn uses the `Conflict` template. A later turn lists the files that still hold markers (D23).
- Reads: `agent`, `checkouts`, `heads`, `openMerge`; scope (marker files of the last check). Writes: none.
- Work: LLM (`Conflict` template).
- Stops: `provider_failed/*`, budget end (`markers.check` then runs once more, D13).
- Parallel: none; one agent.
- Fail-early: F3.

### S14a `markers.check` (loop step)
- Phase: start and release_gate. Chains: implement.
- Problem: decide after each conflict turn whether the merge is resolved.
- Reads: `checkouts`, `openMerge`; scope (marker counter of this merge, marker files and content of the last check). Writes: scope.
- Work: git and file reads (`conflictMarkerFiles` over the files of `openMerge`).
- Rules (D23):
  - No marker: leave the loop; `gate.g(conflict)` commits the merge.
  - Markers left: keep the merge open, commit nothing, and run the next `conflict.turn` with the files that hold markers.
  - The same marker files with the same content as the last check add one to the marker counter of this merge. The counter is separate from the no-progress counter. At 2, the resolution fails.
  - Budget end with markers left: the resolution fails.
  - A failed resolution runs `conflict.report`, then `merge --abort`, then stops with `conflict_unresolved`. The cause is the `merge_base` git step.
- Stops: `conflict_unresolved` (node `Blocked`, no failure count; `onStop` pushes the last gate commit first).
- Parallel: none. Fail-early: F1, directly after each conflict turn.

### S14b `conflict.report`
- Phase: start and release_gate, on a failed resolution only. Chains: implement.
- Problem: keep the partial resolution when the merge aborts.
- Reads: `claim`, `checkouts`, `openMerge`; scope (marker files). Writes: `evidenceIds`.
- Work: server. One evidence with the content of each conflicted file and the list of files that still hold markers. The evidence has one `produced` asset and no repository asset, so `hasEvidence` and `snapshotOf` never accept it.
- Stops: through `run.call` (D28). Parallel: none. Fail-early: F4.

### S15 `units.plan`
- Phase: start. Chains: implement.
- Problem: list the pending units and the verdict unit.
- Reads: `revision`, `setup` (`unit_records`), `heads`, `checkouts`, `prior`, `refreshed`. Writes: `plan`.
- Work: git. One `git rev-list origin/<base_branch>..HEAD` per checkout for all unit records (section 5.1). For each judged commit, `rev-parse --verify` and `merge-base --is-ancestor` (history check), then one verdict-rule `git rev-list`.
- Stops: none.
- Logs: `units planned`, `verdict planned`, `judged commit off the node history`.
- Parallel: per checkout.
- Fail-early: F1, before the first unit turn.

### S16 `assets.place`
- Phase: prepare. Chains: evaluation.
- Problem: place the produced and object assets of the support evidence for the reviewer.
- Reads: `attemptEvidence`, `reviewWorkspace`. Writes: `placedAssets`.
- Work: server and HTTP; stream each body to its file. The placement directory is `evidence` beside the review trees. A workspace with no checkout places the assets in the workspace directory itself (`evaluation-input.ts:524-527`). The support evidence keeps only the newest coder report of each unit id (D29).
- Stops: `operation_failed` on a failed download.
- Parallel: at most 4 downloads at a time; sibling of S11 (D16).
- Fail-early: F1.

### S16a `unit.enter` (loop step)
- Phase: tasks. Chains: implement.
- Problem: name the current unit for a checkpoint commit and a stop, and apply the progress reset of a planned unit.
- Reads: scope. Writes: `currentUnit`; scope (`revisionCount = 0`, `progress.unchangedTurns = 0` when `progress.planned`).
- Telemetry: opens the `worker.task` span of the unit (section 5.6). The span ends at the unit end.
- Logs: `task started` (task unit), `node instruction started` (verdict or node unit).
- Work: static. Stops: none. Parallel: none. Fail-early: F0.

### S17 `unit.turn` (LLM, loop step)
- Phase: tasks and release_gate. Chains: implement.
- Problem: run one Work, TaskRevision or CriterionRevision turn for the current unit.
- Reads: `agent`, `revision`, `checkouts`, `affectedTests`, `setupInstruction`; scope `UnitCtx`. Writes: scope (`turnStartUnchanged`).
- Work: LLM.
- Stops: `provider_failed/*`, budget end.
- Parallel: none.
- Fail-early: F3.

### S18 `gate.g` (loop step)
- Phase: tasks, start (conflict mode), finish and onStop (checkpoint mode). Chains: implement.
- Problem: check the turn for violations and commit it as the only author.
- Reads: `checkouts`, `heads`, `gitPaths`, `openMerge` (conflict and checkpoint modes); scope. Writes: `heads`, `openMerge`; scope (`commits`, `changed`).
- Work: git (section 5.3). Deadline: `cleanup` (section 2, rule 13). Conflict mode runs only after `markers.check` found no marker.
- Hygiene: after each gate with no violation, `removeRootEntries` removes each entry of the workspace root other than the checkouts and `.kanthord-scratch/` (several checkouts only).
- Stops: `operation_failed/worker.turn.branch_changed`, `.../worker.turn.history_rewritten`, `.../worker.turn.foreign_merge`, `.../worker.turn.merge_missing`, `.../worker.turn.git_in_progress`, `operation_failed/worker.git.commit_failed`.
- Logs: `turn violation`, `root entries removed`, `task committed` (write mode, after each turn of a task unit, with the head set).
- Parallel: per checkout (D7), with a barrier: all checks end before the first restore or commit. On several violations, the lowest checkout index names the code, and the gate calls `run.stop` once.
- Fail-early: F1, directly after each agent turn.

### S19 `progress.rule` (loop step)
- Phase: tasks. Chains: implement.
- Problem: apply the progress resets and counts of section 2, rule 4.
- Reads: scope (`changed`, `turnStartUnchanged`, `progress`). Writes: scope (`progress`).
- Work: static.
- Stops: `no_progress` (detail per D14). The stop ends the `worker.task` span with the `kanthord.stop.*` attributes (section 5.6).
- Parallel: none.
- Fail-early: F0, before the verification.

### S20 `verdict.rule` (loop step)
- Phase: tasks. Chains: implement (verdict unit only).
- Problem: check that a commit since the judged commits exists; retry once, then waive. An unmet rule puts back `turnStartUnchanged` before it counts.
- Reads: `heads`, `checkouts`; scope. Writes: scope (`progress`).
- Work: git (`git rev-list --first-parent --ancestry-path --no-merges --max-count=1 <judged>..HEAD`).
- Stops: none. The retry counts one turn only while the count stays under the limit; at the limit it waives.
- Logs: `verdict rule checked`, `verdict rule waived for review`.
- Parallel: per judged checkout; the rule holds when one checkout holds.
- Fail-early: F1, before the verification.

### S21 `verify.own` (loop step)
- Phase: tasks. Chains: implement.
- Problem: run the own commands of the unit in the live checkout. A pending setup runs first.
- Reads: `revision`, `heads`, `baseHead`, `setupEntries`, `setupPending`, `memo`; scope. Writes: `setupPending`; scope (`passed`, `progress.lastVerification`, next instruction).
- Work: shell.
- Stops: `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/verification_timeout`, `environment_failed/command_absent`, budget end.
- Logs: `task verified` (task unit).
- Parallel: commands serial.
- Fail-early: F2.

### S22 `checkout.restore`
- Phase: tasks (after S21), gate violation path, prepare. Chains: implement.
- Problem: bring each checkout back to its head and drop every change of a command.
- Reads: `checkouts`, `heads`, `gitPaths`. Writes: none.
- Work: git (section 5.3, 4 processes). Deadline: `cleanup` (section 2, rule 13). After the restore of a live verification, `removeRootEntries` runs as in `gate.g`.
- Stops: `operation_failed` on an invariant failure.
- Logs: `root entries removed`.
- Parallel: per checkout.
- Fail-early: F1.

### S23 `unit_record.put` (loop step)
- Phase: tasks. Chains: implement.
- Problem: record that the unit passed at the commits of its run.
- Reads: `claim`, `heads`; scope (`commits`). Writes: scope (`recorded`).
- Work: server (`worker.execution.unit_record.put`). It runs only for a task unit, or for the node unit of a node with no task (section 5.1). It runs only when a checkout head is in `commits`; else it logs `unit record skipped`.
- Stops: `revoked` only. Another failure logs `unit record failed`, and the unit counts as not recorded (D10).
- Logs: `unit recorded`, `unit record skipped`, `unit record failed` (replace `done recorded` and `done record skipped`).
- Parallel: none.
- Fail-early: F4.

### S42 `base.fetch`
- Phase: release_gate. Chains: implement.
- Problem: fetch `base_branch` and `upstream_branch` of each checkout before the release merge.
- Reads: `checkouts`, `setup`. Writes: none.
- Work: network git (`transport.fetchBase`), inside `worker.git` with the git step mark `fetch_base`, which gives the stop cause.
- Stops: `operation_failed/repository.connector.git_failed`.
- Parallel: per checkout and branch (D7).
- Fail-early: F1.

### S24 `release_trees.prepare`
- Phase: release_gate. Chains: implement.
- Problem: give each binding a clean Command tree at the head.
- Reads: `checkouts`, `heads`. Writes: release tree paths in `route`.
- Work: git (pool take or `clonePacked` from the live checkout).
- Stops: `operation_failed/repository.connector.git_failed`.
- Dispose: give each release tree back to the Command pool. A leftover release tree goes back at the next `workspace.node` (S06).
- Logs: `tree prepared`.
- Parallel: per checkout.
- Fail-early: F1.

### S25 `verify.all`
- Phase: release_gate (release), verify (evaluation). Chains: implement, evaluation (shared).
- Problem: run every node and task command in clean trees, with `copyRepeated` and `reruns: 2`.
- Reads: `revision`, `heads`, `baseHead`, the tree root of the chain, `memo` (release only). Writes: `verification`.
- Work: shell.
- Stops: `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/verification_timeout`, `environment_failed/command_absent`, budget end.
- Logs: `verification flaky` (release only).
- Parallel: commands serial, in plan order (D11).
- Fail-early: F2.

### S25a `verify.node`
- Phase: work. Chains: examine.
- Problem: give the examine turn the result of the node commands at the base heads.
- Reads: `revision`, `checkouts`, `heads`. Writes: `verification` (null when no checkout exists).
- Work: shell. Only the node commands (`revision.content.verifications`), in the examine workspace directory. No rerun, no copy, no baseline. The step skips the run when the workspace has no checkout (`tested_input` is null).
- Stops: none extra. A failed, absent or timed-out command goes into `verification` and does not stop the examine. A budget end gives a release with `further_work: true` and no stop.
- Parallel: commands serial; sibling of `agent.open`.
- Fail-early: F2.

### S26 `affected.run`
- Phase: release_gate, verify. Chains: implement, evaluation (shared).
- Problem: run the affected test command on the head, and on the base after a head failure.
- Reads: `affectedTests`, `heads`, `baseHead`, `verification`. Writes: `affected`.
- Work: shell.
- Stops: `environment_failed/affected_invalid`, `environment_failed/affected_timeout`, `environment_failed/command_absent`, budget end.
- Parallel: serial across checkouts.
- Fail-early: F2, only after `verify.all` passes.

### S27 `release.route` (loop step)
- Phase: release_gate. Chains: implement.
- Problem: pass the gate, or route the first failure to its owner unit with a TaskRevision instruction.
- Reads: `verification`, `affected`, `revision`; scope (`progress`). Writes: `route`; scope (`progress.lastVerification`).
- Work: static.
- Stops: none.
- Logs: `release verified`, `release failure routed`.
- Parallel: none.
- Fail-early: F0.

### S28 `report.coder` (loop step)
- Phase: tasks, units loop, after S23. Chains: implement.
- Problem: submit the report of one unit as soon as the unit passes, so a budget end loses no report (D29).
- Reads: `currentUnit`, `agent` (`agent.lastText()`, the final agent text of the unit). Writes: `evidenceIds`. The unit report needs no `reports` key, because the step submits it in the unit frame (D29, audit S9).
- Work: server. Subject `Coder report of unit <unit id>`; body `## <unit id> <unit name>` and the final text. Skip when the final text is empty. Stops: through `run.call` (D28). Parallel: none. Fail-early: F4.

### S29 `checkpoint.gate`
- Phase: onExit budget_end and onStop. Chains: implement.
- Problem: commit the partial work of the current unit before the push.
- Reads: `checkouts`, `heads`, `gitPaths`, `currentUnit`, `openMerge`. Writes: `heads`.
- Work: git (gate G in checkpoint mode; D13). Deadline: `cleanup` (section 2, rule 13). The message names `currentUnit`, or the node unit when it is null. An `openMerge` here has no marker, because `markers.check` ran at the budget end; the gate concludes it.
- Stops: `operation_failed/worker.turn.*` (onExit only; onStop restores instead).
- Logs: `checkpoint failed` (onStop, on a failure that does not replace the stop).
- Parallel: per checkout.
- Fail-early: F1.

### S30 `claim.fence`
- Phase: finish, onExit budget_end and onStop. Chains: implement.
- Problem: refuse a push after a revoke.
- Reads: `claim`. Writes: none.
- Work: server (`scheduler.claim.get`). Deadline: `cleanup` (section 2, rule 13). In onStop it uses `run.cleanupContext()` and no `requireActive`, because the stop already cancelled `operationContext`.
- Stops: `revoked` (finish and onExit). In onStop, a revoke answer skips the push, and the stored stop stays.
- Parallel: none; directly before S31.
- Fail-early: F1.

### S31 `branch.push`
- Phase: finish, onExit budget_end and onStop. Chains: implement.
- Problem: push each node branch, with the push record around each push.
- Reads: `checkouts`, `heads`. Writes: none.
- Work: git and network (fast-forward push), inside `worker.git` with the git step mark `push`, which gives the stop cause. Deadline: `cleanup` (section 2, rule 13).
- Stops: `operation_failed/repository.connector.git_failed`.
- Parallel: per checkout; one push record file per binding.
- Fail-early: F4.

### S32 `evidence.head`
- Phase: finish. Chains: implement.
- Problem: record the pushed head of each binding. This evidence meets the release obligation.
- Reads: `heads`, `checkouts`. Writes: `evidenceIds`.
- Work: server. Stops: none extra. Parallel: none. Fail-early: F4.

### S33 `review.scope`
- Phase: prepare. Chains: evaluation.
- Problem: build the round patch of each binding: full against `origin/<base>` in round 1, since `review_base` later.
- Reads: `reviewWorkspace`, `reviewRound`. Writes: `reviewWorkspace` (scope).
- Work: git. Parallel: per checkout. Stops: none. Fail-early: F1.
- Logs: `review base off the node history`.

### S34 `evidence.publish` (evaluation)
- Phase: verify. Chains: evaluation.
- Problem: submit the verification evidence, the affected evidence and the round patch evidence.
- Reads: `verification`, `affected`, `reviewWorkspace`, `heads`. Writes: `evidenceIds`.
- Work: server.
- Stops: none extra.
- Parallel: the three submits run in parallel; the order of `evidence_ids` stays verification, affected, patches, placed.
- Fail-early: F4.

### S35 `judgement.shortcut`
- Phase: judge. Chains: evaluation.
- Problem: write `criterion-not-met` with no LLM on a setup, verification or affected failure.
- Reads: `verification`, `affected`, `reviewWorkspace`. Writes: `judgement` or nothing.
- Work: static. Stops: none. Fail-early: F0, before S12 and S36.

### S36 `judgement.turn` (LLM)
- Phase: judge. Chains: evaluation.
- Problem: get the `kanthord-judgement:` JSON line; one Repair turn on an invalid line.
- Reads: `agent`, `revision`, `verification`, `affected`, `placedAssets`, `reviewWorkspace`, `reviewRound`, `dependencies`. Writes: `judgement`.
- Work: LLM (`Evaluation`, then `Repair` when needed).
- Result: in the examine intent, a judgement with proposals gives the result `Undetermined` (`evaluation.ts:282-299`). In the implement intent, the proposals are dropped.
- Stops: `judgement_invalid`, `provider_failed/*`, budget end (`assessment_absent`).
- Logs: `node judged`.
- Parallel: none. Fail-early: F3.

### S37 `assessment.submit`
- Phase: finish. Chains: evaluation.
- Problem: submit the assessment with `tested_input` and the evidence set; keep prior blockers not in `fixed_finding_ids`.
- Reads: `judgement`, `evidenceIds`, `heads`, `reviewRound`. Writes: the answer (outcome, node state).
- Work: server. A final call (section 2, rule 12): the runner settles the credentials, closes the traces and flushes before it. The claim watch ends before this call, because an outcome closes the execution. `tested_input` is the tested commit set of the review trees, or the newest placed asset when the workspace has no checkout (S07).
- Stops: `operation_failed` when the answer has no outcome, the node stays in `Evaluating` and the result is not `success` (`evaluation.ts:669-671`). An outcome ends the chain as `closed`. A node that left `Evaluating` ends the chain as `revoked`. A `success` result with no outcome continues to `actions.request`. Fail-early: F4.

### S38 `actions.request`
- Phase: finish. Chains: evaluation (success only).
- Problem: request the required external actions.
- Reads: assessment answer. Writes: none.
- Work: server. Stops: `action_unsettled`. Fail-early: F4.

### S39 `examine.turn` (LLM)
- Phase: work. Chains: examine.
- Problem: get the examine assessment text.
- Reads: `agent`, `revision`, `checkouts`, `verification`, `dependencies`. Writes: `report`.
- Work: LLM (`Examine`).
- Stops: `report_absent` on an empty last text, `provider_failed/*`, budget end.
- Fail-early: F3.

### S40 `evidence.report`
- Phase: finish. Chains: examine.
- Problem: submit the Markdown report evidence.
- Reads: `report`, `dependencies`, `verification`. Writes: `evidenceIds`.
- Work: server. Fail-early: F4.

### S41 `execution.release`
- Phase: finish, onExit, onStop. Chains: all (shared).
- Problem: release with `further_work`, the budget limit, or the stop.
- Reads: `claim`, `unitsEnd` or the chain exit. Writes: none.
- Work: server. A final call (section 2, rule 12): the runner settles the credentials, closes the traces and flushes before it. The claim watch ends before this call. Implement sends the stop `budget_end/<limit>` only when no unit completed (section 5.1). Examine sends a budget end with no stop.
- Answer of `execution.release` (`execution-run.ts:466-512`):
  - A refused credential settle with an execution-end answer stops with `revoked`; another refused settle stops with `operation_failed/<code>`.
  - An `Indeterminate` answer reads the claim. `finished` counts as released. Another state stops with `operation_failed`.
  - Another failure stops through `run.call`.
- Answer of `execution.release(stop)` (`execution-run.ts:515-614`), always in `run.cleanupContext()`:
  - A refused credential settle with an execution-end answer ends as `revoked` with no release.
  - An `Indeterminate` answer reads the claim. `finished` with a stop counts as released; an execution-end answer ends as `revoked`.
  - A completed answer releases with `further_work: true` and the stop. An execution-end answer ends as `revoked`.
  - Any other failure returns the stop itself as the end (`Ended` with the stop reason, code and detail).
- Stops: a failed release that is not revoked returns the Diagnostic that ends the pull loop (unchanged).
- Fail-early: F4, last.

## 4. Chains as call stacks

Chain selection (`runNativeExecution`). The runner reads `method` of the worker declaration (`getWorkerDeclaration(setup.worker_name)`) and `setup.intent`:

| `method` | `intent` | Chain |
| --- | --- | --- |
| `evaluation` | any | `evaluation` |
| `steps` | `examine` | `examine` |
| `steps` | `implement` | `implement` |
| none (`claude-code@1`, an external harness declaration) | any | no chain; stop `operation_failed` with no code |

Notation: `[LLM]` marks a model call. `[PAR]` marks a parallel group. Each child of a `[PAR]` line runs at the same time: a `branch` with its own steps, or one `step`. `loop` marks a frame that repeats. `phase` inside a loop is a nested phase. `exit` and `stop` name the short-circuit edges. `armed from` names the first phase that runs `onExit` and `onStop`. `final` marks a final call, a runner action outside every phase (section 2, rule 12). The runner always runs the last `onStop` node, `final execution.release(stop)`.

```text
chain implement
  resource claim.watch                        ends at the first claim.fence or execution.release
  armed from start                            before start, a stop or a budget end goes to execution.release(stop)
  phase prepare
    [PAR] prepare.inputs
      branch reads
        step revision.read
        step prior.read
          [PAR] prior.first
            step failed_checks.read
            step rework_assessment.read
            step link_updates.read
          step review_round.read              when rework exists
          step cleared_outcome.read           when no failed checks and no rework exist
          step change_requests.read           when the cleared outcome is external-failed
          step cleared_assessment.read        when no failed checks, no rework and no change request text exist
      branch workspace
        step attempt_evidence.read
        step workspace.node                   [PAR] per checkout
        [PAR] workspace.static
          step affected.declaration           [PAR] per checkout; stop environment_failed/affected_invalid
          step setup.entries
          step agent.open
  phase start
    loop base.refresh(claim)                  one frame per checkout and merged branch, in binding order
      step base.merge                         merge-base --is-ancestor, then merge
      loop conflict.revisions                 only when the merge conflicts; until no marker is left (D23)
        step conflict.turn                    [LLM] Conflict; later turns list the files with markers
        step markers.check                    markers left -> next turn; same markers twice or budget end -> resolution fails
        step conflict.report                  failed resolution only; produced asset; then merge --abort, stop conflict_unresolved
      step gate.g(conflict)                   no marker left; commits the merge; stop worker.turn.*
    [PAR] start.inputs
      step env.setup(live)                    on the merged heads; stop environment_failed/setup_failed; stop budget_end/wall_time
      step units.plan                         [PAR] per checkout: unit record range, judged history, verdict rule
  phase tasks
    loop release_rounds                       scope ProgressCtx; until route = passed or budget end
      loop units                              scope UnitCtx; planned round: pending units, then the verdict unit
        step unit.enter                       writes currentUnit; planned round resets the progress count
        loop revisions                        until passed
          step unit.turn                      [LLM] Work | CriterionRevision | TaskRevision
          step gate.g(write)                  [PAR] per checkout; stop worker.turn.*
          step verdict.rule                   verdict unit only
          step progress.rule                  stop no_progress
          step verify.own
          step checkout.restore               [PAR] per checkout
        step unit_record.put                  on pass with a gate commit; a failure that is not revoked logs only
        step report.coder                     on pass with non-empty final text; subject `Coder report of unit <unit id>` (D29)
      phase release_gate
        [PAR] base.fetch                      per checkout and merged branch
        loop base.refresh(release)            one frame per checkout and merged branch, in binding order
          step base.merge
          loop conflict.revisions             only when the merge conflicts; until no marker is left (D23)
            step conflict.turn                [LLM] Conflict; later turns list the files with markers
            step markers.check                markers left -> next turn; same markers twice or budget end -> resolution fails
            step conflict.report              failed resolution only; then merge --abort, stop conflict_unresolved
          step gate.g(conflict)               no marker left; commits the merge
        step release_trees.prepare            [PAR] per checkout
        step env.setup(release)
        step verify.all(release)              plan order
        step affected.run(release)            only when verify.all passed
        step release.route                    passed -> leave release_rounds; routed -> owner unit, next round
  phase finish
    step claim.fence                          stop revoked; the claim watch ends
    step branch.push                          [PAR] per checkout
    step evidence.head
  final execution.release                     further_work false
  onExit budget_end
    step checkpoint.gate                      [PAR] per checkout; concludes a marker-free openMerge
    step claim.fence                          stop revoked
    step branch.push                          [PAR] per checkout
    final execution.release                   further_work true; stop budget_end only when no unit completed
  onStop not revoked
    step checkpoint.gate(restore)             skipped after a turn violation
    step claim.fence                          revoke answer skips the push
    step branch.push                          [PAR] per checkout; conflict_unresolved pushes the last gate commit
    final execution.release(stop)             ordered stops carry their reason (rule 5a)
  dispose resources                           agent session, node key and scratch store, base heads, release trees

chain evaluation
  resource claim.watch                        ends before assessment.submit or execution.release
  armed from prepare
  phase prepare
    [PAR] prepare.reads
      step revision.read
      step attempt_evidence.read
      step review_round.read
      step dependencies.read                  examine intent only; [PAR] 3 paged reads
    step workspace.review                     [PAR] per checkout; stop operation_failed when a snapshot is missing
    step review.scope                         [PAR] per checkout
    [PAR] prepare.place
      branch environment
        step setup.entries
        step env.setup(review)                budget end -> stop assessment_absent
      branch assets
        step assets.place                     at most 4 downloads at a time
  phase verify
    step verify.all(evaluation)               budget end -> stop assessment_absent
    step affected.run(evaluation)             implement intent, verify.all passed, setup passed
    step evidence.publish                     [PAR] verification, affected, round patches
  phase judge
    step judgement.shortcut                   setup, verification or affected failure -> criterion-not-met
    step agent.open                           only without a shortcut
    step judgement.turn                       [LLM] Evaluation; budget end -> stop assessment_absent
      step judgement.repair                   [LLM] Repair, once; stop judgement_invalid
  final assessment.submit                     outcome -> closed; node not Evaluating -> revoked; other non-success -> stop operation_failed
  step actions.request                        success only; traces closed; stop action_unsettled
  final execution.release                     further_work false
  onStop not revoked
    final execution.release(stop)
  dispose resources                           agent session, review trees, review base head

chain examine
  resource claim.watch                        ends before execution.release
  armed from prepare
  phase prepare
    [PAR] prepare.inputs
      branch reads
        step revision.read
        step dependencies.read                [PAR] 3 paged reads
      branch workspace
        step workspace.examine                [PAR] per checkout
        step setup.entries
        step env.setup(examine)               stop environment_failed/setup_failed; exit budget_end
  phase work
    [PAR] work.inputs
      step agent.open
      step verify.node(examine)               node commands only; no rerun, copy or baseline; skipped with no checkout
    step examine.turn                         [LLM] Examine; stop report_absent
  phase finish
    step evidence.report
  final execution.release                     further_work false
  onExit budget_end
    final execution.release                   further_work true, no stop
  onStop not revoked
    final execution.release(stop)
  dispose resources                           agent session, examine trees
```

## 5. Mechanism replacements

### 5.1 Unit record (replaces the done record)

Owner: the Worker Service, which owns the done record rule today and owns `execution.setup.get`.

Storage: a new table `worker_unit_record` in the operational store.

| Column | Reader |
| --- | --- |
| `node_id` | `execution.setup.get` selects by node. |
| `unit_id` | `units.plan` matches the unit. |
| `content_digest` | `units.plan` compares it with `digest(unit.content)` of `src/kernel/json.ts`. |
| `commits` | JSON array of `{ binding_id, commit }`; `units.plan` checks each commit against the node range of its checkout. |

`unit_id` is a task id, or the node id for a node without tasks. Only a task unit, or the node unit of a node without tasks, writes a record. The verdict unit and a node unit that a release failure routes to (`release-gate.ts` `commandOwners`) write no record in a node with tasks, because no reader reads a node-id record there.

Unique key: `(node_id, unit_id)`. A put replaces the row. The table holds no attempt, no execution and no time column, because no decision reads them. Open question 1 holds `project_id` and the row deletion.

Write (`worker.execution.unit_record.put`, `PUT /api/worker/execution/:execution_id/unit_record`):

1. A unit passes its live verification (`verify.own`).
2. `unit_record.put` takes each checkout whose head is in the commit set of the gate of that unit run. With no such checkout, it logs `unit record skipped` and sends nothing, as `writeDoneRecord` does today.
3. It sends `{ unit_id, content_digest, commits }`, with one entry per taken checkout.
4. The server checks the execution proof, the claim, that `unit_id` is the node id or a task id of the pinned revision, and that each `binding_id` is in the repository binding set of the revision.
5. The worker logs `unit recorded`. A failure that is not `revoked` logs `unit record failed` and ends nothing (D10). The put needs a call variant that returns the failure without `halt`, because `run.call` stores every failure as the stop and cancels `operationContext`.

Read on a later execution, on any instance:

1. `execution.setup.get` returns `unit_records` for an `implement` execution.
2. After `base.refresh(claim)`, `units.plan` runs `git rev-list origin/<base_branch>..HEAD` once per checkout. This is the range that `readDoneRecords` reads today.
3. A record is valid when all of these hold:
   - `content_digest` equals the digest of the current unit content.
   - Each `binding_id` of `commits` names a checkout of this execution.
   - Each commit is in the range list of its checkout.
4. A unit with a valid record is done and the plan skips it.

Binding guarantees:

- Same node branch only: a commit of the execution exists only on the node branch. A new attempt from `base_branch`, a rebuilt branch and a force-pushed branch drop the old commits from the range, so every unit runs. This keeps the page rule "No record of an earlier attempt decides that a task is complete, unless the attempt continues the same node branch."
- Base merge: a merge of `origin/<base_branch>` keeps the node commits in the range, so the records stay valid.
- Node commit in the base: a commit that reaches `origin/<base_branch>` leaves the range, as today.
- Unconfirmed push: a commit that never reached the remote is absent on another instance, so its record is invalid there and the unit runs again. On the same instance, the node-key checkout keeps the commit, so the record stays valid, and the finish pushes it.
- Multi-repository node: the record names only the checkouts that the unit changed, as the trailer does today.
- Content binding: a revision that changes a task content changes its digest, so only that task opens again.
- Replacement: a routed round that passes the unit again replaces the row. When that newer commit never reaches the remote, the unit runs once more on another instance. This costs turns, not correctness.
- Correctness still rests on the release gate. A wrong record only skips turns.

Completed count for the budget-end limit (EM ruling 2026-11-14, audit B12): a unit counts as completed when it passes, a checkout head holds its gate commit, and `units.plan` found no valid record for it. The put result does not change the count. A pass of the verdict unit, or of the node unit with the cleared text, always counts. This keeps the current rule.

Migration: no reader for `Kanthord-Done` stays. A node branch with trailers runs each pending unit once more. The release notes state this, as for engine #194.

Removed code: `DONE_TRAILER`, `doneTrailerOf`, `amendTrailer`, `trailerValues`, `readDoneRecords`, `writeDoneRecord`. The `done record skipped` log becomes `unit record skipped`.

### 5.2 Claim check replacement

| Part | Rule |
| --- | --- |
| `ClaimWatch` | One timer per execution. It fires at `lastProofAt + 60 s` (`CLAIM_WATCH_INTERVAL_MS = 60000`, the worker heartbeat interval). |
| Proof | One proof hook on the worker transport covers every call of an operation with `requiresExecution`: `run.call`, the host tools, the credential lease and report, and the telemetry writes. Each completed call sets `lastProofAt` and moves the timer. An execution-end answer of any such call calls `run.revoke()`, so a host-tool revoke also ends as `revoked`. The gateway answers such a call only for a claim with `ended_at` null and `expired_at` in the future, which is the `running` claim state. The execution-end answers are 403 `gateway.invocation.execution_proof_failed` and 409 `scheduler.execution.not_running`. |
| Fire | The timer sends `scheduler.claim.get`. `running` sets `lastProofAt`. Another state, or an execution-end answer, calls `run.revoke()`. A network error moves the timer by 60 s, as today `checkClaim` ignores it. |
| `run.revoke()` | Sets the `revoked` stop and cancels `operationContext`. `stopOnEnd` aborts the pi session; the verification runner kills its command. No throw happens on the timer. |
| End | The watch ends at the first `claim.fence`, before `assessment.submit`, before `execution.release`, before `releaseStop`, and at any stop. A final call can end the claim, and the watch must not read that end as a revoke. |
| Fence | `claim.fence` sends `scheduler.claim.get` directly before each `branch.push` (finish, budget end, stop). A revoke answer gives no push. A network error lets the push continue, as today. In `onStop`, the fence uses `run.cleanupContext()`, because the stop already cancelled `operationContext`. |
| Removed | The `turnCheck` call in `finishTurn` (`native-agent.ts:172-176`), `checkClaim` at `steps-implement.ts:525` and `:598`. The budget guard `budget.exhaustedAfterTurn()` in `finishTurn` (`native-agent.ts:171`) stays: it ends the session before a turn past the turn budget. |

Stop delay: at most 60 s plus one `scheduler.claim.get` round trip plus one abort. Today the delay is one model turn, which can hold a bash tool of up to 600 s.

Safe state after a revoke in the middle of a step:

- The revoked path runs no checkpoint and no push, as today.
- A killed git process can leave `index.lock`. `normaliseGitState` removes each lock at the next take of the tree.
- The watch ends at the fence, so the watch never kills a push. A push that the claim expiry kills keeps its `pending` push record, as today.
- `unit_record.put` and every evidence submit go through the server, which checks the claim.

Stale push: a push is a fast-forward. The fence keeps the window between the last proof and the push to one round trip plus the push, as the per-turn check does today at best.

### 5.3 Gate G git reduction

Setup once per checkout per execution, in `workspace.node`:

```text
git rev-parse --git-path rebase-merge --git-path rebase-apply/applying --git-path rebase-apply --git-path CHERRY_PICK_HEAD --git-path REVERT_HEAD --git-path MERGE_HEAD
```

The result goes to `gitPaths`. Each gate then uses `lstat` on `.git` (must be a directory, else an invariant failure) and `existsSync` on the six paths, with no process. These six paths are per-worktree state, so a later `commondir` or config change does not move them.

Before, write mode, per checkout, per agent turn (`turn-gate.ts`, `local-git.ts`):

| # | Command | Unchanged | Changed | Agent committed |
| --- | --- | --- | --- | --- |
| 1 | `git symbolic-ref --quiet HEAD` | yes | yes | yes |
| 2 | `git merge-base --is-ancestor <before> HEAD` | yes | yes | yes |
| 3 | `git rev-list --merges --parents <before>..HEAD` | yes | yes | yes |
| 4 | `git rev-parse --git-path <6 paths>` | yes | yes | yes |
| 5 | `git rev-parse HEAD` | yes | yes | yes |
| 6 | `git reset --soft <before>` | | | yes |
| 7 | `git add --all` | yes | yes | yes |
| 8 | `git diff --cached --raw -z --no-abbrev --no-renames` | yes | yes | yes |
| 9 | `git hash-object --no-filters -- <M paths>` | | when M paths exist | when M paths exist |
| 10 | `git update-index --cacheinfo ...` | | when conversion-only | when conversion-only |
| 11 | `git diff --cached --quiet --` | yes | yes | yes |
| 12 | `git commit --message <m>` | | yes | yes |
| 13 | `git rev-parse HEAD` (in `commitWork`) | | yes | yes |
| 14 | `git rev-parse HEAD` (in `settleCheckout`) | yes | yes | yes |
| 15 | `git symbolic-ref --quiet HEAD` (assert) | yes | yes | yes |
| 16 | `git rev-parse HEAD` (assert) | yes | yes | yes |
| 17 | `git diff --cached --quiet --` (assert) | yes | yes | yes |
| 18 | `git ls-files --others --exclude-standard -z` (assert) | yes | yes | yes |
| 19 | `git rev-parse --git-path <6 paths>` (assert) | yes | yes | yes |
| 20 | `git diff --name-only -z --no-renames <before> <head> --` (telemetry) | | yes | yes |
| | Total | 14 | 18 (17 with no M path) | 19 (18 with no M path) |

After, write mode, per checkout, per agent turn:

| # | Command | Unchanged | Changed | Agent committed |
| --- | --- | --- | --- | --- |
| 1 | `git status --porcelain=v2 --branch --no-ahead-behind -z --untracked-files=all` | yes | yes | yes |
| 2 | `git merge-base --is-ancestor <before> HEAD` | | | yes |
| 3 | `git rev-list --merges --parents <before>..HEAD` | | | yes |
| 4 | `git reset --soft <before>` | | | yes |
| 5 | `git add --all` | | yes | yes |
| 6 | `git diff --cached --raw -z --no-abbrev --no-renames` | | yes | yes |
| 7 | `git hash-object --no-filters -- <M paths>` | | when M paths exist | when M paths exist |
| 8 | `git update-index --cacheinfo ...` | | when conversion-only | when conversion-only |
| 9 | `git commit --message <m>` | | when the staged set is not empty | when the staged set is not empty |
| 10 | `git status --porcelain=v2 --branch --no-ahead-behind -z --untracked-files=all` | | yes | yes |
| | Total | 1 | 6 (5 with no M path) | 9 (8 with no M path) |

The totals leave out `update-index` (row 10 before, row 8 after). It adds 1 process to both tables when a conversion-only path exists.

Rules of the new gate:

1. Status 1 gives `# branch.head`, `# branch.oid`, the entries, the `u` lines and the `?` lines. `--no-ahead-behind` stops the commit walk against the upstream that `checkout -B <b> origin/<ref>` sets.
2. Fast path (write mode, and checkpoint mode with no `openMerge`): `branch.head` is the node branch, `branch.oid` equals `before`, no entry, no `?` line and no operation path exists. Status lists each path that `add --all` stages, so `add --all` would stage nothing. The turn is unchanged, and the gate ends. An entry with only a worktree-side change takes the slow path.
3. Violation checks run in the order of today. The first match names the code:
   1. `branch.head` is not the node branch (also `(detached)`): `worker.turn.branch_changed`.
   2. `branch.oid` differs from `before`, and command 2 fails: `worker.turn.history_rewritten`.
   3. `branch.oid` differs from `before`, and command 3 lists a merge with a parent that is not `before` and not the commit of `openMerge`: `worker.turn.foreign_merge`.
   4. Conflict mode: the cached `MERGE_HEAD` file does not hold the commit of `openMerge`: `worker.turn.merge_missing`.
   5. An operation path exists (`MERGE_HEAD` excepted in conflict mode): `worker.turn.git_in_progress`.

   When `branch.oid` equals `before`, command 2 holds and command 3 lists nothing, so the gate skips both with no change of result.
4. All checkouts run step 3 in parallel (D7). The gate waits for every checkout. On a violation, it restores every checkout to `before` and calls `run.stop` once with the code of the lowest checkout index. In `onStop`, it restores and returns.
5. With no violation and `branch.oid` not `before`, command 4 resets.
6. Command 6 lists the staged set. The `M` entries with the same regular mode are the conversion candidates for command 7. The staged set minus the conversion-only paths decides the commit, and gives the changed paths for the span. This replaces `diff --cached --quiet` and `diff --name-only`.
7. Status 10 is invariant I: `branch.head` is the node branch, `branch.oid` is the new head, no `u` line, no entry with an index-side change (X is not `.`), no `?` line, and no operation path exists. It also gives the new `heads` value. A conversion-only path can show a worktree-side change (Y), as today, and does not fail the invariant.
8. Conflict mode runs only after `markers.check` found no marker (D23). `concludeMerge` (commands 5 to 9) then commits the merge.
9. Checkpoint mode with `openMerge` runs the conflict-mode checks on that checkout and concludes the merge (D13). The `openMerge` has no marker, because `markers.check` ran at the budget end and a marker sends the chain to the D23 failure path. A `MERGE_HEAD` with no `openMerge` is aborted first, as today.

Replacement map:

| Removed process | New source |
| --- | --- |
| `symbolic-ref` (check and assert) | `branch.head` of status 1 and status 10 |
| `rev-parse HEAD` (3 times) | `branch.oid` of status 1 and status 10 |
| `rev-parse --git-path` (check and assert) | `gitPaths` and `lstat` on `.git` |
| `merge-base --is-ancestor`, `rev-list --merges` on an unchanged head | Skipped; the result is fixed when `branch.oid` equals `before` |
| `add --all`, `diff --cached --raw` on a clean status | Skipped; status lists every path that `add --all` stages |
| `diff --cached --quiet` (decision and assert) | The staged set of command 6, and the X column and `u` lines of status 10 |
| `ls-files --others --exclude-standard` | The `?` lines of status 10 (`--untracked-files=all` honors the same exclude files) |
| `diff --name-only` (telemetry) | The paths of command 6 |

Restore sequence after a live verification, per checkout: before 9 processes (`rev-parse --git-path`, `checkout --force -B`, `reset --hard HEAD`, `clean -ffd`, 5 asserts). After 4 processes: `checkout --force -B <branch> <head> --`, `reset --hard HEAD`, `clean -ffd`, one status as invariant I; the operation paths come from `gitPaths`. When an operation path exists, its quit command runs first, as today.

### 5.4 Credentials

Today `hostExecution` (`apps/worker/execution.ts`) handles credentials before `runNativeExecution`, outside the chains. The design moves the same behavior into a shared `claim` phase and two chain resources. No rule changes.

| Part | Rule |
| --- | --- |
| `credentials.handover` (S43, server) | `worker.handover` with `{ execution_id }`. Open the envelope with the handover key from `client_secret`. Open each sealed item with the key of its `holder`. Build the in-memory pi credential store. Take `ssh_identities`. The first handover of an attempt writes `mission_attempt.prompt_commits`. Retry `worker.handover.refresh_in_flight` until the claim expires. Stops: `worker.handover.decryption_failed`, `worker.handover.sealed_unopened`, `worker.credential.lease_mismatch`, `custody.handover.holder_refused`, `project.bindings.repository.ssh_unreachable`, `project.bindings.repository.base_branch_absent`. Logs: `credential handover received`. |
| `setup.read` (S44, server) | `execution.setup.get`, with the retry of an indeterminate result. It reads the prompt commits that S43 pins, so it runs after S43. It returns `unit_records` (D5). |
| Claim phase outcomes | A refusal of S43 or S44 (a coded failure that is not `gateway.*` and not an execution end) releases with a stop: an S43 refusal with an empty credential set, an S44 refusal with the handover credentials. A `gateway.*` failure, or an indeterminate answer after the retry, releases nothing: the host logs `worker.execution.setup_unavailable`, and the pull loop pauses with backoff (`execution.ts:52-62`, `:267-280`, `pull-loop.ts:160-161`). An execution-end answer releases nothing and ends the execution with no Diagnostic (`execution.ts:128-131`). |
| `credential.store` (C1, resource) | The pi auth view exposes only the credential of the effective agent provider at the pinned revision. A refresh takes `worker.credential.lease`, then sends `worker.credential`. A lease retry ends when the claim expires or `operationContext` aborts, so a `ClaimWatch` revoke also ends it. A lease answer for another credential stops with `worker.credential.lease_mismatch`. No credential reaches a file, a span or a log. |
| `ssh.access` (C2, resource) | One signer per repository binding: the handed key at the `server` and `container` placements, the `worker.ssh.sign` relay at the `worker` placement. Each git network operation gets its own agent socket. With D7, parallel fetches and pushes open one socket each. |
| Final report | Every final call (`assessment.submit`, `execution.release`, `execution.release(stop)`) settles the credentials once before the call: `worker.credential` once for each credential, also when it is unchanged. The settle runs before `assessment.submit`, because that call can close the execution and `worker.credential` needs a live execution. A refused report with an execution-end answer ends the execution as `revoked` with no release. |
| Host end | The host logs `execution ended` with the end kind, the reason, the code and the detail. |
| Dispose | Last entry of the `AsyncDisposableStack`: `sshAccess.clear()`, `credentials.discard()`, zero the handover key. |

### 5.5 Agent tooling

| Part | Rule |
| --- | --- |
| Tool set | `agent.open` reads the declaration of the agent (`getAgentDeclaration`). `swe@1`: `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash`, plus the host tools `evidence_upload` and `link_update_list`. `re@1` and `env@1`: `read`, `grep`, `find`, `ls`. |
| `bash` | Wrapped by `tool-table.ts`: timeout `min(remaining budget, 600 s)`, refused below 1 s; `childEnvironment` strips the provider environment; `killGroupAtEnd` kills the process group; each call records the requested and applied timeout. |
| Host tools | `evidence_upload` and `link_update_list` call the server through `hostToolsOf` with the execution context. The proof hook of the transport (section 5.2) moves the `ClaimWatch` timer on each completed call. An execution-end answer calls `run.revoke()`, in place of `state.revoked` and the cancel of the host context. |
| Hooks, in order | `homeRelativeCwd`, redaction restore, `pinnedLayers` (the work prompt as the first user message), redaction. The resource loader loads no extension, skill, prompt template, theme or context file. |
| Confinement | `re@1` in the evaluation chain gets `checkoutConfinement` (D27), with the review checkouts and the `evidence` directory as roots. A workspace with no checkout has the workspace directory as its root. `swe@1` stays unconfined, because `bash` reaches every path anyway. `toolApproval` stays with `env@1`. |
| Revoke | `ClaimWatch` cancels `operationContext`. `stopOnEnd` aborts the session, and `killGroupAtEnd` ends a running `bash` group. |

### 5.6 Telemetry

Every span keeps today's name and attributes. The table names the owning step of each span. Every span carries `kanthord.execution.id`, `kanthord.node.id`, `kanthord.attempt` and `kanthord.worker.name`.

| Span | Owning step | Attributes |
| --- | --- | --- |
| `worker.phase` | Runner, one per phase | `kanthord.phase`. The `prepare` span of implement ends with `kanthord.node.task_count`, `kanthord.node.verification_count` and `kanthord.node.binding_count`. |
| `worker.step` (new, D15) | `spanned` middleware, one per step | `kanthord.step.id`, `kanthord.step.work`, the outcome. |
| `worker.task` | `unit.enter` opens it; the unit end closes it | `kanthord.task.id`, `kanthord.evaluation.round` in a routed round. End: `kanthord.task.result`, `kanthord.task.revision_count`. A `no_progress` stop adds `kanthord.stop.reason`, `kanthord.stop.rule`, `kanthord.stop.count`, `kanthord.stop.limit` and, after a verification, `kanthord.stop.verification.passed`, `.timed_out`, `.index`, `.exit_code`. |
| `worker.gate` | `gate.g`, `checkpoint.gate` | `kanthord.gate.mode`, `kanthord.gate.changed`, `kanthord.gate.violation`, `kanthord.git.changed_file_count`, `kanthord.git.changed_files`. New: `kanthord.git.process_count` (D15), and `kanthord.unit.id` and `kanthord.git.commit` on a gate commit (D24). |
| `worker.verification` | `verify.own`, `verify.all`, `verify.node`, `affected.run` | `kanthord.verification.context`, `.kind`, `.owner_id`, `.index`, `.run`, `.class`, `.timed_out`, `.flaky`, `.signal`, `kanthord.commit`. |
| `worker.git` | `base.merge` (`merge_base`), `base.fetch` (`fetch_base`), `branch.push` (`push`) | `kanthord.git.step`. The git step mark of a failure gives the stop cause (`stop-cause.ts`). |
| `worker.setup` | `env.setup` | `kanthord.setup.result`, `kanthord.setup.entry_count`. |
| `worker.release_gate` | Nested phase `release_gate` | `kanthord.release_gate.result`, `.affected`, `.unit_id`. |
| `worker.evaluation` | Evaluation chain, from `verify.all(evaluation)` to the end of `judgement.turn`; it ends before `assessment.submit` | `kanthord.commit`. End: `kanthord.evaluation.*`, `kanthord.judgement.repaired`. |
| `agent.session` | `agent.open` opens it; the trace close of the final call ends it (rule 12) | `gen_ai.operation.name`, `gen_ai.conversation.id`, `gen_ai.agent.name`, `gen_ai.request.model`, `kanthord.agent.*`, `kanthord.session.format`, `kanthord.session.format_version`. End: `kanthord.session.entry_count` and the redaction counts. |
| `agent.turn` | Each LLM step; child of its `worker.step` span | `gen_ai.*` request, response and usage, `kanthord.turn.index`, `kanthord.turn.model_duration_ms`, `kanthord.prompt.template`, `kanthord.prompt.template.digest`, `kanthord.prompt.work.digest`, `kanthord.usage.cost_usd`. |
| `agent.tool` | Each tool call of an LLM step | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `kanthord.tool.outcome`, `kanthord.tool.duration_ms`, `kanthord.tool.timeout.requested_ms`, `kanthord.tool.timeout.applied_ms`, `kanthord.tool.killed`. |
| Session entry records | `agent.session`; sent at each session event and at the trace close | One record per pi session entry (`agent-telemetry.ts:259`). |

## 6. Before and after

| Observed cost | Change | Expected effect |
| --- | --- | --- |
| `checkClaim` per model turn and per unit loop | `ClaimWatch` (60 s after the last proof) and a fence before each push (D4) | Estimate: a 20-minute execution with about 80 model turns sends about 80 to 90 checks today and at most 20 after; fewer when server calls prove the claim. A revoke now also aborts a running command. |
| Gate G 14/18 git processes per checkout per turn | Status-based gate (D6) | Unchanged turn 14 to 1. Changed turn 17 or 18 to 5 or 6. Agent-committed turn 18 or 19 to 8 or 9. Exact counts from section 5.3. `kanthord.git.process_count` on `worker.gate` confirms them (D15). |
| Repeated asserts and a telemetry-only diff | Status 10 is the assert; the raw diff gives the paths | Included in the counts above. |
| Done-record amend changes the head | Unit record in the Worker Service (D5) | No amend and no extra `rev-parse` per unit per checkout; heads change only at a gate commit. One server put per unit pass with a commit. One `rev-list` per checkout at planning. No trailer in the user repository. |
| Release gate reruns every command after the units; the reviewer runs them again on the same commit | Both runs stay, in plan order (D11) | No change. |
| Serial loops per checkout (gate, refresh, setup, clones) | Parallel git per checkout (D7); merges and setup stay serial (D3) | With N checkouts, the wall time of the gate, the restore, the fetch, the tree build and the push goes from the sum to about the maximum (estimate). No change for one checkout. |
| Serial server reads in Read context | Parallel reads, overlapped with Prepare (D8) | Estimate: 4 to 7 serial round trips become 2 to 4 dependent rounds, hidden behind the clone and the fetch. |
| Agent open after the setup | Agent open in parallel with `env.setup(live)` (D20) | The open time hides behind the setup. |
| Pool size 1 Agent tree; full network clone on miss | No change; add `source` and duration to the span (D17) | No effect yet. The data then shows how often a miss happens. |
| Reviewer downloads all assets and pages all evidence | Downloads in parallel with the review setup, at most 4 at a time, streamed (D16); dependency reads move into the first parallel group | Estimate: download time hides behind the setup. Peak memory is one stream buffer per download, not the whole object. |
| `no_progress` stop detail has no agent reason | Add `unit_id`, `template`, redacted `agent_reason` (D14) | A human sees why the agent made no change, with no session file. |
| Invalid affected declaration found only at the release gate | Validate in Prepare (D9) | Stop before the first LLM turn; saves the whole turn budget of that execution. |
| Restore after each live verification, 9 processes per checkout | 4 processes (D12) | Estimate: 5 fewer processes per checkout per verification. |
| Complete conflict resolution lost at a budget end | Check the markers once more, then conclude a marker-free merge (D13) | The next execution starts from the merged head and needs no new conflict turn. |
| Telemetry phases only in implement | Phase and step spans in all chains (D15) | Every step has a duration and an outcome in the trace. |

## 7. Open questions

1. **Unit record table. DECIDED 2026-11-14 by Ulrich: approved.** The verdict unit writes a record only for a node without tasks. Column review (EM ruling 2026-11-14): no `project_id`, because the table is node-scoped. The Mission Service deletes the rows of a node through a `unitRecords.deleteNode` port in the transaction to `Completed`, `Discarded` or retired, and in the transaction that opens an attempt from `base_branch`. Original text: I want to add `worker_unit_record` with the four columns in section 5.1, because the value cannot be computed and `units.plan` reads each column. AGENTS.md asks for a separate review round for a column list. That round also decides two points. First, AGENTS.md puts `project_id` as the second key column of a project-scoped table, and no decision reads it here. Second, no reader reads a row after its node closes, so the Worker Service deletes the rows of a node at its close.
   - Alternative: an evidence with subject `Unit done <unit_id> <digest>` and repository assets. No new table, but the release obligation (`hasEvidence`) and the reviewer `snapshotOf` then accept it, so both need a subject filter.
   - Alternative: a trailer with a neutral key. No server change, but the record stays in the user repository and the amend stays.
2. **Agent text in the `no_progress` detail. DECIDED 2026-11-14 by Ulrich: a redacted excerpt of at most 512 characters goes in the stop detail.** worker-service.impl.md states that a stop detail is not a log record. Original text: I want a redacted excerpt of at most 512 characters of the last agent text in the detail, because the stop has no reason today. The log rule of `worker-service.impl.md` forbids agent content in a log record; a stop detail is not a log record, but the same intent can apply.
   - Alternative: put the excerpt only in the `worker.step` span text. No agent content in the stop, but a human then needs the trace.
3. **Fence on a network error. DECIDED 2026-11-14 by Ulrich: the push continues.** Original text: I want the push to continue when the fence gets a network error, because that matches the current tolerance of `checkClaim` and a push is a fast-forward.
   - Alternative: skip the push and keep the pending push record. No stale push, but a server outage at the finish keeps work local until the next execution on the same instance.
4. **Later server shape. DECIDED 2026-11-14 by Ulrich: client-side parallel reads only, no API change.** Original text: I want to stop at the client-side parallel reads now, because they need no API change.
   - Alternative: one `worker.execution.context.get` that returns the revision, the prior, the review round and the link updates from one database snapshot. One round trip and one snapshot, but it crosses the Mission and Worker owners.
   - Alternative: the worker heartbeat answer lists the revoked executions of the instance. No claim call at all, but the Worker Service heartbeat then reads Scheduler state.
5. **Partial conflict resolution. DECIDED 2026-11-14 by Ulrich: a programmatic marker check follows each conflict turn; markers left send `swe@1` another conflict turn until no marker is left (D23).** Original text: I want to accept the loss of a resolution that still holds markers at a budget end, because a pushed partial merge needs a new evidence kind and a new prompt input.
   - Alternative: store the resolved files as a produced evidence and give them to the next Conflict turn. Saves conflict work, but adds a contract.
6. **Scope of the trademark concern. DECIDED 2026-11-14 by Ulrich: branches and commits carry no id. A branch gets a semantic name and a commit a semantic message (D24). The branch rule is approved.** Original text: I want to remove only the trailer now, because the EM named the trailer. The node branch prefix `kanthord/` and the file `.kanthord/affected-tests.json` also put the name in the user repository.
   - Alternative: rename the branch prefix and the declaration path in the same release. One migration for every name, but each in-flight node branch and each declaration file then needs a move.

## Pages that record the rulings

- `worker-service.md`: the done record paragraphs (lines 437-446) and the sequence diagrams (lines 517, 891).
- `worker-service.vocabulary.md`: `done record` becomes `unit record`.
- `worker-service.impl.md`: the done record, gate G, the restore sequence, the claim check, the no-progress counter scope, the affected declaration position, the agent open position, the telemetry phases, the `agent.turn` parent rule under `worker.step` (Traces), the final call order (Traces), and the cleanup deadlines (Stop and budget).
- `scheduler-service.impl.md` or the owner of `scheduler.claim.get`: the watch interval, the watch end points and the fence.
- `docs/reference/erd/`: `worker_unit_record`, after the column review.
- `engine/docs/cli/` worker page: the new operation and its error codes.
- `HANDOFF.md`: one item per open question above, under the Worker Service.
