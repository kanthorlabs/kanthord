#!/usr/bin/env bash
# make-initiative-graph.sh — author the initiative-branch-workflow graph package
# used by EPIC 007.12's Proof. No model, no network: tasks run through the real
# CLI daemon with the KANTHORD_FAKE_AGENT seam (see src/main.ts), whose scripted
# bash turn appends a deterministic line to a tracked file in the initiative
# clone so each task produces a real workspace change to squash.
#
# Usage: scripts/e2e/make-initiative-graph.sh <out-dir>
#
# Shape (1 initiative, 2 objectives, 2 sequential tasks each):
#   initiative init-wf                     bindings source/provider/cred
#   ├─ objective obj-A
#   │  ├─ task init-a-1  (root)
#   │  └─ task init-a-2  (deps: init-a-1)
#   └─ objective obj-B                     builds on A
#      ├─ task init-b-1  (deps: init-a-2)  ← cross-objective edge orders A's tasks before B's
#      └─ task init-b-2  (deps: init-b-1)
#
# The four tasks form one linear chain (init-a-1 → init-a-2 → init-b-1 →
# init-b-2), so a single `run daemon --until-idle` claims them one at a time in
# a stable serial order and squashes BOTH objectives (each to one commit, to
# awaiting_confirmation) in that one pass — objective B's squash parent chains
# onto objective A's commit via domain state, so their commits are ordered even
# though neither is integrated yet. Brokering into home happens later, one
# objective at a time, via `approve objective`. Every task uses generic@1 and
# binds three aliases (source/provider/cred) because generic@1 requires
# repository + ai_provider + credential context.
#
# The fake-agent turns are served identically to every `.for()` call
# (src/agent-runner/fake-session.ts) — NOT keyed per task — so the bash turn
# uses append (`>>`) semantics: each of the four sequential tasks appends one
# line to src/todo.mjs (which exists on the integration tip the clone was cut
# from), accumulating in order across the run. Verification is deliberately
# lightweight (`test -f src/todo.mjs`) so the same package runs with no model.
set -euo pipefail

OUT="${1:?usage: make-initiative-graph.sh <out-dir>}"
mkdir -p "$OUT"

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: init-wf-init
name: Initiative-branch workflow
bindings:
  source: repository
  provider: ai_provider
  cred: credential
---
EOF

# ---------------------------------------------------------------------------
# Objective A — first commit on the initiative branch
# ---------------------------------------------------------------------------
cat > "$OUT/objective-a.md" <<'EOF'
---
kind: objective
ref: init-wf-obj-a
initiative: init-wf-init
name: Objective A — first squashed commit
---
EOF

cat > "$OUT/task-a-1.md" <<'EOF'
---
kind: task
ref: init-a-1
objective: init-wf-obj-a
title: Objective A · step 1
agent: generic@1
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Append the objective-A step-1 marker line to `src/todo.mjs` in the initiative
clone. This is the root task of objective A.
# Acceptance Criteria
- [ ] `src/todo.mjs` gains one appended line
# Verification
```sh
test -f src/todo.mjs
```
EOF

cat > "$OUT/task-a-2.md" <<'EOF'
---
kind: task
ref: init-a-2
objective: init-wf-obj-a
title: Objective A · step 2
agent: generic@1
dependencies: [init-a-1]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Append the objective-A step-2 marker line to `src/todo.mjs`. Runs after
`init-a-1` (same objective, sequential).
# Acceptance Criteria
- [ ] `src/todo.mjs` gains one appended line
# Verification
```sh
test -f src/todo.mjs
```
EOF

# ---------------------------------------------------------------------------
# Objective B — second commit; builds on A (init-b-1 depends on init-a-2)
# ---------------------------------------------------------------------------
cat > "$OUT/objective-b.md" <<'EOF'
---
kind: objective
ref: init-wf-obj-b
initiative: init-wf-init
name: Objective B — second squashed commit
---
EOF

cat > "$OUT/task-b-1.md" <<'EOF'
---
kind: task
ref: init-b-1
objective: init-wf-obj-b
title: Objective B · step 1
agent: generic@1
dependencies: [init-a-2]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Append the objective-B step-1 marker line to `src/todo.mjs`. The cross-objective
dependency on `init-a-2` keeps objective A fully built (and integrated) before
objective B starts.
# Acceptance Criteria
- [ ] `src/todo.mjs` gains one appended line
# Verification
```sh
test -f src/todo.mjs
```
EOF

cat > "$OUT/task-b-2.md" <<'EOF'
---
kind: task
ref: init-b-2
objective: init-wf-obj-b
title: Objective B · step 2
agent: generic@1
dependencies: [init-b-1]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Append the objective-B step-2 marker line to `src/todo.mjs`. Runs after
`init-b-1` (same objective, sequential).
# Acceptance Criteria
- [ ] `src/todo.mjs` gains one appended line
# Verification
```sh
test -f src/todo.mjs
```
EOF

# ---------------------------------------------------------------------------
# Scripted no-model turns. One bash tool call APPENDS a deterministic marker
# line to the tracked src/todo.mjs, then a closing text turn. Served identically
# to every task, so the four sequential tasks accumulate four appended lines
# (two per objective) — each a real workspace change to squash into one commit.
# ---------------------------------------------------------------------------
cat > "$OUT/.fake-agent.json" <<'EOF'
[
  {
    "toolCalls": [
      {
        "name": "bash",
        "arguments": { "command": "printf '// kanthord initiative-workflow step\\n' >> src/todo.mjs" }
      }
    ]
  },
  { "text": "Appended one step marker to src/todo.mjs" }
]
EOF
