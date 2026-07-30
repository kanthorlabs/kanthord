#!/usr/bin/env bash
# make-025-execution-graph.sh — author the two graph packages EPIC 025's Proof needs.
#
# Usage: scripts/e2e/make-025-execution-graph.sh <out-dir> <gate-file>
#
# Writes TWO importable packages under <out-dir>:
#
#   probe/   "025 probe" — four tasks in a CHAIN (p1 → p2 → p3 → p4). Never
#            paused. Each completion is PROOF that the daemon performed another
#            enqueue+dispatch cycle. A chain (not four independent tasks) is
#            deliberate: exactly one probe task is ready at a time, so a probe
#            completion is a fresh scan and not a backlog draining.
#
#   gated/   "025 gated" — three tasks in a chain: gate-a → after-a → gate-b.
#            Imported PAUSED. `gate-a`'s bash turn BLOCKS until <gate-a-file>
#            exists, which is how the Proof holds a task in flight while it sends
#            a pause. `after-a` is the task a pause must hold back. `gate-b`
#            blocks on <gate-b-file> so the Proof can send SIGTERM with a task
#            genuinely in flight — otherwise the drain assertion only proves an
#            idle shutdown.
#
# Why a blocking bash turn and not a gate in mock-openai-completions.mjs: the pi
# agent makes one provider call per TURN, so a single gate file checked inside the
# provider mock latches — releasing turn 1 releases every later turn too, and
# `jobs.status='running'` proves only that a job was claimed, never that a
# provider request reached the barrier. A tool call is the exact point where the
# run is provably in flight, and `abandon-run-proof.sh` already relies on the same
# KANTHORD_FAKE_AGENT bash-turn seam.
#
# The gate path is BAKED INTO the JSON at generation time rather than read from
# the environment: the tool call runs inside the agent's execution environment,
# and an absolute literal removes any dependence on env inheritance.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-025-execution-graph.sh <out-dir> <gate-a-file> <gate-b-file>}"
GATE="${2:?usage: make-025-execution-graph.sh <out-dir> <gate-a-file> <gate-b-file>}"
GATE_B="${3:?usage: make-025-execution-graph.sh <out-dir> <gate-a-file> <gate-b-file>}"
mkdir -p "$OUT/probe" "$OUT/gated"

# ---------------------------------------------------------------------------
# probe/ — the scan witness
# ---------------------------------------------------------------------------
cat > "$OUT/probe/initiative.md" <<'EOF'
---
kind: initiative
ref: probe-init
name: 025 probe
bindings:
  source: repository
---
EOF

cat > "$OUT/probe/objective.md" <<'EOF'
---
kind: objective
ref: probe-obj
initiative: probe-init
name: daemon scan witnesses
---
EOF

for n in 1 2 3 4; do
  prev=""
  [ "$n" -gt 1 ] && prev="dependencies: [probe-$((n - 1))]"
  cat > "$OUT/probe/task-p$n.md" <<EOF
---
kind: task
ref: probe-$n
objective: probe-obj
title: probe $n
agent: generic@1
$prev
context:
  source: source
---
# Instructions
Write the marker file for probe $n.
# Acceptance Criteria
- [ ] \`src/probe-$n.mjs\` exists and is valid ES module syntax
# Verification
\`\`\`sh
node --check src/probe-$n.mjs
\`\`\`
EOF
done

# ---------------------------------------------------------------------------
# gated/ — the pause subject
# ---------------------------------------------------------------------------
cat > "$OUT/gated/initiative.md" <<'EOF'
---
kind: initiative
ref: gated-init
name: 025 gated
bindings:
  source: repository
---
EOF

cat > "$OUT/gated/objective.md" <<'EOF'
---
kind: objective
ref: gated-obj
initiative: gated-init
name: pause subject
---
EOF

cat > "$OUT/gated/task-gate-a.md" <<'EOF'
---
kind: task
ref: gate-a
objective: gated-obj
title: gate a
agent: generic@1
context:
  source: source
---
# Instructions
Write the marker file for gate a.
# Acceptance Criteria
- [ ] `src/gate-a.mjs` exists and is valid ES module syntax
# Verification
```sh
node --check src/gate-a.mjs
```
EOF

cat > "$OUT/gated/task-after-a.md" <<'EOF'
---
kind: task
ref: after-a
objective: gated-obj
title: after a
agent: generic@1
dependencies: [gate-a]
context:
  source: source
---
# Instructions
Write the marker file for after a.
# Acceptance Criteria
- [ ] `src/after-a.mjs` exists and is valid ES module syntax
# Verification
```sh
node --check src/after-a.mjs
```
EOF

cat > "$OUT/gated/task-gate-b.md" <<'EOF'
---
kind: task
ref: gate-b
objective: gated-obj
title: gate b
agent: generic@1
dependencies: [after-a]
context:
  source: source
---
# Instructions
Write the marker file for gate b.
# Acceptance Criteria
- [ ] `src/gate-b.mjs` exists and is valid ES module syntax
# Verification
```sh
node --check src/gate-b.mjs
```
EOF

# ---------------------------------------------------------------------------
# ONE merged keyed script for BOTH packages.
#
# KANTHORD_FAKE_AGENT names a single file per process, and the daemon runs both
# initiatives, so the map must cover every task title in one file. Titles are
# unique across the two packages, which is why the keyed form works here.
#
# `gate a`'s FIRST turn blocks on the gate file, so the run is provably in flight
# at a tool-call boundary. The wait is BOUNDED (600 × 0.1s = 60s) so a missing
# release can never hang the Proof — it fails the phase instead, and the trailing
# `test -f` makes a timeout a FAILED tool call rather than a silent pass.
# ---------------------------------------------------------------------------
cat > "$OUT/.fake-agent.json" <<EOF
{
  "probe 1": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const p=1;\\\\n' > src/probe-1.mjs" } } ] },
    { "text": "probe 1 done" }
  ],
  "probe 2": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const p=2;\\\\n' > src/probe-2.mjs" } } ] },
    { "text": "probe 2 done" }
  ],
  "probe 3": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const p=3;\\\\n' > src/probe-3.mjs" } } ] },
    { "text": "probe 3 done" }
  ],
  "probe 4": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const p=4;\\\\n' > src/probe-4.mjs" } } ] },
    { "text": "probe 4 done" }
  ],
  "gate a": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "i=0; while [ ! -f '$GATE' ] && [ \$i -lt 600 ]; do sleep 0.1; i=\$((i+1)); done; test -f '$GATE'" } } ] },
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const g=1;\\\\n' > src/gate-a.mjs" } } ] },
    { "text": "gate a done" }
  ],
  "after a": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const a=1;\\\\n' > src/after-a.mjs" } } ] },
    { "text": "after a done" }
  ],
  "gate b": [
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "i=0; while [ ! -f '$GATE_B' ] && [ \$i -lt 600 ]; do sleep 0.1; i=\$((i+1)); done; test -f '$GATE_B'" } } ] },
    { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const b=1;\\\\n' > src/gate-b.mjs" } } ] },
    { "text": "gate b done" }
  ]
}
EOF

echo "025 graph packages written to $OUT (gate: $GATE)"
