# KanthorD verification using the TODO fixture

These checks are operator-run KanthorD tests, not work assigned to the TODO app worker. Do not import this file. App tests prove app behavior; the checks below prove Mission/Scheduler record and control behavior. Run only against disposable projects/repositories and retain a report with actual results, identities and timestamps. A capability that is unavailable is **not run**, never a pass.

## Preconditions

- Read [README.md](README.md) and configure the `todoapp-repo` binding, execution worker and reviewer explicitly. Use the implemented command/API contracts, not guessed CLI syntax.
- Before import/graph experiments, keep workers unable to claim, for example with project worker instance counts at zero. Enable them only for the execution checks.
- Capture the initial mission version and binding revisions. Read the daemon's stores only for controlled diagnostic assertions; never write directly to them.
- Use a fresh separate project for each destructive or graph-mutating scenario. Source mutations below refer to temporary copies or an identity-bearing export, never edits to the checked-in baseline.

## Planning checks before execution

| Check                       | Action                                                                                                     | Expected observable result                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline preview            | Submit all 25 raw plan files to a fresh mission.                                                           | No violations and no retirements; preview has a digest. Preview writes no nodes.                                                                                            |
| Atomic apply                | Apply the exact preview and expected version.                                                              | 7 live nodes: 1 report node and 6 change nodes, with 18 tasks inside the change node revisions; 12 dependency edges. Mission version increments once.                       |
| Binding resolution          | Read the six change node revisions.                                                                        | Each pins the current repository-binding identity for `todoapp-repo`; the report node and task binding lists are empty. No node pins a worker binding.                      |
| Revision model              | Inspect nodes and revisions.                                                                               | Each node starts at revision 1 and attempt 0. Each task is content of its change node revision, with a `task_<ulid>` identity and no revision, state or attempt of its own. |
| Export round trip           | Export, then preview/apply unchanged content with IDs and current mission version.                         | Same identities, content, edges and revisions; no duplicate nodes or substantive mutation.                                                                                  |
| Unknown grammar             | Add an unknown front-matter field, then separately an unknown H2.                                          | `mission.import.plan_invalid` names the file; the entire apply leaves state unchanged.                                                                                      |
| Unresolved reference        | Change one dependency to `missing.md`.                                                                     | `mission.import.unresolved_reference`; no partial writes.                                                                                                                   |
| Duplicate name              | Submit two entries with the same filename.                                                                 | `mission.import.duplicate_file`; no partial writes.                                                                                                                         |
| Forbidden task key          | Add `depends_on` to one task file, then separately `requires`, then `work`.                                | `mission.import.plan_invalid` names the file each time; a task never becomes a scheduled graph vertex.                                                                      |
| Task on a report node       | Change `node:` of one task file to `todo-api.md`.                                                          | `mission.import.reference_kind_invalid`, because a task names a node with `work: change`; no partial writes.                                                                |
| Binding cardinality         | Remove the repository binding from one change node.                                                        | `mission.node.bindings_invalid`; no partial writes.                                                                                                                         |
| Uncovered node verification | Remove `npm run lint && npm run format:check` from `foundation-runtime.md`.                                | `mission.import.verification_uncovered` names `foundation.md` and the command; no partial writes.                                                                           |
| Dependency cycle            | Make foundation depend on `todo-api.md`.                                                                   | `mission.import.cycle`, because `todo-api.md` depends on foundation.                                                                                                        |
| Unmatched requirement       | Add `requires: [platform.macos]` to `foundation.md` while every worker binding holds `traits: []`.         | Preview reports the unmatched claim pairs of foundation. Apply refuses with `mission.node.requires_unmatched` and `details.claims`; no partial writes.                      |
| Stale mission version       | Perform a valid human graph write, then apply a previously prepared import/version.                        | Version conflict refuses the whole apply; the earlier human write survives.                                                                                                 |
| Pre-start task edit         | Change one task criterion in an identity-bearing export before any attempt.                                | Exactly its change node takes a new content revision; the task keeps its `task_<ulid>` identity.                                                                            |
| Task omission               | Omit one task that holds no change node verification from an identity-bearing export in an unused mission. | Its change node takes a new content revision without that task. Preview lists no retirement.                                                                                |
| Node retirement             | Omit `todo-api.md` from an identity-bearing export in an unused mission.                                   | Preview lists precisely that retirement; apply requires the digest and exact retirement confirmation. The report node retires with its dependency edges.                    |

The twelve dependency edges are persistence→foundation, authentication→persistence, todos→authentication, operations→foundation, acceptance→todos, acceptance→operations and todo-api→each of the six change nodes. A task names its node in the node content, not in a dependency row.

## Execution and review checks

1. Enable the configured workers for the untouched baseline. Initially only foundation is a claimable node. The report node holds `Pending` and no job until all six change nodes are `Completed`; no task ever has a job or execution.
2. Claim foundation. Confirm one live `scheduler_execution`, attempt 1 pinned to revision 1, the node in `Executing` and its job removed. A repeated work pull for the same runtime identity returns that same live execution rather than creating another.
3. Have the steps worker publish repository evidence naming the pinned binding and checkpoint commit, then release without further work. Foundation becomes `Waiting` and receives an evaluation job when ready. A release without required evidence is refused with `mission.release.obligation_unmet` and changes neither claim nor node.
4. Have the reviewer run every change node verification and every task verification from the pinned revision. A passing assessment names the verification evidence, tested commit and pinned revision. Tasks get no independent evidence, assessment or outcome records. The reviewer judges each task's final-state criterion, not just exit status.
5. Complete the configured repository action, if any, through its supported platform/Intake path. A requested unresolved action keeps foundation from completing. Record the action's request evidence and observed end state; do not substitute an unrecorded manual merge for that check.
6. Once foundation is `Completed`, persistence and operations become eligible. Authentication remains pending until persistence completes; todos waits for authentication; acceptance waits for both todos and operations. Confirm completed dependency code is available in each later checkout.
7. After every change node is `Completed`, the report node becomes `Available`. Its steps execution reads the outcome and evidence of each direct dependency. Its evaluation checks out one base-branch head of `todoapp-repo` and runs the report verification. Its successful assessment names the current outcome of each direct dependency in `dependency_outcome_ids`. A discarded dependency satisfies nothing, so the report node stays `Pending` until a human removes that dependency.
8. Record the final evidence, assessments and outcomes by node. Verify each outcome references an assessment; no task has an outcome. Capture filename→node identity, node revision, attempt, execution identity, tested commit, evidence IDs, assessment ID and outcome ID for each completed executable node.

## Controlled review and revision experiments

Perform these only in a separate fixture project, not by weakening the baseline plan.

- **Failed verification:** deliberately introduce a real test failure in a disposable execution branch. The reviewer cannot submit a passing assessment; its rationale identifies the failed verification. The attempt closes into a blocked outcome rather than unlocking dependent nodes.
- **Active task import:** after a change node opens attempt 1, modify one of its tasks through a copied identity-bearing import. The modification fails atomically under the import condition of that node, regardless of other untouched nodes.
- **Pinned revision:** through the authorized human node API, change the criterion of a nonterminal change node while attempt 1 is open. Confirm the new revision exists while the execution still reads and verifies the old pinned revision. Use documented human controls for further work; import never retargets or unblocks an attempt.
- **Work lock:** through the authorized human node API, change `work` of a change node while attempt 1 is open. The write fails with `mission.node.work_locked` and changes no revision.
- **Authority:** an execution credential cannot import plans, create nodes or write criteria. App bearer tokens likewise confer no KanthorD authority; these are separate security systems.
- **Human unblock:** after a controlled criterion failure, apply an authorized human unblock with the needed corrected content. Confirm a new attempt pins the chosen revision, prior evidence remains attributable to the previous attempt and dependents remain gated until success.

This fixture does not claim exhaustive KanthorD recovery, external-provider or load coverage. Record unsupported steps explicitly and keep app behavior, KanthorD behavior and infrastructure limitations separate in the report.

## Report template

For each check record: check name; pass/fail/not-run; project/mission identity; before/after mission version; affected node IDs; actual response/status; relevant record identities; tested commit; reason for any failure or not-run result. Never place credentials in the report.

The design basis is [Mission Service](../../mission-service.md), its [implementation sibling](../../mission-service.impl.md), [planning ERD](../../../reference/erd/01-setup.md) and [execution ERD](../../../reference/erd/02-execution.md). These documents are contracts to test, not evidence that the implementation already satisfies them.
