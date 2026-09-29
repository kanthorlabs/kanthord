# AGENTS.md

Rules for every agent that works in the kanthord repository. Ulrich is the human owner.

## Work with Ulrich

- Raise ONE open item per turn, in prose, with the recommendation first. Apply the answer, report, then raise the next item.
- Never put more than one question into one `AskUserQuestion` call. An answer can close an item as a no-op.
- Discuss each open item or blocker with the `/explain` skill, in this order:
  1. The conclusion in one or two sentences.
  2. A numbered timeline of 4 to 8 steps that shows the failure without the fix. Use the names of the vocabulary siblings.
  3. The same timeline with the fix, marked "diverges at step N".
  4. The page changes, line by line.
  5. The recommendation first, then the alternatives with one-line trade-offs.
  6. Exactly one question.
- When Ulrich restates the problem, confirm or correct the restatement at once in three or four bullets.
- When a page already holds the rule, say so first. Then present the ruling as a repair with a confirmation question.
- Prefer to forbid a configuration change over a mechanism that handles the edge case of that change.
- When Ulrich approves a plan of several steps, run all steps in sequence. Do not ask for confirmation between steps. Verify and commit each step. Stop only for a real blocker or for an open item that needs a ruling.
- Open a report with two to four short prose paragraphs that state the conclusion. Put tables, metrics, per-item findings and blocker lists below, under `## Details`.

## Design set

- The design set lives in `docs/brainstorm/`. Each service or shared component has a page `<name>.md`, a vocabulary sibling `<name>.vocabulary.md` and an implementation sibling `<name>.impl.md`.
- Open work lives in `docs/brainstorm/HANDOFF.md`.
- Phase 1 (design pages) is closed. Phase 2 writes the implementation siblings. Phase 3 (epics from the design) starts only when Ulrich closes Phase 2.
- Read the owning page before you take an item.

### Where a ruling goes

- Put a ruled mechanism into the root `.impl.md` of the owning page. Put a daemon-wide mechanism into `architecture.impl.md`.
- A submodule owns the documents that detail its own code. `engine/docs/cli/` holds the command table of each service group.
- A submodule document never overrides a page or a sibling. A conflict is a defect of the submodule document.
- An index row holds a path plus the sibling that owns the declaration. Never strip a declaration from its owner to centralize it.
- Custody and the Repository component are shared components with their own pages. No service owns them.
- Delete the HANDOFF item that carried the reasoning once its answer lands in a page. The page is the rule, and git history is the record.

### HANDOFF queue

- Take items in section order.
- Skip every item with an explicit `POSTPONED` marker. Never infer a postponement from wording such as "after the system runs live".
- Put a postponed item under the section of its owning component with `POSTPONED <date> by Ulrich until <condition>`. Never put it under a Next session list.
- Put a root tooling item under `### Root repository`.
- Remove an item from HANDOFF as soon as its write is verified. Do not keep it until the commit.
- B9 (failure and recovery) comes last. Never open a B9 item on your own initiative. Only Ulrich starts it.

### Protocol for one design item

1. Run `/explain` on the item.
2. Take the ruling from Ulrich.
3. Write the ruling into `docs/brainstorm/HANDOFF.md` under the owning component.
4. Delegate the edits to pi with the exact old text and the exact new text.
5. Verify the diff yourself.

- Batch the mechanical items that need no ruling into one pi run.
- Start a `/debate` round only when Ulrich asks for it.
- Before you build a `/debate` block, write every ruling of the conversation into HANDOFF. The debate engine sees only the files that the block inlines.
- After each ruling, grep the pages that you already wrote for sentences that touch the same actors. A rule phrased as "who performs an action" changes its meaning when a later ruling changes the actor. Re-check every earlier fix against the new ruling.

### Rejected proposals

The pages record only the decision. Do not propose these alternatives again. When a new ruling rejects an alternative, add it here.

- An SSH key in custody or a kanthord ssh-agent. SSH transport uses the SSH configuration of the host user.
- A proxy for the remote runtime. Custody hands credentials to the `worker` app encrypted under keys derived from its client secret.
- `masterKey` on a client, a worker key pair, or a public-key handover envelope. A worker holds the client secret of its machine JWT, derived from `masterKey` and `sub`.
- A workspace root in the cache directory. It lives in the state directory.
- One agent per worker. A worker declares one or more agents.
- A "human OR client" access policy or an optional revision bound. One operation serves one caller kind.
- Worker ownership of acquisition. The Intake Service owns the connection lifetime.
- A background healthcheck, a stored observation or a freshness cache. The resource healthcheck runs on demand and only reports.
- Repository code (simple-git, octokit, decoders) inside the Worker Service or the Project Service, and the term "system component". It is the Repository shared component.
- Claude Code or opencode as processes that kanthord starts or prompts. An external harness is a worker that registers itself. `reviewer@1` does not review its node.
- A softened version of the principles of Ulrich in a prompt text. A violation of the default standard is a blocker.
- A kanthord-shipped provider, model or effort default. A human enables an agent globally in the Worker Service.
- A dedicated revision table or provider table for the agent enablement. `worker_agent_enablement` is one row per revision, as `project_binding` and `credential`.
- A mission change record (`mission_change`, `change list`, `change get`) or a node revision on an objective move. Node revisions and retirement suffice. The history of a dependency edit, an objective move and a retirement without a revision is accepted as lost.
- A current-revision pointer on `mission_node`. The current revision is the greatest `revision`. `mission_node` and `mission_node_revision` stay two tables because a node holds live state.
- A Unix timestamp or a hybrid `max(now_ms, last + 1)` as the revision value. The revision stays a per-resource integer counter from 1. The UI shows the UTC label `r3 · 2026.9.27+101500` from `created_at`.
- Removal of `mission_mission.version`, a mission row lock instead of it, or the name `generation`. The counter stays as the compare-and-swap of a whole-mission write. `version` names every mutable counter that goes up by one, for example `gateway.tokenVersion`.
- A narrower `expectedMissionVersion` that covers only the import and a whole-mission rebind. A change of the mission version makes the human review before the next graph write, so the "false" 409 is intended.
- A durable Mission request record (`mission_request`, `import get`, `mission.request.payload_mismatch`). The version checks refuse a second act, and the Gateway replay covers a retry.
- An unblock record or table (`mission_unblock`, `unblock_<ulid>`). The attempt names its opener in `opened_by`.
- A durable evaluation record or evaluation try record (`mission_evaluation`, `mission_evaluation_try`, `claimed_from`). An evaluation attempt is one reviewer execution, and B9 item W7 owns the retry bound.
- A run output record (`mission_run_output`, `run-output submit`). The node revision carries the direction of a human, the checkpoint commit carries the work, and the handoff between executions waits for the budget design.
- A job state machine, a visibility timeout (`due_at`) on `scheduler_job`, or a single-queue model where one job row lives from enqueue to finish. `scheduler_job` stays stateless, the claim deletes it, and the execution deadline is the only zombie detector.
- A second ordering column on `scheduler_job` that keeps the first job time across a release. A release with further work inserts a new job, and the node takes its age from the release.
- A prefix for the credential table (`custody_credential`, `kernel_credential`, `system_credential`) or a Kernel or System Service that owns it. Custody is a component, not a service, so its table has no prefix. The table stays `credential`, and the migration test carries its one exemption.
- A `custody` key under `services` in the health report. Custody is a shared component. Its entries sit under `shared.custody`.
- A JWT denylist (`gateway_token_denylist`, `ban`, `sweep`). Revocation is `gateway.tokenVersion` only.
- A table-named binding column, for example `scheduler_execution.project_binding_id`. A binding column names the binding kind that it requires: `worker_binding_id`, `storage_binding_id`, `source_binding_id`.
- A stored claim kind on `scheduler_execution` or `scheduler_job`. While a claim is live, the node state `Executing` or `Evaluating` fixes its kind.
- A durable Scheduler request record (`scheduler_request`, `WorkPull.requestId`, `scheduler.request.scope_mismatch`). A work pull is idempotent by the runtime identity: it returns the live execution of its instance. A worker crash or a server restart ends the runtime identity, and B9 owns recovery.
- A renewal of a Scheduler execution, or an execution-renewal request identifier or record (`scheduler_renewal`, `renewal_request_id`, `scheduler.execution.renewal_superseded`, `renew-lease`). An execution deadline is fixed at the claim.
- A merge of the runtime identity and the client identity, or a new runtime identity at a worker restart. A restarted program gets its live registration back, and a server restart ends no registration.
- A soft delete (`deleted_at` or another marker) or a recoverable delete. A delete removes the row. A later audit record supports the regret of a human.
- A `mission_external_object` table, a `mission_observation` table or a separate confirmation row (`confirms_evidence_id`, `confirmation_evidence_id`). A request is a `mission_evidence` row with `requirement_key` and a write-once `end_state`.
- An observation obligation, its lease or an observer processor. Delivery admission and the human check call the Intake check inline, and the Intake delivery carries the retry.
- A natural key or a digest of an evidence submission (`observation_key`, `submission_digest`), a stored confirmation time or an aggregate detail text. A repeat after a restart creates a second record.
- A cleanup process of expired uploads. A human deletes an expired asset.
- Custody that performs a platform call, a model call or a presign. Custody releases the material, and the holder performs its own operation.
- A human-assertion basis on an outcome (`basis_actor`, `decision`) or a revision column on `mission_outcome`. A human act writes a human assessment, and every outcome names an assessment.
- A task record in `mission_evidence`, `mission_assessment` or `mission_outcome`, a `content_owner_id` column or a `task-result submit`. The reviewer of an objective runs and judges every task.

## Contracts

- External contracts (YAML files, CLI input and output, HTTP payloads) use the exact field names of the domain entities in code.
- Never use a shortened alias, for example `deps` for `dependencies`. Never rename a field in an adapter.
- Diff every key of a new contract against the vocabulary sibling of the owning page.
- A divergence from the model is an explicit locked decision, never a naming convenience.
- Every error code that the engine answers stands on the owning design page and on the `engine/docs/cli/` page of its command group.
- Every command page of `engine/docs/cli/` holds an error-code table with the HTTP status, the code and the condition of each code that its commands answer.

## Database design

- Never declare a SQL `CHECK` constraint, for example `CHECK (kind IN ('repository','worker','storage'))`.
- Define every closed value set as an enum in code. The owning service validates the value before the write.
- Never declare an index that is not a unique index.
- The schema lives in `docs/reference/erd/` and records only ruled design. Keep HANDOFF items out of it.
- `project_id` is the second key column only in project-scoped tables.
- A resolved Intake delivery keeps its row. Only its payload expires.
- A rename of a table or a column also updates the map in `docs/reference/erd/README.md`.
- `docs/viewer.html` pins mermaid 11.17.2. Never pin a version below 11, because the ERD views use `classDef` in an `erDiagram`.

## Shared working tree and commits

Several agents edit the same working tree in parallel, for example `docs/brainstorm/HANDOFF.md` and `engine/docs/cli/*`.

- Edit HANDOFF by quoted sentence only. Never revert a foreign change.
- Commit design pages per step. Leave HANDOFF uncommitted until a batch ends or Ulrich asks.
- Stage exact paths only. Never use `git add -A`. Never stage a file with the uncommitted edits of another agent.
- Commit directly on `main`. Do not create a branch, because a branch switch moves HEAD under the other agents.
- Write every commit subject in the format `<type>(<scope>): <subject>`. The `(<scope>)` part is optional.
- Write the subject in the present tense, for example `feat: add hat wobble`.
- Use only one of these types:
  - `feat`: a new feature for the user. A new feature for a build script is not `feat`.
  - `fix`: a bug fix for the user. A fix to a build script is not `fix`.
  - `docs`: a change to the documentation.
  - `style`: formatting, for example a missing semicolon. No production code change.
  - `refactor`: a change to production code that keeps the behavior, for example a variable rename.
  - `test`: a new test or a refactor of a test. No production code change.
  - `chore`: a change to build tasks or tooling. No production code change.

## Delegation

### Pi

- Pi satisfies the literal acceptance check, not its intent. It reports false passes and leaves counts and cross-references stale.
- State acceptance criteria as intent, not as a string match. Always read the produced file yourself.
- Do a change in a single file with fewer than 10 edited rows yourself. Never delegate it to pi.
- When `/pi` fails twice (timeout, abort, or output that fails your read), do not retry pi and do not ask:
  - For an implementation task, spawn an Agent with `model: "opus"`, the same packet and the working-tree state.
  - For a document task, write the content yourself.
- Say in the report who produced the result.

### Debate in a sub-agent

- A sub-agent often skips the debate with a false excuse. In the prompt, name these calls:
  1. `~/.claude/skills/debate/scripts/run.sh --check`.
  2. The Write of the args file.
  3. `run.sh <args-path>` with a Bash timeout of 600000 ms.
- Read the DEBATE line of each report. Send back any report with zero rounds.
- Never accept a pushback of a sub-agent without a check against the code.

### Debate engine short reply

- `run.sh` reports `DEBATE ENGINE FAILED ... reply too short` for a final reply under 1000 bytes.
- When that happens, read the newest `~/.kanthorlabs/debate/*-reply.txt`. A complete verdict with `AGREE` and `=== END ===` is a valid review. Tell Ulrich so.
- Ask the engine to "cite source lines" to keep replies above the minimum.

## Repository tooling

- `kanthord` is a superrepo with the submodules `engine` (Node 24 daemon) and `apps` (pnpm + turbo, Vite React dashboard).
- Every `make` target wraps `scripts/<category>/<command>.sh`.
- Run `make repo-bootstrap` first in a clone. It is idempotent.
- `make up` and `make down` start and stop both sides. Pids and logs go to `.dev/`.
- `make sync-all` publishes the submodules. The `tree-*` targets manage worktrees of the submodules only.
- The daemon listens on port 31415. The web app listens on port 27182 at `http://localhost:27182`.
- Both submodules pin `pnpm@11.24.0`. Keep `minimumReleaseAge` in `.npmrc`.
- pnpm forwards `--` literally. Write `pnpm run X --flag`, not `pnpm run X -- --flag`.
- The `.githooks/pre-commit` hook refuses a root commit whose staged gitlink is not on the `origin/main` of that submodule. Move a root pointer only after the submodule commit is pushed.
