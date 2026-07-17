# Story 06 — Verification & result capture

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The D3 contract: the runner computes normalized, immutable evidence; the
profile judges it (two-valued verdict); an agent `escalate` call
short-circuits the judgment entirely (the actor's review IS the
verification — Ulrich, 2026-07-16); accepted work is finalized as a commit
on the task branch; results persist and print. (The escalated path's
status/approve half is story 07 — this story produces the `escalated`
TaskResult and the proposal commit.)

D6 extension (Ulrich, 2026-07-17, debate-reviewed): when the task carries
`verification: string[]`, the runner EXECUTES those commands in the
workspace after an accepted verdict and before finalize — a real gate, not
a prompt suggestion (debate: prompt-only verification is a false gate; the
task could complete while its checks fail). The captured results are the
task's **evidence** (`task_results.evidence`) — proof the work is correct,
never human-authored. Runner-executed task-authored commands are an
arbitrary-command surface accepted under the epic's existing trust-boundary
non-goal; EPIC 009 adds the controls.

## Acceptance Criteria

- `src/agent-runner/verification.ts` (adapter-level):
  - `OutcomeEvidence = { baseCommit: string; finalDiff: { files: string[];
hasChanges: boolean }; finalResponse: string }` — computed by the
    runner from the workspace: diff vs `baseCommit` INCLUDING untracked
    files; `finalResponse` = last assistant text (truncated 500 chars).
  - `VerificationResult = { verdict: 'accepted'; evidence: string }
| { verdict: 'rejected'; code: 'NO_CHANGES' | 'UNEXPECTED_CHANGES' |
'MISSING_RESPONSE'; message: string }`.
- `generic@1.verify`: `hasChanges === true` → accepted; else rejected
  `NO_CHANGES`.
- Runner sequence after the run ends (extends story 05 step 7):
  1. compute evidence;
  2. **the agent called `escalate({ reason })` during the run → skip
     `verify()`** → **proposal commit** on `kanthord/proposal/<task-id>`
     (kanthord identity, untracked included; the task branch itself stays
     at `baseCommit`; skipped when `hasChanges` is false — no-change
     escalation, `proposalCommit` undefined) → escalated `{ reason,
summary, workspace, branch, baseCommit, proposalCommit? }`;
  3. otherwise `profile.verify(evidence)`: `rejected` → failed
     (`reason = '<code>: <message>'`);
  4. `accepted` + `task.verification` present → **run verification (D6)**:
     execute each command sequentially via `sh -c <command>` with
     cwd = workspace dir (`node:child_process`, no new dependency),
     capturing `{ command, exitCode, output }` (stdout+stderr merged,
     truncated 10 000 chars) into the evidence array; per-command timeout
     300 s (timeout/spawn error → exitCode -1). First non-zero exit → stop,
     failed `VerificationFailedError: <command> (exit <code>)` — no
     finalize commit, no task_results.evidence persistence for the failed
     run (the reason carries the failing command; retry re-runs everything).
     `VerificationFailedError` is a RUNNER failure name, not a new
     profile-verdict code — command execution is runner-owned, judgment
     stays profile-owned (D3). Escalated runs never reach this step
     (escalate short-circuits at 2). No `verification` on the task → skip;
  5. all passed (or none) → **finalize**: commit-if-dirty on
     `kanthord/<task-id>` (kanthord identity, message `kanthord: <task
title>`; an agent-made commit means a clean tree → no-op) → completed
     `{ summary: evidence.finalResponse, workspace, branch, commitSha,
evidence?: VerificationEvidence[] }`;
  6. any git failure during evidence/finalize/proposal →
     failed `ResultCaptureError: <git stderr>`.
- `VerificationEvidence = { command: string; exitCode: number; output:
string }` (in `src/agent-runner/verification.ts`) — distinct from the D3
  `OutcomeEvidence` (runner-computed structural facts): `verification` is
  the task-authored HOW-to-check input, `evidence` is its captured output.
- `src/agent-runner/port.ts` TaskResult union (second annotated
  supersession of the EPIC 005 lock):
  `{ outcome: 'completed'; summary?: string; workspace?: string; branch?:
string; commitSha?: string; evidence?: VerificationEvidence[] } |
{ outcome: 'failed'; reason: string } |
{ outcome: 'escalated'; reason: string; summary: string; workspace:
string; branch: string; baseCommit: string; proposalCommit?: string }`.
  FakeRunner untouched.
- `RunNextTask` tx2 persists a `task_results` row for `completed`,
  including the `evidence` column (JSON array; NULL when the task had no
  `verification`) — the escalated branch is story 07.
- `get task --id`: a task with a result gains its key/value lines
  (`workspace/branch/commit_sha/summary`, plus `proposal_commit` when
  present, plus one `evidence` line per verification command —
  `<command> → exit <code>` — when evidence exists); `--json` gains a
  `result` object carrying the full evidence array (with outputs); a task
  without a result prints exactly as before.

## Constraints

- Evidence is computed once and passed by value — profiles never touch the
  workspace (D3 round 2: judgment reads evidence, not mutable state).
- `TaskResult.summary` stays the agent's text; the verification `evidence`
  string travels in the `agent.finished` event payload (story 08) — the
  two are never merged.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — evidence + verdict + finalize/proposal in the runner

**Requires:** S05-T1.

**Input:** `src/agent-runner/verification.ts` (new),
`src/agent-runner/pi.ts`, `src/agent-runner/pi-profile.ts`,
`src/agent-runner/port.ts` (+ tests).

**Action — RED:** integration tests (fake model, real tools/git, temp
dirs): (a) scripted session edits a file via the real edit tool →
completed; `commitSha ≠ baseCommit`; the commit is on `kanthord/<id>` in
the workspace and NOT in the source home; (b) text-only session → failed
`NO_CHANGES: …`; (c) session that commits via the bash tool → completed,
no double commit (rev count = base + 1); (d) scripted session edits a file
then calls `escalate({ reason })` → escalated: verify was NOT called (a
spying profile proves it), `proposalCommit` exists on
`kanthord/proposal/<id>` containing the edit (untracked file included),
the task branch still points at `baseCommit`, the result carries the
reason; (e) scripted session calls `escalate` BEFORE any change →
escalated with `proposalCommit` undefined (no-change escalation); (f)
`.git` removed by the scripted session → failed `ResultCaptureError:`; (g)
D6: a task with `verification: ['sh -c "exit 0"', 'echo ok']` → completed,
result `evidence` has two entries in order with exit 0 and captured output;
(h) `verification: ['exit 7']` → failed `VerificationFailedError:` naming
the command and exit 7, NO finalize commit (branch still at the agent's
last state), later commands not executed; (i) an escalating session with
`verification` set → escalated, the commands were NEVER executed (probe
file untouched); (j) no `verification` → completed with `evidence`
undefined (unchanged behavior). Fails today: verification absent.

**Action — GREEN:** implement evidence computation, verdict precedence,
finalize, proposal commit, and the port union extension.

**Action — REFACTOR:** none.

**Output:** deterministic, policy-aware result capture over frozen
evidence.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — completed persistence + `get task` output

**Requires:** T1; S02-T2; EPIC 004 S07-T3; EPIC 005 S03 (RunNextTask tx2).

**Input:** `src/app/task/run-next-task.ts`, the get-task query use case,
`src/apps/cli/task.ts` (+ tests).

**Action — RED:** temp-DB tests: (a) a fake runner returning the extended
completed result (with an evidence array) → tx2 writes the `task_results`
row including the `evidence` JSON (crash before tx2 → no row); (b)
`get task --id` on it prints the four result lines plus one
`<command> → exit <code>` line per evidence entry; `--json` carries
`result` with the full evidence array; (c) a result-less task prints
exactly as before, and a completed result without evidence prints no
evidence lines. Fails today: persistence/printing absent.

**Action — GREEN:** extend tx2 + query + formatter.

**Action — REFACTOR:** none.

**Output:** the Proof's `get task --id "$TASK"` output for completed work.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
