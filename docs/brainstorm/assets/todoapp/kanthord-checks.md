# KanthorD verification using the TODO fixture

These checks are operator-run KanthorD tests, not work assigned to the TODO app worker. Do not import this file. App tests prove app behavior; the checks below prove Mission/Scheduler record and control behavior. Run only against disposable projects/repositories and retain a report with actual results, identities and timestamps. A capability that is unavailable is **not run**, never a pass.

## Preconditions

- Read [README.md](README.md) and configure the `todoapp-repo` binding, execution worker and reviewer explicitly. Use the implemented command/API contracts, not guessed CLI syntax.
- Before import/graph experiments, keep workers unable to claim, for example with project worker instance counts at zero. Enable them only for the execution checks.
- Capture the initial mission version and binding revisions. Read the daemon's stores only for controlled diagnostic assertions; never write directly to them.
- Use a fresh separate project for each destructive or graph-mutating scenario. Source mutations below refer to temporary copies or an identity-bearing export, never edits to the checked-in baseline.

## Planning checks before execution

| Check | Action | Expected observable result |
| --- | --- | --- |
| Baseline preview | Submit all 25 raw plan files to a fresh mission. | No violations and no retirements; preview has a digest. Preview writes no nodes. |
| Atomic apply | Apply the exact preview and expected version. | 25 live nodes: 1 initiative, 6 objectives, 18 tasks; 24 parent links and 6 dependency edges. Mission version increments once. |
| Binding resolution | Read the six objective revisions. | Each pins the current repository-binding identity for `todoapp-repo`; initiative/task binding lists are empty. No node pins a worker binding. |
| Revision model | Inspect nodes and revisions. | Initiative and objectives start at revision 1 and attempt 0; task content is embedded in its objective revision, with no standalone task revision/state/attempt. |
| Export round trip | Export, then preview/apply unchanged content with IDs and current mission version. | Same identities, content, edges and revisions; no duplicate nodes or substantive mutation. |
| Unknown grammar | Add an unknown front-matter field, then separately an unknown H2. | `mission.import.plan_invalid` names the file; the entire apply leaves state unchanged. |
| Unresolved reference | Change one dependency to `missing.md`. | `mission.import.unresolved_reference`; no partial writes. |
| Duplicate name | Submit two entries with the same filename. | `mission.import.duplicate_file`; no partial writes. |
| Forbidden task edge | Add `depends_on` to one task. | Import rejects it; tasks never become scheduled graph vertices with dependencies. |
| Binding cardinality | Remove the repository binding from one objective. | `mission.node.bindings_invalid`; no partial writes. |
| Containment cycle | Make foundation depend on its own `todo-api.md` initiative. | `mission.import.cycle`, including the implicit initiative wait edge. |
| Stale mission version | Perform a valid human graph write, then apply a previously prepared import/version. | Version conflict refuses the whole apply; the earlier human write survives. |
| Pre-start task edit | Change one task criterion in an identity-bearing export before any attempt. | Exactly its owning objective takes a new content revision; the task keeps its node identity. |
| Omission/retirement | Omit one task from an identity-bearing export in an unused mission. | Preview lists precisely that retirement; apply requires the digest and exact retirement confirmation. Task retires, owning objective content revises. |

The six explicit dependency edges are persistence→foundation, authentication→persistence, todos→authentication, operations→foundation, acceptance→todos and acceptance→operations. Parent links are not dependency rows.

## Execution and review checks

1. Enable the configured workers for the untouched baseline. Initially only foundation is a claimable objective. The initiative has no steps job until all its objectives are terminal; no task ever has a job or execution.
2. Claim foundation. Confirm one live `scheduler_execution`, attempt 1 pinned to revision 1, the node in `Executing` and its job removed. A repeated work pull for the same runtime identity returns that same live execution rather than creating another.
3. Have the steps worker publish repository evidence naming the pinned binding and checkpoint commit, then release without further work. Foundation becomes `Waiting` and receives an evaluation job when ready. A release without required evidence is refused with `mission.release.obligation_unmet` and changes neither claim nor node.
4. Have the reviewer run every objective verification and every task verification from the pinned revision. A passing assessment names the verification evidence, tested commit and pinned revision. Tasks get no independent evidence, assessment or outcome records. The reviewer judges each task's final-state criterion, not just exit status.
5. Complete the configured repository action, if any, through its supported platform/Intake path. A requested unresolved action keeps foundation from completing. Record the action's request evidence and observed end state; do not substitute an unrecorded manual merge for that check.
6. Once foundation is `Completed`, persistence and operations become eligible. Authentication remains pending until persistence completes; todos waits for authentication; acceptance waits for both todos and operations. Confirm completed dependency code is available in each later checkout.
7. After every objective is terminal, the initiative may run. Its successful assessment must weigh all six current child outcomes and the final repository verification. A failed/discarded child can satisfy terminal readiness, but cannot satisfy this initiative's success criterion.
8. Record the final evidence, assessments and outcomes by initiative/objective. Verify each outcome references an assessment; no task has an outcome. Capture filename→node identity, node revision, attempt, execution identity, tested commit, evidence IDs, assessment ID and outcome ID for each completed executable node.

## Controlled review and revision experiments

Perform these only in a separate fixture project, not by weakening the baseline plan.

- **Failed verification:** deliberately introduce a real test failure in a disposable execution branch. The reviewer cannot submit a passing assessment; its rationale identifies the failed verification. The attempt closes into a blocked outcome rather than unlocking dependent objectives.
- **Active task import:** after an objective opens attempt 1, modify one of its tasks through a copied identity-bearing import. The modification fails atomically under the objective's import condition, regardless of other untouched nodes.
- **Pinned revision:** through the authorized human node API, change a nonterminal objective's criterion while attempt 1 is open. Confirm the new revision exists while the execution still reads and verifies the old pinned revision. Use documented human controls for further work; import never retargets or unblocks an attempt.
- **Authority:** an execution credential cannot import plans, create nodes or write criteria. App bearer tokens likewise confer no KanthorD authority; these are separate security systems.
- **Human unblock:** after a controlled criterion failure, apply an authorized human unblock with the needed corrected content. Confirm a new attempt pins the chosen revision, prior evidence remains attributable to the previous attempt and dependents remain gated until success.

This fixture does not claim exhaustive KanthorD recovery, external-provider or load coverage. Record unsupported steps explicitly and keep app behavior, KanthorD behavior and infrastructure limitations separate in the report.

## Report template

For each check record: check name; pass/fail/not-run; project/mission identity; before/after mission version; affected node IDs; actual response/status; relevant record identities; tested commit; reason for any failure or not-run result. Never place credentials in the report.

The design basis is [Mission Service](../../mission-service.md), its [implementation sibling](../../mission-service.impl.md), [planning ERD](../../../reference/erd/01-setup.md) and [execution ERD](../../../reference/erd/02-execution.md). These documents are contracts to test, not evidence that the implementation already satisfies them.
