# Worker node execution: chain design

Status: ruled design. The owning pages hold the rules; the code does not change yet.
Sources: the engine code at `engine/src/worker/unit/` and `engine/src/apps/worker/` at engine commit `2797a453`, and the code facts list below. This document names each code fact in the list below, with its file.

Code facts:

- `ExecutionRun.halt` cancels `operationContext` with the stop. `stopOnEnd` aborts the pi session on that cancel (`native-method.ts`). A revoke from a timer thus aborts a model turn and a verification command at once.
- The verification runner stops at the first command that does not pass (`verification.ts:414`).
- Push is a fast-forward `git push origin refs/heads/<b>:refs/heads/<b>` (`repository/connector.ts:665`).
- The release obligation of the Mission Service accepts any evidence of the execution whose repository assets cover the binding set (`mission/transitions.ts` `hasEvidence`). The reviewer takes the newest support evidence with a repository asset as the snapshot (`evaluation-input.ts` `snapshotOf`). A new evidence with repository assets thus changes both rules.
- `prepareStepsWorkspace` reads `.kanthord/affected-tests.json` at `origin/<base>` and skips an invalid file. `runAffected` stops with `environment_failed affected_invalid` only in the release gate, after every agent turn (`affected.ts:826-839`).
- One slot runs per instance (`worker-service.impl.md`, the tree pool). An Agent tree per address thus serves one execution at a time.
- `execution.setup.get` and `execution.link_update.get` belong to the Worker Service (`worker/contract.ts:1900`, `:1965`).
- The registration heartbeat runs every 60 s (`apps/worker/registration.ts` `HEARTBEAT_INTERVAL_MS`) and carries no stop order. The instance heartbeat runs every 15 s (`worker/contract.ts` `INSTANCE_HEARTBEAT_INTERVAL_MS`).
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
- Examine runs only the node commands, with no flaky rerun, no copy, no baseline and no infrastructure or environment stop. The shared runner reruns an infrastructure-class command once; the second result goes into `verification`. It skips the run when no checkout exists (`steps-examine.ts:70-97`).
- `runNativeExecution` selects the method from the worker declaration. A declaration with no method stops with `operation_failed` and no code (`native-method.ts:103-104`, `:146-149`).
- `openSession` gives pi a list of inline extension factories through `DefaultResourceLoader`: `homeRelativeCwd`, the redaction restore, the hooks of the caller, the redaction hook. It sets `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes` and `noContextFiles`. It passes the allowlist as `tools` of `createAgentSession` (`agent/agent-session.ts:104-129`). It does not call `session.bindExtensions({})`, so pi emits no `session_start` event. It ends a session with `session.dispose()`, which emits no `session_shutdown` event (`agent/agent-session.ts:136`).
- `sessionTools` builds each `host_tools` entry of the agent declaration as a pi `ToolDefinition`. It passes them as `customTools`, with the wrapped `bash` (`tool-table.ts:91`, `:144`).
- No worker session uses `checkoutConfinement`. Only the project environment agent uses it (`project/environment-agent.ts:306`). Only the Workbench session uses `toolApproval` (`workbench/service.ts:410`). The hook checks the field `path` of `read`, `grep`, `find` and `ls` (`agent/hooks/checkout-confinement.ts:7`).
- The redaction hook restores a marker into a tool input only for the tools of `RESTORE_TOOLS`: `write` and `edit` (`agent/hooks/sensitive-text-redaction.ts:101`).

## 1. Decisions

### EM ideas

- **D0 (idea 0): use a typed staged pipeline, not a Chain of Responsibility.** Reason: every step runs in order and adds data; a Chain of Responsibility passes one request until one handler takes it, so it does not fit.
- **D1 (idea 1): each step declares `reads`, `writes` and `stops`. The step type gives each step only its `reads` slice. `build()` rejects a read with no earlier writer, two parallel branches that write one key, and an exit node that reads a key that the exit point can lack. A test builds each chain.** Reason: a move, an insert or a removal that breaks a contract then fails in a unit test, not in a live run. A type-level key check across loops, parallel groups and exits costs more than it gives.
- **D2 (idea 2): share a step when its contract is the same in each chain. Share a service when the contract differs.** Shared steps: `inputs.read`, `workspace.review`, `env.setup`, `verify.all`, `affected.run`, `agent.open`, `execution.release`. Shared services: tree acquisition (pool take, guards, clone, fetch), the setup runner, the verification runner, gate G, the restore sequence. Reason: `workspace.review(refs)` takes the ref kind as a parameter, so the difference is explicit. `workspace.node` has its own stop codes, the push record, the node-key reuse and the scratch store; it stays separate.
- **D3 (idea 3): order each chain as static, then server and git, then shell, then LLM. Run git and server work in parallel. Keep shell commands serial. Keep each local merge serial.** Reason: commands of one node share ports, build directories and the pnpm store, so parallel commands give false failures and break the flaky-pass rule. A merge can open a conflict turn, and gate G refuses an open merge in another checkout.
- **D4 (idea 4): replace the per-turn claim check with a `ClaimWatch` timer. The timer fires 60 s after the start and every 60 s until its end point. A fence reads the claim before each push. The watch ends at the first fence and before each final step.** Reason: the timer cancels `operationContext`, which aborts the pi session in the middle of a turn, so the stop is faster per call and the call count drops. First signal (EM ruling 2026-11-15, audit S4): `endLiveClaim` queues a stop order with reason `revoked` for every revoked claim except a human pause. At the `server` and `container` placements, the pool host sends the stop order at once through the slot `stopOrders` call. At the `worker` placement, the process reads it on the next instance heartbeat (15 s) through the work read. The worker unit then calls `run.revoke()` with no release. The 60 s registration heartbeat carries no stop order. `ClaimWatch` is the fallback for a lost slot message or a lost instance heartbeat. The stop order needs no claim read.
- **D5 (idea 5): replace the `Kanthord-Done` trailer with a unit record in the Worker Service. `execution.setup.get` returns the records. A new `worker.execution.unit_record.put` writes one record after each unit pass that made a gate commit. A record binds to the content digest and to each commit of the unit run that is a checkout head at the pass.** Reason: the record leaves the user repository, the amend and the head change go away, and the setup read already happens, so the read costs no round trip.
- **D6 (idea 6): replace the 14 to 19 git processes of gate G with one `git status --porcelain=v2 --branch --no-ahead-behind` before and one after, plus file checks on cached operation paths.** Reason: one status gives the branch, the head, the index state and the untracked files, which are the facts of the removed processes.

### Own ideas

- **D7 (own idea): run per-checkout git work in parallel.** This covers gate G, the restore sequence, the base fetch, the release tree build and the push. Merges stay serial (D3). Reason: the checkouts are separate repositories; the wall time becomes the maximum, not the sum.
- **D8 (own idea): run the Read context reads in parallel with each other and with Prepare.** A read that the verdict precedence can skip runs only when the precedence needs it. Reason: no read depends on Prepare, and the first consumer is in Start; the read latency hides behind the clone and the fetch.
- **D9 (own idea): validate `.kanthord/affected-tests.json` at `origin/<base>` in Prepare. Stop with `environment_failed affected_invalid` before the first LLM turn.** Reason: the agent cannot fix a file at the base, so the release gate stop after all agent turns wastes the whole budget.
- **D10 (own idea): a failed `unit_record.put` that is not `revoked` logs `unit record failed` and does not stop the execution. The unit then counts as not recorded.** Reason: a record only saves turns of a later execution, and a transient server error must not end work in progress.
- **D11 (own idea): keep the coder release gate and the reviewer verification as two separate runs, each in plan order.** Reason: the clean-clone check before push and the independent reviewer verification are invariants. A scrubbed tree needs the output of each earlier command, and the owner of a failure comes from its plan index.
- **D12 (own idea): cut the restore sequence after a live verification from 9 git processes to 4 per checkout. Cache the tree id of each commit for the verification memo.** Reason: the 5 assert processes collapse into one status, and a tree id never changes for a commit.
- **D13 (EM ruling 2026-11-16, own idea): at a budget end in a conflict turn, `markers.check` runs once more on the open merge. No marker: the checkpoint gate runs the conflict-mode checks and concludes the merge. Markers left: the D23 failure path runs.** Reason: today a complete resolution that ends with the budget is lost; the marker rule still blocks every bad merge.
- **D14 (own idea): add `unit_id`, `template` and a redacted `agent_reason` of at most 512 characters to the `no_progress` detail. The detail fitting cuts `agent_reason` before `command`. `agent_reason` is the last agent text after `run.reasonOf` redaction with the secret list of the execution; the redaction runs before the cut to 512 characters; when the secret list cannot be read, the detail holds no `agent_reason`.** Reason: a human reads a counted stop with no reason today.
- **D15 (own idea): the chain runner opens one `worker.phase` span per phase and one new `worker.step` span per step, for all three chains. The `worker.gate` span gets `kanthord.git.process_count`.** Reason: today only `implement` has phase spans; `runStep` gives the spans to every step with no step code. The process count proves the D6 and D12 savings in production.
- **D16 (own idea): place the reviewer assets in parallel with the review setup, with at most 4 downloads at a time, streamed to disk.** Reason: the downloads do not depend on the setup, the placement directory is outside each review tree (a workspace with no checkout runs no setup), and `arrayBuffer()` holds a whole object in memory.
- **D17 (own idea): keep the tree pool size. Add `source` (`pool` or `clone`) and the duration to the workspace step span.** Reason: one slot per instance means one free Agent tree per address covers sequential executions; measure the misses before a change.
- **D18 (own idea): keep one pi session per execution.** Reason: an execution runs on any instance, the prompt cache does not live across executions, and the Read context already carries the memory.
- **D19 (own idea): each step that takes a resource registers its release on one `AsyncDisposableStack`. The host disposes the stack once.** Reason: success, budget end and stop then share one cleanup path; Node 24 ships the type.
- **D20 (EM ruling 2026-11-14, audit S1): in implement, run `env.setup(live)` after `base.refresh(claim)`, on the merged heads, in parallel with `units.plan`.** `agent.open` runs in prepare as a member of `workspace.static`, because the conflict turn needs the session. The conflict turn runs with no live setup; the marker check and the release gate decide correctness. New: a setup stop or a setup budget end now runs `onStop` or `onExit` and pushes the merged heads. Reason: the agent always works on an environment that matches the merged code.
- **D22 (EM ruling 2026-11-14): measure and improve the `Conflict` prompt during the refactor.** Keep one `swe@1` turn and add no second agent. Record per turn the conflicted file count, the model turns, the end, and a release gate failure on a command whose owner touched a conflicted file. Candidate: add the base-side log and diff since the merge base per conflicted file, cut at a byte limit. Compare before it becomes the default. Reason: the prompt asks to keep the base change intact but does not show it. HANDOFF holds the item under the Worker Service.
- **D23 (EM ruling 2026-11-14): loop the conflict turn on a programmatic marker check.** The `conflict.revisions` loop runs `conflict.turn`, then `markers.check` (`conflictMarkerFiles` over the files of `openMerge`). Markers left: keep the merge open, commit nothing, and send a conflict turn that lists the files with markers. No marker: gate G in conflict mode commits the merge. Bound: the first `markers.check` of a merge sets the marker counter to 0; a later check that finds the same marker files with the same content adds 1; at 2 the resolution fails. A failed resolution loses no work (EM ruling 2026-11-14): the worker submits a conflict report evidence with the content of each conflicted file and the files that still hold markers, aborts the merge, and releases with a stop that closes the attempt into `Blocked` through a new Mission transition `Executing -> Blocked`. New: a failed submit logs `conflict report failed`; the step still aborts the merge and stops with `conflict_unresolved`. A budget end while markers are left takes the same path: report evidence, merge abort, node `Blocked` (EM ruling 2026-11-14). Blocked release (EM ruling 2026-11-14, audit B8): the stop reason and the transition rule are `conflict_unresolved`; `recordStop` moves the node to `Blocked` with no failure count. `onStop` pushes `heads` first. The conflict report is a produced asset only. The marker counter belongs to one merge, separate from the no-progress counter. The cause is the `merge_base` git step. Reason: today the first check with markers left ends the execution, and the work of the turn is lost.
- **D24 (EM ruling 2026-11-14): semantic branch names and commit messages with no id.** Commit: keep the header `<type>: <unit name>` and drop the id body. Branch: a name chosen once per attempt start and stored with the start point; the push guard checks the `node_branch` of the claim. Branch rule (EM ruling 2026-11-14): `<commit_type>/<node name slug>`, slug lower-case kebab, at most 50 characters; a `-2`, `-3` counter when the remote holds the name; a new attempt from the base gets the next free counter. Branch ownership (EM ruling 2026-11-14, audit B5 and B6): the server reserves each name per binding and never gives it out twice. The first push of an attempt uses `--force-with-lease=refs/heads/<branch>:` and expects the branch to be absent. The first handover of the attempt chooses the name: it skips each reserved name and each name that `git ls-remote` shows, then pins the name like `prompt_commits` (EM ruling 2026-11-16). A refused first push stops with `repository.node_branch.taken`; the name of an attempt never changes. Commit attribution (EM ruling 2026-11-14, audit B9): when gate G commits, the `worker.gate` span ends with `kanthord.unit.id` and `kanthord.git.commit`; the rule of worker-service.md:419 becomes attribution through that span. The create-only first push does not overwrite a branch, so the rule text becomes "No act deletes, renames or overwrites a node branch". `.kanthord/*` stays as the project configuration directory (EM ruling 2026-11-14, S16).
- **D25 (gap found by Ulrich 2026-11-14): make credentials part of the host execution.** The host (`hostExecution`) runs `credentials.handover` then `setup.read` before `runChain`, creates the dispose stack, and defers the credential entry first. It calls `runChain` with the seed `claim`, `setup` and `sshAccess`. `hostExecution` gives the handover result only to `credential.store`, and no context key holds a credential (D32). `agentPort` gets the model runtime factory over that store and the known secrets. `credential.store` (C1, pi auth, refresh lease and report) and `ssh.access` (C2, handed key or relay signer per binding) stay host resources on that stack. Every final step settles the credentials once before the call (audit B2). Dispose discards every credential, clears SSH access and zeroes the handover keys. Section 5.4 holds the rules.
- **D26 (gap found by Ulrich 2026-11-14): make the agent tool set part of the `agent.open` contract.** The step reads the agent declaration (`tools`, `host_tools`) and writes the tool allowlist, the host tools and the hook list. Section 5.5 holds the rules.
- **D27 (EM ruling 2026-11-14): confine the `re@1` read tools.** The agent open service of `judgement` adds `checkoutConfinement`. The allowed roots are the review checkouts and the `evidence` directory. A workspace with no checkout places the assets in the workspace directory itself, so that directory is the root (`evaluation-input.ts:524-527`). The hook resolves each `path` with the path function of pi (`resolveToCwd`: `@` prefix, `~`, `file://`, Unicode spaces), then follows symbolic links. The hook accepts the path when the result is inside one root. The hook refuses a path that it cannot resolve. A call with no `path` takes the agent root. With two checkouts the agent root is `review/checkouts`; the roots are the agent root and the `evidence` directory. The review bundle keeps its paths relative to the agent root. A test reads `@<absolute path>`, `~`, `file://` and a symbolic link that leaves the roots, and asserts a refusal. Reason: `re@1` has no `bash`, so the hook is its only path boundary; today it can read every file of the worker user.
- **D28 (EM ruling 2026-11-14, audit S2): retry an indeterminate answer with the same idempotency key.** `run.call` keeps one key for all tries. It retries `Indeterminate` and 409 `gateway.idempotency.conflict` with `Backoff` for at most 30 s and never past `expired_at`. It stops at once on `closed` and on a stop of the run. After the bound it stops with `operation_failed`. `retryIndeterminate` takes the key outside its loop. Reason: the gateway replays a recorded answer by key, so a lost response must not cost a counted failure.
- **D29 (EM ruling 2026-11-15, audit S10): submit one coder report per unit, directly after the unit passes.** The subject is `Coder report of unit <unit id>`. The reviewer keeps the newest coder report of each unit id of the pinned revision. At a budget end, only a unit that passed has a coder report; the checkpoint commit of the open unit has no report. Reason: today the report waits for the end of the execution, a budget end submits none, and the reviewer reads only the newest report, so the units of a budget-end execution never reach the reviewer.
- **D30 (EM ruling 2026-11-16, audit S15): the commit identity is a property of the repository.** The repository binding config holds `commit_identity: { name, email }`, required for the first live binding of a `resource_identity`, copied for the next ones, and cascaded to every live binding of that `resource_identity` on a change. `execution.setup.get` sends it per repository; the worker sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*` per checkout. `DEFAULT_IDENTITY` and the four identity names of `KEPT_GIT_VARIABLES` are deleted. Reason: the default `kanthord <kanthord@localhost>` puts the product name into user repositories, and the identity belongs to the repository, not to the worker host.
- **D21 (own idea): deliver in layers. Each layer passes the full engine suite before the next layer starts.**
  1. Gate G and restore reduction on the current code (D6, D12).
  2. Unit record, then removal of the trailer code (D5, D10).
  3. `ClaimWatch` and push fence (D4).
  4. Chain runner. Port the current steps with no behavior change. A test prints each built chain in the notation of section 4 and compares it with a golden file.
  5. Parallel groups and fail-early order (D7, D8, D9, D16, D20). `SpanRecorder` takes the parent from the scope of the branch, not from one stack.
  6. Checkpoint merge, telemetry and stop detail (D13, D14, D15).

  Reason: layers 1 to 3 each change one file group (`turn-gate.ts` and `local-git.ts`, `done-record.ts`, `execution-run.ts`) and give the cost cut that the EM asks for with no runner. Layer 4 then ports verified behavior, and the golden file keeps section 4 equal to the code.

- **D31 (own idea): run the `tasks` phase as a standalone local command through the Foundry ports and the agent tools of D32.** The command uses production step code with no step of its own. No `tasks` step holds placement logic or imports a transport constructor; placement lives only in the Foundry host. The command adds one production behavior: the capture hook of section 5.7. Reason: a developer runs and replays the core of an execution on one machine with no server access and can change one variable and compare the result.

- **D32 (EM ruling 2026-11-17): the Foundry is the core of a node execution. It is a custom framework on pi-coding-agent.** D32 extends D31 to all three chains.
  - A Foundry host calls one function of the Foundry per chain: `foundryImplement`, `foundryEvaluation` or `foundryExamine`. The Foundry does not know its Foundry host.
  - The Foundry host has two forms: the KanthorD worker and the standalone CLI. Both forms run the same code of the Foundry.
  - A human, a harness or the long-running worker process prepares the input. The same consumer takes the local materials after the phase and acts on them.
  - The Foundry depends only on its input and on the host tools that the Foundry host injects. It constructs no client, no transport and no resource.
  - The Foundry makes a side effect only through a host tool. A host tool is an agent tool or a Foundry port.
  - Typed Foundry ports take the place of the operation-shaped `MethodClients` for `tasks`. A chain gets only the ports that its steps call.
  - `ExecutionRun`, the credentials, the SSH signer and the tree service stay outside the Foundry. A `tasks` step returns its stop as a value.
  - No context key holds a credential, so no step of any phase can read one. Only `credential.store` holds the handover result, as host code.
  - The agent tools build on the pi extension design. A capability is one pi extension factory. The design adds no registry, no plugin format and no tool interface where pi has one.
  - A later capability (search, browser, MCP) is one more pi extension factory in the capability list. No `tasks` step changes for it.
  - D32 keeps these parts of D31:
    - the seed, `tasks_prepare`, `--tree` and the mirror;
    - the credential input, the capture hook and the seed export;
    - the output folder, the `--verify` checks, `compare` and `until`.

  Sections 2, 5.4, 5.5 and 5.7 hold the rules. Reason: one boundary lets a human, a harness and the worker drive the same core. No code of the Foundry can reach a server, a remote or a credential.

### Invariants

| Invariant                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The execution is the only commit author.         | Kept. Gate G still soft-resets agent commits and commits once per turn. The amend goes away.                                                                                                                                                                                                                                                                                                                                                 |
| Gate violations (`worker.turn.*`)                | Kept, with the same precedence. Section 5.3 maps each check to its new source.                                                                                                                                                                                                                                                                                                                                                               |
| Verdict rule semantics                           | Kept. The `rev-list` command and the judged-commit history check do not change.                                                                                                                                                                                                                                                                                                                                                              |
| No-progress rule                                 | Kept. The counter lives in the `progress` context key with the reset rules of section 5.8.                                                                                                                                                                                                                                                                                                                                                   |
| Independent reviewer verification                | Kept (D11).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Clean-clone check before push                    | Kept. The `release_gate` loop stays the only entry.                                                                                                                                                                                                                                                                                                                                                                                          |
| Trusted-link filtering                           | Kept. The server filters at read time; a parallel read does not change it.                                                                                                                                                                                                                                                                                                                                                                   |
| Stop accounting codes                            | Kept. Evaluation still turns a budget end into `assessment_absent`. New: examine releases a budget end with the stop `budget_end/<limit>`. Implement still sends `budget_end` only when no unit completed. A stop order or a unit stop still releases with its own reason (section 2, rule 4a). D14 only adds fields to the `no_progress` detail JSON. D23 adds `conflict_unresolved`. See section 2, rule 5 for the full `stopMapped` list. |
| No checkpoint and no push before the start phase | Kept for prepare and earlier. New: a setup stop or a setup budget end of `env.setup(live)` in start runs `onStop` or `onExit` and pushes the merged heads. The checkpoint commits nothing after a setup end; the push sends the merged heads only.                                                                                                                                                                                           |
| Claim check at every model turn                  | Replaced. Guarantee: a revoke stops spend within 60 s plus one round trip and one abort, and no push starts after a revoke that the server reports before the fence.                                                                                                                                                                                                                                                                         |
| Done record in the node branch                   | Replaced. Guarantee: a record counts only when its content digest matches and each recorded commit is in `origin/<base_branch>..HEAD` of its checkout. The release gate still decides correctness.                                                                                                                                                                                                                                           |

## 2. Chain model

The runner is a staged pipeline. A step reads a typed slice of the context and returns a patch of its declared keys. Loops and parallel groups are nodes of the chain, not step code.

```ts
type ChainId = "implement" | "examine" | "evaluation" | "tasks_prepare";
type Phase = "prepare" | "start" | "tasks" | "finish";

type StopCode = `${EndReason}` | `${EndReason}/${string}`;
type ReleaseRoute =
  | { kind: "passed" }
  | { kind: "routed"; unit: TaskContent; instruction: string };

interface ProgressCtx {
  planned: boolean;
  unchangedTurns: number;
  lastVerification: VerificationFacts;
}

interface ExecutionCtx {
  claim: MethodClaim;
  setup: ExecutionSetup;
  sshAccess: ReadonlyMap<BindingId, SshAccess>;
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
  baseHead: BaseHead | null;
  memo: VerificationMemo;
  affectedTests: readonly AffectedTest[];
  refreshed: RefreshResult;
  openMerge: ConflictMerge | null;
  agent: AgentSession;
  plan: UnitPlan;
  currentUnit: TaskContent | null;
  completedUnits: number;
  route: ReleaseRoute;
  commandTrees: CommandTrees;
  reviewWorkspace: ReviewWorkspace;
  placedAssets: readonly PlacedAsset[];
  setupFailure: SetupFailure | null;
  verification: VerificationRun | null;
  affected: AffectedStep | null;
  evidenceIds: readonly EvidenceId[];
  judgement: Judgement;
  progress: ProgressCtx;
}
type Key = keyof ExecutionCtx;

interface UnitCtx {
  unit: TaskContent;
  verdict: NodeInstruction | null;
  instruction: string | null;
  template: PromptTemplate;
  changed: boolean;
  revisionCount: number;
  commits: ReadonlySet<Commit>;
  passed: boolean;
}

type StepResult<S, W extends Key> =
  | { kind: "next"; patch: Pick<ExecutionCtx, W>; scope: S }
  | { kind: "budget_end"; patch: Partial<Pick<ExecutionCtx, W>>; scope: S }
  | { kind: "closed"; patch: Partial<Pick<ExecutionCtx, W>>; scope: S };

const DeadlineKind = { Work: "work", Cleanup: "cleanup" } as const;
type DeadlineKind = (typeof DeadlineKind)[keyof typeof DeadlineKind];

interface StepIo {
  run: ExecutionRun;
  budget: ExecutionBudget;
  context: CancellationContext;
  deadline: number;
  resources: AsyncDisposableStack;
  spans: SpanRecorder;
}

interface Step<S, R extends Key, W extends Key> {
  id: StepId;
  deadline: DeadlineKind;
  reads: readonly R[];
  writes: readonly W[];
  stops: readonly StopCode[];
  run(
    ctx: Readonly<Pick<ExecutionCtx, R>>,
    scope: S,
    io: StepIo,
  ): Promise<StepResult<S, W>>;
}

interface FoundryIo<P extends CommonPorts> {
  budget: ExecutionBudget;
  context: CancellationContext;
  deadline: number;
  ports: P;
}

type FoundryStepResult<S, W extends Key> =
  | StepResult<S, W>
  | {
      kind: "stop";
      stop: ExecutionStop;
      patch: Partial<Pick<ExecutionCtx, W>>;
      scope: S;
    };

interface FoundryStep<S, R extends Key, W extends Key, P extends CommonPorts> {
  id: StepId;
  deadline: DeadlineKind;
  reads: readonly R[];
  writes: readonly W[];
  stops: readonly StopCode[];
  ports: readonly (keyof P)[];
  run(
    ctx: Readonly<Pick<ExecutionCtx, R>>,
    scope: S,
    io: FoundryIo<P>,
  ): Promise<FoundryStepResult<S, W>>;
}

type ChainNode =
  | {
      kind: "step";
      step:
        Step<unknown, Key, Key> | FoundryStep<unknown, Key, Key, CommonPorts>;
    }
  | {
      kind: "parallel";
      id: string;
      branches: readonly (readonly ChainNode[])[];
    }
  | { kind: "loop"; id: string; frame: LoopFrame<unknown> };

interface LoopFrame<S> {
  reads: readonly Key[];
  init(ctx: ExecutionCtx, outer: unknown): S | null;
  body: readonly (
    Step<S, Key, Key> | FoundryStep<S, Key, Key, CommonPorts> | ChainNode
  )[];
  next(ctx: ExecutionCtx, scope: S): S | null;
  span?(ctx: ExecutionCtx, scope: S): SpanContext;
  end?(
    ctx: ExecutionCtx,
    scope: S,
    outcome: "next" | "budget_end" | "stop",
  ): SpanAttributes;
}

interface Chain {
  id: ChainId;
  phases: readonly { phase: Phase; nodes: readonly ChainNode[] }[];
  onStop: readonly ChainNode[];
  budgetEnd:
    | { kind: "exit"; nodes: readonly ChainNode[] }
    | { kind: "stop"; reason: EndReason };
}

interface ChainBuilder {
  phase(phase: Phase): ChainBuilder;
  step(
    step: Step<unknown, Key, Key> | FoundryStep<unknown, Key, Key, CommonPorts>,
  ): ChainBuilder;
  parallel(
    id: string,
    ...branches: ((b: ChainBuilder) => ChainBuilder)[]
  ): ChainBuilder;
  loop<S>(id: string, frame: (b: ChainBuilder) => LoopFrame<S>): ChainBuilder;
  onStop(nodes: (b: ChainBuilder) => ChainBuilder): ChainBuilder;
  budgetEnd(rule: Chain["budgetEnd"]): ChainBuilder;
  build(): Chain;
}

declare function chain(id: ChainId): ChainBuilder;
declare function runChain(
  chain: Chain,
  seed: Pick<ExecutionCtx, "claim" | "setup" | "sshAccess">,
  io: StepIo,
): Promise<ExecutionEnd>;

declare function runPhase(
  chain: Chain,
  phase: Phase,
  seed: PhaseSeed,
  io: StepIo,
): Promise<PhaseEnd>;

interface PhaseSeed {
  keys: Partial<ExecutionCtx>;
  resources: PhaseResources;
}

interface PhaseResources {
  ports: ImplementPorts & { agent: AgentPort };
  trees: TreeService;
}

type PhaseEnd =
  | { kind: "completed"; ctx: ExecutionCtx }
  | { kind: "budget_end"; ctx: ExecutionCtx }
  | { kind: "stop"; stop: ExecutionStop; ctx: ExecutionCtx };
```

Rules of the runner:

1. **Context.** The host runs `credentials.handover` then `setup.read` before `runChain`; it creates the dispose stack and defers the credential entry first. The seed holds `claim`, `setup` and `sshAccess`. The handover result is no context key: `hostExecution` gives it only to `credential.store` (D32). The runner seeds `currentUnit = null`, `openMerge = null`, `completedUnits = 0` and `progress` before the first phase. A `tasks` function seeds `memo` (a new `VerificationMemo`) for its call. Only `verify.own` and `verify.all(release)` read `memo`. The build check counts the seed as a writer. A step gets a shallow-frozen slice of its `reads`. A resource key (`agent`, `baseHead`, `memo`) holds a live object. The runner merges the patch into the context. A step never mutates a context object other than a resource. `heads` replaces the in-place `checkout.head` writes of today. The host builds the input of a `tasks` function from the context. It merges the result of each `FoundryEnd` kind into the context.
2. **Build check.** `build()` walks every path of the chain. It rejects a read with no earlier writer on that path, two parallel branches that write one key, and an `onExit` or `onStop` node that reads a key that the end of `prepare` can lack. Each `LoopFrame` declares the keys that `init` and `next` read from the outer context. The seed check requires a `LoopFrame.reads` key only when no node of the phase writes it before the first read of the frame. A scope field is no key and needs no seed. `build()` rejects a `FoundryStep` whose `ports` are not in the port set of its phase. In a `tasks` phase, the port set is the port type of the `tasks` function of the chain. In a host phase, the port set is the port set of the Foundry host, which holds every Foundry port. `runChain` takes it from the worker host. `runPhase` takes it from `PhaseResources.ports` of the Foundry host that calls it. `build()` rejects a `FoundryStep` that declares `sshAccess` in `reads`. It rejects a `Step` in a `tasks` phase. No step can declare a credential, because no context key holds one.
3. **Loop scope.** A `LoopFrame` gets the scope of its outer loop in `init`. `UnitCtx` lives in the `units` scope. `refreshed` and `openMerge` are context keys: `base.merge` and `markers.check` write them. A step returns its scope and a patch of its declared keys. The `revisions` frame `next` keeps `instruction` and `template` when the template is `CriterionRevision`.
4. **Stop.** A `Step` calls `io.run.stop(reason, code, detail)`, and the throw ends the phase. A `FoundryStep` returns the result kind `stop`. The walker then ends the `tasks` function with `FoundryEnd` kind `stop`, and the host stores that stop with `ExecutionRun.halt`. The first stop wins, as in `ExecutionRun.halt` today: a stored stop wins over a returned stop. For a stop that is not `revoked`, the runner first aborts the agent. When the chain reached the end of `prepare`, it runs the `onStop` nodes. It then always runs `execution.release(stop)` (`releaseStop`). An `onStop` failure logs `checkpoint failed` and does not replace the stop. For `revoked`, the runner runs no `onStop` node and ends the execution. `ClaimWatch` calls `run.revoke()`. This sets the stop and cancels `operationContext`. The running step sees an aborted `io.context`. A `tasks` function returns `cancelled` on an abort of `input.cancel`. The runner reads the stored stop and ends with `revoked`.
   4a. **Requested stop.** A stop order (`human_paused`, `instance_archived`) and a unit stop (`worker_stopped`) cancel the joined `stop` context with an `ExecutionStop`. The runner adopts that abort reason through `run.stopOf` as the stop. It wins over the code of the step that it aborted, because `ExecutionRun.halt` reads the requested stop first. The `ClaimWatch` ends, `onStop` runs as in rule 4, and `execution.release(stop)` carries the ordered reason. The Scheduler accepts it, because the stop order exists. One test per reason proves the release reason. A stop order with reason `revoked` (D4) is not a requested stop: it calls `run.revoke()`, and rule 4 applies. Inside `tasks`, the Foundry sees only the abort of `input.cancel` and returns `cancelled`; the host applies this rule.
5. **Budget end.** A step returns `budget_end`, or the `NativeAgent` turn call returns the budget end before the send when `budget.exhausted()` holds; each LLM step maps it. `conflict.turn` maps it to `next` (S14). A step can throw `ContextCancelled` or `DeadlineExceeded` while `budget.exhausted()` holds and `operationContext` is not aborted. `stopMapped` maps that throw to the budget end, as `endedByBudget` and `endedByBudgetExhaustion` do today. `stopMapped` wraps every step of every chain. Kept: the mapping in `affected.run(evaluation)`, `judgement`, and in `env.setup(examine)`, `inputs.read(dependencies)`, `agent.open`, `verify.node` and `examine.turn` of examine. New: the mapping in `inputs.read(revision)` and `workspace.review(base)` of examine, and in every other step of implement and evaluation. The `onExit` nodes are the `nodes` of `Chain.budgetEnd` with `kind: exit`. `Chain.budgetEnd` decides the result:
   - `implement`: before the end of `prepare`, the stop `budget_end/wall_time`. From the end of `prepare`, the exit runs the `onExit` nodes.
   - `examine`: before the end of `prepare`, the stop `budget_end/wall_time`. From the end of `prepare`, the exit nodes release with `further_work: true` and the stop `budget_end/<limit>`.
   - `evaluation`: the stop `assessment_absent`, as `endedByBudget` does today.

   A `tasks` function returns `FoundryEnd` kind `budget_end` with its result. The host applies `Chain.budgetEnd` to it. Inside `tasks`, the walker maps a thrown `ContextCancelled` or `DeadlineExceeded` to `budget_end` when `input.budget.exhausted()` holds and `input.cancel` is not aborted.

   For `kind: exit`, a budget end before the end of `prepare` is the stop `budget_end/wall_time` in every chain. A step that returns `budget_end` from the wall deadline calls `budget.wallDeadlineReached()` first, so `budget.limit()` holds at the release.

6. **Parallel group.** The runner gives each branch a child `CancellationContext` and awaits all branches with `Promise.allSettled`. When one branch stops, the runner aborts its siblings. The first stop in time wins: `run.stop` stores it, and the walker of a `tasks` function keeps the first returned stop. A step that must name one code for several branches collects the branch results first, then raises one stop. Gate G does this for its violations. When one branch returns `budget_end`, the runner aborts its siblings, awaits all branches, merges the patch of each branch that ended with `next`, and then takes the exit. A stop of a sibling before the abort wins over the exit.
7. **Telemetry.** `runStep` opens `worker.step` with `kanthord.step.id` and `kanthord.step.outcome`: `next`, `budget_end` or `stop`. The span holds no error text and no stop detail. The runner opens a phase span for each phase. A loop frame with a `span` hook opens its span at frame start; its `end` hook returns the attributes and runs the frame release at frame end. `worker.task`, `worker.release_gate` and `worker.evaluation` use the loop frame hooks. The `end` hook of the `evaluation` loop takes `kanthord.evaluation.*` from `judgement`; the outcome `stop` or `budget_end` ends the span with `Error`. The spans of `assessment.submit` and `execution.release` end before the server call (S37, S41). These `worker.step` spans end with the outcome `next`, or `stop` in `onStop`; the answer of the call changes no span. Every current span and attribute stays with the owning step of section 5.6. `worker.step` nests under the enclosing `worker.task` or `worker.phase` span. An `agent.turn` span becomes a child of the `worker.step` span of its LLM step. The runner gives each branch of a parallel group, and each per-checkout task inside a step, its own span scope. The parent of that scope is the span that is open when the group starts. A span of one branch never becomes the parent of a span of another branch. The runner opens one `worker.phase` span with `kanthord.phase` `on_exit` or `on_stop` around the nodes of `onExit` and `onStop`. A `FoundryStep` writes its spans through the port `telemetry`. The host gives that port the open `worker.phase` span as the parent scope.
8. **Resources.** A `Step` that takes a tree, a base head or an agent session calls `io.resources.defer(...)`. A loop frame with an `end` hook registers a release that runs at the frame end. The host disposes the stack once at every end: after `runChain` returns, and after each end before `runChain` (section 5.4). The stack runs in reverse order of registration. This replaces the `finally` blocks of `runStepsImplement` and `runEvaluation`. A `FoundryStep` registers no resource. A port that makes a resource registers the release on the dispose stack of the host.
9. **Composition.** A chain file lists phases and steps with the builder. A step file holds one step. A test runs one `Step` with a fake `StepIo`, or one `FoundryStep` with fake ports, and a context slice. A golden test prints each built chain in the notation of section 4. The golden test also asserts the set of log messages of section 3 (`Logs:` of each step). The golden file prints `port:` for each `FoundryStep` that calls a port.
10. **Deadline.** The runner builds `io.context` and `io.deadline` from `Step.deadline`:
    - `work`: `io.context` is `operationContext`, bounded by `expired_at`. `io.deadline` is `budget.wallDeadline()`. Shell and git runners read `io.deadline`. An LLM step takes its deadline from the agent context of the budget.
    - `cleanup`: a fresh context bounded by `expired_at`. In phases and in `onExit`, it is `budget.cleanupContext(operationContext)`. In `onStop`, it is `run.cleanupContext()`, because the stop already cancelled `operationContext`.
    - Report (`worker.credential`): a context bounded by `expired_at` that a stop does not cancel. The lease joins that context with the signal of the session.

    `gate.g`, `checkpoint.gate`, `markers.check`, `branch.push`, `assessment.submit` and `execution.release` are `cleanup` steps. `assessment.submit`, `execution.release` and `execution.release(stop)` are the final steps. The restore sequence inside `verify.own` and `env.setup(live)` runs under the cleanup deadline. `base.merge`, `base.fetch` and `release_trees.prepare` are `work` steps. Every other step is a `work` step. Kept: `run.call` uses `operationContext`, so `expired_at` bounds each server call of a step of either kind, not the wall deadline. After a stop, `run.call` throws the stored stop, so no `onStop` node uses `run.call`. A `tasks` function builds the `work` context from `input.cancel`. It builds the `cleanup` context from `input.budget.cleanupContext(input.cancel)`, bounded by `claim.expired_at`. A worker port bounds each call by `operationContext` and by the context that the step gives; the call ends when either aborts.

11. **`runPhase`.** `runPhase` runs the chain `tasks_prepare`. It seeds the context with `seed.keys`, then runs the nodes of the named phase with the loop rules. It shares the node walker and the loop rules with `runChain` and with the `tasks` functions. `runPhase` applies the runner defaults of rule 1 for a key that the seed lacks. It starts no `claim.watch`. On a stop it aborts the agent. It runs no `onExit` node, no `onStop` node and no final step, so it makes no checkpoint commit and no push. After the end, the caller disposes `io.resources` and sends no server call. When `input.until` of a `tasks` function names a loop id, the walker ends with `completed` on entering that loop. The `--skip-release-gate` option sets `until` to `release_gate`. The worker gives `until: null`.

The node walker runs each step through `runStep`: opens `worker.step`, runs the step, and applies the `stopMapped` mapping. `stopMapped` maps `ContextCancelled` and `DeadlineExceeded` to the chain budget end when `budget.exhausted()` holds and `operationContext` is not aborted (rule 5). It maps an abort with an `ExecutionStop` reason to that stop (rule 4a). It maps every other unknown error to `run.stopOf`. `stopMapped` runs on the host side. The walker of a `tasks` function catches a throw and returns `FoundryEnd` kind `failed` with the error and the result. The host merges the result, then maps the error: the worker with `run.stopOf`, the CLI with the mapping of section 5.7.

### The Foundry (D32)

The Foundry is one function per chain. One call runs the whole `tasks` phase of section 4, with the rework rounds inside. No step of `tasks` moves to another phase. Each side effect of a step is a call of a host tool, at the same place in the step.

| Term          | Meaning                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Foundry       | The `tasks` function of a chain and the steps that it runs.                                                          |
| Foundry host  | The code that calls a `tasks` function: the worker host (`runChain`) or the CLI host (`kanthord worker tasks run`).  |
| host tool     | An agent tool or a Foundry port. The Foundry makes a side effect only through a host tool.                           |
| agent tool    | A pi tool that the model calls in a turn (`evidence-upload`, `link_update_list`). The Foundry never calls it.        |
| Foundry port  | A typed function of the Foundry host that step code calls outside a model turn.                                      |
| capability    | One pi extension factory (`InlineExtension`) of the Foundry host that registers agent tools or MCP servers.          |
| guard         | A pi extension factory that `agentPort` adds to each session that it opens.                                          |
| host resource | A long-running object of the Foundry host that runs beside `tasks`: `claim.watch`, `credential.store`, `ssh.access`. |
| side effect   | A call to a kanthord server, a git remote, a tree pool, the credential custody or an LLM provider.                   |

```ts
type PortResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "failed"; code: string | null; message: string };

interface EvidencePort {
  submit(
    draft: EvidenceDraft,
    context: CancellationContext,
    options: { halt: boolean },
  ): Promise<PortResult<EvidenceId>>;
}

interface UnitRecordPort {
  put(
    record: UnitRecordDraft,
    context: CancellationContext,
  ): Promise<PortResult<null>>;
}

interface PortCall {
  context: Context;
  deadline: number;
}

interface RepositoryPort {
  fetchBase(checkout: CheckoutRef, call: PortCall): Promise<PortResult<null>>;
}

interface ReleaseTreePort {
  take(
    checkout: CheckoutRef,
    head: Commit,
    call: PortCall,
  ): Promise<PortResult<CommandTree>>;
  takeBase(
    checkout: CheckoutRef,
    commit: Commit,
    call: PortCall,
  ): Promise<PortResult<CommandTree>>;
  give(tree: CommandTree): Promise<void>;
}

interface AgentPort {
  open(
    request: AgentOpenRequest,
    context: CancellationContext,
  ): Promise<PortResult<AgentSession>>;
}

interface AgentOpenRequest {
  claim: MethodClaim;
  setup: ExecutionSetup;
  checkouts: readonly CheckoutRef[];
  reviewWorkspace: ReviewWorkspace | null;
}

interface AgentSession {
  turn(request: TurnRequest, context: CancellationContext): Promise<TurnEnd>;
  lastText(): string | undefined;
  close(): Promise<void>;
}

interface SecretPort {
  redact(text: string): Promise<string | null>;
}

interface LogPort {
  log(message: string, fields: LogFields): void;
}

interface CommonPorts {
  telemetry: SpanRecorder;
  secrets: SecretPort;
  log: LogPort;
}

interface FoundryHost<P extends CommonPorts> {
  capabilities: readonly InlineExtension[];
  ports: P;
  steps?: StepWatch;
}

interface StepWatch {
  started(step: string): void;
  ended(step: string, scope: unknown): void;
}

interface ImplementPorts extends CommonPorts {
  evidence: EvidencePort;
  unitRecords: UnitRecordPort;
  repository: RepositoryPort;
  releaseTrees: ReleaseTreePort;
}

interface EvaluationPorts extends CommonPorts {
  evidence: EvidencePort;
  agent: AgentPort;
}

interface ExaminePorts extends CommonPorts {
  evidence: EvidencePort;
  agent: AgentPort;
}

interface FoundryControl {
  cancel: CancellationContext;
  budget: ExecutionBudget;
  until: string | null;
  env: Readonly<Record<string, string>>;
}

interface ImplementInput extends FoundryControl {
  claim: MethodClaim;
  setup: ExecutionSetup;
  revision: Revision;
  checkouts: readonly CheckoutRef[];
  heads: ReadonlyMap<BindingId, Commit>;
  gitPaths: ReadonlyMap<BindingId, OperationPaths>;
  setupEntries: readonly SetupEntry[];
  baseHead: BaseHead | null;
  affectedTests: readonly AffectedTest[];
  plan: UnitPlan;
  setupPending: boolean;
  setupInstruction: string | null;
  progress: ProgressCtx;
  agent: AgentSession;
}

interface EvaluationInput extends FoundryControl {
  claim: MethodClaim;
  setup: ExecutionSetup;
  revision: Revision;
  checkouts: readonly CheckoutRef[];
  heads: ReadonlyMap<BindingId, Commit>;
  baseHead: BaseHead | null;
  commandTrees: CommandTrees;
  setupFailure: SetupFailure | null;
  reviewWorkspace: ReviewWorkspace;
  placedAssets: readonly PlacedAsset[];
  reviewRound: ReviewRound;
  dependencies: DependencyRead;
}

interface ExamineInput extends FoundryControl {
  claim: MethodClaim;
  setup: ExecutionSetup;
  revision: Revision;
  checkouts: readonly CheckoutRef[];
  heads: ReadonlyMap<BindingId, Commit>;
  dependencies: DependencyRead;
}

interface ImplementResult {
  heads: ReadonlyMap<BindingId, Commit>;
  currentUnit: TaskContent | null;
  openMerge: ConflictMerge | null;
  completedUnits: number;
  route: ReleaseRoute | null;
  progress: ProgressCtx;
}

interface EvaluationResult {
  verification: VerificationRun | null;
  affected: AffectedStep | null;
  evidenceIds: readonly EvidenceId[];
  judgement: Judgement | null;
}

interface ExamineResult {
  verification: VerificationRun | null;
}

type FoundryEnd<R> =
  | { kind: "completed"; result: R; verificationTimedOut: boolean }
  | { kind: "budget_end"; result: R; verificationTimedOut: boolean }
  | {
      kind: "stop";
      stop: ExecutionStop;
      result: R;
      verificationTimedOut: boolean;
    }
  | { kind: "cancelled"; result: R; verificationTimedOut: boolean }
  | {
      kind: "failed";
      error: unknown;
      result: R;
      verificationTimedOut: boolean;
    };

declare function foundryImplement(
  input: ImplementInput,
  host: FoundryHost<ImplementPorts>,
): Promise<FoundryEnd<ImplementResult>>;
declare function foundryEvaluation(
  input: EvaluationInput,
  host: FoundryHost<EvaluationPorts>,
): Promise<FoundryEnd<EvaluationResult>>;
declare function foundryExamine(
  input: ExamineInput,
  host: FoundryHost<ExaminePorts>,
): Promise<FoundryEnd<ExamineResult>>;
```

`EvidenceDraft` is `Omit<EvidenceSubmit, keyof ExecutionContext>` of `src/mission/contract.ts`: `subject`, `assets` and an optional `verification`. The worker port fills `node_id` from the claim and gives the idempotency key as a client option. `PortCall` holds the context and the deadline of a git or tree call. `takeBase` serves the base tree of `BaseHead`, which the `tasks` phase takes for the baseline of a command-absent exit, the affected run on the base and the node-failure fallback of the release setup. `UnitRecordDraft` is `{ unit_id, content_digest, commits }` (section 5.1). `NativeAgent` implements `AgentSession`. `env` is the environment of each child process, which the Foundry host already filtered.

The interfaces `EvidencePort`, `UnitRecordPort`, `RepositoryPort` and `AgentPort` answer `PortResult`. `ReleaseTreePort.take` answers `PortResult` too. Four port functions do not: `releaseTrees.give` answers nothing, `secrets.redact` answers the text or `null`, `telemetry` is a `SpanRecorder`, and `log` answers nothing.

Each input key is a context key that a step of the phase reads before a writer inside the phase. Each result key has a reader after the call: `finish`, `onExit` or `onStop` of the worker host, or the output folder of the CLI host. The CLI output is the only reader of `route` and `progress` of implement, and of `verification` and `affected` of evaluation and examine.

Who prepares the input:

| Part                                                                                    | Human or harness (CLI host)                                                                        | Worker host                                                           |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `claim`, `setup`, `revision`, `heads`                                                   | `seed.json`, written by hand or exported with `worker tasks seed`                                  | `credentials.handover`, `setup.read`, `inputs.read`, `workspace.node` |
| `checkouts`, `gitPaths`                                                                 | `--tree <binding_id>=<path>`, cloned from a bare mirror                                            | `workspace.node`                                                      |
| `setupEntries`, `baseHead`, `affectedTests`, `plan`, `setupPending`, `setupInstruction` | `tasks_prepare`; a hand-written `plan` replaces `units.plan`                                       | `prepare` and `start`                                                 |
| `progress`                                                                              | The runner default of rule 1                                                                       | The context at the end of `start`                                     |
| `agent` (implement)                                                                     | `agent.open` of `tasks_prepare`, with the frozen store or the replay provider                      | `agent.open` of `prepare`                                             |
| `cancel`                                                                                | SIGINT cancels it with `worker_stopped`                                                            | `operationContext` of `ExecutionRun`                                  |
| `budget`                                                                                | Built from `setup.resource_budget` and the overrides                                               | Built by the host after `setup.read`                                  |
| `env`                                                                                   | `PATH`, `LANG`, `TMPDIR`, `HOME` of the output folder and each `--pass-env` variable (section 5.7) | The `childEnvironment` result of the worker process                   |

The same consumer takes the local materials after the call. The worker host runs `finish`, `onExit` or `onStop` on `FoundryEnd`. The CLI host writes the output folder of section 5.7.

Rules of the Foundry:

1. **No construction.** No file of the Foundry imports a transport, a client constructor, `MethodClients`, `ExecutionRun`, the credential store, the custody contract, the tree pool or `hostToolsOf`. A module test asserts this.
2. **No host knowledge.** No step of the Foundry holds placement logic. No step reads which Foundry host runs it.
3. **Port result.** A port answers `ok`, or `failed` with a code or `null`. The Foundry maps `failed` to the stop of the step: `operation_failed/<code>`, or `operation_failed` with no code for `null`. Two calls are log-only: `unitRecords.put` logs `unit record failed` (D10), and the conflict report of `markers.check` logs `conflict report failed` (D23). A port never throws a stop of the host.
4. **Port ownership.** The Foundry host owns the retry, the idempotency key, the execution proof and the `expired_at` bound of each port call. The D28 retry thus lives in the worker port.
5. **Execution end.** When a port call or an agent tool call gets an execution-end answer, the Foundry host cancels `input.cancel`. The port answers `failed`. The Foundry checks `input.cancel` before it logs or maps a `failed` answer; on an abort, it writes no log and returns `cancelled`.
6. **Stops are values.** A step returns its stop (rule 4 of the runner). The worker host stores it with `ExecutionRun.halt`, so the first stop still wins.
7. **Stored stop.** In the worker, a failed `run.call` stores the stop and cancels `operationContext`. The worker port then answers `failed`. The worker host takes the stored stop, not the stop that the Foundry maps from `failed`. One test per final stop reason proves it. A call with `halt: false` uses the no-halt call of section 5.1: it stores no stop and cancels nothing.
8. **Cancellation.** On an abort of `input.cancel`, the running step ends: `AgentSession.turn` aborts, the verification runner kills its command, and each port call gets the cancelled context. The Foundry returns `cancelled` with the result of the last completed step. It does not know the reason.
9. **Local work.** The Foundry runs local `git` on the given trees, and it runs the commands of the revision as child processes. Every `git` child runs with `isolatedGitEnvironment` and no `SSH_AUTH_SOCK`. A child process is no resource of the Foundry host. Each child process gets `input.env`; the Foundry never reads `process.env`.
10. **No state between calls.** The Foundry keeps no module variable. `memo` is a plain object that one call makes and drops.
11. **`budget` and `cancel` are input, not ports.** `ExecutionBudget` holds counters and a clock and makes no call. The Foundry reads the time only through `budget`. It reads only the abort of `cancel`.
12. **Session.** `agent` of implement is input, because the conflict turn of `start` needs the session before `tasks` (D18, D20). `foundryImplement` gets no `agent.open` port. Evaluation and examine open their session through `agent.open`.
13. **Rounds.** The rework rounds stay inside one call. The Foundry host does no work between two rounds; it only serves the port calls and the agent tool calls. The progress counter and the session carry from round to round.
14. **Shared steps.** A step that runs in `tasks` and in a host phase is one `FoundryStep`. `prepare` and `start` stay host phases. `runChain` gives such a step the port set of the worker host and stores its returned stop with `ExecutionRun.halt`. `runPhase` gives it the port set of the CLI host, so `tasks_prepare` has the ports `log`, `secrets`, `telemetry` and `agent`.
15. **Serialized input.** A serialized input follows the seed rules of section 5.7. It holds no credential, no SSH identity, no handover key, no `containerEnv` and no `remoteEnv`.
16. **Unknown error.** The walker of a `tasks` function catches a throw. It returns `FoundryEnd` kind `failed` with the error and the result of the last completed step. The Foundry gives the error no stop reason. The Foundry host merges the result, then maps the error: the worker host with `run.stopOf`, the CLI host with the mapping of section 5.7.
17. **Redaction.** A `FoundryStep` that puts tool output or git output into a stop detail or a log redacts it through `secrets.redact` first.
18. **Logs.** A `FoundryStep` writes each log message of section 3 through the port `log`.
19. **Step watch.** The walker calls `host.steps.started` before each step and `host.steps.ended` with the step scope after it. The watch makes no decision and returns nothing. `runPhase` gets the same watch through the optional `ChainIo.steps`, which `walkStep` calls. Only the CLI host sets either field. The worker host passes no watch. The CLI host uses it for the step of each outbox entry, the step run times and the last `UnitCtx` of each unit. It assumes that steps run in sequence.

Port implementations:

| Port                    | Worker host                                                                                                                                               | CLI host                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `evidence.submit`       | `mission.evidence.submit` through `run.call` with the D28 retry. With `halt: false`, it uses the no-halt call of section 5.1.                             | Appends the draft to `outbox.json` and copies each asset to `uploads/`. Answers a synthetic identity whose ULID encodes the call position. |
| `unitRecords.put`       | `worker.execution.unit_record.put` through the no-halt call of section 5.1. An execution-end answer calls `run.revoke()`; the port then answers `failed`. | Appends the record to `outbox.json`. Answers `ok`.                                                                                         |
| `repository.fetchBase`  | `transport.fetchBase` with the signer of `ssh.access` for the binding, inside `worker.git` with the git step mark `fetch_base`.                           | `git fetch --prune origin` from the mirror `state/origin/<binding_id>.git`. It holds no signer.                                            |
| `releaseTrees.take`     | Command pool take, else `clonePacked` from the live checkout.                                                                                             | `clonePacked` to `state/release/<binding_id>/`, with no pool.                                                                              |
| `releaseTrees.takeBase` | Base tree pool take of `BaseHead`, for the baseline, the affected run on the base and the setup fallback.                                                 | `clonePacked` of the base commit under `state/base/`, with no pool.                                                                        |
| `releaseTrees.give`     | Gives the tree back to the Command pool and removes the release directory.                                                                                | Removes the directory.                                                                                                                     |
| `agent.open`            | `agentPort` of section 5.5 over the custody model runtime and the telemetry trace. It registers the close on the dispose stack of the host.               | `agentPort` over the frozen store or the replay provider, and the `spans.jsonl` trace.                                                     |
| `telemetry`             | `SpanRecorder` over the telemetry sink of the execution.                                                                                                  | `SpanRecorder` over a sink that writes `spans.jsonl`.                                                                                      |
| `secrets.redact`        | `run.reasonOf` with the secret list of the execution (D14).                                                                                               | Redaction over the standard-input credential and each `--pass-env` value.                                                                  |
| `log`                   | `run.log` of the execution.                                                                                                                               | The log of the command.                                                                                                                    |

The LLM provider call, the credential lease and the turn telemetry need no port. pi owns them behind `AgentSession`: `session.prompt()`, the `ModelRuntime` of the host and `session.subscribe()`.

## 3. Step catalogue

Stop code notation: `<EndReason>` or `<EndReason>/<code>`. Every server step can also raise `revoked` and `operation_failed/<server code>` through `run.call`; the entries do not repeat these two. Every LLM step can raise `provider_failed/*` and a budget end. `Chain.budgetEnd` turns a budget end into an exit or a stop (section 2, rule 5). The entries write "budget end" for it.

`Port:` names each Foundry port that a `FoundryStep` calls (section 2). A `FoundryStep` raises `operation_failed/<server code>` from the `failed` answer of its port. It raises `revoked` through the abort of `input.cancel`. A `FoundryStep` returns each stop of its `Stops:` entry as a value. It writes each message of its `Logs:` entry through the port `log`.

Fail-early class: F0 static, F1 server or git, F2 shell, F3 LLM, F4 publish.

`Logs:` names the log messages that the step writes today. The golden test asserts this set (section 2, rule 9). The host writes `credential handover received` (S43), `execution ended` (host end, section 5.4) and `tasks capture failed` (capture hook, section 5.7). The run writes `telemetry faults` at dispose, and the span sink writes `telemetry write failed` and `telemetry records dropped`.

### C0 `claim.watch` (chain resource)

- Phase: all, up to the start of `branch.push` or the first final step (`assessment.submit`, `execution.release`, `releaseStop`). Chains: implement, examine, evaluation (shared).
- Problem: detect a revoke with fewer calls than one per model turn.
- Reads: `claim`. Writes: none.
- Work: server timer (section 5.2).
- Stops: `revoked`, through `run.revoke()`.
- Parallel: runs beside every step.
- Fail-early: starts before the first step.

### S43 `credentials.handover`

- Phase: host function (before runChain). Chains: implement, examine, evaluation (shared).
- Problem: open the handover envelope, build the credential store and take the SSH identities.
- Reads: `claim`. Writes: no context key. It returns the handover result and the handed SSH identities to `hostExecution`.
- Work: server (`worker.handover`). The first handover of an attempt writes `mission_attempt.prompt_commits`. Retry `worker.handover.refresh_in_flight` until the claim expires. S43 adds each credential value to the known secrets of the run before it returns.
- Stops: `operation_failed/worker.handover.decryption_failed`, `operation_failed/worker.handover.sealed_unopened`, `operation_failed/worker.credential.lease_mismatch`, `operation_failed/custody.handover.holder_refused`, `operation_failed/project.bindings.repository.ssh_unreachable`, `operation_failed/project.bindings.repository.base_branch_absent`.
- Logs: `credential handover received`.
- Parallel: none; first host function.
- Fail-early: F1.

### S44 `setup.read`

- Phase: host function (after credentials.handover). Chains: implement, examine, evaluation (shared).
- Problem: read the execution setup, including the prompt commits that S43 pins.
- Reads: `claim`. Writes: `setup`, `sshAccess`.
- Work: server (`execution.setup.get`), with the retry of an indeterminate result. S44 gives `worker_name` and the environment digests to the run. The host builds the budget from `setup.resource_budget`. It returns `unit_records` (D5).
- Stops: `operation_failed/<code of the refusal>`, for example `worker.execution.prompt_record_failed`.
- Parallel: serial after S43.
- Fail-early: F1.

### C1 `credential.store` (chain resource)

- Phase: all phases (registered after setup.read). Chains: implement, examine, evaluation (shared).
- Problem: manage the pi auth view, the refresh lease and the credential report.
- Reads: no context key. `hostExecution` gives it the handover result. Writes: none.
- Work: server. The pi auth view exposes only the credential of the effective agent provider at the pinned revision. A refresh takes `worker.credential.lease`, then sends `worker.credential`. A lease retry ends when the claim expires or `operationContext` aborts. No credential reaches a file, a span or a log.
- Stops: `operation_failed/worker.credential.lease_mismatch`.
- Parallel: runs in the background of every step.
- Fail-early: registered in hostExecution, after setup.read.

### C2 `ssh.access` (chain resource)

- Phase: all phases (registered after setup.read). Chains: implement, examine, evaluation (shared).
- Problem: provide one signer per repository binding for every git network operation.
- Reads: `sshAccess`. Writes: none.
- Work: local signing or server relay. One signer per repository binding: the handed key at the `server` and `container` placements; the `worker.ssh.sign` relay at the `worker` placement. Each git network operation gets its own agent socket. With D7, parallel fetches and pushes open one socket each.
- Stops: none.
- Parallel: runs in the background of every git network step.
- Fail-early: registered in hostExecution, after setup.read.

### S01 `inputs.read(keys)`

- Phase: prepare. Chains: implement, evaluation, examine (shared).
- Problem: read the pinned revision and the execution inputs that the named keys list.
- Reads: `claim`, `setup` (prior only). Writes: the named keys.
- Work: server. The named reads run with `Promise.all`. Each read uses `run.call`. `revision` reads `execution.pinnedRevision.get`. `attemptEvidence` reads `execution.evidence.list`; its pages stay serial (cursor). The `prior` key uses a conditional order: a first parallel group (`failed_checks.read`, `rework_assessment.read`, `link_updates.read`), then by result: `review_round.read` when rework exists; `cleared_outcome.read` at attempt 2 or later when no failed checks and no rework exist; `change_requests.read` when the cleared outcome is external-failed; `cleared_assessment.read` at attempt 2 or later when no failed checks, no rework and no change request text exist. A read that the precedence skips stays unread, so its failure cannot stop the execution. The precedence of `readUnblockPrior` stays in one pure function over the read results. The verdict source has one reader, the `failed_checks` test (`steps-implement.ts:972`). A verdict built from link updates alone carries the source `rework`. The `dependencies` key: in the implement intent of evaluation the step writes an empty read with no server call.
- Stops: none extra.
- Parallel: named keys run in parallel. Implement: `inputs.read(revision, prior)` beside the workspace branch; `inputs.read(attemptEvidence)` as the first step of that branch. Evaluation: `inputs.read(revision, attemptEvidence, reviewRound, dependencies)`; `dependencies` is examine intent only with 3 paged reads in parallel. Examine: `inputs.read(revision, dependencies)`.
- Fail-early: F1, group 1.

### S06 `workspace.node`

- Phase: prepare. Chains: implement.
- Problem: give each binding a coder checkout at the node branch.
- Reads: `claim`, `setup`, `sshAccess`, `attemptEvidence`. Writes: `checkouts`, `heads`, `gitPaths`.
- Work: git and network. Shared tree service, per checkout:
  - Node-key reuse with a pending push, else Agent pool tree, else clone.
  - `fetchAndCheckout`.
  - `git fetch --prune origin`.
  - One `git rev-parse --git-path` per checkout for `gitPaths`.
  - Restore sequence of prepare (`restoreCheckout`, section 5.3) to the head that the checkout read.
- Push record: `workspace.node` and `branch.push` use `push-record.ts` on the file directly and declare no context key. With no record and a remote node branch, `workspace.node` writes `confirmed` = the remote head.
- Hygiene, before the checkouts: give the leftover release trees of the node key back to the Command pool; `keepOnly` keeps the push record of the node branch and the checkout directories of the bindings and `.kanthord-scratch/`.
- Hygiene, after the checkouts: restore the scratch store of the node branch (one checkout: move the saved `.kanthord-scratch/` back; several checkouts: drop it when it belongs to another branch). Each new tree gets the `.kanthord-scratch/` line in `.git/info/exclude`.
- Stops: `operation_failed/repository.node_checkout.pending_rebuild`, `operation_failed/repository.node_branch.missing`, `operation_failed/repository.connector.git_failed`.
- Keep rule: on `repository.node_branch.missing`, the step keeps the created directories. On any other failure, it removes them (`workspace.ts:320-330`). The kept checkout protects unpushed work.
- Dispose: give each coder tree back to the Agent pool, except a tree with a pending or unreadable push record; store the scratch of the node branch first.
- Logs: `tree prepared`, `tree deleted`, `scratch not stored`.
- Parallel: per checkout. Runs after `inputs.read(attemptEvidence)` in the same branch, beside `inputs.read(revision, prior)`.
- Fail-early: F1, group 1.

### S07 `workspace.review(refs)`

- Phase: prepare. Chains: evaluation (refs=snapshot), examine (refs=base).
- Problem: give each binding a tree at its ref; for snapshot, build the round scope patch and the commandTrees key.
- Reads: `claim`, `setup`, `sshAccess`, `attemptEvidence` (snapshot only), `reviewRound` (snapshot only). Writes: `reviewWorkspace`, `checkouts`, `heads`, `commandTrees` (snapshot only).
- Work: git and network, shared tree service. For snapshot: the step gives the leftover review trees back to the Agent pool and removes the review key. It then takes each tree with `refreshSnapshot` and scrubs it. After each tree, it runs `git diff`, writes the round scope patch `round-<n>-<binding>.patch` in the evidence directory, and writes the scope to `reviewWorkspace`. For base: the step gives the leftover examine trees back to the Agent pool, then takes each tree at its base head. With no repository binding, it makes the execution workspace `workspaces/<execution identity>/`, writes empty `checkouts` and `heads`, and registers the removal at dispose.
- Workspace kind (snapshot): implement intent with a snapshot of every binding gives the review trees. Implement intent with no snapshot gives an execution workspace with no checkout; `tested_input` then falls back to the newest placed asset (`evaluation-input.ts:497-499`). Examine intent gives examine trees at the base heads.
- Stops: `operation_failed` (snapshot: a snapshot for some bindings but not for all), `operation_failed` (snapshot: no tested input), `operation_failed/repository.connector.git_failed`.
- Dispose: for snapshot, give each review tree back to the Agent pool, then remove the review key. For base, give each examine tree back to the Agent pool, then remove the review key.
- Logs: `tree prepared`, `tree deleted`, `review base off the node history` (snapshot only).
- Parallel: per checkout.
- Fail-early: F1; for snapshot, after group 1; for base, group 1.

### S09 `affected.declaration`

- Phase: prepare. Chains: implement. The evaluation chain keeps the read inside `affected.run`, which runs before its only LLM step.
- Problem: read and validate `.kanthord/affected-tests.json` at `origin/<base>`.
- Reads: `checkouts`, `setup`. Writes: `affectedTests`. `affectedTests` feeds the prompts of S14 and S17 only.
- Work: git (`git show`) and static parse.
- Stops: `environment_failed/affected_invalid` (new position, D9).
- Parallel: per checkout; sibling of S10.
- Fail-early: F0 after the workspace, before any shell step.

### S10 `setup.entries`

- Phase: prepare. Chains: implement, examine, evaluation (shared).
- Problem: resolve the devcontainer setup scripts of each checkout, and build the base head for the node-failure fallback.
- Reads: `checkouts`, `setup`. Writes: `setupEntries`, `baseHead`.
- Work: git (`git show`) and static parse.
- Stops: `environment_failed/setup_failed` on a parse failure.
- Parallel: per checkout; sibling of S09.
- Fail-early: F1.
- States: S10 writes `null` for `baseHead` with no checkout (examine). S10 writes the `BaseHead` from the setup entries of each checkout (implement, evaluation).
- Dispose: give the base-head tree of each checkout back to the `command` class (implement, evaluation).

### S11 `env.setup`

- Phase: start (live), prepare (review, examine), tasks release_gate loop (release). Chains: all (shared, target given by the chain).
- Problem: run `updateContentCommand` and `postCreateCommand` on the target heads; on a node failure, run the base head.
- Reads: `setupEntries`, `heads`, `setup` (templates, implement live), and `baseHead` for the node-failure fallback; `commandTrees` for the release and review targets. `env.setup(examine)` reads `setupEntries` and `heads` only, because the examine heads are the base heads. Writes: `setupPending` and `setupInstruction` (implement live), or `setupFailure` (evaluation and release), or a stop (examine). `env.setup(review)` and `env.setup(release)` write `setupFailure`. `env.setup(release)` stops with `environment_failed/setup_failed` on a base failure or a node head equal to the base head; a budget end takes `onExit`.
- Work: shell.
- Stops: `environment_failed/setup_failed`; a budget end of `env.setup(live)` takes `onExit` (rule 5); a budget end of `env.setup(review)` gives `assessment_absent`; a budget end of `env.setup(examine)` gives the stop `budget_end/wall_time` (rule 5). Before a stop or a budget-end exit, `env.setup(live)` runs the restore sequence of section 5.3 to `heads` on each checkout, under the cleanup deadline.
- Logs: `environment setup` (implement), `setup failed on the node head` (implement, evaluation), `tree prepared` and `tree deleted` (base tree).
- Parallel: serial across checkouts. Sibling of S16 `assets.place` in evaluation, and of S15 `units.plan` in implement (D20).
- Fail-early: F2; in implement it runs after `conflict.turn` (D20).

### S12 `agent.open`

- Phase: prepare (implement), tasks (examine). Chains: implement, examine (shared).
- Problem: open the pi session with the prompt layers.
- Reads: `claim`, `setup`, `checkouts`. Writes: `agent`.
- Port: `agent.open`. The port holds the model runtime factory of the host, and it adds the guards and the capabilities (section 5.5). In a host phase, the step takes the port from the port set of the Foundry host.
- Work: static, and the model runtime of the credential. No model call. No workspace file read (`noContextFiles`).
- Stops: `operation_failed`.
- Parallel: implement: member of `workspace.static`, sibling of S09 and S10. examine: sibling of S25a in `tasks.inputs`.
- Fail-early: F0, before the first LLM step.

### S13 `base.merge` (loop step)

- Phase: start and tasks release_gate loop (release). Chains: implement.
- Problem: merge `origin/<base_branch>`, then `upstream_branch`, into one checkout.
- Reads: `checkouts`, `heads`, `setup`, `revision`. Writes: `heads`, `refreshed`, `openMerge`.
- Work: git. The ancestor check is one `git merge-base --is-ancestor origin/<b> HEAD`, not 2 processes. On a conflict, it writes `openMerge` with the directory, the merged branch, the merged commit, the merge message and the unmerged files. A frame with no conflict writes `openMerge = null`. A frame writes `refreshed = merged` when this frame or an earlier frame merged; else `current`.
- Stops: `operation_failed/repository.connector.git_failed`. The merge runs inside `worker.git` with the git step mark `merge_base`, which gives the stop cause.
- Telemetry: new: a clean merge sets `kanthord.git.commit`, the merge commit, on its `worker.git` span with the git step mark `merge_base`.
- Logs: `base merged`, at the end of the `base.refresh` frame, after `gate.g(conflict)`. The log names the merge commit.
- Parallel: none. The `base.refresh` loop runs one frame per checkout and merged branch, in binding order. The `conflict.revisions` loop and `gate.g(conflict)` run inside the frame before the next merge (D3).
- Fail-early: F1.

### S14 `conflict.turn` (LLM, loop step)

- Phase: start and tasks release_gate loop. Chains: implement.
- Problem: let `swe@1` resolve the conflicts of one checkout. The first turn uses the `Conflict` template. A later turn lists the files that still hold markers (D23).
- Reads: `agent`, `checkouts`, `heads`, `openMerge`, `claim`, `revision`, `setup`, `affectedTests`; scope (marker files of the last check). Writes: none.
- Work: LLM (`Conflict` template). The turn runs on `agent`, which is `input.agent` in `tasks`. The step calls no port.
- Stops: `provider_failed/*`. At a budget end, before the send or inside the turn, `conflict.turn` sends no further model call and returns `next`. `markers.check` then runs once more and reads `io.budget.exhausted()` (D13).
- Parallel: none; one agent.
- Fail-early: F3.

### S14a `markers.check` (loop step)

- Phase: start and tasks release_gate loop. Chains: implement.
- Problem: decide after each conflict turn whether the merge is resolved; own the failed resolution.
- Reads: `claim`, `checkouts`, `openMerge`; scope (marker counter of this merge, marker files and content of the last check). Writes: `openMerge` (writes `resolved: true` when no marker); scope.
- Work: git and file reads (`conflictMarkerFiles` over the files of `openMerge`). On a failed resolution: port call then git.
- Port: `evidence.submit` with `halt: false`, for the conflict report of a failed resolution. A `failed` answer logs `conflict report failed` and stores no stop, so `conflict_unresolved` stays the stop.
- Deadline: `cleanup` (section 2, rule 10).
- Rules (D23):
  - No marker: writes `openMerge` with `resolved: true`; leave the loop; `gate.g(conflict)` commits the merge.
  - Markers left: keep the merge open, commit nothing, and run the next `conflict.turn` with the files that hold markers.
  - The first check of a merge sets the marker counter of this merge to 0. A later check that finds the same marker files with the same content as the last check adds 1. The counter is separate from the no-progress counter. At 2, the resolution fails.
  - `io.budget.exhausted()` and no marker: `markers.check` returns `budget_end`.
  - `io.budget.exhausted()` and markers left: the resolution fails.
  - Failed resolution: submit the conflict report evidence (the cut content of each conflicted file and the list of files still holding markers; cut at a byte limit so the asset stays below 5 MiB; each cut marked; one `produced` asset, no repository asset), log `conflict report failed` on a failed submit, run `git merge --abort`, then return the stop `conflict_unresolved`.
- Stops: `conflict_unresolved` (node `Blocked`, no failure count; `onStop` pushes `heads` first; the stop detail names the conflicted files, fitted to `STOP_DETAIL_MAX_LENGTH`; the cause is the `merge_base` git step). The worker port holds the D28 retry of the submit.
- Parallel: none. Fail-early: F1 for the check; F4 for a failed resolution submit.

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
- Reads: `progress`; scope. Writes: `currentUnit`, `progress` (`unchangedTurns = 0` when `progress.planned`); scope (`revisionCount = 0`).
- Telemetry: the `span` hook of the `units` frame opens the `worker.task` span of the unit (section 5.6). The `end` hook ends it.
- Unit id: the verdict unit uses the node id as `unit_id`.
- Setup instruction: `init` of the `units` frame gives `setupInstruction` to the first pending task of the planned round as its `instruction`, with template `TaskRevision`. No other unit takes it.
- Logs: `task started` (task unit and node unit), `node instruction started` (verdict unit).
- Work: static. Stops: none. Parallel: none. Fail-early: F0.

### S17 `unit.turn` (LLM, loop step)

- Phase: tasks. Chains: implement.
- Problem: run one Work, TaskRevision or CriterionRevision turn for the current unit.
- Reads: `agent`, `revision`, `checkouts`, `affectedTests`, `setup`, `claim`; scope `UnitCtx`. Writes: none.
- Work: LLM. The turn runs on `agent`, which is `input.agent`. The model calls the agent tools `evidence-upload` and `link_update_list` of the host capabilities (section 5.5). The step calls no port.
- Stops: `provider_failed/*`, budget end.
- Parallel: none.
- Fail-early: F3.

### S18 `gate.g` (loop step)

- Phase: tasks (write mode), start and tasks release_gate loop (conflict mode); checkpoint mode is S29. Chains: implement.
- Problem: check the turn for violations and commit it as the only author. In conflict mode, returns `next` with no git process and no `worker.gate` span when `openMerge` is null.
- Reads: `checkouts`, `heads`, `gitPaths`, `openMerge` (conflict and checkpoint modes), `progress`; scope. Writes: `heads`, `openMerge`; scope (`commits`, `changed`). Conflict mode in the release_gate loop also writes `progress` (`unchangedTurns = 0`). Write mode writes no `progress`.
- Work: git (section 5.3). Deadline: `cleanup` (section 2, rule 10). Conflict mode runs only after `markers.check` found no marker.
- Port: `secrets.redact`, for the violation detail, before the log `turn violation` and before the stop.
- Hygiene: after each gate with no violation, `removeRootEntries` removes each entry of the workspace root other than the checkouts and `.kanthord-scratch/` (several checkouts only).
- Stops: `operation_failed/worker.turn.branch_changed`, `.../worker.turn.history_rewritten`, `.../worker.turn.foreign_merge`, `.../worker.turn.merge_missing`, `.../worker.turn.git_in_progress`, `operation_failed/worker.git.commit_failed`.
- Logs: `turn violation`, `root entries removed`, `task committed` after each write-mode gate of a task unit or node unit.
- Parallel: per checkout (D7), with a barrier: all checks end before the first restore or commit. On several violations, the lowest checkout index names the code, and the gate returns one stop.
- Fail-early: F1, directly after each agent turn.

### S21 `verify.own` (loop step)

- Phase: tasks. Chains: implement.
- Problem: apply the verdict rule and progress counts, then run the own commands of the unit in the live checkout.
- Reads: `revision`, `heads`, `baseHead`, `setupEntries`, `setupPending`, `memo`, `checkouts`, `gitPaths`, `setup`, `claim`, `progress`, `agent`; scope. Writes: `setupPending`, `progress`; scope (`passed`, `instruction`, `template`, `revisionCount`).
- Work: verdict rule check (`git rev-list --first-parent --ancestry-path --no-merges --max-count=1 <judged>..HEAD`), under the cleanup context as today; then progress count (`progressRule()`, static, reads `agent.lastText`); then shell commands. The verdict rule runs only for the verdict unit; a verdict with no judged commit skips the rule. If the rule is unmet under the limit, the same instruction goes again (`retry` local); at the limit, the rule waives (`waived` local). `verdictRule()` and `progressRule()` are pure helpers. The step skips the shell commands when the verdict rule forces a retry. The verdict rule holds when one judged checkout holds. On a retry, the step runs no `progressRule()` and no shell command; the verdict rule adds the one count. Before the shell commands, a pending setup runs first and clears `setupPending` on a pass.
- Before a pass, a failure, a stop or a budget-end exit, `verify.own` runs the restore sequence of section 5.3 to `heads` on each checkout, then `removeRootEntries`, under the cleanup deadline, as S11 states for `env.setup(live)`.
- Stops: `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/verification_timeout`, `environment_failed/command_absent`, `operation_failed` (restore invariant failure), `no_progress` (detail per D14; at a count of 2, or with rule `verdict_rule_unmet` when the verification fails after a verdict-rule waiver; the stop ends the `worker.task` span with the `kanthord.stop.*` attributes), budget end.
- Logs: `verdict rule checked`, `verdict rule waived for review`, `task verified` (every unit), `root entries removed`.
- Port: `secrets.redact`, for `agent_reason` of the `no_progress` detail (D14). A `null` answer gives a detail with no `agent_reason`.
- Run state: sets `verificationTimedOut` of `FoundryEnd` to `timed_out` of the last result. The host calls `run.noteVerification` with it; the stop cause reads it.
- Parallel: commands serial.
- Fail-early: F2.

### S23 `unit_record.put` (loop step)

- Phase: tasks. Chains: implement.
- Problem: record that the unit passed at the commits of its run.
- Reads: `claim`, `heads`, `plan`; scope (`commits`). Writes: `completedUnits`; scope.
- Port: `unitRecords.put`. The worker port sends `worker.execution.unit_record.put`.
- Work: port call. It runs only for a task unit, or for the node unit of a node with no task (section 5.1). On each pass, it adds one to `completedUnits` when the unit is the verdict unit, or when a checkout head is in `commits` and `plan` holds no valid record of the unit. The put runs only for a task unit or for a unit of a node with no task. With no eligible head, it logs `unit record skipped`.
- Stops: `revoked` only, through the abort of `input.cancel` after an execution-end answer. The step checks `input.cancel` before the log: on an abort, it writes no log. Any other `failed` answer logs `unit record failed`, and the unit counts as not recorded (D10).
- Logs: `unit recorded`, `unit record skipped`, `unit record failed` (replace `done recorded` and `done record skipped`).
- Parallel: none.
- Fail-early: F4.

### S42 `base.fetch`

- Phase: tasks release_gate loop. Chains: implement.
- Problem: fetch `base_branch` and `upstream_branch` of each checkout before the release merge.
- Reads: `checkouts`, `setup`. Writes: none.
- Port: `repository.fetchBase`. The worker port calls `transport.fetchBase`. The signer stays behind the port, and the step reads no `sshAccess`.
- Work: network git in the port, inside `worker.git` with the git step mark `fetch_base`, which gives the stop cause. Deadline: `work`; a thrown deadline with an exhausted budget gives the budget-end exit (rule 5).
- Stops: `operation_failed/repository.connector.git_failed`.
- Parallel: per checkout (D7). One `git fetch --prune origin` per checkout, then one `git rev-parse origin/<branch>` for each merged branch.
- Fail-early: F1.

### S24 `release_trees.prepare`

- Phase: tasks release_gate loop. Chains: implement.
- Problem: give each binding a clean Command tree at the head.
- Reads: `checkouts`, `heads`. Writes: `commandTrees`.
- Port: `releaseTrees.take` and `releaseTrees.give`. The worker port does the pool take, `clonePacked` and the pool give.
- Work: git in the port (pool take or `clonePacked` from the live checkout). Deadline: `work`; a thrown deadline with an exhausted budget gives the budget-end exit (rule 5).
- Stops: `operation_failed` with no code.
- Give: at the end of each `release_gate` loop frame, on a pass, a route, a budget-end exit and a stop, the loop frame `end` hook calls `releaseTrees.give` for each release tree. The worker port gives the tree back to the Command pool and removes the release directory. The dispose stack of the host holds the give only as the fallback. A leftover release tree goes back at the next `workspace.node` (S06).
- Logs: `tree prepared`.
- Parallel: per checkout.
- Fail-early: F1.

### S25 `verify.all`

- Phase: tasks (both chains). Chains: implement (release_gate loop), evaluation (shared).
- Problem: run every node and task command in clean trees, with `copyRepeated` and `reruns: 2`.
- Reads: `revision`, `heads`, `baseHead`, `claim`, `setup`, `checkouts`, `setupFailure` (release only), `commandTrees` and `memo` (release only), `commandTrees` (evaluation only). Writes: `verification`.
- Work: shell. Skipped after a setup failure in the release gate only; `verify.all(evaluation)` always runs. Each command runs with `childEnvironment` and with no SSH agent socket, so its output holds no credential of the execution.
- Stops (release only): `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/verification_timeout`, `environment_failed/command_absent`, budget end.
- Logs: `verification flaky` (release only).
- Run state: sets `verificationTimedOut` of `FoundryEnd` to `timed_out` of the last result. The host calls `run.noteVerification` with it; the stop cause reads it.
- Parallel: commands serial, in plan order (D11).
- Fail-early: F2.

### S25a `verify.node`

- Phase: tasks. Chains: examine.
- Problem: give the examine turn the result of the node commands at the base heads.
- Reads: `claim`, `setup`, `revision`, `checkouts`, `heads`. Writes: `verification` (`VerificationRun | null`; null when no checkout exists). S39 reads `verification.verification`.
- Work: shell. Only the node commands (`revision.content.verifications`), in the examine workspace directory. No flaky rerun, no copy, no baseline. The shared runner reruns an infrastructure-class command once; the second result goes into `verification`. The step skips the run when the workspace has no checkout (`tested_input` is null). Each command runs with `childEnvironment` and with no SSH agent socket, so its output holds no credential of the execution.
- Stops: none extra. A failed, absent or timed-out command goes into `verification` and does not stop the examine. A command that the wall deadline ends, or that is not started at the wall deadline (class `budget_end`), gives `budget_end`; the step reads `outcome` of `runVerificationsWithOutput` and calls `budget.wallDeadlineReached()` first.
- Run state: sets `verificationTimedOut` of `FoundryEnd` to `timed_out` of the last result. The host calls `run.noteVerification` with it; the stop cause reads it.
- Parallel: commands serial; sibling of `agent.open`.
- Fail-early: F2.

### S26 `affected.run`

- Phase: tasks (both chains). Chains: implement (release_gate loop), evaluation (shared).
- Problem: run the affected test command on the head, and on the base after a head failure.
- Reads: `heads`, `baseHead`, `verification`, `claim`, `setup`, `checkouts`, `setupFailure` (release only), `commandTrees` (release and evaluation). Writes: `affected`. The step reads and validates the declaration at `origin/<base_branch>` of its tree, in both chains; an invalid file stops with `environment_failed/affected_invalid`.
- Work: shell. In evaluation the step runs only in the implement intent, with one checkout or more, after a passed setup and a passed `verify.all`. A skipped step writes `affected: null`. Each command runs with `childEnvironment` and with no SSH agent socket, so its output holds no credential of the execution.
- Stops: `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/affected_invalid`, `environment_failed/affected_timeout`, `environment_failed/command_absent`, budget end.
- Parallel: serial across checkouts.
- Fail-early: F2, only after `verify.all` passes.

### S27 `release.route` (loop step)

- Phase: tasks release_gate loop. Chains: implement.
- Problem: pass the gate, or route the first failure to its owner unit with a TaskRevision instruction.
- Reads: `verification`, `affected`, `setupFailure`, `revision`, `claim`, `setup`, `heads`, `progress`. Writes: `route`, `progress`. When `progress.planned` holds, `release.route` writes `unchangedTurns = 0` and `planned = false`. A setup failure routes to the node unit. Owners: a setup failure and an affected failure go to the node unit; a failed command goes to the owner of the first failed index.
- Work: static.
- Stops: none.
- Logs: `release verified`, `release failure routed`.
- Parallel: none.
- Fail-early: F0.

### S28 `report.coder` (loop step)

- Phase: tasks, units loop, after S23. Chains: implement.
- Problem: submit the report of one unit as soon as the unit passes, so a budget end loses no report (D29).
- Reads: `currentUnit`, `agent` (`agent.lastText()`, the final agent text of the unit). Writes: none.
- Port: `evidence.submit`, for the report.
- Work: port call. Subject `Coder report of unit <unit id>`; the verdict unit uses `Coder report of unit <node id>`; body `## <unit id> <unit name>` and the final text. Skip when the final text is empty. Stops: `operation_failed/<server code>` on a `failed` answer; the worker port holds the D28 retry. Parallel: none. Fail-early: F4.

### S29 `checkpoint.gate`

- Phase: onExit budget_end and onStop. Chains: implement.
- Problem: commit the partial work of the current unit before the push.
- Reads: `checkouts`, `heads`, `gitPaths`, `currentUnit`, `openMerge`. Writes: `heads`.
- Work: git (gate G in checkpoint mode; D13). Deadline: `cleanup` (section 2, rule 10). The message names `currentUnit`, or the node unit when it is null. On `onExit`, the gate concludes only an `openMerge` with `resolved: true`. It aborts each other `MERGE_HEAD`. An `openMerge` with no `MERGE_HEAD` counts as no merge. On `onStop`, the gate aborts every `MERGE_HEAD`.
- Stops: `operation_failed/worker.turn.*` (onExit only; onStop restores instead).
- Logs: `checkpoint failed` (onStop, on a failure that does not replace the stop).
- Parallel: per checkout.
- Fail-early: F1.

### S31 `branch.push`

- Phase: finish, onExit budget_end and onStop. Chains: implement.
- Problem: fence the push against a revoke, then push each node branch with the push record around each push.
- Reads: `checkouts`, `heads`, `claim`, `sshAccess`. Writes: none.
- Work: Fence first (`scheduler.claim.get`, no `run.call`): a completed answer with a `claim_state` other than `running`, or an execution-end answer, is a revoke answer; every other answer and a thrown error let the push continue; in `onStop` a revoke answer skips the push and the stored stop stays; never raises `operation_failed`; in `onStop` uses `run.cleanupContext()` and no `requireActive`. The fence ends the `claim.watch`. The push uses `push-record.ts` on the file directly (no context key). The step uses `worker.git` with the git step mark `push`, which gives the stop cause. The push of `onStop` also writes a `worker.git` span. With no `confirmed` commit in the push record, the push is create-only (`--force-with-lease=refs/heads/<branch>:`, D24). Every later push is a fast-forward push. Deadline: `cleanup` (section 2, rule 10).
- Stops: `revoked` (finish and onExit, from the fence), `operation_failed/repository.connector.git_failed`, `operation_failed/repository.node_branch.taken`.
- Parallel: per checkout; one push record file per binding.
- Fail-early: F1 (fence), F4 (push).

### S32 `evidence.head`

- Phase: finish. Chains: implement.
- Problem: record the pushed head of each binding. This evidence meets the release obligation.
- Reads: `heads`, `checkouts`. Writes: none.
- Work: server. Stops: none extra. Parallel: none. Fail-early: F4.

### S34 `evidence.publish` (evaluation)

- Phase: tasks (evaluation). Chains: evaluation.
- Problem: submit the verification evidence, the affected evidence and the round patch evidence.
- Reads: `verification`, `affected`, `claim`, `placedAssets`, `reviewWorkspace`, `heads`. Writes: `evidenceIds`.
- Port: `evidence.submit`, once for each evidence.
- Work: port calls.
- Stops: none extra.
- Parallel: the submits run after `affected.run`, in parallel. The patch evidence goes out before the judgement. Kept: the verification evidence also goes out before a stop of `verify.all(evaluation)`; `verify.all(evaluation)` writes the stop class into `verification`, and `judgement` raises `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/verification_timeout`, `environment_failed/command_absent` or `assessment_absent` after `evidence.publish`. New: a stop of `affected.run(evaluation)` submits no evidence. The affected submit runs only when `affected` holds a document. The order of `evidence_ids` stays verification, affected, patches, placed. The snapshot evidence is the first entry of the placed group.
- Fail-early: F4.

### S35 `judgement` (LLM)

- Phase: tasks. Chains: evaluation.
- Problem: get the `kanthord-judgement:` JSON line; write `criterion-not-met` with no LLM on a setup, verification or affected failure.
- Reads: `claim`, `setup`, `revision`, `verification`, `affected`, `setupFailure`, `placedAssets`, `reviewWorkspace`, `reviewRound`, `dependencies`. Writes: `judgement` (never null).
- Port: `agent.open`. The step reads no credential. The step gives `reviewWorkspace`; the port computes the roots of `checkoutConfinement`.
- Work: LLM (`Evaluation`, then `Repair` when needed). Order: (1) the deferred stops of `verify.all(evaluation)` and the shortcut assessment, with an early return; (2) `agent.open` with the evaluation tool set and `checkoutConfinement`; the port registers the close on the dispose stack of the host; (3) the budget check; (4) the `Evaluation` turn and one `Repair` turn. After each turn, an exhausted budget gives the budget end before the step parses the reply.
- Result: in the examine intent, a judgement with proposals gives the result `Undetermined` (`evaluation.ts:282-299`). In the implement intent, the proposals are dropped.
- Stops: `operation_failed/worker.verification.infrastructure_failed`, `environment_failed/verification_timeout`, `environment_failed/command_absent`, `assessment_absent`, `judgement_invalid`, `provider_failed/*`, `operation_failed` (agent open), budget end.
- Logs: `node judged`.
- Budget: steps (1) and (2) run before the explicit budget check at step (3). Step (1) must run with an exhausted budget.
- Parallel: none. Fail-early: F3.

### S37 `assessment.submit`

- Phase: finish. Chains: evaluation.
- Problem: submit the assessment with `tested_input` and the evidence set; keep prior blockers not in `fixed_finding_ids`. On a `success` result, request the required external actions and call `execution.release(false)`.
- Reads: `judgement`, `evidenceIds`, `heads`, `reviewRound`, `reviewWorkspace`, `dependencies`, and the resource `credentialStore` for the settle. Writes: the answer (outcome, node state).
- Work: server. Deadline: cleanup. The run method does these acts in order before the call: end the claim watch; end each open `worker.step`, `worker.task`, `worker.release_gate`, `worker.evaluation` and `worker.phase` span, with `Error` on a stop; settle the credentials once; close the agent traces, with `Error` for `execution.release(stop)` and `Ok` otherwise; flush the spans for at most 5 s. A later span end is a no-op. `tested_input` is the tested commit set of the review trees, or the newest placed asset when the workspace has no checkout (S07).
- Stops: `operation_failed` when the answer has no outcome, the node stays in `Evaluating` and the result is not `success` (`evaluation.ts:669-671`). An answer with no outcome and a node state other than `Evaluating` ends the chain as `revoked` (`evaluation.ts:663-668`). An outcome ends the chain as `closed` with the outcome id. A `success` result with no outcome requests the required external actions; a reply is not a required external action. The Mission Service drafts each reply as an `awaiting_approval` request in the transaction that moves the node to `Completed`; a human approves or rejects it (EM rulings 2026-11-16). A failed request stops with `action_unsettled`. Fail-early: F4.

### S39 `examine.turn` (LLM)

- Phase: tasks. Chains: examine.
- Problem: get the examine assessment text; submit the Markdown report evidence.
- Reads: `agent`, `claim`, `setup`, `revision`, `checkouts`, `verification`, `dependencies`. Writes: none.
- Work: LLM (`Examine`). After the turn, the step builds the report with `reportFacts` and submits the evidence with the subject `Report on current dependency outcomes`. The worker port bounds the server call by `expired_at` through `run.call`, not by the wall deadline.
- Port: `evidence.submit`, for the report.
- Stops: `report_absent` on an empty last text, `provider_failed/*`, budget end, `operation_failed/<server code>` on a submit failure.
- Budget end: a budget end inside the turn exits with `budget_end`. New: a turn that completes with a nonempty last text keeps the report, also when the budget is exhausted after the turn; the chain continues to the final step and releases with `further_work` false. New: the step keeps the report only when the last assistant message has no tool call and no abort, and the last text is nonempty. With an exhausted budget and any other end, the step returns `budget_end`. `report_absent` applies only when the budget is not exhausted.
- Budget checks: the turn call returns the budget end before the send (rule 5). A budget end in `prepare` is the stop `budget_end/wall_time`.
- Fail-early: F3.

### S41 `execution.release`

- Phase: finish, onExit budget_end and onStop. Chains: all (shared).
- Problem: release with `further_work`, the budget limit, or the stop.
- Reads: `claim`, `completedUnits` or the chain exit, and the resource `credentialStore` for the settle. `execution.release(stop)` reads the same resource. Writes: none.
- Work: server. Deadline: cleanup. The run method does these acts in order before the call: end the claim watch; end each open `worker.step`, `worker.task`, `worker.release_gate`, `worker.evaluation` and `worker.phase` span, with `Error` on a stop; settle the credentials once; close the agent traces, with `Error` for `execution.release(stop)` and `Ok` otherwise; flush the spans for at most 5 s. A later span end is a no-op. Implement sends the stop `budget_end/<limit>` only when no unit completed (section 5.1). `<limit>` is `budget.limit()`. New: examine always sends the stop `budget_end/<limit>` on a budget end, because it has no unit that completes; the release then counts toward `mission.further_work_limit`. When both limits hold, the budget end names `turns` before `wall_time`.
- Revoke: Kept: a revoke runs no final step and no flush, and the sink drops the queued records and logs `telemetry records dropped`. New: dispose closes the agent traces with `Error`.
- Answer of `execution.release` (`execution-run.ts:466-512`):
  - A refused credential settle with an execution-end answer stops with `revoked`; another refused settle stops with `operation_failed/<code>`.
  - An `Indeterminate` answer first takes the D28 retry with the same key. After the bound, the runner reads the claim. `finished` counts as released. Another state stops with `operation_failed`.
  - Another failure stops through `run.call`.
- Answer of `execution.release(stop)` (`execution-run.ts:515-614`), always in `run.cleanupContext()`:
  - A refused credential settle with an execution-end answer ends as `revoked` with no release.
  - An `Indeterminate` answer first takes the D28 retry with the same key. After the bound, the runner reads the claim. `finished` with a stop counts as released; an execution-end answer ends as `revoked`.
  - A completed answer releases with `further_work: true` and the stop. An execution-end answer ends as `revoked`.
  - Any other failure returns the stop itself as the end (`Ended` with the stop reason, code and detail).
- Stops: a failed release that is not revoked returns the Diagnostic that ends the pull loop (unchanged).
- Fail-early: F4, last.

## 4. Chains as call stacks

Chain selection (`runNativeExecution`). `hostExecution` calls `credentials.handover` and `setup.read`, registers `credential.store` and `ssh.access`, builds the budget, reads `method` of the worker declaration and `setup.intent` to select the chain, then calls `runChain` with the seed.

| `method`                                                | `intent`    | Chain                                          |
| ------------------------------------------------------- | ----------- | ---------------------------------------------- |
| `evaluation`                                            | any         | `evaluation`                                   |
| `steps`                                                 | `examine`   | `examine`                                      |
| `steps`                                                 | `implement` | `implement`                                    |
| none (`claude-code@1`, an external harness declaration) | any         | no chain; stop `operation_failed` with no code |

Notation: `[LLM]` marks a model call. `[PAR]` marks a parallel group. Each child of a `[PAR]` line runs at the same time: a `branch` with its own steps, or one `step`. `loop` marks a frame that repeats. `exit` and `stop` name the short-circuit edges. `[cleanup]` marks a step with the cleanup deadline (section 2, rule 10). `host` marks a host function in `hostExecution`. The runner always runs the last `onStop` node, `execution.release(stop)`. `port:` names each Foundry port that a `FoundryStep` calls (section 2). The host runs each `tasks` phase as one call of the `tasks` function of the chain.

```text
chain implement
  host credentials.handover                 the first handover of an attempt pins the prompt commits (D25)
  host setup.read                           reads the prompt pin of credentials.handover
  resource claim.watch                      ends at the start of branch.push or execution.release
  resource credential.store                 pi auth, refresh lease and report
  resource ssh.access                       handed key or relay signer per binding
  phase prepare
    [PAR] prepare.inputs
      step inputs.read(revision, prior)     reads revision and prior in parallel
      branch workspace
        step inputs.read(attemptEvidence)
        step workspace.node                 [PAR] per checkout
        [PAR] workspace.static
          step affected.declaration         [PAR] per checkout; stop environment_failed/affected_invalid
          step setup.entries
          step agent.open
  phase start
    loop base.refresh(claim)                one frame per checkout and merged branch, in binding order
      step base.merge                       merge-base --is-ancestor, then merge
      loop conflict.revisions               only when the merge conflicts; until no marker is left (D23)
        step conflict.turn                  [LLM] Conflict; later turns list the files with markers
        step markers.check                  markers left -> next turn; counter at 2, or budget end with markers left -> resolution fails; budget end with no marker -> exit budget_end
      step gate.g(conflict)                 no marker left; commits the merge; stop worker.turn.*; port: secrets.redact
    [PAR] start.inputs
      step env.setup(live)                  on the merged heads; stop environment_failed/setup_failed; exit budget_end
      step units.plan                       [PAR] per checkout: unit record range, judged history, verdict rule
  phase tasks                               one call: foundryImplement(input, host)
    loop release_rounds                     until route = passed or budget end
      loop units                            scope UnitCtx; planned round: pending units, then the verdict unit
        step unit.enter                     writes currentUnit; planned round resets the progress count
        loop revisions                      until passed
          step unit.turn                    [LLM] Work | CriterionRevision | TaskRevision; agent tools evidence-upload, link_update_list
          step gate.g(write)                [PAR] per checkout; stop worker.turn.*; port: secrets.redact
          step verify.own                   verdict rule, progress rule, then shell commands; [PAR] per checkout restore on exit; port: secrets.redact (D14)
        step unit_record.put                port: unitRecords.put; on pass with a gate commit; a failure that is not revoked logs only
        step report.coder                   port: evidence.submit; on pass with non-empty final text; subject `Coder report of unit <unit id>` (D29)
      loop release_gate                     id "release_gate"; one frame per round
        step base.fetch                     port: repository.fetchBase; [PAR] per checkout
        loop base.refresh(release)          one frame per checkout and merged branch, in binding order
          step base.merge
          loop conflict.revisions           only when the merge conflicts; until no marker is left (D23)
            step conflict.turn              [LLM] Conflict; later turns list the files with markers
            step markers.check              markers left -> next turn; counter at 2, or budget end with markers left -> resolution fails, port: evidence.submit; budget end with no marker -> exit budget_end
          step gate.g(conflict)             no marker left; commits the merge; port: secrets.redact
        step release_trees.prepare          port: releaseTrees.take; [PAR] per checkout
        step env.setup(release)             node failure -> release.route; exit budget_end
        step verify.all(release)            plan order; skipped after a setup failure
        step affected.run(release)          only when verify.all passed; skipped after a setup failure
        step release.route                  passed -> leave release_rounds; routed -> owner unit, next round
        frame end: give release trees       port: releaseTrees.give; at frame end, on every outcome
  phase finish
    step branch.push                        [PAR] per checkout; claim watch ends, stop revoked
    step evidence.head
    step execution.release                  [cleanup] further_work false
  onExit budget_end
    step checkpoint.gate                    [PAR] per checkout; concludes openMerge with resolved: true; aborts each other MERGE_HEAD
    step branch.push                        [PAR] per checkout; claim watch ends, stop revoked
    step execution.release                  [cleanup] further_work true; stop budget_end only when no unit completed
  onStop not revoked
    step checkpoint.gate(restore)           aborts an open merge
    step branch.push                        [PAR] per checkout; pushes heads; revoke answer skips
    step execution.release(stop)            [cleanup] ordered stops carry their reason (rule 4a)
  dispose resources                         release trees, base heads, agent session, node key and scratch store, SSH access, credential store and handover keys

chain evaluation
  host credentials.handover                 the first handover of an attempt pins the prompt commits (D25)
  host setup.read                           reads the prompt pin of credentials.handover
  resource claim.watch                      ends before assessment.submit or execution.release
  resource credential.store                 pi auth, refresh lease and report
  resource ssh.access                       handed key or relay signer per binding
  phase prepare
    step inputs.read(revision, attemptEvidence, reviewRound, dependencies)
    step workspace.review(snapshot)         [PAR] per checkout; stop operation_failed when a snapshot is missing
    [PAR] prepare.place
      branch environment
        step setup.entries
        step env.setup(review)              budget end -> stop assessment_absent
      branch assets
        step assets.place                   at most 4 downloads at a time
  phase tasks                               one call: foundryEvaluation(input, host)
    loop evaluation                         one frame; span worker.evaluation
      step verify.all(evaluation)           budget end -> stop assessment_absent
      step affected.run(evaluation)         implement intent, one checkout or more, verify.all passed, setup passed
      step evidence.publish                 port: evidence.submit; [PAR] verification, affected, round patches
      step judgement                        [LLM] shortcut on failure -> criterion-not-met; then port: agent.open, Evaluation, Repair once; stop judgement_invalid, assessment_absent
  phase finish
    step assessment.submit                  [cleanup] outcome -> closed; node not Evaluating -> revoked; non-success -> stop operation_failed; success -> request actions, stop action_unsettled; then execution.release(false)
  onStop not revoked
    step execution.release(stop)            [cleanup]
  dispose resources                         review trees, review base head, agent session, SSH access, credential store and handover keys

chain examine
  host credentials.handover                 the first handover of an attempt pins the prompt commits (D25)
  host setup.read                           reads the prompt pin of credentials.handover
  resource claim.watch                      ends before execution.release
  resource credential.store                 pi auth, refresh lease and report
  resource ssh.access                       handed key or relay signer per binding
  phase prepare
    [PAR] prepare.inputs
      step inputs.read(revision, dependencies)
      branch workspace
        step workspace.review(base)         [PAR] per checkout
        step setup.entries
        step env.setup(examine)             stop environment_failed/setup_failed; budget end -> stop budget_end/wall_time
  phase tasks                               one call: foundryExamine(input, host)
    [PAR] tasks.inputs
      step agent.open                       port: agent.open
      step verify.node(examine)             node commands only; no flaky rerun, copy or baseline; infra rerun once; skipped with no checkout; exit budget_end
    step examine.turn                       [LLM] Examine; stop report_absent; exit budget_end; kept report when complete, no tool call, no abort; port: evidence.submit for the report
  phase finish
    step execution.release                  [cleanup] further_work false
  onExit budget_end
    step execution.release                  [cleanup] further_work true, stop budget_end/<limit>
  onStop not revoked
    step execution.release(stop)            [cleanup]
  dispose resources                         examine trees or the execution workspace, agent session, SSH access, credential store and handover keys
```

## 5. Mechanism replacements

### 5.1 Unit record (replaces the done record)

Owner: the Worker Service, which owns the done record rule today and owns `execution.setup.get`.

Storage: a new table `worker_unit_record` in the operational store.

| Column           | Reader                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `node_id`        | `execution.setup.get` selects by node.                                                                          |
| `unit_id`        | `units.plan` matches the unit.                                                                                  |
| `content_digest` | `units.plan` compares it with `digest(unit.content)` of `src/kernel/json.ts`.                                   |
| `commits`        | JSON array of `{ binding_id, commit }`; `units.plan` checks each commit against the node range of its checkout. |

`unit_id` is a task id, or the node id for a node without tasks. Only a task unit, or the node unit of a node without tasks, writes a record. In a node with tasks, the verdict unit writes no record. A node unit that a release failure routes to (`release-gate.ts` `commandOwners`) writes no record there. No reader reads a node-id record in such a node.

Unique key: `(node_id, unit_id)`. A put replaces the row. The table holds no attempt, no execution and no time column, because no decision reads them. Open question 1 holds `project_id` and the row deletion.

Write (`worker.execution.unit_record.put`, `PUT /api/worker/execution/:execution_id/unit_record`):

1. A unit passes its live verification (`verify.own`).
2. `unit_record.put` takes each checkout whose head is in the commit set of the gate of that unit run. With no such checkout, it logs `unit record skipped` and sends nothing, as `writeDoneRecord` does today.
3. It sends `{ unit_id, content_digest, commits }`, with one entry per taken checkout.
4. The server checks the execution proof, the claim, that `unit_id` is the node id or a task id of the pinned revision, and that each `binding_id` is in the repository binding set of the revision.
5. The worker logs `unit recorded`. A failure that is not `revoked` logs `unit record failed` and ends nothing (D10). The put uses the no-halt call: a variant of `run.call` that returns the failure, stores no stop and cancels nothing. `run.call` stores every failure as the stop and cancels `operationContext`. `evidence.submit` with `halt: false` uses the same no-halt call (section 2).

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

| Part           | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClaimWatch`   | The watch starts when the runner starts. It fires 60 s from the start, then every 60 s (`CLAIM_WATCH_INTERVAL_MS = 60000`, the registration heartbeat interval).                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Proof          | One proof hook on the worker transport covers every call of an operation with `requiresExecution`: `run.call`, the agent tools, the credential lease and report, `worker.ssh.sign`, and the telemetry writes. An execution-end answer of any such call calls `run.revoke()`, so an agent-tool revoke also ends as `revoked`. The gateway answers such a call only for a claim with `ended_at` null and `expired_at` in the future, which is the `running` claim state. The execution-end answers are 403 `gateway.invocation.execution_proof_failed` and 409 `scheduler.execution.not_running`. |
| Fire           | The timer sends `scheduler.claim.get`. A `running` state does nothing. Another state, or an execution-end answer, calls `run.revoke()`. A network error ends nothing; the next fire follows the interval.                                                                                                                                                                                                                                                                                                                                                                                       |
| `run.revoke()` | Sets the `revoked` stop and cancels `operationContext`. `stopOnEnd` aborts the pi session; the verification runner kills its command. No throw happens on the timer.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| End            | The watch ends at the start of `branch.push`, before `assessment.submit`, before `execution.release`, before `releaseStop`, and at any stop. A final step can end the claim, and the watch must not read that end as a revoke.                                                                                                                                                                                                                                                                                                                                                                  |
| Fence          | The fence logic runs inside `branch.push`. It does not use `run.call`. A completed answer with a `claim_state` other than `running`, or an execution-end answer, is a revoke answer. Every other answer and a thrown error let the push continue. The fence never raises `operation_failed`. In `onStop`, the fence uses `run.cleanupContext()`, because the stop already cancelled `operationContext`.                                                                                                                                                                                         |
| Removed        | The `turnCheck` call in `finishTurn` (`native-agent.ts:172-176`), `checkClaim` at `steps-implement.ts:525` and `:598`. The budget guard `budget.exhaustedAfterTurn()` in `finishTurn` (`native-agent.ts:171`) stays: it ends the session before a turn past the turn budget.                                                                                                                                                                                                                                                                                                                    |

Stop delay: at most 60 s plus one `scheduler.claim.get` round trip plus one abort.

Safe state after a revoke in the middle of a step:

- The revoked path runs no checkpoint and no push, as today.
- A killed git process can leave `index.lock`. `normaliseGitState` removes each lock at the next take of the tree.
- The watch ends at the fence, so the watch never kills a push. A push that the claim expiry kills keeps its `pending` push record, as today.
- A stop order `revoked` during a push cancels the push; the `pending` push record stays.
- `unit_record.put` and every evidence submit go through the server, which checks the claim.

Stale push: the window between the fence and the end of the push is one round trip plus the push.

### 5.3 Gate G git reduction

Setup once per checkout per execution, in `workspace.node`:

```text
git rev-parse --git-path rebase-merge --git-path rebase-apply/applying --git-path rebase-apply --git-path CHERRY_PICK_HEAD --git-path REVERT_HEAD --git-path MERGE_HEAD
```

The result goes to `gitPaths`. Each gate and restore uses `lstat` on `.git`. When `.git` is a directory, the gate uses `existsSync` on the six cached paths, with no process. When `.git` is not a directory, one `git rev-parse --git-path` resolves the six paths again for that call, so a turn that writes a gitdir file keeps its commit and its push. These six paths are per-worktree state, so a later `commondir` or config change does not move them.

Before, write mode, per checkout, per agent turn (`turn-gate.ts`, `local-git.ts`):

| #   | Command                                                               | Unchanged | Changed                | Agent committed        |
| --- | --------------------------------------------------------------------- | --------- | ---------------------- | ---------------------- |
| 1   | `git symbolic-ref --quiet HEAD`                                       | yes       | yes                    | yes                    |
| 2   | `git merge-base --is-ancestor <before> HEAD`                          | yes       | yes                    | yes                    |
| 3   | `git rev-list --merges --parents <before>..HEAD`                      | yes       | yes                    | yes                    |
| 4   | `git rev-parse --git-path <6 paths>`                                  | yes       | yes                    | yes                    |
| 5   | `git rev-parse HEAD`                                                  | yes       | yes                    | yes                    |
| 6   | `git reset --soft <before>`                                           |           |                        | yes                    |
| 7   | `git add --all`                                                       | yes       | yes                    | yes                    |
| 8   | `git diff --cached --raw -z --no-abbrev --no-renames`                 | yes       | yes                    | yes                    |
| 9   | `git hash-object --no-filters -- <M paths>`                           |           | when M paths exist     | when M paths exist     |
| 10  | `git update-index --cacheinfo ...`                                    |           | when conversion-only   | when conversion-only   |
| 11  | `git diff --cached --quiet --`                                        | yes       | yes                    | yes                    |
| 12  | `git commit --message <m>`                                            |           | yes                    | yes                    |
| 13  | `git rev-parse HEAD` (in `commitWork`)                                |           | yes                    | yes                    |
| 14  | `git rev-parse HEAD` (in `settleCheckout`)                            | yes       | yes                    | yes                    |
| 15  | `git symbolic-ref --quiet HEAD` (assert)                              | yes       | yes                    | yes                    |
| 16  | `git rev-parse HEAD` (assert)                                         | yes       | yes                    | yes                    |
| 17  | `git diff --cached --quiet --` (assert)                               | yes       | yes                    | yes                    |
| 18  | `git ls-files --others --exclude-standard -z` (assert)                | yes       | yes                    | yes                    |
| 19  | `git rev-parse --git-path <6 paths>` (assert)                         | yes       | yes                    | yes                    |
| 20  | `git diff --name-only -z --no-renames <before> <head> --` (telemetry) |           | yes                    | yes                    |
|     | Total                                                                 | 14        | 18 (17 with no M path) | 19 (18 with no M path) |

After, write mode, per checkout, per agent turn:

| #   | Command                                                                         | Unchanged | Changed                          | Agent committed                  |
| --- | ------------------------------------------------------------------------------- | --------- | -------------------------------- | -------------------------------- |
| 1   | `git status --porcelain=v2 --branch --no-ahead-behind -z --untracked-files=all` | yes       | yes                              | yes                              |
| 2   | `git merge-base --is-ancestor <before> HEAD`                                    |           |                                  | yes                              |
| 3   | `git rev-list --merges --parents <before>..HEAD`                                |           |                                  | yes                              |
| 4   | `git reset --soft <before>`                                                     |           |                                  | yes                              |
| 5   | `git add --all`                                                                 |           | yes                              | yes                              |
| 6   | `git diff --cached --raw -z --no-abbrev --no-renames`                           |           | yes                              | yes                              |
| 7   | `git hash-object --no-filters -- <M paths>`                                     |           | when M paths exist               | when M paths exist               |
| 8   | `git update-index --cacheinfo ...`                                              |           | when conversion-only             | when conversion-only             |
| 9   | `git commit --message <m>`                                                      |           | when the staged set is not empty | when the staged set is not empty |
| 10  | `git status --porcelain=v2 --branch --no-ahead-behind -z --untracked-files=all` |           | yes                              | yes                              |
|     | Total                                                                           | 1         | 6 (5 with no M path)             | 9 (8 with no M path)             |

The totals leave out `update-index` (row 10 before, row 8 after). It adds 1 process to both tables when a conversion-only path exists.

Rules of the new gate:

1. Status 1 gives `# branch.head`, `# branch.oid`, the entries, the `u` lines and the `?` lines. `--no-ahead-behind` stops the commit walk against the upstream that `checkout -B <b> origin/<ref>` sets.
2. Fast path (write mode, and checkpoint mode with no `openMerge`): `branch.head` is the node branch, `branch.oid` equals `before`, no entry, no `?` line and no operation path exists. Status lists each path that `add --all` stages, so `add --all` would stage nothing. The turn is unchanged, and the gate ends. An entry with only a worktree-side change takes the slow path. With a submodule whose `ignore` is `all`, status lists nothing while `add --all` stages the gitlink; `diff --cached --raw` hides that gitlink, so the outcome is the same: no commit and an unchanged turn.
3. Violation checks run in the order of today. The first match names the code:
   1. `branch.head` is not the node branch (also `(detached)`): `worker.turn.branch_changed`. The detail names `refs/heads/<branch>`, or the ref of one `git symbolic-ref --quiet HEAD` when `branch.head` is `(null)`.
   2. `branch.oid` differs from `before`, and command 2 fails: `worker.turn.history_rewritten`.
   3. `branch.oid` differs from `before`, and command 3 lists a merge with a parent that is not `before` and not the commit of `openMerge`: `worker.turn.foreign_merge`.
   4. Conflict mode: the cached `MERGE_HEAD` file does not hold the commit of `openMerge`: `worker.turn.merge_missing`.
   5. An operation path exists (`MERGE_HEAD` excepted in conflict mode): `worker.turn.git_in_progress`.

   When `branch.oid` equals `before`, command 2 holds and command 3 lists nothing, so the gate skips both with no change of result.

4. All checkouts run step 3 in parallel (D7). The gate waits for every checkout. On a violation, it restores every checkout to `before` and returns one stop with the code of the lowest checkout index. In `onStop`, it restores and returns.
5. With no violation and `branch.oid` not `before`, command 4 resets.
6. Command 6 lists the staged set. The `M` entries with the same regular mode are the conversion candidates for command 7. The staged set minus the conversion-only paths decides the commit, and gives the changed paths for the span. This replaces `diff --cached --quiet` and `diff --name-only`.
7. Status 10 is invariant I: `branch.head` is the node branch, `branch.oid` is the new head, no `u` line, no `?` line, and no operation path exists. No entry has an index-side change (X is not `.`), apart from a gitlink entry whose three modes are `160000`. It also gives the new `heads` value. A conversion-only path can show a worktree-side change (Y), as today, and does not fail the invariant.
8. Conflict mode runs only after `markers.check` found no marker (D23). `concludeMerge` (commands 5 to 9) then commits the merge.
9. Checkpoint mode on `onExit`: the gate concludes an `openMerge` with `resolved: true` by running the conflict-mode checks (D13). It aborts each other `MERGE_HEAD`, as today. An `openMerge` with no `MERGE_HEAD` counts as no merge. Checkpoint mode on `onStop`: the gate aborts every `MERGE_HEAD`.

Replacement map:

| Removed process                                                      | New source                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `symbolic-ref` (check and assert)                                    | `branch.head` of status 1 and status 10                                            |
| `rev-parse HEAD` (3 times)                                           | `branch.oid` of status 1 and status 10                                             |
| `rev-parse --git-path` (check and assert)                            | `gitPaths` and `lstat` on `.git`                                                   |
| `merge-base --is-ancestor`, `rev-list --merges` on an unchanged head | Skipped; the result is fixed when `branch.oid` equals `before`                     |
| `add --all`, `diff --cached --raw` on a clean status                 | Skipped; status lists every path that `add --all` stages                           |
| `diff --cached --quiet` (decision and assert)                        | The staged set of command 6, and the X column and `u` lines of status 10           |
| `ls-files --others --exclude-standard`                               | The `?` lines of status 10 (`--untracked-files=all` honors the same exclude files) |
| `diff --name-only` (telemetry)                                       | The paths of command 6                                                             |

Restore sequence after a live verification, per checkout: before 9 processes (`rev-parse --git-path`, `checkout --force -B`, `reset --hard HEAD`, `clean -ffd`, 5 asserts). After 4 processes: `checkout --force -B <branch> <head> --`, `reset --hard HEAD`, `clean -ffd`, one status as invariant I; the operation paths come from `gitPaths`. When an operation path exists, its quit command runs first, as today. The restore runs per checkout in parallel (D7). An invariant failure stops with `operation_failed`. After the restore of a live verification, `removeRootEntries` runs.

### 5.4 Credentials

`hostExecution` (`apps/worker/execution.ts`) handles credentials before `runChain`. S43 and S44 run as host functions, then the host calls `runChain` with the seed `claim`, `setup` and `sshAccess`. `hostExecution` holds the handover result of S43 as a local value. It gives that value only to `credential.store` (D32). `agentPort` gets the model runtime factory over that store and the known secrets.

| Part                                        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credentials.handover` (S43, host function) | `worker.handover` with `{ execution_id }`. Open the envelope with the handover key from `client_secret`. Open each sealed item with the key of its `holder`. Build the in-memory pi credential store. Take `ssh_identities`. The first handover of an attempt writes `mission_attempt.prompt_commits`. Retry `worker.handover.refresh_in_flight` until the claim expires. S43 adds each credential value to the known secrets of the run before it returns. Stops: `operation_failed/worker.handover.decryption_failed`, `operation_failed/worker.handover.sealed_unopened`, `operation_failed/worker.credential.lease_mismatch`, `operation_failed/custody.handover.holder_refused`, `operation_failed/project.bindings.repository.ssh_unreachable`, `operation_failed/project.bindings.repository.base_branch_absent`. Logs: `credential handover received`. |
| `setup.read` (S44, host function)           | `execution.setup.get`, with the retry of an indeterminate result. It reads the prompt commits that S43 pins, so it runs after S43. It returns `unit_records` (D5). S44 gives `worker_name` and the environment digests to the run, and the host builds the budget from `setup.resource_budget`. Stops: `operation_failed/<code of the refusal>`, for example `worker.execution.prompt_record_failed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Host function outcomes                      | A refusal is a coded failure that is not `gateway.*` and not an execution end. A refusal releases with a stop. An S43 refusal settles an empty credential set. An S44 refusal settles the handover credentials. A stop or an unknown error before S43 returns releases with an empty credential set; S43 discards each opened view and zeroes both keys before it throws. A `gateway.*` failure or an indeterminate answer after the retry releases nothing; the host logs `worker.execution.setup_unavailable`, and the pull loop pauses with backoff. An execution-end answer releases nothing and ends the execution with no Diagnostic. S43 and S44 are bounded by `expired_at`, use no `run.call` and have no budget end.                                                                                                                                 |
| `credential.store` (C1, resource)           | The pi auth view exposes only the credential of the effective agent provider at the pinned revision. A refresh takes `worker.credential.lease`, then sends `worker.credential`. A lease retry ends when the claim expires or `operationContext` aborts, so a `ClaimWatch` revoke also ends it. A lease answer for another credential stops with `worker.credential.lease_mismatch`. No credential reaches a file, a span or a log. The report (`worker.credential`) uses a context bounded by `expired_at` that a stop does not cancel. The lease joins that context with the signal of the session.                                                                                                                                                                                                                                                           |
| `ssh.access` (C2, resource)                 | One signer per repository binding: the handed key at the `server` and `container` placements, the `worker.ssh.sign` relay at the `worker` placement. Each git network operation gets its own agent socket. With D7, parallel fetches and pushes open one socket each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Final report                                | Every final step (`assessment.submit`, `execution.release`, `execution.release(stop)`) settles the credentials once before the call: `worker.credential` once for each credential, also when it is unchanged. The settle runs before `assessment.submit`, because that call can close the execution and `worker.credential` needs a live execution. A refused report with an execution-end answer ends the execution as `revoked` with no release.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Host end                                    | The host logs `execution ended` with the end kind, the reason, the code and the detail. The host removes `agent_reason` from the logged detail of a `no_progress` stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dispose                                     | The host defers this entry first, so it runs last: `sshAccess.clear()`, `credentials.discard()`. The discard zeroes the handover key and the report key and empties the SSH identities. It runs at every end: after a final step, after a revoke, and after each end of S43 or S44 (a refusal, a `gateway.*` failure, an indeterminate answer and an execution end). The telemetry sink closes after the credential discard. `run.dispose()` runs after the agent session entry.                                                                                                                                                                                                                                                                                                                                                                               |

Only `credential.store` holds the handover result, and it is host code. The agent open service of the host (`agentPort`, section 5.5) gets the model runtime factory and the known secrets, and no credential. No step of any chain reads a credential, because no context key holds one. `sshAccess` stays a context key, because three steps of the host phases read it: `workspace.node`, `workspace.review` and `branch.push`. The worker port `repository.fetchBase` is its only other reader. No verification command and no affected command reads a credential or `sshAccess`.

Credential rules of the Foundry (D32):

1. No step declares a credential in `reads`, because `ExecutionCtx` holds no credential key. No `FoundryStep` declares `sshAccess`; `build()` rejects such a step (section 2, rule 2).
2. No port answers a credential, a signer or a model runtime. `AgentSession` has no such method.
3. The Foundry gets `secrets.redact`, not the secret list.
4. The Foundry holds no credential and no handle of the credential store. pi asks the store behind `AgentSession` for a token. The lease and the report belong to `credential.store` (C1).
5. After a refresh, the Foundry sees a normal turn end or `provider_failed/*`. After `worker.credential.lease_mismatch`, it sees the abort of `input.cancel`.

Credential rules of a capability (D32):

1. A capability factory gets no handover result, no `sshAccess` and no model runtime. `agentPort` gives it nothing; the Foundry host builds it. pi gives each extension `ctx.modelRegistry`, which can answer a provider key, and pi has no option to hide it. A lint rule forbids `modelRegistry` and `registerProvider` in `src/agent/capabilities/`.
2. A capability that needs a secret gets the value from custody through the host. The host adds the value to the known secrets before the open, as S43 does.
3. A capability secret never enters `process.env` or the environment of `bash`; `childEnvironment` stays. A stdio MCP server gets only the `childEnvironment` result and the `env` of its config (section 5.5).
4. The CLI host takes a capability secret only through the standard-input object of section 5.7. No option, no environment variable and no file takes it.
5. No tool result holds a credential. The redaction guard covers a result that echoes one.
6. `re@1` stays without `bash`. Its declaration gets a new tool only with a `locations` entry and a D27 test for that tool.

### 5.5 Agent tooling

| Part            | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool set        | `agent.open` reads the declaration of the agent (`getAgentDeclaration`). `swe@1`: `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash`, plus the agent tools `evidence-upload` and `link_update_list`. `re@1` and `env@1`: `read`, `grep`, `find`, `ls`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `bash`          | Wrapped by `tool-table.ts`: timeout `min(remaining budget, 600 s)`, refused below 1 s; `childEnvironment` strips the provider environment; `killGroupAtEnd` kills the process group; each call records the requested and applied timeout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Agent tools     | `evidence-upload` and `link_update_list` are agent tools. Each Foundry host registers them through a capability (D32, below). In the worker, they call the server through `hostToolsOf` with the execution context. The proof hook of the transport (section 5.2) covers each agent tool call. An execution-end answer calls `run.revoke()`, in place of `state.revoked` and the cancel of the host context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Hooks, in order | `homeRelativeCwd`, redaction restore, the guards, `pinnedLayers` (the work prompt as the first user message), the capabilities of the Foundry host, redaction. The resource loader loads no extension, skill, prompt template, theme or context file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Confinement     | Each `re@1` session gets `checkoutConfinement` (D27), in the evaluation chain and in the examine chain. The hook resolves each `path` with a copy of the rules of the pi path function (`resolveToCwd`: `@` prefix, `~`, `file://`, Unicode spaces), because pi 1.1.0 does not export it. It also checks, for each path, each spelling variant that the pi `read` tool tries. It then follows symbolic links and refuses a dangling link. After the check, it freezes the tool input, so a later handler cannot change a checked path. The hook accepts the path when the result is inside one root. The hook refuses a path that it cannot resolve. A call with no `path` takes the agent root. With two checkouts the agent root is `review/checkouts`; the roots are the agent root and the `evidence` directory. A workspace with no checkout has the workspace directory as its root. `swe@1` stays unconfined, because `bash` reaches every path anyway. `toolApproval` stays a hook of the Workbench session only. |
| Revoke          | `ClaimWatch` cancels `operationContext`. `stopOnEnd` aborts the session, and `killGroupAtEnd` ends a running `bash` group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Host tools (D32)**

A host tool is an agent tool or a Foundry port (section 2). Section 2 holds the Foundry ports.

| Kind         | Caller                    | pi mechanism                                                                                                                              |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Agent tool   | The model, inside a turn  | A `ToolDefinition` that a capability registers with `pi.registerTool()`, or an MCP server that it registers with `pi.registerMcpServer()` |
| Foundry port | Step code, outside a turn | None; a typed interface of section 2                                                                                                      |

pi owns the validation, the `tool_call` and `tool_result` pipeline, the parallel calls and the result message of an agent tool. A Foundry port is no pi tool, because pi runs a tool only for the model or from another tool (`ctx.executeTool()`). Step code decides on a port result, and a model must not call these writes.

| Agent tool         | Worker host                                                                               | CLI host                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-upload`  | Capability `executionEvidence(hostToolsOf(...))`: server upload with the execution proof. | Capability `executionEvidence(localHostTools(...))`: copies the file to `uploads/`, answers synthetic identities and `s3://local/<evidence_id>/<asset_id>`. |
| `link_update_list` | Capability `linkUpdates(hostToolsOf(...))`: `execution.link_update.get`.                  | Capability `linkUpdates(localHostTools(...))`: pages over `link_updates` of the seed.                                                                       |

**Composition (D32)**

```ts
type SessionHostTools = (workspace: string) => HostTools;

declare function executionEvidence(tools: SessionHostTools): InlineExtension;
declare function linkUpdates(tools: SessionHostTools): InlineExtension;

declare function agentPort(input: {
  capabilities: readonly InlineExtension[];
  modelRuntimeFactory: ModelRuntimeFactory;
  knownSecrets: KnownSecrets;
  trace: SessionTraceFactory;
  sessionRoot: string | null;
  budget: ExecutionBudget;
  env: Readonly<Record<string, string>>;
  hostHome: string;
}): SessionPort;
```

- A capability is one inline extension factory in the list that `openSessionRuntime` gives to `DefaultResourceLoader`. The design adds no registry, no plugin format and no tool interface.
- `executionEvidence` is `(pi) => pi.registerTool(evidenceUploadTool(tools))`. `evidenceUploadTool` and `linkUpdateListTool` keep their `ToolDefinition` and the `HostTools` interface. A capability tool takes the workspace from `ctx.cwd` of the call, because `FoundryHost.capabilities` is one list for each execution.
- Each capability tool declares `annotations.openWorldHint` explicitly. `evidence-upload` and `link_update_list` declare `openWorldHint: false`.
- The two tools are not in the `customTools` list of `sessionTools`. The wrapped `bash` stays in `customTools`.
- `agentPort` is shared code in `engine/src/agent/`. It answers a `SessionPort`, whose `open` gives the guarded pi session. The host code `openNativeAgent` wraps that session into the `AgentSession` of the Foundry, because `src/agent/` imports no worker module. Both Foundry hosts build `ports.agent` with it, and `input.agent` of implement comes from it.
- The Foundry host gives `agentPort` the model runtime factory, the known secrets, the budget, the host home and `env`. `env` is the same filtered environment as `input.env`. `agentPort` gets no credential.
- `agentPort` calls `openSessionRuntime` with the factory order of the table above. pi runs handlers in load order, so a guard sees each call before a capability handler.
- `agentPort` calls `session.bindExtensions({})` after the session exists. pi emits `session_start` there, and an MCP capability connects its servers on that event.
- `AgentSession.close()` ends the session through `AgentSessionRuntime.dispose()` of pi. That path emits `session_shutdown` and then calls `session.dispose()`. `session.dispose()` alone emits no `session_shutdown`, so `agentPort` builds each session through `AgentSessionRuntime`.
- `agentPort` passes its own `modelRuntime`, an in-memory `settingsManager` and its `resourceLoader` as the services of the runtime. It never calls `createAgentSessionServices` with defaults, so pi writes no `auth.json` and no settings file.
- `AgentSession.close()` aborts the session first, then disposes the runtime under the cleanup deadline. The cleanup context has the context of the open as its parent. A revoke thus does not wait on a `session_shutdown` handler or on the close of an MCP server. A failed open closes its runtime the same way.
- `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes` and `noContextFiles` stay set. The session loads no pi package, no skill and no project resource. Only factories that the KanthorD build compiles in can load, because an extension runs inside the worker process.

| Part                                          | Worker host                                                            | CLI host                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `capabilities`                                | `executionEvidence(hostToolsOf(...))`, `linkUpdates(hostToolsOf(...))` | `executionEvidence(localHostTools(...))`, `linkUpdates(localHostTools(...))`          |
| `ports.agent`, and `input.agent` of implement | `agentPort` with the custody model runtime and the telemetry trace     | `agentPort` with the frozen store or the replay provider, and the `spans.jsonl` trace |
| Other ports                                   | Section 2, worker column                                               | Section 2, CLI column                                                                 |

**Guards (D32)**

A guard is a pi extension factory that `agentPort` adds to each session that it opens. A Foundry host cannot leave a guard out. The project environment agent and the Workbench call `openSession` with their own hooks and get no guard of `agentPort`.

The `tools` option of `createAgentSession` is the first tool guard. `openSessionRuntime` passes `tools` plus `host_tools` of the agent declaration. pi registers no tool that the list does not name, and it keeps an MCP tool that the list does not name inactive. The model thus sees no undeclared tool.

Every model call of a tool passes the `tool_call` handlers. This holds for a registered tool, an MCP tool and a nested call through `ctx.executeTool()`. A `tool_call` handler that fails blocks the call. A guard thus needs no knowledge of a later tool.

| Guard                      | pi mechanism                                                                                  | Rule for every tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool allowlist (new)       | `tool_call` handler that returns `block`                                                      | Second tool guard. The handler blocks each tool name that is not in `tools` or `host_tools` of the agent declaration.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Checkout confinement (D27) | `tool_call` handler that returns `block` (`agent/hooks/checkout-confinement.ts`)              | A guard of a confined session only: each `re@1` session. The catalog entry of each tool declares `locations`: the input fields that hold a path or a URL. The handler checks each declared field with the resolution of D27. It blocks a tool with no catalog entry. A `file://` URL of a later tool thus gets the same check as a `path`. A tool whose path fields are nested, such as `environment_write`, declares `locations: []`. Its document check is lexical, and `containedPath` of the image build resolves each real path and fails closed. |
| Sensitive-text redaction   | `context`, `message_end` and `tool_call` handlers (`agent/hooks/sensitive-text-redaction.ts`) | The redaction works on messages, not on tool names, so it redacts the result of each tool. The restore of a marker into a tool input stays limited to `RESTORE_TOOLS`. Another tool gets the marker, never the secret value.                                                                                                                                                                                                                                                                                                                           |

`agentPort` adds `checkoutConfinement` with the `locations` rule to each `re@1` session in one change (D27). The Foundry gives `reviewWorkspace`; `agentPort` computes the roots. The Foundry cannot open a `re@1` session without the hook.

The project environment agent uses the same hook for `env@1`. The `locations` rule blocks a tool with no catalog entry, and the hook of today passes such a tool. Each session tool of the project environment agent thus gets a catalog entry with its `locations` in the same change.

**A new capability (D32)**

Example: a browser tool.

1. Add `browser(deps): InlineExtension` in `engine/src/agent/capabilities/`. The factory calls `pi.registerTool()` with a `ToolDefinition` and its `annotations`, with an explicit `openWorldHint`.
2. Start no process in the factory. Start the browser at the first call and stop it in `session_shutdown`.
3. Add the tool name to the agent catalog (`engine/src/agent/catalog.ts`) with its parameters and its `locations`.
4. Add the tool name to `host_tools` of each agent declaration that can use it (D26).
5. Add `browser(...)` to `capabilities` of the worker host and of the CLI host.

No `tasks` step, no port, no chain listing and no golden chain file changes. A step sends a turn; pi offers the tool.

**MCP capability (D32)**

An MCP server takes the same five steps, with `pi.registerMcpServer(name, config)` in the factory. The Foundry host also adds `createMcpExtension(options)` to the factory list.

- The server config uses `exposure: "direct"`. The model then sees each tool by its name `mcp__<server>__<tool>`, and the declaration and the allowlist name it.
- The session gets no `codemode` extension and no `tool_search` extension.
- `options.loadConfig` answers no server and no error. A server thus comes only from a factory, and the session reads no `mcp.json` of the agent directory or of a checkout.
- `options.credentials` is a store that refuses each read and each write. The session writes no `mcp-auth.json`. The server config holds no `oauth` field.
- The settings manager of the session sets `projectTrusted: false`.
- `options.logPath` points into the state directory of the execution. Dispose deletes that directory, so no `mcp.log` stays in the pi agent directory.
- `options.createTransport` builds each stdio transport with `inheritEnv: false`. The server gets the `childEnvironment` result and the `env` of its config, and no other variable of the worker process.
- A confined agent (`re@1`) gets no stdio MCP capability. A stdio server is a child process with the permissions of the worker user, and the `tool_call` guard sees only the input of a call.

### 5.6 Telemetry

Every span keeps today's name and attributes. The table names the owning step of each span. Every span carries `kanthord.execution.id`, `kanthord.node.id`, `kanthord.attempt` and `kanthord.worker.name`.

| Span                     | Owning step                                                                                                                                                                                                                                      | Attributes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `worker.phase`           | Runner, one per phase                                                                                                                                                                                                                            | `kanthord.phase`. The `prepare` span of implement ends with `kanthord.node.task_count`, `kanthord.node.verification_count` and `kanthord.node.binding_count`.                                                                                                                                                                                                                              |
| `worker.step` (new, D15) | `runStep`, one per step                                                                                                                                                                                                                          | `kanthord.step.id`, `kanthord.step.outcome`: `next`, `budget_end` or `stop`. The span holds no error text and no stop detail.                                                                                                                                                                                                                                                              |
| `worker.task`            | Loop frame `span`/`end` hooks of the `units` loop                                                                                                                                                                                                | `kanthord.task.id`, `kanthord.evaluation.round` on the verdict unit. No span holds `agent_reason`. End: `kanthord.task.result`, `kanthord.task.revision_count`. A `no_progress` stop adds `kanthord.stop.reason`, `kanthord.stop.rule`, `kanthord.stop.count`, `kanthord.stop.limit` and, after a verification, `kanthord.stop.verification.passed`, `.timed_out`, `.index`, `.exit_code`. |
| `worker.gate`            | `gate.g`, `checkpoint.gate`                                                                                                                                                                                                                      | `kanthord.gate.mode`, `kanthord.gate.changed`, `kanthord.gate.violation`, `kanthord.git.changed_file_count`, `kanthord.git.changed_files`. New: `kanthord.git.process_count` (D15), and `kanthord.unit.id` and `kanthord.git.commit` on a gate commit (D24).                                                                                                                               |
| `worker.verification`    | `verify.own`, `verify.all`, `verify.node`, `affected.run`                                                                                                                                                                                        | `kanthord.verification.context`, `.kind`, `.owner_id`, `.index`, `.run`, `.class`, `.timed_out`, `.flaky`, `.signal`, `kanthord.commit`.                                                                                                                                                                                                                                                   |
| `worker.git`             | `base.merge` (`merge_base`), `base.fetch` (`fetch_base`), `branch.push` (`push`)                                                                                                                                                                 | `kanthord.git.step`. The git step mark of a failure gives the stop cause (`stop-cause.ts`). New: a clean merge of `base.merge` (`merge_base`) sets `kanthord.git.commit`, the merge commit. New: the push of `onStop` also writes a `worker.git` span.                                                                                                                                     |
| `worker.setup`           | `env.setup`                                                                                                                                                                                                                                      | `kanthord.setup.result`, `kanthord.setup.entry_count`.                                                                                                                                                                                                                                                                                                                                     |
| `worker.release_gate`    | Loop frame `span`/`end` hooks of the `release_gate` loop                                                                                                                                                                                         | `kanthord.release_gate.result`, `.affected`, `.unit_id`. `.result` is `route.kind`, or `budget_end` on the outcome `budget_end`; `.affected` from `affected`; `.unit_id` from the routed unit. The outcome `stop` ends the span with `Error`.                                                                                                                                              |
| `worker.evaluation`      | Loop frame `span`/`end` hooks of the `evaluation` loop                                                                                                                                                                                           | `kanthord.commit`. End: `kanthord.evaluation.*`, `kanthord.judgement.repaired`.                                                                                                                                                                                                                                                                                                            |
| `agent.session`          | `agent.open` opens it; the trace close of the final step ends it. Kept: a revoke runs no final step and no flush, and the sink drops the queued records and logs `telemetry records dropped`. New: dispose closes the agent traces with `Error`. | `gen_ai.operation.name`, `gen_ai.conversation.id`, `gen_ai.agent.name`, `gen_ai.request.model`, `kanthord.agent.*`, `kanthord.session.format`, `kanthord.session.format_version`. End: `kanthord.session.entry_count` and the redaction counts.                                                                                                                                            |
| `agent.turn`             | Each LLM step; child of its `worker.step` span                                                                                                                                                                                                   | `gen_ai.*` request, response and usage, `kanthord.turn.index`, `kanthord.turn.model_duration_ms`, `kanthord.prompt.template`, `kanthord.prompt.template.digest`, `kanthord.prompt.work.digest`, `kanthord.usage.cost_usd`.                                                                                                                                                                 |
| `agent.tool`             | Each tool call of an LLM step                                                                                                                                                                                                                    | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `kanthord.tool.outcome`, `kanthord.tool.duration_ms`, `kanthord.tool.timeout.requested_ms`, `kanthord.tool.timeout.applied_ms`, `kanthord.tool.killed`.                                                                                                                                                                                         |
| Session entry records    | `agent.session`; sent at each session event and at the trace close                                                                                                                                                                               | One record per pi session entry (`agent-telemetry.ts:259`).                                                                                                                                                                                                                                                                                                                                |

A reader finds the turns of a task as the `agent.turn` descendants of its `worker.task` span, not as its direct children.

### 5.7 Standalone tasks run

`kanthord worker tasks run` runs the `tasks` phase of an `implement` execution on one machine with no server call during the phase. The command uses the production step code of `tasks` unchanged: no `tasks` step imports a transport constructor or a client constructor. The command is the CLI host. It builds a `FoundryHost<ImplementPorts>` and an `ImplementInput`, and it calls `foundryImplement(input, host)` (section 2). Each side effect flows through a Foundry port or an agent tool of the CLI host. `kanthord worker tasks compare` and `kanthord worker tasks seed` are companion commands. The command adds one production behavior: the capture hook below.

**Seams**

`runPhase` runs the nodes of `tasks_prepare` with the node walker and the loop rules. It shares the node walker and the loop rules with `runChain`. `foundryImplement` runs the `tasks` phase with the same walker.

Before the first node, `runPhase` lists each key that a node of the phase reads before a writer inside the phase, and each key in `LoopFrame.reads` of each loop of the phase. Each listed key must be in `seed.keys`. A missing key fails with `cli.worker.tasks.seed_invalid`; the diagnostic names the missing keys. The seed check requires a `LoopFrame.reads` key only when no node of the phase writes it before the first read of the frame. A scope field is no key and needs no seed. The command builds `ImplementInput` from the seed and from the context at the end of `tasks_prepare`. A missing input key fails with `cli.worker.tasks.seed_invalid`.

With `input.until` set to `release_gate`, the walker ends with `completed` on entering the `release_gate` loop. After the end, the caller disposes the resources of the CLI host and sends no server call. It runs no `onExit` node, no `onStop` node and no final step, so it makes no checkpoint commit and no push.

The CLI host implements each Foundry port of `ImplementPorts` over the output folder and the local mirror. The CLI column of the port table in section 2 holds each implementation. The CLI ports `evidence.submit` and `unitRecords.put` record each write in call order in `outbox.json`. No port reads the server, so the CLI host has no read answer.

`HostTools` holds the agent tool calls. The local implementation `localHostTools(outbox, seed)` records each call and copies each uploaded file into `uploads/` of the output folder. `evidenceUpload` answers synthetic evidence identities and the URI `s3://local/<evidence_id>/<asset_id>`. The CLI host gives the two agent tools as the capabilities `executionEvidence(localHostTools(...))` and `linkUpdates(localHostTools(...))` (section 5.5).

**Seed and local resolution**

The seed keeps every id of production unchanged. The local run adds a resolver and does not change the phase contract. No step of `tasks` reads data from the server by id; ids are keys that steps compare, log and send back. The command copies each tree source into a bare mirror `state/origin/<binding_id>.git` of the output folder. `origin` of the clone names the mirror. No tree holds the path of the source.

| Input key                                      | Production source                                               | Local source                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `checkouts`, `heads`, `gitPaths`               | `workspace.node` on the instance data root                      | `--tree <binding_id>=<path>` → a bare mirror at `state/origin/<binding_id>.git`; each clone sets `origin` to that mirror |
| `agent`                                        | `agent.open` through `agentPort` with the custody model runtime | `agent.open` through `agentPort` with the frozen store, or the replay provider                                           |
| credential of the session (by `credential_id`) | `worker.handover`, held by `credential.store`                   | the standard-input credential, bound to the same `credential_id`, held by the frozen store                               |
| `setupEntries`, `baseHead`                     | `setup.entries` (S10) of `prepare` and `start`                  | `setup.entries` with a tree service that has no pool and puts the base tree under `state/base/`                          |
| `setupPending`, `setupInstruction`             | `env.setup(live)` of `prepare` and `start`                      | `env.setup(live)` in `tasks_prepare`                                                                                     |
| `plan`, `affectedTests`                        | git steps of `prepare` and `start`                              | `seed.json`, or the same steps in `tasks_prepare`                                                                        |
| ids of new records (evidence, unit records)    | answers of the server                                           | synthetic ids in the valid format, from the position of the call                                                         |
| `revision`, `setup`, `prior`, `claim`          | server reads                                                    | `seed.json`, unchanged                                                                                                   |

**Credentials**

Input:

- Live mode requires `--credential-stdin`. The command validates the options and the seed, then reads one JSON object from standard input before it creates the output folder or a child process.
- An `api_key` credential is `{ "provider_id": "anthropic", "credential": { "type": "api_key", "key": "<key>" } }`.
- An `oauth` credential is `{ "provider_id": "anthropic", "credential": { "type": "oauth", "refresh": "<token>", "access": "<token>", "expires": <epoch ms> } }`.
- `credential` follows `piCredentialSchema` of `src/custody/contract.ts`: the same shapes, the same well-formed check and the same byte limit as a custody handover item.
- `provider_id` must equal `piProviderId` of the effective provider of the agent selection, after `--model`. The command binds the credential to `credential_id` of the agent selection.
- The optional key `metadata` holds the routing metadata of the provider, such as `base_url`. It follows `metadata_schema` of the provider in `LLM_PLATFORMS`. A provider with a metadata schema requires it. A provider with no metadata schema refuses it.
- The routing metadata of the run comes only from standard input. The seed agent metadata must equal it as canonical JSON. A seed thus cannot send the credential to an endpoint that the credential owner did not give.
- `cli.worker.tasks.credential_invalid`: standard input is a terminal, holds no JSON, fails the schema, names another provider, or holds `metadata` that differs from the seed agent metadata. The diagnostic names the failed field path only, with no value and no schema message.
- `cli.worker.tasks.credential_expiring`: an `oauth` access token expires before the wall deadline of the run plus 5 minutes (`PI_OAUTH_REFRESH_WINDOW_MS`).
- No option, no environment variable and no file takes a credential.
- Replay mode reads no standard input. Its store holds the placeholder `{ type: "api_key", key: "replay" }`, which no provider receives.

Lifetime:

- The command checks the terminal with `isatty(0)` and does not touch `process.stdin`. A slow pipe writer thus gives the full object.
- The command reads standard input into one `Buffer`, parses it, then fills the `Buffer` with zeros.
- The credential lives only in process memory, in one `frozenStore` of `src/llm/refresh-watch.ts`, a `CredentialStore` of pi-ai.
- `createModelRuntime` passes the store to `ModelRuntime.create`, so pi creates no `AuthStorage` and writes no `auth.json`.
- The session uses `SettingsManager.inMemory` and `SessionManager.inMemory`, so no session file reaches the disk. The pi directory is `state/pi/` of the output folder. After `usePiDirectory`, the command checks that `piAgentDirectory()` is that directory, and else ends with `failed`. An `auth.json` in that directory fails with `credential_invalid`.
- The credential never enters `process.env`.
- Dispose runs at every end, after every failure and after SIGINT, and drops every reference to the credential. A JavaScript string has no overwrite, so the value leaves the heap at garbage collection.

OAuth refresh:

- The store is frozen. Its `modify` answers the stored value and never calls the refresh of pi-ai.
- The run rotates no refresh token, and it sends no `worker.credential.lease` and no `worker.credential` report. Custody keeps a valid refresh token.
- A provider refusal stops the phase with `provider_failed`.
- The command page tells the developer to use a credential that the developer owns.

Leak paths:

| Path                                          | Rule                                                                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turns.jsonl`                                 | The recorder writes the request after the redaction hook of the session. It never writes the stream options, so it holds no `apiKey`. Each line passes the writer redaction. A tool line holds only `content` and `isError`. |
| `spans.jsonl`, stop details                   | Each credential value joins the known secrets of the CLI host: `knownSecrets` of `agentPort` and the port `secrets.redact`. The session trace and the stop detail thus redact it.                                            |
| `outbox.json`                                 | The CLI ports and `localHostTools` hold no credential operation. The frozen store sends no report.                                                                                                                           |
| `progress.json`, `outbox.json`, `uploads/`    | The writer redacts each known secret with the matcher of the session hook: exact, encoded and partial forms. It decodes an upload as UTF-8 text when it can, else it redacts exact bytes.                                    |
| `result.json`, `context.json`, `metrics.json` | They record the mode, `provider_id` and the overrides. No override takes a credential. `context.json` omits `sshAccess`, `agent`, `baseHead` and `memo`, and it holds no credential.                                         |
| logs, diagnostics                             | No log field takes a credential. A diagnostic holds no embedded value.                                                                                                                                                       |
| child processes                               | The environment rule of "Calls outside the worker" applies.                                                                                                                                                                  |
| seed, capture, export                         | No credential, no `ssh_identities`, no handover key and no value of `containerEnv`, `remoteEnv` or the process environment.                                                                                                  |
| core dump                                     | The command page tells the developer to run `ulimit -c 0` first; `repository.impl.md` states the core-dump risk of a host install.                                                                                           |

SSH:

- The run needs no SSH. `base.fetch` fetches from `origin` of the prepared tree, which is the mirror at `state/origin/<binding_id>.git`.
- The command takes no SSH option and reads no `SSH_AUTH_SOCK`. `isolatedGitEnvironment` removes `SSH_AUTH_SOCK` from every `git` child.
- The Foundry takes no `sshAccess`, so the command builds no `sshAccess` entry. The CLI port `repository.fetchBase` holds no signer.

**Production behavior**

The command adds no server call, no step and no log message outside the capture hook to the production execution. Code additions with no behavior change: `runPhase`, `LoopFrame.reads` and the chain id `tasks_prepare`. The command adds one behavior: the capture hook. It runs only when the operator sets `KANTHORD_CAPTURE_TASKS=1` for the worker process. The command never writes to the workspace of a live execution.

D32 changes these production behaviors of a worker session:

- `agentPort` calls `session.bindExtensions({})`, so pi emits `session_start`.
- `AgentSession.close()` emits `session_shutdown` before the dispose.
- `evidence-upload` and `link_update_list` register through `pi.registerTool()` in a capability, not through `customTools`.
- The tool allowlist guard blocks each call of a tool that the declaration does not name.
- `checkoutConfinement` joins each `re@1` session, with the `locations` rule (D27). The same rule applies to the `env@1` session.

**Seed format**

`seed.json` requires: `claim` (the `MethodClaim`), `setup` (the `ExecutionSetup` as `execution.setup.get` answers it), `revision` (the pinned node revision) and `heads` (the seed head of each binding). Optional: `plan`, `affectedTests`, `prior`, `link_updates`, `elapsed_ms`. The schema is strict. `state.open` sets `refreshed` to no refresh before `units.plan`, so the seed holds no `refreshed`. The seed holds no credential, no SSH identity, no handover key and no value of `containerEnv`, `remoteEnv` or the process environment. The seed writer removes `containerEnv`, `remoteEnv` and `build.args` from each `setup.repositories[].environment.document`. The local run applies none of them; a developer names a variable with `--pass-env`.

A hand-written seed omits `prompt.final` and `templates` of `setup`. The run takes them from `--system-prompt` and `--templates`. Without those options, such a seed fails with `cli.worker.tasks.seed_invalid`.

Each binding gets one tree source: `--tree <binding_id>=<path>`. The command clones the path into the bare mirror `state/origin/<binding_id>.git`, removes its `origin` remote and makes the mirror read-only. No tree thus holds the path of the source, and no push reaches the source or the mirror. Dispose restores the write bits.

**Defaults and preparation (`tasks_prepare`)**

The command runs a preparation chain `tasks_prepare` before `tasks` with `runPhase`. The chain holds one phase `prepare`. The chain builder builds it as `[PAR] affected.declaration, setup.entries, agent.open`, then `[PAR] env.setup(live), units.plan`. A step whose key the seed holds is not in the chain. `env.setup(live)` always runs, because its effect lives in the tree.

| Key                                | Source                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `claim.created_at`                 | start of the run, minus `elapsed_ms` (default 0)                                                        |
| `claim.expired_at`                 | new `created_at`, plus `expired_at` minus `created_at` of the seed                                      |
| `checkouts`, `heads`, `gitPaths`   | prepared trees                                                                                          |
| `setupEntries`, `baseHead`         | `setup.entries` with a tree service that has no pool and puts the base tree under `state/base/`, always |
| `setupPending`, `setupInstruction` | `env.setup(live)` on the trees, always                                                                  |
| `agent`                            | `agent.open` with local resources, always                                                               |
| `affectedTests`                    | `affected.declaration`, when the seed lacks the key                                                     |
| `plan`                             | `units.plan`, when the seed lacks the key; reads `prior` (default: empty) and `refreshed` (no refresh)  |

**Capture hook**

When the operator sets `KANTHORD_CAPTURE_TASKS=1`, `runChain` calls the capture hook once, after the last node of `start`. The hook writes `captures/<execution_id>/` in the data directory of the instance with mode `0700`:

- `seed.json` with `claim`, `setup`, `revision`, `heads`, `prior`, `affectedTests`, `plan` and `elapsed_ms`.

The hook writes no credential, no `ssh_identities`, no handover key and no value of `containerEnv`, `remoteEnv` or the process environment. The hook removes `containerEnv`, `remoteEnv` and `build.args` from each `setup.repositories[].environment.document`. A capture failure logs `tasks capture failed` and does not stop the execution. The instance deletes the capture with the instance data.

**Seed export**

`worker.execution.seed.get` is a `human` read of `unary` lifetime at `GET /api/worker/execution/:execution_id/seed`, with the access policy of `scheduler.execution.get`. It answers `{ claim, setup, revision, heads }` for any execution of a node that is not closed. `heads` comes from the head evidence of the execution, else of an earlier execution on the same node branch, else the prompt pin, else the current base head. The route writes nothing. An export of a closed node answers 409 `worker.execution.seed_unavailable`. The route answers no credential, no SSH identity and no handover key. The route removes `containerEnv`, `remoteEnv` and `build.args` from each `setup.repositories[].environment.document`. It holds no value of `containerEnv`, `remoteEnv` or the process environment. `worker-service.impl.md` holds the full route spec.

**Calls outside the worker**

The phase reaches no kanthord server and no git remote: `base.fetch` reads the local `origin`. In live mode, the agent calls the LLM provider. `env.setup`, the verification commands and agent `bash` run on the host with its network, and the help text states it.

Each child process receives `PATH`, `LANG` and `TMPDIR` of the command, and each variable that `--pass-env <name>` names. Each child process receives `HOME` set to `state/home/` of the output folder, not the developer home. Each child process receives `GIT_CONFIG_NOSYSTEM=1` and `GIT_SSH_COMMAND="ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityFile=none"`, so no host credential helper and no host SSH key reaches git. No other variable of the shell reaches it. The pi tool install follows the same rule.

`--pass-env` refuses an unset name, a fixed name, each name that `childEnvironment` removes and each ambient credential or endpoint variable that the command removes before pi loads. Each `--pass-env` value of 12 characters or more joins the known secrets of the run. The writer, `secrets.redact` and `agentPort` get the same list.

Before pi loads, the command removes each variable that `childEnvironment` removes and each AWS, Google Cloud and Azure credential chain variable and each provider endpoint variable, such as `AZURE_OPENAI_BASE_URL` and `AWS_ENDPOINT_URL`, from its own process environment. It sets `HOME` to `state/home/`, `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` under `state/home/.aws/`, `AWS_EC2_METADATA_DISABLED=true` and `METADATA_SERVER_DETECTION=none`. No provider SDK thus finds an ambient credential or an ambient endpoint. The proxy variables `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` stay, because a proxy does not change the endpoint and TLS keeps the credential from the proxy.

SIGINT cancels the stop context with `worker_stopped`. The command then disposes the resources.

**Overrides**

Overrides edit the seed before `tasks_prepare`. The `turns.jsonl` header records each override of the live run. Replay mode takes the overrides from the header:

- A non-file override (`--model`, `--reasoning`, `--unit`, `--budget-turns`, `--budget-wall`, `--skip-release-gate`) comes from the header. Replay refuses each of these options on its command line with `cli.worker.tasks.mode_invalid`.
- The header records `--system-prompt` and `--templates` as content digests. Replay requires each file option that the header names, and only those. A missing option, an extra option or a digest that differs fails with `cli.worker.tasks.replay_invalid`.
- A seed digest that differs from the header fails with `cli.worker.tasks.replay_invalid`.
- Each check runs before the output folder exists.

| Option                       | Effect                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--model <provider>/<model>` | replaces the provider and the model of the agent selection                                              |
| `--reasoning <level>`        | replaces the reasoning effort                                                                           |
| `--system-prompt <file>`     | replaces `prompt.final` of the agent selection                                                          |
| `--templates <folder>`       | reads templates with `resolveTemplateSet`; an absent file keeps the shipped template                    |
| `--unit <unit_id>`           | keeps only these units in `plan`; repeatable                                                            |
| `--budget-turns <count>`     | replaces the turn budget                                                                                |
| `--budget-wall <duration>`   | replaces the wall-time budget                                                                           |
| `--skip-release-gate`        | sets `until` to `release_gate`; the phase ends after the units of round 1 with `completed` and no route |

**Output**

The command writes one output folder with mode `0700`. `--force` replaces an empty folder or a run folder, which holds both `result.json` and `state/`. It refuses any other folder with `output_exists`. After the output folder exists, the command writes `result.json` at every end. A diagnostic end records the end `diagnostic`, its code and exit code 1. A folder that a hard kill leaves has a read-only mirror, and the command page tells the developer to run `chmod -R u+w` before a manual delete. `result.json` records the `FoundryEnd` kind, the exit or stop, the step, the mode, `provider_id`, the overrides, the seed digest and the check results. `context.json` holds the input and the result of `FoundryEnd` with no resource key and no `sshAccess`. `progress.json` holds the last `progress` and the last `UnitCtx` of each unit. `metrics.json` holds unit metrics, step run times and phase totals. `outbox.json` holds each Foundry port write and each agent tool call with its operation, body, step and time. `turns.jsonl` holds each model request and answer in replay format with a version header. It also holds the recorded tool results of the replay rule below. `spans.jsonl` holds the spans. `uploads/` holds the files of `evidence-upload`. `state/` holds the trees, the base tree and the pi directory. The CLI port `releaseTrees.give` removes each release tree at its frame end.

Replay rule (D32): a replay runs each agent tool again, and the result of an open-world capability tool changes over time.

- The rule covers only a tool that a capability registers. Each such tool declares `annotations.openWorldHint` explicitly (section 5.5).
- The CLI host wraps `execute` of each capability tool with `openWorldHint: true`.
- In live mode, the wrapper records the result of each call in `turns.jsonl`.
- In replay mode, the wrapper answers the recorded result and does not call the tool.
- pi registers an MCP tool itself, with the hints of its server, so the CLI host has no `execute` to wrap. The CLI host records and answers each call of an open-world MCP tool through `options.createTransport`. An MCP tool with no `openWorldHint` counts as open world. Today no MCP capability exists, so the CLI host builds no MCP record.
- A replay runs every other tool again: each pi built-in tool, `evidence-upload`, `link_update_list` and each capability tool with `openWorldHint: false`.
- A replay runs the recorded tool calls on the host with the `--pass-env` values. The command page tells the developer to replay only a `turns.jsonl` that the developer recorded.

`turns.jsonl` format: the first line is the header `{ kind: "header", version, seed_digest, overrides }`. Each request line holds the provider, the model id and the messages after the redaction hook. Each answer line holds the assistant message. Each tool line holds the name, the call id and the result or the error of an open-world capability tool. The recorder replaces the output folder path with a token, and removes the message `timestamp`, `durationMs` and `details`.

Replay compares each request with the recorded request. The comparison maps every redaction marker form to `<redacted:<rule>>` and every `pi-bash-<hex>.log` path to one token. When the writer redaction changes an answer line or a tool line, the recorder marks the line `redacted: true` and keeps only the redacted text. A replay stops at a marked answer with `redacted_record`. A marked tool line replays its redacted result. `cli.worker.tasks.replay_diverged` names the `turn`, the `step` and one reason: `request_differs`, `request_extra`, `tool_unrecorded`, `redacted_record` or `turns_unused`. A completed replay that leaves a recorded request or tool line unused fails with `turns_unused`.

A request that differs from the record only in the `text` of a text part of a pi built-in tool result is a drift, not a divergence. A built-in tool runs again on the host, so its output can hold a time or a duration. Everything else must stay equal, also the result of `evidence-upload`, `link_update_list` and each capability tool, because the worker composes it. The replay answers the recorded answer and records each drifted tool call once in `result.json` as `drift: [{ turn, step, message_index, tool_call_id, tool_name }]`. `drift` is `null` in live mode.

The replay output folder must not equal, contain or lie inside the folder of the `--replay` file, compared by real path. Otherwise the command fails with `cli.worker.tasks.option_invalid`.

End mapping of the CLI host:

- `completed`, `budget_end` and `stop` keep their kind in `result.json`.
- `cancelled` after SIGINT becomes the stop `worker_stopped`.
- `failed` is an internal error. The command writes `result.json` with the end kind `failed`, writes one redacted log record `tasks failed` with the reason, prints the diagnostic `cli.worker.tasks.internal_error` and gives the internal-error exit code. An error after the `FoundryEnd`, such as a failed output write or a failed dispose, also ends with `failed`. Dispose closes each agent separately and always disposes the resources.

With `--verify`, the command runs these checks and records each result in `result.json`:

Today the command runs checks 3, 5, 6, 7 and 8. Checks 1, 2 and 4 need the unit record port, the coder report in `tasks` and the commit span attribute of C2.

1. Each pass of a task unit, or of the node unit of a node with no task, that leaves a gate commit of the pass as a checkout head has one `worker.execution.unit_record.put` after it. Its `content_digest` equals the digest of the unit content, and its `commits` name each such head (section 5.1).
2. Each pass of a unit with non-empty final text has one coder report after it, with the subject `Coder report of unit <unit id>` (D29). The verdict unit uses the node id.
3. Each head in `context.json` equals `git rev-parse HEAD` of its tree.
4. Each commit of `git rev-list <seed head>..HEAD` of each tree is a commit of the run: `spans.jsonl` holds it as `kanthord.git.commit` of a `worker.gate` span, or of a `worker.git` span with the git step mark `merge_base`.
5. With the end `completed`, each tree has a clean status: no index change, no untracked file and no operation path.
6. With the end `completed`, the route is `passed`. With `--skip-release-gate`, the route is absent.
7. A stop code is in the `stops` list of the step that `result.json` names, or it is `revoked`, `operation_failed/<server code>` or `provider_failed/*` (section 3), or it is a requested stop of rule 4a.
8. In replay mode, the outbox and the commits equal those of the recorded run in the folder of the `--replay` file. The comparison replaces each commit id with its tree id and its message. The replay rule gives each open-world capability tool call its recorded result. Check 8 reads the recorded checkouts with `git log` under `isolatedGitEnvironment`, plus `log.showSignature=false` and `gpg.program`, `gpg.ssh.program` and `gpg.x509.program` set to `false`, so a config of a recorded tree runs no program.

**Commands**

`worker-service.impl.md` holds the full option list, the exit codes and the diagnostic codes. `worker tasks seed` is a remote command. `worker tasks run` and `worker tasks compare` are local commands that call no route, open no database and need no configuration file of the server.

**Tests**

1. Golden chain test prints `tasks_prepare`. Both chains use the production chain builder.
2. Module test asserts rule 1 of the Foundry (section 2): no file of the Foundry imports a transport, a client constructor, `MethodClients`, `ExecutionRun`, the credential store, the custody contract, the tree pool or `hostToolsOf`.
3. Each port runs once with the worker implementation over a fake transport and once with the CLI implementation, with the same draft. Both runs make the same operation and body.
4. A live run with a scripted provider writes a capture. A replay of that capture passes check 8 with `--verify`.
5. A replay of `turns.jsonl` from test 4 with a changed tool set stops with `replay_diverged`.
6. A capture contains no credential, no SSH identity, no handover key and no value of `containerEnv`, `remoteEnv` or the process environment.
7. `runPhase` requires each phase read key and each `LoopFrame.reads` key that no node of the phase writes before the first read; `until` ends the phase.
8. A minimal seed fills every `tasks_prepare` default.
9. `--tree` leaves the source repository unchanged; an agent `git push origin` fails.
10. `compare` shows each section of difference and refuses two seeds with different digests.
11. Canary test: a live run with a canary credential, one `--pass-env` canary value and a scripted provider searches every output file, including `context.json`, and both standard streams for each canary value and expects no match. A test asserts that `context.json` holds no `credentials` key and no `sshAccess` key. The test also searches each serialized input and each `FoundryEnd`.
12. Credential test proves each refusal, the empty `auth.json` path under the pi directory and the frozen store.
13. Replay mode reads no standard input and calls no provider.
14. Route test of `worker.execution.seed.get`.
15. Hand-written seed with `--system-prompt` and `--templates`.
16. Replay test (D32): a replay answers the recorded result of a capability tool with `openWorldHint: true` and does not call the tool. It runs `bash`, `edit`, `write` and a capability tool with `openWorldHint: false` again.

### 5.8 Progress rule

Steps S16a, S18, S21 and S27 apply these rules. The runner seeds `progress` with `planned`, `unchangedTurns = 0` and `lastVerification` before the first phase (rule 1).

- In the planned round, each unit starts with `progress.unchangedTurns = 0`.
- After the planned round, `release.route` resets the counter once and sets `progress.planned` to false.
- In a routed round, the counter carries from unit to unit and from round to round.
- After a turn with a gate commit (scope `changed`), `verify.own` sets the counter to 0, except after a verdict turn that leaves the verdict rule unmet. That turn keeps the counter.
- A conflict-mode gate commit of `base.refresh(release)` sets `progress.unchangedTurns` to 0.
- A `TaskRevision` turn with no gate commit adds one. A `CriterionRevision` turn adds one only through the verdict rule. A `Work` turn never adds one.
- A verdict turn that leaves the rule unmet adds one.
- After a verdict-rule waiver, `verify.own` runs the own commands once. A pass completes the unit. A failure stops with `no_progress` and rule `verdict_rule_unmet`.
- At 2, `verify.own` stops with `no_progress`; the detail holds `progress.lastVerification`.
- `verify.own` and `release.route` write `progress.lastVerification`.

## 6. Before and after

| Observed cost                                                                                      | Change                                                                                                                                | Expected effect                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkClaim` per model turn and per unit loop                                                      | `ClaimWatch` (60 s from start, fixed interval) and a fence before each push (D4)                                                      | Estimate: a 20-minute execution with about 80 model turns sends about 80 to 90 checks today and at most 20 after. A revoke now also aborts a running command.                                                        |
| Gate G 14/18 git processes per checkout per turn                                                   | Status-based gate (D6)                                                                                                                | Unchanged turn 14 to 1. Changed turn 17 or 18 to 5 or 6. Agent-committed turn 18 or 19 to 8 or 9. Exact counts from section 5.3. `kanthord.git.process_count` on `worker.gate` confirms them (D15).                  |
| Repeated asserts and a telemetry-only diff                                                         | Status 10 is the assert; the raw diff gives the paths                                                                                 | Included in the counts above.                                                                                                                                                                                        |
| Done-record amend changes the head                                                                 | Unit record in the Worker Service (D5)                                                                                                | No amend and no extra `rev-parse` per unit per checkout; heads change only at a gate commit. One server put per unit pass with a commit. One `rev-list` per checkout at planning. No trailer in the user repository. |
| Release gate reruns every command after the units; the reviewer runs them again on the same commit | Both runs stay, in plan order (D11)                                                                                                   | No change.                                                                                                                                                                                                           |
| Serial loops per checkout (gate, refresh, setup, clones)                                           | Parallel git per checkout (D7); merges and setup stay serial (D3)                                                                     | With N checkouts, the wall time of the gate, the restore, the fetch, the tree build and the push goes from the sum to about the maximum (estimate). No change for one checkout.                                      |
| Serial server reads in Read context                                                                | Parallel reads, overlapped with Prepare (D8)                                                                                          | Estimate: 4 to 7 serial round trips become 2 to 4 dependent rounds, hidden behind the clone and the fetch.                                                                                                           |
| Agent open after the setup                                                                         | Agent open in prepare, in parallel with `affected.declaration` and `setup.entries` (D20)                                              | Implement: the conflict turn has its session before the first merge. Examine: the open time hides behind the node commands.                                                                                          |
| Dependency read in evaluation after the judgement turns                                            | `inputs.read(dependencies)` runs in prepare, before the verification                                                                  | The judgement uses the dependency state of the prepare phase.                                                                                                                                                        |
| Pool size 1 Agent tree; full network clone on miss                                                 | No change; add `source` and duration to the span (D17)                                                                                | No effect yet. The data then shows how often a miss happens.                                                                                                                                                         |
| Reviewer downloads all assets and pages all evidence                                               | Downloads in parallel with the review setup, at most 4 at a time, streamed (D16); dependency reads move into the first parallel group | Estimate: download time hides behind the setup. Peak memory is one stream buffer per download, not the whole object.                                                                                                 |
| `no_progress` stop detail has no agent reason                                                      | Add `unit_id`, `template`, redacted `agent_reason` (D14)                                                                              | A human sees why the agent made no change, with no session file.                                                                                                                                                     |
| Invalid affected declaration found only at the release gate                                        | Validate in Prepare (D9)                                                                                                              | Stop before the first LLM turn; saves the whole turn budget of that execution.                                                                                                                                       |
| Restore after each live verification, 9 processes per checkout                                     | 4 processes (D12)                                                                                                                     | Estimate: 5 fewer processes per checkout per verification.                                                                                                                                                           |
| Complete conflict resolution lost at a budget end                                                  | Check the markers once more, then conclude a marker-free merge (D13)                                                                  | The next execution starts from the merged head and needs no new conflict turn.                                                                                                                                       |
| Telemetry phases only in implement                                                                 | Phase and step spans in all chains (D15)                                                                                              | Every step has a duration and an outcome in the trace.                                                                                                                                                               |

## 7. Rulings on the questions

1. **Unit record table. DECIDED 2026-11-14 by Ulrich: approved.** The table is `worker_unit_record` with four columns (`node_id`, `unit_id`, `content_digest`, `commits`). No `project_id`: the table is node-scoped. The verdict unit writes a record only for a node without tasks. The Mission Service deletes the rows of a node through a `unitRecords.deleteNode` port in the transaction to `Completed`, `Discarded` or retired, and in the transaction that opens an attempt from `base_branch`.
2. **Agent text in the `no_progress` detail. DECIDED 2026-11-14 by Ulrich: a redacted excerpt of at most 512 characters goes in the stop detail.** A stop detail is not a log record. The host removes `agent_reason` from the logged detail.
3. **Fence on a network error. DECIDED 2026-11-14 by Ulrich: the push continues.**
4. **Later server shape. DECIDED 2026-11-14 by Ulrich: client-side parallel reads only, no API change.**
5. **Partial conflict resolution. DECIDED 2026-11-14 by Ulrich: a programmatic marker check follows each conflict turn; markers left send `swe@1` another conflict turn until no marker is left (D23).**
6. **Scope of the trademark concern. DECIDED 2026-11-14 by Ulrich: branches and commits carry no id. A branch gets a semantic name and a commit a semantic message (D24). The branch rule is approved.**
7. **Credential placement. DECIDED 2026-11-16 by Ulrich: S43 and S44 run as host functions in `hostExecution` before `runChain`. The host passes `claim`, `setup` and `sshAccess` as the seed, and it gives the handover result only to `credential.store` (D32).**
8. **Claim watch interval. DECIDED 2026-11-16 by Ulrich: `ClaimWatch` fires at a fixed 60 s interval from the start.**

## Pages that record the rulings

- `worker-service.md`: the done record paragraphs (lines 437-446) and the sequence diagrams (lines 517, 891).
- `worker-service.vocabulary.md`: `done record` becomes `unit record`.
- `worker-service.impl.md`: the done record, gate G, the restore sequence, the claim watch interval (D4 ruling 8) and its end points and the fence, the no-progress counter scope, the affected declaration position, the agent open position, the telemetry phases, the release gate fetch and tree build (D7), the `agent.turn` parent rule under `worker.step` (Traces), the cleanup deadlines (Stop and budget), the host credentials placement (D25 ruling 7, section 5.4), the D16 parallel reviewer asset download rule, the examine `budget_end/<limit>` stop rule, the S39 kept-report rule and its completion test, and section 5.7: the capture hook, `KANTHORD_CAPTURE_TASKS`, `worker.execution.seed.get` and the three `kanthord worker tasks` commands.
- `custody.impl.md`: section 5.7: the frozen store of a local run and `--credential-stdin`.
- `architecture.impl.md`: the `kanthord worker tasks` group and the span tree row and pill of `worker.step`, and the first turn of a `worker.task` as a descendant.
- `mission-service.md` and `mission-service.impl.md`: `conflict_unresolved` (D23).
- `repository.md` and `repository.impl.md`: `repository.node_branch.taken` (D24).
- `project-service.impl.md`: `commit_identity` (D30).
- `agent.impl.md`: `checkoutConfinement` (D27).
- Open in HANDOFF (Architecture): `docs/reference/erd/` (`worker_unit_record`), `engine/docs/cli/` worker page (new operation, error codes, section 5.7 commands).
- `HANDOFF.md`: the D22 item, the two section 5.7 items and the Architecture documents item under the Worker Service.
- D32: `worker-service.vocabulary.md` holds the terms Foundry, Foundry host, host tool, agent tool, Foundry port, capability, guard and host resource. `worker-service.impl.md` holds the Foundry and its build order. `HANDOFF.md` holds the build item with its checks and the open items under the Worker Service.
