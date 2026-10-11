---
title: Council design
---

# Council design

Status: proposed on branch `feat/council`. Not a ruled page. Where this spec and a page of the design set disagree, the page wins and this spec is defective.

## Purpose

A human states a raw idea. The council assesses its complexity, asks open questions about it, collects isolated answers from several role agents that run on different models, and synthesizes a development direction. It writes that direction as a set of plan files in the Markdown plan format of the [Mission Service](../mission-service.md#criterion-and-authority).

The human reviews and edits the plan files, then imports them. The import is the approval. After the import, the Scheduler Service lets the existing workers claim the nodes as usual.

## Constraints from ruled pages

- Planning occurs outside kanthord, and an execution creates no node and writes no criterion ([Mission Service](../mission-service.md#criterion-and-authority)). The council therefore runs as a CLI command, not as a worker, and it writes plan files, never nodes.
- An agent name names a role, and no agent name equals a worker name ([Agent](../agent.md#agent-catalog)).
- A human enables an agent before use, an enablement is global to the server, and a declaration supplies no provider, model identifier or reasoning effort default ([Agent](../agent.md#agent-configuration)). Each role runs on the model that its enablement selects, so model diversity needs no new mechanism.
- Every agent has an agent file `<agent_name>.md` that the [prompt composer](../agent.md#prompt-composer) reads.

## Command

`kanthord council "<idea>" --out <dir>`

- It belongs to the `cli` application and acts under the human token of the caller.
- It reads the enablement of all six agents through `agent.enablement.get` before any model call. The triage has not run yet, so the command requires every agent that any complexity can select.
- It runs every agent answer as one new [workbench session](../workbench-service.md#workbench-session) through the existing Workbench operations: `workbench.session.create` with the agent name and the `default_configuration` of its enablement, one `workbench.session.message`, then `workbench.session.events` until the run ends. The answer is the text of the last assistant message.
- The sessions stay in the Workbench list of their agent, so a human can open each answer later.
- It writes the plan files and `council.md` into `<dir>` and stops.
- It adds no service, no table and no HTTP operation.

## Agents

| Agent name    | Perspective                               | Question it answers                                                                      |
| ------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `council@1`   | Triage, questioning, synthesis            | How complex is the idea, where do the roles agree and conflict, which direction follows? |
| `po@1`        | Value, scope, priority                    | What comes first, what is cut, how is success measured?                                  |
| `designer@1`  | Experience, flow, error states            | Which steps does a user take, and where do they stumble?                                 |
| `user@1`      | End user, candid                          | Do I need this, and what makes me leave?                                                 |
| `architect@1` | Technology, risk, cost                    | Which parts does it touch, and what is hard to reverse?                                  |
| `security@1`  | Attack surface, sensitive data, authority | What can be abused, and what can leak?                                                   |

Each role prompt states who the role is and what it cares about. It requires a fixed answer frame per question: `answer`, `confidence`, `assumptions`. The fixed frame lets the synthesis merge answers mechanically.

## Flow

1. **Triage.** `council@1` returns a complexity of `S`, `M` or `L` with its reasons.
2. **Questions.** `council@1` produces a list of open questions about the idea.
3. **Panel.** Each selected role answers every question in its own new agent session. The roles run in parallel.
4. **Second round** (`L` only). `council@1` derives questions from the conflicts of round one, and each selected role answers them in a new agent session.
5. **Synthesis.** `council@1` merges the answers into agreements, conflicts and a recommended direction.
6. **Plan writing.** `council@1` turns the synthesis into initiatives, objectives and tasks as entries of the JSON plan format of the Mission Service (`importEntrySchema`), with no `id` and an empty `bindings` list.
7. **Write.** The command renders each entry with the plan file serializer of the Mission Service, checks that the plan parser reads it back unchanged and that every `parent` and `depends_on` names a file of the set, then writes the plan files and `council.md` into `<dir>`.

### Complexity selects roles and rounds

| Complexity | Roles                                                       | Rounds |
| ---------- | ----------------------------------------------------------- | ------ |
| `S`        | `po@1`, `user@1`                                            | 1      |
| `M`        | `po@1`, `user@1`, `designer@1`, `architect@1`               | 1      |
| `L`        | `po@1`, `user@1`, `designer@1`, `architect@1`, `security@1` | 2      |

### Isolation

- Every role answer runs in a new agent session.
- The input of a role session holds only the idea, the triage result and the questions of its round.
- No role session ever receives the answer of another role.

### Output

- One plan file per node, in the Markdown plan format of the Mission Service, with no identifier, so the import creates each node.
- Every plan file holds an empty `bindings` list. The human adds the bindings of the project before the import, and the import preview of the Mission Service checks the set.
- `council.md`: the record of the run. It holds the idea, the triage result, every question, every role answer per round, the synthesis and the reasons for each node. It is for the human review and is not imported.

## Errors

The command refuses a configuration instead of handling its edge case.

| Code                                     | Condition                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.council.token_required`             | No human token is configured.                                                                                                                                                                          |
| `cli.council.agent_not_enabled`          | One of the six agents has no enablement or a disabled one. The command refuses before any model call and lists every missing agent.                                                                    |
| `cli.council.output_directory_not_empty` | `<dir>` exists and is not empty. The command never overwrites and never merges.                                                                                                                        |
| `cli.council.agent_session_failed`       | A workbench session of the run fails: a refused operation, a run error, a pending approval, or no end of the run within 10 minutes. The command aborts the run, writes nothing, not even `council.md`. |
| `cli.council.answer_invalid`             | An answer holds no JSON value that matches the schema of its step. The command writes nothing.                                                                                                         |
| `cli.council.plan_file_invalid`          | A rendered plan file does not read back unchanged, or a `parent` or a `depends_on` names no file of the set. The command writes nothing.                                                               |

Each code must also stand on the `engine/docs/cli/` page of the command group before the command ships.

## Testing

- A fake model runtime returns fixed answers.
- Triage results `S`, `M` and `L` select exactly the roles and rounds of the table.
- Isolation: no prompt sent to a role session contains the answer of another role.
- Round trip: the plan parser of the Mission Service reads every produced plan file back to its entry.
- Each error code has a test that triggers its condition and checks that `<dir>` stays untouched.
- A workbench run that waits for an approval fails the session, because a role needs no tool.

## Out of scope

- Debate in which a role reads another role's answer.
- A Workbench or dashboard view of a council run.
- Any write of a node by the council.
