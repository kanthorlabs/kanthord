#!/usr/bin/env bash
# make-discard-graph.sh — author the deterministic DISCARD-path graph package used
# by EPIC 007.16's first Proof block. No model, no network: both tasks run through
# the real CLI daemon with the KANTHORD_FAKE_AGENT seam (see src/main.ts).
#
# Usage: scripts/e2e/make-discard-graph.sh <out-dir>
#
# Shape (2 tasks, one edge):
#   root-task   Verification `test -f src/definitely-missing-on-purpose.mjs`,
#               which the scripted turn deliberately never creates — so the pi
#               runner gates the run as failed with
#               `VerificationFailedError: <cmd> (exit 1)`.
#   dep-task    `dependencies: [root-task]` — stays `pending` forever because
#               only a `completed` dependency satisfies an edge (readiness()).
#
# That is exactly the state the Proof needs: a `failed` root with a persisted
# `reason`, plus one `pending` dependent for the cascade to discard.
#
# Bindings mirror make-todo-graph.sh: generic@1 requires repository +
# ai_provider + credential context, so the initiative declares all three aliases
# and the import needs `--bind source=… --bind provider=… --bind cred=…`. Under
# the fake-agent seam the provider/credential values are ignored (they only
# satisfy the runner's context-binding check) — a dummy pair suffices.
set -euo pipefail

OUT="${1:?usage: make-discard-graph.sh <out-dir>}"
mkdir -p "$OUT"

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: discard-init
name: Unachievable work reaches a terminal state
bindings:
  source: repository
  provider: ai_provider
  cred: credential
---
EOF

cat > "$OUT/objective.md" <<'EOF'
---
kind: objective
ref: discard-obj
initiative: discard-init
name: Discard a failed root and its dependent subtree
---
EOF

# ---------------------------------------------------------------------------
# Task 1 — root-task. Its Verification can NEVER pass.
# ---------------------------------------------------------------------------
cat > "$OUT/task-root.md" <<'EOF'
---
kind: task
ref: root-task
objective: discard-obj
title: Root task whose verification can never pass
agent: generic@1
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Deterministic no-model task. The scripted turn writes an unrelated file, so the
Verification command below always exits non-zero and the run gates as failed.
# Acceptance Criteria
- [ ] `src/definitely-missing-on-purpose.mjs` exists
# Verification
```sh
test -f src/definitely-missing-on-purpose.mjs
```
EOF

# ---------------------------------------------------------------------------
# Task 2 — dep-task. Depends on the root, so it never becomes ready.
# ---------------------------------------------------------------------------
cat > "$OUT/task-dep.md" <<'EOF'
---
kind: task
ref: dep-task
objective: discard-obj
title: Dependent task that never becomes ready
agent: generic@1
dependencies:
  - root-task
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Never executed by the Proof: only a `completed` dependency satisfies a
dependency edge, and root-task fails. This task exists to prove the discard
cascade reaches a `pending` dependent.
# Acceptance Criteria
- [ ] Extends the root task's output
# Verification
```sh
true
```
EOF

# Proof-only: scripted no-model turns. One bash tool call writes a file that is
# NOT the one Verification looks for, then a closing text turn. The workspace
# change is real (so the run reaches the verification gate) but the gate fails.
cat > "$OUT/.fake-agent.json" <<'EOF'
[
  {
    "toolCalls": [
      {
        "name": "bash",
        "arguments": { "command": "mkdir -p src && printf '// wrong file on purpose\\n' > src/not-the-expected-file.mjs" }
      }
    ]
  },
  { "text": "Wrote src/not-the-expected-file.mjs" }
]
EOF
