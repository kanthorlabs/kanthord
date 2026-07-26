#!/usr/bin/env bash
# make-sha-graph.sh — author the deterministic graph package used by EPIC 007.18's
# Proof block. No model, no network, no repository: every task runs on `fake@1`,
# which is absent from EXECUTOR_BINDING_SPECS (binding-resolver.ts), so the
# initiative declares NO `bindings:` and no task carries `context:` — the import
# therefore needs no `--bind` flag. There is deliberately no `.fake-agent.json`:
# that file is the seam for the pi loop (src/main.ts), which `fake@1` never enters.
#
# Usage: scripts/e2e/make-sha-graph.sh <out-dir> [--add-new-task]
#
# Shape (3 tasks, one edge):
#   ran-task      no dependencies — the daemon runs it to `completed`. The Proof
#                 leaves its file untouched and asserts it classifies `unchanged`.
#   blocker-task  no dependencies — the Proof fails it on purpose through the
#                 daemon's `--fail <id>` flag.
#   idle-task     `dependencies: [blocker-task]` — stays `pending` forever because
#                 only a `completed` dependency satisfies an edge, and nothing
#                 cascades off a `failed` task (discard is explicit, EPIC 007.16).
#
# Three tasks, not two: `run daemon --until-idle` drains the queue, so two
# INDEPENDENT tasks would both reach `completed` and leave nothing `pending` for
# the Proof's `updated` and `drifted` cases.
#
# With `--add-new-task` the script writes ONLY `task-new.md` into an existing
# output dir and exits — it must not rewrite the other files, because the Proof
# calls it a second time on a directory whose manifest and stamped ids are live.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-sha-graph.sh <out-dir> [--add-new-task]}"
MODE="${2:-}"
mkdir -p "$OUT"

# ---------------------------------------------------------------------------
# Additive mode — the insert the Proof lands on an already-progressed
# initiative. Title is load-bearing: the Proof resolves the new id by matching
# this exact string in `list task --initiative --json`, because there is no
# `find task` subcommand.
# ---------------------------------------------------------------------------
if [ "$MODE" = "--add-new-task" ]; then
  cat > "$OUT/task-new.md" <<'EOF'
---
kind: task
ref: new-task
objective: sha-obj
title: Added after work already ran
agent: fake@1
---
# Instructions
Deterministic no-model task, inserted after the initiative already had work
reach a terminal state. It exists to prove a fresh node still lands.
# Acceptance Criteria
- [ ] The task lands on the live initiative and arrives `pending`
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
ref: sha-init
name: Content drift versus lifecycle progress
---
EOF

cat > "$OUT/objective.md" <<'EOF'
---
kind: objective
ref: sha-obj
initiative: sha-init
name: Classify a progressed task by content alone
---
EOF

# ---------------------------------------------------------------------------
# Task 1 — ran-task. Runs to `completed`; its file is never edited by cases 1-3.
# ---------------------------------------------------------------------------
cat > "$OUT/task-ran.md" <<'EOF'
---
kind: task
ref: ran-task
objective: sha-obj
title: Task that runs to completion
agent: fake@1
---
# Instructions
Deterministic no-model task. FakeRunner returns `completed` and produces no
landing candidate, so this task reaches a terminal state with no repository.
# Acceptance Criteria
- [ ] The task reaches `completed`
# Verification
```sh
true
```
EOF

# ---------------------------------------------------------------------------
# Task 2 — blocker-task. The Proof fails it via the daemon's `--fail <id>`.
# ---------------------------------------------------------------------------
cat > "$OUT/task-blocker.md" <<'EOF'
---
kind: task
ref: blocker-task
objective: sha-obj
title: Task the proof fails on purpose
agent: fake@1
---
# Instructions
Deterministic no-model task the Proof drives to `failed` through the daemon's
`--fail <id>` flag, so its dependent stays `pending`.
# Acceptance Criteria
- [ ] The task reaches `failed`
# Verification
```sh
true
```
EOF

# ---------------------------------------------------------------------------
# Task 3 — idle-task. Depends on the blocker, so it never becomes ready.
# ---------------------------------------------------------------------------
cat > "$OUT/task-idle.md" <<'EOF'
---
kind: task
ref: idle-task
objective: sha-obj
title: Idle task
agent: fake@1
dependencies:
  - blocker-task
---
# Instructions
Never executed by the Proof: only a `completed` dependency satisfies a
dependency edge, and blocker-task fails. This task stays `pending` so the Proof
has a live node for its `updated` and `drifted` cases.
# Acceptance Criteria
- [ ] Extends the blocker task's output
# Verification
```sh
true
```
EOF
