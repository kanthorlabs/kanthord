---
description: Drive a kanthord TDD implementation cycle for one EPIC using OpenCode subagents.
agent: build
---

# /work - OpenCode TDD Orchestrator

Arguments: `$ARGUMENTS`

You are the orchestrator. You own dispatch, lifecycle checks, and human
escalation. The `test-engineer`, `software-engineer`, and `reviewer-engineer`
subagents own their role turns.

Use OpenCode's Task tool to invoke subagents. Do not impersonate a role inside
the orchestrator turn.

## Required Agents

Before starting, verify these files exist:

- `.opencode/agents/test-engineer.md`
- `.opencode/agents/software-engineer.md`
- `.opencode/agents/reviewer-engineer.md`

## Parse Arguments

- First positional argument: EPIC file path. Required.
- `--variant core`: accepted, but this project has one variant, so it is the same as serial.
- `--base <ref>`: base ref for changed-file review. Default `HEAD`.
- `--max-turns N`: turn cap. Default `128`; `0` means unlimited.
- `--sketch`: abort. This project has no sketch phase.
- `--join`: abort unless the project later defines multiple variants.

If the EPIC path is missing or is not under `.agent/plan/epics/`, stop with
usage.

## Discussion File

Compute today's UTC date and the EPIC slug from the EPIC filename. Use:

`.agent/tdd/history/<YYYY-MM-DD>-<epic-slug>.md`

If it does not exist, create it with a header containing:

- EPIC path.
- Opened date.
- Cycle: `tdd`.
- Scope: `all` or `core`.
- Opener: `test-engineer`.
- Base ref from `git rev-parse HEAD`.
- The EPIC `## Verification Gate` text.

After seeding, the orchestrator must not edit the discussion file except for the
auto-review routing block described below.

## Dispatch Loop

Repeat until `IMPLEMENTATION_READY_FOR_REVIEW:` appears after the latest review
failure boundary, or until max turns is reached.

Determine the next role from the last `END:` marker in the discussion file:

- No marker: dispatch `test-engineer`.
- `END: TEST-ENGINEER`: dispatch `software-engineer`.
- `END: SOFTWARE-ENGINEER`: dispatch `test-engineer`.
- Anything else: stop and ask the human to inspect the discussion file.

For each turn:

1. Mint a unique `TURN_ID` using EPIC slug, scope, UTC timestamp, and turn count.
2. Set the draft file to `.agent/tdd/.<role>-response-<TURN_ID>.md`.
3. Snapshot `git status --porcelain -uall` before dispatch.
4. Use the Task tool with `subagent_type` set to the role name.
5. Pass this prompt to the subagent, with paths resolved from the repo root:

```text
Continue the TDD implementation cycle for EPIC <EPIC_FILE>.

Working root: <repo-root>
Discussion file: <DISCUSSION_FILE>
Scope: <scope>
Draft file: <DRAFT_FILE>

Single-turn contract:
- ONE turn = ONE role = ONE append = ONE final END marker.
- Do not switch or impersonate the other role.
- Do not spawn or dispatch subagents.
- Append IMPLEMENTATION_READY_FOR_REVIEW only when this turn is it.

Response-size discipline (ignoring it can abort your turn and lose all its work):
- The model caps a SINGLE assistant response at 32000 output tokens, counting your thinking + prose + EVERY tool-call input (a Write body, an Edit hunk, a Bash heredoc). You cannot see your own token count, so control size STRUCTURALLY, not by estimating.
- Emit AT MOST ONE source/test-file mutation per assistant response: one Write or one Edit, then let the tool result return before the next. Never batch edits across files or put a large write in a batched response.
- Never write/edit a source or test file with a Bash heredoc (cat > file); use Write/Edit. The only heredoc allowed is the small cat >> append to the discussion file.
- Never rewrite an existing file wholesale (use targeted Edit hunks; scaffold a large new file across responses). test-engineer: at most one new test file per response.
- A multi-file (ripple) change is still ONE Task but NOT one response: change the seam and one conformer, let feedback return, then the next. If it would touch more than ~3 files or a file over ~10 KB, split it across responses.
- Never paste file contents or full command output; cite path:line and summarize. Keep the appended turn short (~40 lines).

Follow your role instructions exactly:
- If test-engineer: write RED, confirm GREEN, or pass through GREEN-only Tasks.
- If software-engineer: make the latest RED green or implement forwarded GREEN-only Tasks.
- If reviewer-engineer: review only the changed files requested by the orchestrator.

Draft your turn into <DRAFT_FILE>.
Append it with: cat '<DRAFT_FILE>' >> '<DISCUSSION_FILE>'
Re-read the discussion tail and verify the final non-blank line is END: <ROLE>.
Do not delete <DRAFT_FILE>; the orchestrator cleans it up.
Return one short sentence summarizing what you wrote.
```

6. Verify the discussion file changed and ends with the expected role marker. If it did not change: on a response-size abort (the "32000 output token maximum" error, or a return with no append), re-dispatch the same role once with the same `TURN_ID`, prepending "Your previous attempt exceeded the single-response output-token cap; make only ONE small mutation this turn and split the rest across later turns." Count it toward the Task's attempt limit; a second size abort on the same Task escalates to the human.
7. Snapshot `git status --porcelain -uall` after dispatch.
8. Check lane ownership for newly changed files.

Lane rules:

- `test-engineer`: may change `src/**/*.test.ts`, `src/**/*.spec.ts`, its draft file, and `.agent/tdd/memory/test-engineer/**`.
- `software-engineer`: may change production `src/**/*.ts` excluding tests, its draft file, and `.agent/tdd/memory/software-engineer/**`.
- `reviewer-engineer`: may change nothing.
- Both TDD roles may append to the active discussion file.
- Always forbidden to TDD roles: `.agent/plan/**`, `.claude/**`, `.opencode/**`, `package.json`, `package-lock.json`, `tsconfig*.json`, `*.config.*`, `scripts/**`, `Containerfile`, `compose.yaml`, `Makefile`, and generated proto output.

If the project has `scripts/lane-check.sh`, prefer it for lane checks.

After a clean turn, delete only that turn's exact draft file.

## Failed Attempts

After each turn, read the latest `ATTEMPT-FAILED:` line. Count failures for the
same Task after the latest review failure boundary. If one Task reaches 3 failed
attempts, stop and escalate to the human with the failed lines and discussion
file path.

## Review Phase

**One reviewer round only.** Dispatch the `reviewer-engineer` **exactly once** per
cycle. After that single round — including after auto-routing `action:YES`
findings back through the TDD loop and fixing them — do **not** dispatch the
reviewer again. Hand the result to the human. Run another reviewer round only
when the human explicitly asks for one.

When `IMPLEMENTATION_READY_FOR_REVIEW:` is present:

1. If latest `HUMAN_REVIEW:` is `PASS`, report closed.
2. If latest `HUMAN_REVIEW:` is `FAIL`, collect following `BLOCKER:` lines and return to the dispatch loop.
3. If no human verdict exists, check whether the reviewer already ran this review cycle. It runs **at most once** between human verdicts:
   - If an `AUTO_REVIEW:` line exists after the latest `HUMAN_REVIEW:` line (or, when there is no human verdict yet, anywhere in the file), the reviewer already ran and its `action:YES` findings were routed and fixed. Do **not** re-dispatch it. Read back the recorded `INFO:` (`action:NO`) findings, present them to the human, and pause for human review.
   - Otherwise, run the reviewer gate once for this review cycle.

Reviewer gate:

- Compute changed files with `git diff --name-only <base-ref>..HEAD`.
- Mint a reviewer draft path `.agent/tdd/.reviewer-response-<epic-slug>-<UTC-timestamp>.md` here in the orchestrator so it can be deleted later by exact name.
- Dispatch `reviewer-engineer` with EPIC path, discussion file, scope, phase `B`, base ref, changed files, and the minted draft file path (tell it to draft its verdict into that exact file; the orchestrator deletes it after the turn). Instruct it to obey response-size discipline: the single-response 32000-output-token cap counts thinking + prose + every tool-call input, so it must not reproduce source code, full diffs, long logs, or an exhaustive per-AC table — findings as `<B/S> - action - name - one-line` with `file:line` cites plus a compact coverage summary, reading only the line ranges it needs.
- After the reviewer turn lands, delete its draft file by that exact name (`rm -f` it) so reviewer drafts do not pile up under `.agent/tdd/`.
- Parse findings with `action:YES` and `action:NO`.
- If any `action:YES` findings exist, append one auto-review block to the discussion file:

```md
AUTO_REVIEW: FAIL - routing <N> action:YES finding(s) to the TDD loop; <M> action:NO finding(s) recorded for the human.
BLOCKER: <action:YES finding 1>
INFO: <action:NO finding 1>
```

- Then reset the turn count and return to the dispatch loop.
- If no `action:YES` findings exist, show the reviewer verdict and pause for human review.

Tell the human to append one of these to the discussion file and re-run `/work`:

- `HUMAN_REVIEW: PASS`
- `HUMAN_REVIEW: FAIL` followed by one `BLOCKER: <issue>` line per issue

## Exit Summary

End with one line:

`done - mode=<serial|core> - turns=<N> - reason=<reason> - human_review=<PASS|FAIL|pending> - lifecycle=<opened|closed> - root=<repo-root>`

Then list only the important events from this run.
