# Worker V2 build plan

Ruled 2026-11-17 by Ulrich. This page holds the build order, the roles and the gates of Worker V2. [HANDOFF.md](HANDOFF.md) holds the status of each step.

Worker V2 is the worker execution refactor of [design.md](../worker-execution-refactor/design.md) with the Foundry of D32. Remove this folder before `feature/worker-v2` merges into `main`.

## Branches

- Each pull request of Worker V2 merges into the branch `feature/worker-v2` of its repository.
- `kanthord` holds `feature/worker-v2` from `7cf6ea8e`. `engine` holds `feature/worker-v2` from `ea454eab`.
- Start each worktree under `.dev/` from `origin/feature/worker-v2`.
- An `engine` pull request merges first. A `kanthord` pull request then points the submodule to the new `engine` commit.
- The pre-commit hook of `kanthord` accepts only a pointer on `engine` `origin/main`. Before a pointer commit, confirm that the `engine` commit is on `origin/feature/worker-v2`. Then commit with `KANTHORD_SKIP_SUBMODULE_PUSH=1`.
- The merge of `engine` `feature/worker-v2` into `main` makes a new commit. Point `kanthord` to that commit before `kanthord` `feature/worker-v2` merges into `main`.
- `feature/worker-v2` merges into `main` after phase C. Remove this folder in that merge.

## Build order

1. Phase A: build the Foundry and the CLI with no behavior change.
2. Phase B: record the eval set baseline on the behavior of today.
3. Phase C: build the behavior layers. Measure each layer against the baseline.

Reason: the baseline records the behavior of today. Each behavior layer shows its change as a `compare` difference against the baseline.

### Phase A: build

| Step | Content                                                                                                                      | Source                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A1   | Chain runner. Port the current steps with no behavior change. Add the golden chain test.                                     | D21 layer 4                                                   |
| A2   | Implement ports in the worker and `LogPort`. Settle G5 and G6.                                                               | D32 layer 1                                                   |
| A3   | Evaluation and examine ports, `AgentPort`.                                                                                   | D32 layer 2                                                   |
| A4   | Stops as values, `secrets.redact`, the end kind `failed`.                                                                    | D32 layer 3                                                   |
| A5   | Boundary of the Foundry: `foundryImplement`, `foundryEvaluation`, `foundryExamine`, the `build()` rules and the module test. | D32 layer 4                                                   |
| A6   | Capabilities and guards: `agentPort`, the two capability factories, the tool allowlist, the `locations` rule, the MCP rules. | D32 layer 5                                                   |
| A7   | CLI host and `kanthord worker tasks run` for `implement`.                                                                    | D32 layer 6                                                   |
| A8   | `kanthord worker tasks seed`, the route `worker.execution.seed.get` and `kanthord worker tasks compare`.                     | D31, [design.md §5.7](../worker-execution-refactor/design.md) |
| A9   | Pages: [agent.impl.md](../agent.impl.md) and `engine/docs/cli/worker.md`.                                                    | D32 pages                                                     |

The main [HANDOFF](../HANDOFF.md) holds the check of each D32 layer under the Worker Service.

### Phase B: eval set baseline

| Step | Content                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| B1   | Select 8 to 12 executions. Cover one unit, many units, a merge conflict, a setup failure, a release gate failure and a budget end. |
| B2   | Export the seed of each execution with `kanthord worker tasks seed`.                                                               |
| B3   | Run each seed in live mode with the production model of its `setup`. Use the same model for each run of the set.                   |
| B4   | Write the baseline report: exit code, checks, turns, tokens, cost, run time and verify result of each seed.                        |
| B5   | Replay each seed against its own record. The replay shows no difference.                                                           |

### Phase C: behavior layers

| Step | Content                                        | Source      |
| ---- | ---------------------------------------------- | ----------- |
| C1   | Gate G and restore reduction.                  | D21 layer 1 |
| C2   | Unit record, then removal of the trailer code. | D21 layer 2 |
| C3   | `ClaimWatch` and push fence.                   | D21 layer 3 |
| C4   | Parallel groups and fail-early order.          | D21 layer 5 |
| C5   | Checkpoint merge, telemetry and stop detail.   | D21 layer 6 |
| C6   | Measure and improve the `Conflict` prompt.     | D22         |

Each step of phase C replays the full eval set. A difference appears only where the step intends a change. C1 and C6 also run a live record of the affected seeds. Ulrich approves the cost of each live run.

## Eval set

- Keep the eval set outside the repository, in a folder with mode `0700`. A seed holds `claim` and `setup`. A record holds model turns with project source text.
- Keep the index of the eval set in this folder: the execution id, the case and the seed digest of each seed.
- `kanthord worker tasks run` serves the `implement` chain only until phase C ends.

## Roles

| Role                   | Who                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Owner                  | Ulrich. Rules each open item.                                                                        |
| Orchestrator           | Aelita (Opus 5.5). Writes each step brief, runs the gates, sorts review findings, updates the pages. |
| Implementer, Fable 5.2 | A1, A4, A6.                                                                                          |
| Implementer, Opus 5.5  | A2, A3, A5, A7, A8, and phase C.                                                                     |
| Reviewer               | The other model of the two. A Fable 5.2 step gets an Opus 5.5 review, and the reverse.               |
| Security review        | `/security-review` on A6, A7 and A8, in addition to the review.                                      |
| Fixer                  | The implementer of the step, resumed with its context.                                               |
| Page writer            | Sonnet 5.5 for A9. The `crucible` skill checks the pages with Opus and a Haiku reader test.          |
| Eval runs              | Aelita runs B2 to B5 and the replays of phase C. A Sonnet 5.5 agent condenses each `compare` output. |

At most 5 sub-agents run at one time.

## Step flow

1. The orchestrator writes the brief of the step from the design pages.
2. The implementer builds the step in a worktree from `origin/feature/worker-v2`.
3. The reviewer reviews the diff with `/code-review high`.
4. The orchestrator lists each finding in the format `B1/S1 - status - action - name - description - fix - why`.
5. The implementer fixes each finding with `action:YES`.
6. The orchestrator runs the gate of the step.
7. When the gate passes, the orchestrator opens the pull request to `feature/worker-v2` and merges it. One pull request is open at a time. The next step starts after the merge.
8. The orchestrator marks the step done in [HANDOFF.md](HANDOFF.md) and records each ruling in its owning page.

## Gates

- Each step of phase A and phase C passes the full `engine` suite and the golden chain test.
- Each step passes the check of its layer in the main [HANDOFF](../HANDOFF.md).
- A step does not start before the step before it passes its gate.
- A `kanthord` pull request passes `scripts/docs/check.sh`.
