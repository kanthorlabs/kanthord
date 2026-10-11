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
        kind -- yes --> s2["<b>2</b> Read the prior rationale<br/>of the rework or cleared assessment"]
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
        s8["<b>8</b> Merge the base branch again<br/>verify every task when the base moved"]
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
| The node is paused during the execution            | The claim check after the next turn or before the next task ends the execution as revoked.  |
| A rework after a `criterion-not-met` assessment    | The start check gives the rationale to each task that it names.                             |
| The budget ends inside a task                      | The worker writes a checkpoint commit, pushes and releases. The next execution resumes.     |

## Limits

- **One review, at the node.** `coder@1` judges each task itself. Only `reviewer@1` reviews the work, and only after the release.
- **One repository.** An objective works on its one repository binding. Work in two repositories needs two objectives.
- **A stalled node pauses.** An execution that completes no task before its budget ends counts toward `mission.further_work_limit`. At the limit, the node moves to `Paused`.
