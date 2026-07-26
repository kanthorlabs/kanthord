#!/usr/bin/env bash
# make-transplant-graph.sh — assemble the deterministic transplant-proof package
# used by EPIC 007.14 (deterministic stale-candidate transplant, no-model rebuild).
# No model, no network: each task runs through the real CLI daemon with the
# KANTHORD_FAKE_AGENT seam (see src/main.ts), whose scripted bash turn overwrites
# src/f.mjs so the run gates as a `candidate` and can be landed by `approve task`.
#
# Usage: scripts/e2e/make-transplant-graph.sh <out-dir>
#
# The proof needs three sibling candidates that edit ONE file's regions
# differently, all built from the SAME base (before any land):
#   - root            → edits the TOP region     (export const A=…)
#   - non-overlap sib → edits the BOTTOM region  (export const Z=…)
#   - overlap sib     → edits the TOP region     (same lines as root)
# After `approve task <root>` moves the base, transplanting the non-overlap
# sibling onto the moved base merges cleanly (different hunk → no model), while
# the overlap sibling conflicts on the top region and falls back to a model
# rebuild. The seed file (src/f.mjs = A=1 / "// ---" / Z=1) is created by the
# EPIC Proof block itself, not here (mirrors make-landing-graph.sh's split).
#
# DESIGN CHOICE — per-task scripted turns.
# The fake session factory (src/agent-runner/fake-session.ts) serves turns to
# every task, and the per-task workspace dir is a ULID (no ref/title reaches the
# bash turn), so a single branching bash command CANNOT distinguish the three
# siblings. We therefore use the fake seam's KEYED form: `.fake-agent.json` is a
# JSON object mapping each task's exact title → that task's FakeTurn[]. The
# runner threads the task title into ProviderSessionFactory.for() and the fake
# factory selects turns by title (falling back to a "*" default). This is the
# smaller, backward-compatible change: a plain FakeTurn[] still serves every task
# identically, as before.
#
# All three tasks are dependency-free so the FIRST `run daemon --until-idle`
# builds all three candidates from the same base (a repository-bound task that
# produces a candidate holds at awaiting_confirmation, not completed, so a
# dependent would stay blocked — run-next-task.ts). The root sorts first by file
# name so it takes the smallest (monotonic) ULID and is the task the Proof
# selects with `find(t => t.dependencies.length === 0)`.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-transplant-graph.sh <out-dir>}"
mkdir -p "$OUT"

# Exact task titles — these are the .fake-agent.json keys AND the strings the
# EPIC Proof matches with /non-overlap/i and /overlap/i (and !/non-overlap/i).
ROOT_TITLE="Root task - move base top region"
NONOVERLAP_TITLE="Sibling non-overlap bottom region"
OVERLAP_TITLE="Sibling overlap top region"

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: transplant-init
name: Deterministic stale-candidate transplant
bindings:
  source: repository
  provider: ai_provider
  cred: credential
---
EOF

cat > "$OUT/objective.md" <<'EOF'
---
kind: objective
ref: transplant-obj
initiative: transplant-init
name: Transplant siblings onto a moved base
---
EOF

# ---------------------------------------------------------------------------
# Task 1 — root (sorts first → smallest ULID → the Proof's zero-dep root).
# Edits the TOP region so landing it moves the base out from under the siblings.
# ---------------------------------------------------------------------------
cat > "$OUT/task-1-root.md" <<EOF
---
kind: task
ref: root-task
objective: transplant-obj
title: ${ROOT_TITLE}
agent: generic@1
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Edit the TOP region of \`src/f.mjs\` (the \`export const A\` line). This is the
change that, once approved and landed, moves the base the sibling candidates
were built on.
# Acceptance Criteria
- [ ] \`src/f.mjs\` remains valid ES module syntax
# Verification
\`\`\`sh
node --check src/f.mjs
\`\`\`
EOF

# ---------------------------------------------------------------------------
# Task 2 — non-overlapping sibling. Edits the BOTTOM region only, so a 3-way
# transplant onto the moved base (whose only change is the TOP region) merges
# cleanly with no model.
# ---------------------------------------------------------------------------
cat > "$OUT/task-2-nonoverlap.md" <<EOF
---
kind: task
ref: sib-nonoverlap
objective: transplant-obj
title: ${NONOVERLAP_TITLE}
agent: generic@1
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Edit ONLY the BOTTOM region of \`src/f.mjs\` (the \`export const Z\` line), leaving
the TOP region untouched, so this candidate transplants cleanly onto a base that
changed only the TOP region.
# Acceptance Criteria
- [ ] \`src/f.mjs\` remains valid ES module syntax
# Verification
\`\`\`sh
node --check src/f.mjs
\`\`\`
EOF

# ---------------------------------------------------------------------------
# Task 3 — overlapping sibling. Edits the SAME TOP region as the root, so a
# 3-way transplant onto the moved base textually conflicts and must fall back to
# a full model rebuild.
# ---------------------------------------------------------------------------
cat > "$OUT/task-3-overlap.md" <<EOF
---
kind: task
ref: sib-overlap
objective: transplant-obj
title: ${OVERLAP_TITLE}
agent: generic@1
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Edit the TOP region of \`src/f.mjs\` (the \`export const A\` line) — the same
region the root changes — so this candidate conflicts when transplanted onto the
moved base and falls back to a model rebuild.
# Acceptance Criteria
- [ ] \`src/f.mjs\` remains valid ES module syntax
# Verification
\`\`\`sh
node --check src/f.mjs
\`\`\`
EOF

# ---------------------------------------------------------------------------
# Keyed scripted turns (KANTHORD_FAKE_AGENT). Each task's bash turn rewrites the
# whole file deterministically from the known seed (A=1 / "// ---" / Z=1):
#   root      → A=2 (top changed)
#   non-overlap→ Z=9 (bottom changed, top untouched → clean transplant)
#   overlap   → A=7 (top changed, same lines as root → conflict → model rebuild)
# ---------------------------------------------------------------------------
cat > "$OUT/.fake-agent.json" <<EOF
{
  "${ROOT_TITLE}": [
    {
      "toolCalls": [
        {
          "name": "bash",
          "arguments": { "command": "mkdir -p src && printf 'export const A=2;\\\\n// ---\\\\nexport const Z=1;\\\\n' > src/f.mjs" }
        }
      ]
    },
    { "text": "root edited the top region" }
  ],
  "${NONOVERLAP_TITLE}": [
    {
      "toolCalls": [
        {
          "name": "bash",
          "arguments": { "command": "mkdir -p src && printf 'export const A=1;\\\\n// ---\\\\nexport const Z=9;\\\\n' > src/f.mjs" }
        }
      ]
    },
    { "text": "non-overlap sibling edited the bottom region" }
  ],
  "${OVERLAP_TITLE}": [
    {
      "toolCalls": [
        {
          "name": "bash",
          "arguments": { "command": "mkdir -p src && printf 'export const A=7;\\\\n// ---\\\\nexport const Z=1;\\\\n' > src/f.mjs" }
        }
      ]
    },
    { "text": "overlap sibling edited the top region" }
  ]
}
EOF
