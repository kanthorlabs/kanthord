#!/usr/bin/env bash
# make-transitions-graph.sh — author the graph packages used by EPIC 023's Proof
# (scripts/e2e/http-transitions-proof.sh). No model, no network: every task runs
# through the real CLI daemon with the KANTHORD_FAKE_AGENT seam (see src/main.ts).
#
# Usage: scripts/e2e/make-transitions-graph.sh <out-dir>
#
# Emits THREE packages plus ONE shared scripted-turn file:
#
#   verdict      1 initiative / 1 objective / 1 task. Its scripted turns write a
#                file and then call the built-in `escalate` tool, so the task
#                stops at `awaiting_confirmation` WITH a proposal commit
#                (src/agent-runner/pi.ts:717-741 creates one when the workspace
#                changed). That proposal commit is what makes a REPEATED approve
#                the idempotent 200 branch (src/app/task/approve-task.ts:132-138)
#                rather than a 409.
#
#   integration  1 initiative / 1 objective / 1 task. Its turn writes the file the
#                task's Verification checks, so the task COMPLETES and the
#                objective reaches `awaiting_confirmation` with a `commitOid` —
#                the candidate an objective verdict must echo back as
#                `expectedCommit` (EPIC 012).
#
#   failure      1 initiative / 1 objective / 2 tasks. Neither task's turn writes
#                anything, so each task's own Verification (`test -f
#                src/never.mjs`) exits 1 and the task reaches `failed` through the
#                real failure path. `failed` is the status a task must be in for
#                `retry task` (retry-task.ts:129-131) and the status
#                `reject task --resolution discard` accepts
#                (reject-task.ts:163-169), and the Proof needs one task for each.
#
#   .fake-agent.json   a FakeTurnMap keyed by task TITLE
#                      (src/agent-runner/fake-session.ts:86-108), because the
#                      three kinds of task need three different scripts. The "*"
#                      default is the do-nothing script the two failure tasks use.
#
# Bindings: generic@1 requires repository context only, so every initiative
# declares the `source` alias and each import needs `--bind source=<repo-id>`.
# Under the fake-agent seam the provider/credential values are ignored (they only
# satisfy the runner's context-binding check).
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-transitions-graph.sh <out-dir>}"

write_initiative() { # $1=dir $2=ref $3=name
  mkdir -p "$1"
  cat > "$1/initiative.md" <<EOF
---
kind: initiative
ref: $2
name: $3
bindings:
  source: repository
---
EOF
}

write_objective() { # $1=dir $2=ref $3=initiative-ref $4=name
  cat > "$1/objective.md" <<EOF
---
kind: objective
ref: $2
initiative: $3
name: $4
---
EOF
}

write_task() { # $1=dir $2=file $3=ref $4=objective-ref $5=title $6=verification-file
  cat > "$1/$2" <<EOF
---
kind: task
ref: $3
objective: $4
title: $5
agent: generic@1
context:
  source: source
---
# Instructions
Deterministic no-model task. The scripted turn for this task's exact title
decides what happens; see .fake-agent.json.
# Acceptance Criteria
- [ ] \`$6\` exists
# Verification
\`\`\`sh
test -f $6
\`\`\`
EOF
}

# ---------------------------------------------------------------------------
# Package 1 — verdict. One task that escalates WITH a workspace change.
# ---------------------------------------------------------------------------
write_initiative "$OUT/verdict" tr-verdict-init "Transitions verdict"
write_objective  "$OUT/verdict" tr-verdict-obj tr-verdict-init "Verdict objective"
write_task       "$OUT/verdict" task-approve.md tr-verdict-task tr-verdict-obj \
  "Verdict approve task" "src/verdict.mjs"

# ---------------------------------------------------------------------------
# Package 2 — integration. One task that completes, so its objective becomes
# awaiting_confirmation with a commitOid.
# ---------------------------------------------------------------------------
write_initiative "$OUT/integration" tr-integration-init "Transitions integration"
write_objective  "$OUT/integration" tr-integration-obj tr-integration-init "Integration objective"
write_task       "$OUT/integration" task-integration.md tr-integration-task tr-integration-obj \
  "Integration task" "src/integration.mjs"

# ---------------------------------------------------------------------------
# Package 3 — failure. Two tasks that both fail their own verification.
# ---------------------------------------------------------------------------
write_initiative "$OUT/failure" tr-failure-init "Transitions failure"
write_objective  "$OUT/failure" tr-failure-obj tr-failure-init "Failure objective"
write_task       "$OUT/failure" task-reject.md tr-failure-reject tr-failure-obj \
  "Failure reject task" "src/never.mjs"
write_task       "$OUT/failure" task-reattempt.md tr-failure-reattempt tr-failure-obj \
  "Failure reattempt task" "src/never.mjs"

# ---------------------------------------------------------------------------
# The shared scripted turns, keyed by task title.
# ---------------------------------------------------------------------------
cat > "$OUT/.fake-agent.json" <<'EOF'
{
  "Verdict approve task": [
    {
      "toolCalls": [
        {
          "name": "bash",
          "arguments": { "command": "mkdir -p src && printf '// kanthord 023 verdict marker\\n' > src/verdict.mjs" }
        }
      ]
    },
    {
      "toolCalls": [
        {
          "name": "escalate",
          "arguments": { "reason": "a human must approve this change" }
        }
      ]
    }
  ],
  "Integration task": [
    {
      "toolCalls": [
        {
          "name": "bash",
          "arguments": { "command": "mkdir -p src && printf '// kanthord 023 integration marker\\n' > src/integration.mjs" }
        }
      ]
    },
    { "text": "Created src/integration.mjs" }
  ],
  "*": [{ "text": "Nothing was done, so this task's verification must fail." }]
}
EOF
