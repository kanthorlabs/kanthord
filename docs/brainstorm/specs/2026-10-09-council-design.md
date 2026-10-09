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

- It belongs to the `cli` application and calls the running server to resolve the effective configuration of each agent.
- It writes the plan files and `council.md` into `<dir>` and stops.
- It adds no service, no table and no HTTP endpoint beyond what agent session resolution already provides.

## Agents

| Agent name | Perspective | Question it answers |
| --- | --- | --- |
| `council@1` | Triage, questioning, synthesis | How complex is the idea, where do the roles agree and conflict, which direction follows? |
| `po@1` | Value, scope, priority | What comes first, what is cut, how is success measured? |
| `designer@1` | Experience, flow, error states | Which steps does a user take, and where do they stumble? |
| `user@1` | End user, candid | Do I need this, and what makes me leave? |
| `architect@1` | Technology, risk, cost | Which parts does it touch, and what is hard to reverse? |
| `security@1` | Attack surface, sensitive data, authority | What can be abused, and what can leak? |

Each role prompt states who the role is and what it cares about. It requires a fixed answer frame per question: `answer`, `confidence`, `assumptions`. The fixed frame lets the synthesis merge answers mechanically.

## Flow

1. **Triage.** `council@1` returns a complexity of `S`, `M` or `L` with its reasons.
2. **Questions.** `council@1` produces a list of open questions about the idea.
3. **Panel.** Each selected role answers every question in its own new agent session. The roles run in parallel.
4. **Second round** (`L` only). `council@1` derives questions from the conflicts of round one, and each selected role answers them in a new agent session.
5. **Synthesis.** `council@1` merges the answers into agreements, conflicts and a recommended direction.
6. **Plan writing.** `council@1` turns the synthesis into initiatives, objectives and tasks with their criterion and verifications, in the Markdown plan format.
7. **Write.** The command validates every plan file with the plan parser of the Mission Service, then writes the plan files and `council.md` into `<dir>`.

### Complexity selects roles and rounds

| Complexity | Roles | Rounds |
| --- | --- | --- |
| `S` | `po@1`, `user@1` | 1 |
| `M` | `po@1`, `user@1`, `designer@1`, `architect@1` | 1 |
| `L` | `po@1`, `user@1`, `designer@1`, `architect@1`, `security@1` | 2 |

### Isolation

- Every role answer runs in a new agent session.
- The input of a role session holds only the idea, the triage result and the questions of its round.
- No role session ever receives the answer of another role.

### Output

- One plan file per node, in the Markdown plan format of the Mission Service, with no identifier, so the import creates each node.
- `council.md`: the record of the run. It holds the idea, the triage result, every question, every role answer per round, the synthesis and the reasons for each node. It is for the human review and is not imported.

## Errors

The command refuses a configuration instead of handling its edge case.

| Code | Condition |
| --- | --- |
| `agent_not_enabled` | An agent that the selected roles or `council@1` need has no enablement or a disabled one. The command refuses before any model call and lists every missing agent. |
| `output_directory_not_empty` | `<dir>` exists and is not empty. The command never overwrites and never merges. |
| `agent_session_failed` | A role session or a `council@1` session fails. The command writes nothing, not even `council.md`. |
| `plan_file_invalid` | A produced plan file does not parse with the plan parser of the Mission Service. The command writes nothing. |

Each code must also stand on the `engine/docs/cli/` page of the command group before the command ships.

## Testing

- A fake model runtime returns fixed answers.
- Triage results `S`, `M` and `L` select exactly the roles and rounds of the table.
- Isolation: no prompt sent to a role session contains the answer of another role.
- Round trip: the produced plan files import, and the export of the imported nodes equals the produced files.
- Each error code has a test that triggers its condition and checks that `<dir>` stays untouched.

## Out of scope

- Debate in which a role reads another role's answer.
- A Workbench or dashboard view of a council run.
- Any write of a node by the council.
