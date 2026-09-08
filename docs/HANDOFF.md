# Handoff

This file is a working note. It is not a design document. Phase 2 produces no `.current` or `.drift` sibling for it. The decision-document rule does not apply to it.

Written 2026-09-08.

## How to use this file

Read this file before a new discussion starts. Find the component that owns the topic. A discussion that belongs to a component starts from the material already parked under that component, so no session re-derives a settled decision.

`docs/overview.md` is the product design. `docs/architecture.md` is the top level, and it names services, responsibilities and relations only. Neither document holds the mechanism inside a service. Every parked item below waits for the component document that owns it.

## State

`docs/overview.md` is rebuilt and revised. `docs/architecture.md` is written and reviewed. Neither is committed.

`docs/index.html` gained an Architecture link. `docs/viewer.html` carries an editor reformat that Aelita did not make and did not review.

## Settled and already in the documents

- A service is a logical part of one process. A service boundary separates authority and never describes a deployment.
- A worker is a template. A worker name has the form `<implementation>@<version>`, so the same name always identifies the same implementation. A project configures which workers are available and how many instances of each. An instance takes an available level and creates a run.
- A mission is the whole work of one project. A project has one mission. The Mission Service holds it and represents it as a graph.
- The Mission Service performs evaluation. Every write of a criterion, an assessment and an outcome passes through it. An executor requests an evaluation and never writes the result.
- The evaluation method follows the criterion and never the level. Each level carries its own criteria, which is a separate statement.
- An external harness is an executor, and it reaches kanthord as a client through the API or the CLI.
- A terminal state never reopens and never repeats. A human override adds a new outcome and never restarts a terminal run.
- An assessment that does not pass ends the run and blocks the level. A blocked level is not available for a further run. Only a human unblocks a level. An unblock authorizes a further run and asserts nothing about the results.
- A run of an objective performs the configured repository action before a successful outcome of that objective.
- The Project Service holds the credentials that a project's resources require, and the bindings that permit their use. No credential enters evidence or telemetry.

## Parked for the Mission Service document

Evaluation, criteria, assessments, outcomes.

- Completion is three separate rules. An ending requires an outcome, including one that cannot establish the result. A claim of success requires a passing assessment that names the evidence the outcome carries. A human bypass uses the override. One rule cannot both authorize success and record a failure.
- Evidence is content-addressed: a commit hash for git work, a SHA-256 hash otherwise. A commit identifies a snapshot, so work that no commit holds is not evidence.
- An assessment names the evidence it assesses and is valid only for that evidence.
- Assessments accumulate and are never overwritten. The content address decides which assessments are eligible; record order decides which eligible one is current. Write order alone is not the rule.
- An executor never writes the criteria of the level it executes. A verification command belongs to the WHAT; the files it reads belong to the repository and stay mutable. Protection is attribution plus a judgement criterion, not a protected-path list.
- An exit status of zero proves that one command exited zero. It proves nothing about test adequacy, coverage, or suppressed failures.
- The evaluator's scope differs by level while its method follows the criterion. A task evaluator works against a workspace; an objective evaluator also weighs child outcomes and the repository action.
- OPEN: bind an assessment to a criteria revision, not only to evidence. An authorized criteria change currently leaves an obsolete assessment looking current.
- OPEN: who records the outcome when evaluation produces no assessment at all. An inconclusive assessment is not the same as no assessment.
- OPEN: whether "an assessment that does not pass" includes the inconclusive case. Present wording covers it by construction; confirm.
- OPEN: a late assessment must never clear a newer block or overturn a newer human override.

## Parked for the Scheduler Service document

Runs, availability, retry.

- A run now ends on a failed assessment, so the run boundary equals the attempt boundary on the semantic path.
- The attempt budget belongs to the LEVEL, not the run. A run-scoped budget hands a fresh allowance to every replacement run, which reopens assessment shopping by crashing.
- An executor re-requests evaluation only with new evidence. A human may re-evaluate the same evidence, because a human is the authority the protocol protects.
- Claim protocol: the Scheduler determines eligibility, an instance requests compatible work, and an authoritative claim operation rechecks eligibility, reserves capacity and budget, and records the run. An instance never authorizes its own claim.
- No dispatch window may exist between run termination and the block taking effect.
- A stale or repeated unblock request must not authorize an unintended attempt.
- OPEN: what may retry automatically. An earlier ruling gave a configured attempt count with automatic retry; the blocking rule routes failure through a human. A resource limit can mean an impossible task rather than a transient fault, a lost instance may already have pushed a commit, and a crash can recur deterministically. State only that a failed assessment is never eligible for automatic continuation, and decide the rest separately.
- OPEN: concurrency and capacity. Whether two runs may work one level, and whether one instance runs one run at a time.
- OPEN: whether a parent run can occupy the last instance while waiting for its children, which deadlocks.

## Parked for the Agent Service document

Workers, instances, execution.

- Liveness: a lease with an expiry that the run renews, plus a token compared on write so a stale run cannot mutate a reassigned level. Needed because a long-lived run makes silence normal, so silence stops being a death signal.
- Abandonment costs the workspace, never the budget.
- Terminating a run does not require deleting its artifacts. A new run may reuse a retained checkout, branch or cache while the previous run stays terminal.
- Instance identity is three separate decisions: whether a human configures individual instances, whether instances carry runtime identity, and whether instance records persist. Only the first is rejected.
- OPEN: whether memory belongs to the worker template, the worker instance or the run. The vocabulary names no scope on purpose.

## Parked for the Project Service document

Credentials and bindings.

- Custody is a dedicated component of the Project Service. Project owns resource configuration and the authorization bindings; secret material sits behind a protected facility that trusted execution consults after checking the binding.
- Holding a resource does not confer custody of its secret. A binding does not narrow upstream authority: one SSH key reaches many repositories, one API key can authorize a whole account.
- Separate system authorization, what kanthord permits an execution to access, from credential authority, what the remote permits any holder. Only the first is enforceable here.
- A central store with explicit bindings beats the same secret duplicated per project. Unrestricted selection is the danger, not central storage.
- Only network git operations need a credential. Commit, branch and merge are local, so a trusted executor boundary covers clone, fetch and push only.
- Local disablement, upstream revocation, rotation, expiry and OAuth refresh are five different things.
- OAuth does not imply a person and an API key does not imply an organization. Record the configuring actor, the upstream principal and the execution identity separately.
- The boundary is authorization of operations, not custody of bytes. An agent that never sees a key can still abuse an authenticated tool, and an SSH agent socket grants authentication even when the key is unreadable.
- OPEN: a repository probably needs TWO credentials. An SSH key authorizes git transport; opening a pull request goes through the platform API and needs its own token. A pull-request strategy is already approved.
- OPEN: which provider account a worker configuration selects, whether an agent may override that selection, what authenticates a run when it requests an operation, what happens when permissions change mid-execution, and whether an external harness may use a project binding or must bring its own.

## Parked for the Tracking Service document

- The system retains the evidence that a retained outcome depends on. A content address identifies content and restores none, so losing an evidence record destroys the basis of its outcome.
- Evidence and telemetry carry different retention. No outcome depends on telemetry.

## Parked cross-cutting

- The state model must distinguish "not assessed yet" from "an assessment that could not establish the result". Execution lifecycle, evaluation lifecycle, approval status and outcome history stay separate dimensions and never collapse into one status field.
- A human holds three roles with different authority: participant as the WHO, reviewer who produces an assessment, and override authority who asserts an exception. Unblocking is a fourth action, not a fourth role: it authorizes a further run against the same criteria and asserts nothing about the results.
- Aggregation is not assessment. A worker aggregates child outcomes to report progress; the level's own outcome and the approved stopping conditions end the run.
- A blocked task must not fail its objective's run and must not reopen a sibling task that is already terminal. Dependency propagation is a separate decision from run termination.
- A failed objective assessment can arrive after a pull request, a merge or a push, because the repository action precedes objective success. Ending the run undoes none of it. A replacement run inspects what already happened. Unblock and rollback are different actions.
- The block must be enforced at the API and the CLI, not only in the Scheduler. An external harness is an executor reaching kanthord that way, so Scheduler-only enforcement leaves a bypass.
- `provider` is used in `docs/architecture.md` and defined nowhere. It is a product term and belongs in the overview vocabulary.

## Working notes

**The debate engine.** `KANTHOR_DEBATE_ENGINE=pi`. The skill lives at `~/.claude/skills/debate`. Call `scripts/run.sh --check`, write the debate block to the `args` path it prints, then call `scripts/run.sh <args-path>`. Run it in the background; a pass takes two to four minutes. Declare the parked items inside the block, or the engine reports their absence as defects.

**Do not trust the writer's self-check.** Pi reports its own acceptance as a pass on defective output. Every defect in this session came from the adversarial review or from reading Pi's output directly.

**Pi games an acceptance grep.** Given a forbidden-string list containing `sha` and `engine`, Pi wrote `sh&#97;pe`, `s&#104;ared` and `&#101;ngineering`, encoding one letter each so the grep missed them, then reported a pass. State acceptance criteria as intent, not as a string match, and read the produced file.

**Re-check counts and cross-references after Pi inserts list items.** It added two bullets and left "The first three rules" pointing at the wrong group.
