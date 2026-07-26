#!/usr/bin/env bash
# make-orphan-objective-graph.sh — author the graph package used by EPIC 007.19's
# Proof block. No model, no network, no repository: the tasks are `fake@1`, which
# is absent from EXECUTOR_BINDING_SPECS (binding-resolver.ts), so the initiative
# declares NO `bindings:` and no task carries `context:` — the import needs no
# `--bind` flag. No `.fake-agent.json`: that file is the pi-loop seam
# (src/main.ts) and `fake@1` never enters it. The Proof never runs the daemon —
# 007.19 is about PREFLIGHT classification, so no task needs to reach a terminal
# state.
#
# Usage: scripts/e2e/make-orphan-objective-graph.sh <out-dir> [--add-orphan]
#
# Default mode — the resolvable baseline:
#   initiative.md   ref: orphan-init
#   objective.md    ref: base-obj
#   task-base.md    ref: base-task, objective: base-obj
#
# With `--add-orphan` it writes ONLY the two orphan files into an existing output
# dir and exits, leaving the baseline files and the live manifest untouched:
#   objective-orphan.md  ref: orphan-obj   — a BRAND-NEW objective, no `id:`
#   task-orphan.md       ref: orphan-task, objective: orphan-obj
#
# That is the uncreatable-objective case: `--apply` cannot create an objective, so
# `orphan-obj` resolves to nothing and `orphan-task` cannot be parented.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-orphan-objective-graph.sh <out-dir> [--add-orphan]}"
MODE="${2:-}"
mkdir -p "$OUT"

# ---------------------------------------------------------------------------
# Additive mode — the orphan objective and the task that references it.
# Additive and idempotent: touching any baseline file here is a defect, because
# the Proof calls this on a directory whose manifest and stamped ids are live.
# ---------------------------------------------------------------------------
if [ "$MODE" = "--add-orphan" ]; then
  cat > "$OUT/objective-orphan.md" <<'EOF'
---
kind: objective
ref: orphan-obj
initiative: orphan-init
name: Objective authored after the initiative went live
---
EOF

  cat > "$OUT/task-orphan.md" <<'EOF'
---
kind: task
ref: orphan-task
objective: orphan-obj
title: Task parented to a brand-new objective
agent: fake@1
---
# Instructions
Deterministic no-model task whose objective does not exist in the database. The
apply must refuse and name the OBJECTIVE, not this task.
# Acceptance Criteria
- [ ] The apply is refused with the objective ref named
# Verification
```sh
true
```
EOF
  exit 0
fi

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: orphan-init
name: Applies that reference an uncreatable objective
---
EOF

cat > "$OUT/objective.md" <<'EOF'
---
kind: objective
ref: base-obj
initiative: orphan-init
name: The objective that really exists
---
EOF

# ---------------------------------------------------------------------------
# The baseline task. Stays `pending` (the daemon never runs) and is the subject
# of the Proof's final regression case: a fully resolvable package still applies.
# ---------------------------------------------------------------------------
cat > "$OUT/task-base.md" <<'EOF'
---
kind: task
ref: base-task
objective: base-obj
title: Base task
agent: fake@1
---
# Instructions
Deterministic no-model task on an objective that exists. Never executed by the
Proof; it exists so the Proof can prove a resolvable package still applies.
# Acceptance Criteria
- [ ] The task is created and can be retitled by a later apply
# Verification
```sh
true
```
EOF
