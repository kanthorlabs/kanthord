# How the coder@1 worker works

[Explanations](README.md)

`coder@1` is the native worker that does the work of a node. It uses one agent of the [native agent](native-agent.md), `swe@1`. `swe@1` works on each task until its verifications pass and its criterion is met.

| Property        | Value                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Method          | `steps`                                                                                                                  |
| Agent           | `swe@1`                                                                                                                  |
| Claims          | A node in state `Available`                                                                                              |
| Default budget  | 200 turns and 2 hours of wall time                                                                                       |
| Repository      | The repository binding of the objective, after [binding inheritance](../reference/mission/import.md#binding-inheritance) |
| After a success | The node moves to `Waiting`, and `reviewer@1` evaluates the whole node                                                   |

The native workers are `coder@1` and `reviewer@1`. `coder@1` does the work, and `reviewer@1` judges it.

## The execution in 11 steps

An execution of an objective has four phases and 11 steps. An initiative has no tasks, so `coder@1` writes a report instead.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#ffffff", "primaryTextColor": "#2d3142", "primaryBorderColor": "#4f5d75", "secondaryColor": "#ececec", "tertiaryColor": "#f5f5f5", "lineColor": "#4f5d75", "edgeLabelBackground": "#f5f5f5", "fontFamily": "system-ui, sans-serif", "fontSize": "14px"}, "flowchart": {"htmlLabels": true, "useMaxWidth": false, "nodeSpacing": 24, "rankSpacing": 40}}}%%
flowchart TB
    accTitle: The coder@1 execution in 11 steps
    accDescr: Four phases. Prepare reads the revision and the prior rationale, prepares the workspace and opens swe@1. Start merges the base branch and checks every task. Tasks runs each pending task. Finish merges the base branch again, pushes, submits the head commit and releases the node to Waiting.
    claim(["Claim: node Available → Executing"]) --> s1
    subgraph prepare ["Prepare"]
        s1["<b>1</b> Read the pinned revision"] --> kind{"Node has tasks?"}
        kind -- yes --> s2["<b>2</b> Read the prior rationale<br/>of the rework, the change request<br/>or the cleared assessment"]
        s2 --> s3["<b>3</b> Prepare the workspace<br/>check out kanthord/&lt;node_id&gt;"]
        s3 --> s4["<b>4</b> Open swe@1"]
    end
    kind -- "no: initiative" --> report(["Initiative report<br/>see the native agent page"])
    subgraph start ["Start"]
        s5["<b>5</b> Merge origin/&lt;base_branch&gt;<br/>swe@1 resolves conflicts"]
        s5 --> s6["<b>6</b> Start check<br/>verify and judge every task"]
    end
    s4 --> s5
    subgraph tasks ["Tasks"]
        s7["<b>7</b> Run each pending task<br/>work, verify, judge"]
    end
    s6 -- "pending tasks" --> s7
    subgraph finish ["Finish"]
        s8["<b>8</b> Merge the base again<br/>verify all tasks on a move"]
        s8 --> s9["<b>9</b> Push the node branch"]
        s9 --> s10["<b>10</b> Submit the head commit<br/>as evidence"]
        s10 --> s11["<b>11</b> Release<br/>further_work: false"]
    end
    s7 --> s8
    s11 --> waiting(["Node Waiting → reviewer@1"])
    classDef focal fill:#fbeae1,stroke:#eb6c36,color:#2d3142,stroke-width:2px;
    classDef outcome fill:#ececec,stroke:#7a8399,color:#2d3142;
    class s7 focal;
    class claim,report,waiting outcome;
```

## How coder@1 drives pi

`swe@1` runs on the pi SDK, `@earendil-works/pi-coding-agent` 1.0.3. The [native agent](native-agent.md) page explains the configuration, the prompt layers and the tool set. This section shows which pi calls `coder@1` makes and what it reads back.

| Need of the worker           | pi API                                                                    | What the worker does with it                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A model with a credential    | `ModelRuntime.create`, then `runtime.getModel`                            | Step 4. The runtime reads the secret from the custody handover. It makes no network call.     |
| A session in the workspace   | `createAgentSession` with `SessionManager.inMemory`                       | Step 4. The session lives in memory. A new execution opens a new session.                     |
| The task in every model call | The `context` hook and a guard on `agent.streamFunction`                  | The worker pins the work prompt of the current task, so that a compaction does not remove it. |
| A turn of work               | `session.prompt(text)`, then `session.waitForIdle()`                      | Steps 5 to 8. The worker sends the work prompt or an instruction and waits for the agent.     |
| The reply                    | `session.getLastAssistantText()`                                          | The worker parses the `kanthord-judgement:` line from the last reply.                         |
| A provider failure           | The last assistant message with `stopReason: "error"`                     | The worker maps `errorMessage` to a code and stops with `provider_failed`.                    |
| The turn budget              | `session.subscribe` for `turn_end`, and an override of `agent.finishTurn` | Each `turn_end` counts one turn. After each turn the worker checks the budget and the claim.  |
| A safe `bash`                | `createBashToolDefinition` with a `spawnHook` and a timeout               | The hook removes every provider key from the environment. The timeout is 10 minutes or less.  |
| Evidence from the agent      | A custom tool `evidence-upload`                                           | The tool uploads a workspace file and returns `evidence_id`, `asset_id` and `uri`.            |
| A stop                       | `session.abort()`                                                         | The worker aborts on a budget end, on a cancellation and before a checkpoint commit.          |
| The transcript               | `session.messages`                                                        | At the end, the worker writes the messages to `<state>/transcripts/<execution_id>.jsonl`.     |

The worker does not use `steer` or `followUp`. Each instruction is a new `prompt` call after the agent is idle.

One task, from the side of the worker, has this shape:

```ts
await session.prompt(workPrompt, { expandPromptTemplates: false });
await session.waitForIdle();
failOnProviderError(session.messages);

const head = await commitWork(workspace, task, attempt);
const verification = await runVerifications(workspace, task.verifications);
if (!verificationPassed(verification)) {
  await session.prompt(taskRevisionInstruction(verification, outputTail));
  await session.waitForIdle();
}

await session.prompt(taskJudgementInstruction(task));
await session.waitForIdle();
const judgement = parseJudgement(session.getLastAssistantText());
```

The code sketch leaves out the loop, the budget checks and the claim checks. Step 7 below shows the full loop.

## Step 6: the start check

The workspace and the node branch survive between attempts. The start check decides which tasks still need work, so a new execution does not redo finished work.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#ffffff", "primaryTextColor": "#2d3142", "primaryBorderColor": "#4f5d75", "secondaryColor": "#ececec", "tertiaryColor": "#f5f5f5", "lineColor": "#4f5d75", "edgeLabelBackground": "#f5f5f5", "fontFamily": "system-ui, sans-serif", "fontSize": "14px"}, "flowchart": {"htmlLabels": true, "useMaxWidth": false, "nodeSpacing": 24, "rankSpacing": 40}}}%%
flowchart TB
    accTitle: The start check of one task
    accDescr: A task with a failed verification is pending. A passed task named in the prior rationale is pending with that rationale. A passed task that was judged met at the same head, attempt and revision is skipped. Any other passed task is judged now; a met criterion skips it, an unmet criterion makes it pending.
    task(["Task"]) --> verify{"Verifications<br/>pass?"}
    verify -- no --> p1["Pending<br/>plain work prompt"]
    verify -- yes --> named{"Prior rationale<br/>names the task?"}
    named -- yes --> p2["Pending<br/>criterion revision with the rationale"]
    named -- no --> judged{"Judged met at this head<br/>in this attempt and revision?"}
    judged -- yes --> skip(["Skip"])
    judged -- no --> judge["swe@1 judges the criterion"]
    judge -- met --> skip
    judge -- "not met" --> p3["Pending"]
    classDef pending fill:#fbeae1,stroke:#eb6c36,color:#2d3142;
    classDef outcome fill:#ececec,stroke:#7a8399,color:#2d3142;
    class p1,p2,p3 pending;
    class skip outcome;
```

## Step 7: one task

`swe@1` works on one task until its verifications pass and its criterion is met. The worker, not the agent, commits, runs the verifications and decides when the task is complete.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#ffffff", "primaryTextColor": "#2d3142", "primaryBorderColor": "#4f5d75", "secondaryColor": "#ececec", "tertiaryColor": "#f5f5f5", "lineColor": "#4f5d75", "edgeLabelBackground": "#f5f5f5", "fontFamily": "system-ui, sans-serif", "fontSize": "14px"}, "flowchart": {"htmlLabels": true, "useMaxWidth": false, "nodeSpacing": 24, "rankSpacing": 40}}}%%
flowchart TB
    accTitle: One task of coder@1
    accDescr: swe@1 works, the worker commits and runs the verifications. A failure sends the failed results and the output tail back to swe@1. A pass leads to the criterion judgement. An unmet criterion sends the rationale back. A met criterion records the judged commit and completes the task. A budget end at any point ends the task work.
    start(["Pending task"]) --> work["swe@1 works<br/>prompt or revision instruction"]
    work --> commit["Worker commits"]
    commit --> verify{"Verifications<br/>pass?"}
    verify -- no --> failed["Revision instruction<br/>failed results + last 4 KiB of output"] --> work
    verify -- yes --> judge{"swe@1 judges:<br/>criterion met?"}
    judge -- no --> unmet["Revision instruction<br/>with the rationale"] --> work
    judge -- yes --> record["Record the judged commit"] --> done(["Task complete<br/>next task"])
    work -. "budget ends" .-> budget(["Finish with further_work: true"])
    classDef focal fill:#fbeae1,stroke:#eb6c36,color:#2d3142,stroke-width:2px;
    classDef outcome fill:#ececec,stroke:#7a8399,color:#2d3142;
    class failed,unmet focal;
    class start,done,budget outcome;
```

`coder@1` holds no review of its own. The node review of `reviewer@1`, after the release, is the only review.

## Example: a run with no problem

The objective `node_01JZ8Q0K4M6N8P0R2S4T6V8W0X` adds a health endpoint. Its base branch is `main`, and it has two tasks:

| Task                                | Criterion                                      | Verifications                    |
| ----------------------------------- | ---------------------------------------------- | -------------------------------- |
| `node_01JZ8Q1A…` Add `GET /healthz` | The route answers 200 with `{"status":"ok"}`   | `npm test -- healthz`            |
| `node_01JZ8Q1B…` Document the route | `docs/api.md` describes the route and its body | `grep -q '/healthz' docs/api.md` |

1. The worker claims the node. The claim gives `execution_01JZ8R2B…` and attempt 1.
2. Steps 1 to 4 read the revision, find no prior rationale, check out `kanthord/node_01JZ8Q0K…` and open `swe@1`.
3. Step 5 merges `origin/main` with no conflict. Step 6 runs `npm test -- healthz`, which fails, so the first task is pending. The second task also fails its verification and is pending.
4. Step 7 sends the work prompt of the first task:

   ```text
   # Add GET /healthz

   ## Requirement

   Add a route GET /healthz to the HTTP server.

   ## Criterion

   The route answers 200 with {"status":"ok"}

   ## Verifications

   1. npm test -- healthz
   ```

5. `swe@1` edits `src/server.ts`, adds a test and ends its turns. The worker commits `kanthord: task node_01JZ8Q1A… attempt 1`. `npm test -- healthz` exits with code 0.
6. The worker sends the judgement instruction. The last line of the reply is:

   ```text
   kanthord-judgement: {"criterion_met": true, "rationale": "src/server.ts answers GET /healthz with 200 and {\"status\":\"ok\"}, and test/healthz.test.ts checks both."}
   ```

7. The worker records the judged commit in `judged-tasks.json` and moves to the second task. The second task follows the same path.
8. Step 8 fetches `origin/main`. The base did not move, so the worker runs no verification again.
9. Steps 9 and 10 push the node branch and submit the head commit as evidence:

   ```json
   {
     "execution_id": "execution_01JZ8R2B…",
     "attempt": 1,
     "node_revision": 3,
     "subject": "Head commit of the node branch",
     "assets": [
       {
         "kind": "repository",
         "address": {
           "kind": "repository",
           "binding_id": "binding_01JZ…",
           "commit": "9f2c4e1…"
         }
       }
     ]
   }
   ```

10. Step 11 releases with `{ "further_work": false, "stop": null }`. The node moves to `Waiting`, and `reviewer@1` claims it.

## How the execution ends

Every end pushes the node branch, except a revocation. The release decides the next node state.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#ffffff", "primaryTextColor": "#2d3142", "primaryBorderColor": "#4f5d75", "secondaryColor": "#ececec", "tertiaryColor": "#f5f5f5", "lineColor": "#4f5d75", "edgeLabelBackground": "#f5f5f5", "fontFamily": "system-ui, sans-serif", "fontSize": "14px"}, "flowchart": {"htmlLabels": true, "useMaxWidth": false, "nodeSpacing": 24, "rankSpacing": 40}}}%%
flowchart LR
    accTitle: How a coder@1 execution ends
    accDescr: Four kinds of end. Success releases with further_work false to Waiting. A failed final merge and a budget end release with further_work true to Available. A stop releases with further_work true and the stop reason. A revocation ends with no release.
    ok["All tasks complete<br/>final merge and verifications pass"] --> r1["push, evidence,<br/>further_work: false"] --> waiting(["Waiting<br/>reviewer@1"])
    merge["Final merge conflicts<br/>or a verification fails"] --> r2["reset the merge, push,<br/>further_work: true"] --> available(["Available<br/>next execution"])
    budget["Budget ends"] --> r3["checkpoint commit, push,<br/>further_work: true"] --> available
    r3 -. "budget_end count at<br/>mission.further_work_limit" .-> paused(["Paused"])
    stop["Stop: operation_failed,<br/>judgement_invalid, ..."] --> r4["checkpoint commit, push,<br/>further_work: true + stop"] --> available
    revoked["Claim revoked"] --> r5["no push, no release"] --> ended(["Execution ended"])
    classDef good fill:#ffffff,stroke:#4f5d75,color:#2d3142,stroke-width:2px;
    classDef focal fill:#fbeae1,stroke:#eb6c36,color:#2d3142;
    classDef outcome fill:#ececec,stroke:#7a8399,color:#2d3142;
    class ok good;
    class merge,budget,stop,revoked focal;
    class waiting,available,paused,ended outcome;
```

A budget end carries the `budget_end` stop only when no task completed in that execution. A release without that stop resets the count toward `mission.further_work_limit`.

## Edge cases

| Case                                               | Behavior                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Conflict at the step 5 merge                       | `swe@1` resolves the files. A file that still holds a marker stops with `operation_failed`. |
| Conflict at the step 8 merge                       | The worker aborts the merge and releases with `further_work: true`.                         |
| A verification fails                               | `swe@1` gets the failed command, the results and the last 4 KiB of its output.              |
| A verification command runs longer than 10 minutes | The worker kills the command. The command counts as failed, and later commands do not run.  |
| A judgement reply has no valid marker line         | One repair turn. A second invalid reply stops with `judgement_invalid`.                     |
| A model call fails at the provider                 | The turn ends with the error, and the worker stops with `provider_failed` and its code.     |
| Two revisions in a row change no file              | The worker stops with `no_progress` and does not verify the unchanged head again.           |
| The node branch is gone after a recorded push      | The worker stops with `operation_failed` and `repository.node_branch.missing`.              |
| The node is paused during the execution            | The claim check after the next turn or before the next task ends the execution as revoked.  |
| A rework after a `criterion-not-met` assessment    | The start check gives the rationale to each task that it names.                             |
| An unblock after a change request on the PR        | The start check judges each task against the requested changes of the reviewers.            |
| The budget ends inside a task                      | The worker writes a checkpoint commit, pushes and releases. The next execution resumes.     |

## Examples of the edge cases

Each example starts from the run above and changes one fact.

### A verification fails

`npm test -- healthz` exits with code 1 after the first turn. The worker sends this revision instruction:

````text
Revise the task work to satisfy its criterion and verifications. Verification 1 `npm test -- healthz` failed with exit code 1.
Verification results: [{"command":"npm test -- healthz","exit_code":1,"signal":null,"timed_out":false}]

Output of the last verification that ran (the last 4 KiB):

```text
FAIL test/healthz.test.ts
  expected 200, received 404
```
````

`swe@1` fixes the route. The worker commits, verifies again and continues with the judgement.

### The criterion is not met

The verifications pass, but the reply ends with:

```text
kanthord-judgement: {"criterion_met": false, "rationale": "The route answers 200, but the body is the text ok, not {\"status\":\"ok\"}."}
```

The worker sends `Revise the task work to meet its criterion. Previous judgement: The route answers 200, but …`. The loop goes back to work.

### The judgement has no marker line

The reply ends with `The criterion is met.` and no `kanthord-judgement:` line. The worker sends one repair turn: `The reply holds no valid kanthord-judgement: line. Reply again with exactly one such line.` A second reply with no valid line stops the execution:

```json
{
  "further_work": true,
  "stop": { "reason": "judgement_invalid", "code": null }
}
```

### The budget ends inside a task

The 200th turn ends while `swe@1` works on the second task. The first task is complete. The worker aborts the session, commits `kanthord: checkpoint of task node_01JZ8Q1B… attempt 1`, pushes and releases:

```json
{ "further_work": true, "stop": null }
```

The stop is `null` because one task completed in this execution. The node moves to `Available`. The next execution skips the first task at the start check, because it was judged met at the same head, attempt and revision.

When no task completes before the budget ends, the release carries the stop, and the count toward `mission.further_work_limit` grows:

```json
{ "further_work": true, "stop": { "reason": "budget_end", "code": "turns" } }
```

### Two revisions change no file

`npm test -- healthz` fails. `swe@1` answers two revision instructions in a row and changes no file. The worker stops and does not verify the same head again:

```json
{ "further_work": true, "stop": { "reason": "no_progress", "code": null } }
```

### The provider refuses a call

The provider answers 429 to a model call. The turn ends with `stopReason: "error"`. The worker writes a checkpoint commit, pushes and releases:

```json
{
  "further_work": true,
  "stop": { "reason": "provider_failed", "code": "rate_limited" }
}
```

After `mission.consecutive_failure_limit` stops in a row, the node moves to `Paused`.

### The base moves during the run

At step 8, `origin/main` holds a new commit. The merge has no conflict, so the worker runs the verifications of every task again. When all pass, the worker pushes the merge commit. When one fails, the worker resets the node branch to the head before the merge, pushes and releases with `{ "further_work": true, "stop": null }`.

### A human pauses the node

The human pauses the node during the work on the first task. After the next turn, the claim check reads a claim that is not `running`. The worker ends the execution as revoked. It does not push and does not release, because the claim is no longer its own.

## What coder@1 reports

`coder@1` reports on the two channels of the [worker contract](worker-contract.md). On the state channel, it checks its claim, submits the head commit as evidence and releases. On the telemetry channel, it writes a `worker.phase` span for each phase, a `worker.task` span for each task, and `worker.verification`, `worker.judgement`, `agent.turn` and `agent.tool` spans below each task. An external harness writes the same `agent.turn` and `agent.tool` spans.

## Limits

- **One review, at the node.** `coder@1` judges each task itself. Only `reviewer@1` reviews the work, and only after the release.
- **One repository.** An objective works on its one repository binding. Work in two repositories needs two objectives.
- **A stalled node pauses.** An execution that completes no task before its budget ends counts toward `mission.further_work_limit`. At the limit, the node moves to `Paused`.
