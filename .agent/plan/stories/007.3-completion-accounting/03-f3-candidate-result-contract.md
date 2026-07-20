# Story 3 — F3: executor-neutral `candidate` result contract

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

Today a _changed_ `generic@1` task returns `outcome: "completed"`
(`TaskResult`, `src/agent-runner/port.ts:20-38`) and `RunNextTask` marks it
`completed` with no landing candidate. The runner also rejects verified
no-change as `NO_CHANGES` (`genericProfile.verify()`, `pi-profile.ts:63-72`),
which the runner turns into `failed`. Both are wrong for the north-star: changed
work must become a **candidate** awaiting a landing gate, and verified no-change
is a legitimate `completed`.

This story adds an **executor-neutral** `candidate` outcome to `TaskResult` and
rewires the pi runner so **changed → `candidate`**, **verified no-change →
`completed`**. Lifecycle is NOT inferred from `task.agent === "generic@1"` — the
runner keys the profile as today; the outcome is decided by the profile's
change/no-change verdict only.

## Locked contract (tests assert verbatim)

```ts
// src/agent-runner/port.ts — TaskResult gains a `candidate` arm
export type TaskResult =
  | {
      outcome: "completed";
      summary?: string;
      workspace?: string;
      branch?: string;
      commitSha?: string;
      evidence?: VerificationEvidence[];
    }
  | {
      outcome: "candidate";
      workspace: string;
      branch: string; // task branch, e.g. "kanthord/<taskId>"
      baseCommit: string; // canonical-branch HEAD at run start (workspace.baseCommit)
      candidateCommit: string; // the proposal commit to be landed
      summary: string;
      evidence?: VerificationEvidence[];
    }
  | { outcome: "failed"; reason: string }
  | {
      outcome: "escalated";
      reason: string;
      summary: string;
      workspace: string;
      branch: string;
      baseCommit: string;
      proposalCommit?: string;
    };
```

- `candidate.baseCommit` = `workspace.baseCommit` (the value `PiAgentRunner`
  already captures). `candidate.candidateCommit` = the commit the runner makes on
  the task branch (the same value the `escalated` arm records as
  `proposalCommit`).
- The `escalated` arm is unchanged (it keeps `proposalCommit`).

## No-change verify contract

`genericProfile.verify()` must stop mapping no-change to a `rejected NO_CHANGES`
that becomes `failed`. New contract:

- `finalDiff.hasChanges === true` → the runner produces `outcome: "candidate"`.
- `finalDiff.hasChanges === false` → the runner produces `outcome: "completed"`
  (verified no-change is a legitimate completion, NOT a failure).

Keep `verify()`'s real failure verdicts (e.g. a failing verification command)
mapping to `failed` — only the **no-change** verdict changes meaning.

## Constraints

- Executor-neutral: no `if (task.agent === "generic@1")` in the run/complete
  path. The change/no-change decision comes from the profile verdict + diff, not
  the executor id.
- Do NOT rename `Task.agent` (EPIC 008 owns that).
- The runner still only knows about git state — it does NOT decide whether a
  candidate is landed vs completed-in-place; that binding-type policy lives in
  `RunNextTask` (Story 4). The runner always returns `candidate` for changed
  work.
- No schema change. Hermetic.

## Verification Gate

`node --test src/agent-runner/port.test.ts` (compile/type test for the new arm),
`node --test src/agent-runner/pi.test.ts`, and
`node --test src/agent-runner/pi-profile.test.ts` green; `npm run typecheck` 0;
`npm run lint` clean.

---

### Task T1 — add the `candidate` arm to `TaskResult`

**Requires:** nothing.

**Input:** `src/agent-runner/port.ts`, `src/agent-runner/port.test.ts` (new or
extend a type/compile test).

**Action — RED:** a compile test constructing a `candidate` `TaskResult` with all
required fields and asserting (via a `switch (r.outcome)` narrowing test) that
`candidateCommit`/`baseCommit`/`workspace`/`branch`/`summary` are typed on the
`candidate` arm. Fails today: `"candidate"` is not an allowed `outcome`.

**Action — GREEN:** add the `candidate` arm to `TaskResult` exactly as locked.

**Action — REFACTOR:** none.

**Output:** the port admits a `candidate` outcome.

**Verify:** `npm run typecheck` 0; `node --test src/agent-runner/port.test.ts`
green.

---

### Task T2 — pi runner: changed → `candidate`, no-change → `completed`

**Requires:** T1.

**Input:** `src/agent-runner/pi.ts`, `src/agent-runner/pi-profile.ts`,
`src/agent-runner/pi.test.ts`, `src/agent-runner/pi-profile.test.ts`.

**Action — RED:**
(a) profile test: `genericProfile.verify()` with `finalDiff.hasChanges === false`
no longer returns `rejected NO_CHANGES` on the completion path — instead the
runner-visible verdict distinguishes no-change from a real failure (assert the
verdict/shape the runner consumes to pick `completed`).
(b) runner test with a fake agent that leaves a **changed** workspace (a real
commit on the task branch): asserts `run()` resolves to
`{ outcome: "candidate", baseCommit, candidateCommit, branch, workspace, summary }`
with `candidateCommit` = the task-branch HEAD and `baseCommit` =
`workspace.baseCommit`.
(c) runner test with a fake agent that leaves **no change**: asserts
`{ outcome: "completed" }` (NOT `failed`).
Fails today: changed → `completed`, no-change → `failed`.

**Action — GREEN:** update `genericProfile.verify()`'s no-change verdict and the
runner's verdict→`TaskResult` mapping in `pi.ts` so changed produces
`candidate` (carrying the captured base/proposal commits) and verified no-change
produces `completed`. Real verification failures still map to `failed`.

**Action — REFACTOR:** none.

**Output:** the runner speaks the executor-neutral `completed`/`candidate`
contract; no `task.agent` inference introduced.

**Verify:** `node --test src/agent-runner/pi.test.ts` and
`src/agent-runner/pi-profile.test.ts` green; `npm run typecheck` 0; lint clean.
