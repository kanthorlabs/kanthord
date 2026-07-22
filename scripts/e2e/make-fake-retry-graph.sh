#!/usr/bin/env bash
# make-fake-retry-graph.sh — author a minimal single-task graph that runs on the
# FakeRunner (agent: fake@1), for EPIC 007.9 Proof B (provider transient-retry).
#
# Usage: scripts/e2e/make-fake-retry-graph.sh <out-dir>
#
# fake@1 is NOT in EXECUTOR_BINDING_SPECS, so it requires no repository /
# ai_provider / credential context — the graph declares no bindings and the
# import needs no --bind flags. The single root task has no dependencies, so the
# daemon claims and runs it immediately. On success FakeRunner returns
# `completed` (it produces no landing candidate), so the proof asserts the task
# reaches `completed` — the shipped fake-runner contract exercised by
# `--fail-transient` (see src/apps/cli/daemon.test.ts, 007.9 S2 end-to-end).
set -euo pipefail

OUT="${1:?usage: make-fake-retry-graph.sh <out-dir>}"
mkdir -p "$OUT"

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: fake-retry-init
name: Provider transient-retry proof
---
EOF

cat > "$OUT/objective.md" <<'EOF'
---
kind: objective
ref: fake-retry-obj
initiative: fake-retry-init
name: Retry a transient provider failure
---
EOF

cat > "$OUT/task-root.md" <<'EOF'
---
kind: task
ref: retry-root
objective: fake-retry-obj
title: Root task that survives transient provider failures
agent: fake@1
---
# Instructions
Deterministic no-model task executed by the FakeRunner. When
`--fail-transient <id>:<count>` targets this task, the runner returns a
transient-classified failure the first <count> times, then succeeds.
# Acceptance Criteria
- [ ] The task reaches a terminal success state after its transient failures are retried
# Verification
```sh
true
```
EOF
