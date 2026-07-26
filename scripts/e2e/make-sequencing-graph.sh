#!/usr/bin/env bash
# make-sequencing-graph.sh — author the graph packages used by EPIC 007.17's
# Proof (scripts/e2e/sequencing-proof.sh). No model, no network: every task runs
# through the real CLI daemon with the KANTHORD_FAKE_AGENT seam (see src/main.ts).
#
# Usage: scripts/e2e/make-sequencing-graph.sh <out-dir>
#
# Emits THREE packages under <out-dir>:
#
#   init-a              1 initiative / 1 objective / 1 task. The prerequisite.
#   init-b              1 initiative / 1 objective / 1 task. Declares NO `after:` —
#                       the Proof sequences it after init-a with
#                       `add initiative-dependency`, which is the real
#                       "2.1 before 3" case: both initiatives already exist, and a
#                       package cannot name the other initiative's ULID anyway.
#   two-obj             1 initiative / 3 objectives:
#                         obj-1   (task obj1-task)
#                         obj-1b  (task obj1b-task)
#                         obj-2   `after: [obj-1, obj-1b]` (task obj2-task)
#                       TWO prerequisites on purpose: `after:` is a SET, so a
#                       one-element list cannot demonstrate canonicalisation —
#                       reversing it is a no-op, and a reorder check on it would
#                       pass even if sorting were never implemented.
#
# The two APPLY-mode variants (reordered / edge-removed) are NOT emitted here.
# `--apply` needs the ULIDs and the `.kanthord-export.json` baseline that only the
# `--create` import writes, so the Proof derives them by copying `two-obj` AFTER
# importing it and rewriting obj-2's `after:` line in the copy. See
# `derive_variant` in scripts/e2e/sequencing-proof.sh.
#
# Bindings: generic@1 requires repository context only, so every initiative
# declares only the source alias and the import needs `--bind source=…` only.
# Under the fake-agent seam the provider/credential values are ignored (they only
# satisfy the runner's context-binding check) — a dummy pair suffices.
#
# Every task's Verification is `test -f src/marker.mjs`, which the single scripted
# turn satisfies, so each task gates as a `candidate` deterministically.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-sequencing-graph.sh <out-dir>}"

# ---------------------------------------------------------------------------
# Shared writers. $1 = package dir.
# ---------------------------------------------------------------------------

write_bindings_initiative() { # $1=dir $2=ref $3=name
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

write_objective() { # $1=dir $2=file $3=ref $4=initiative-ref $5=name [$6=after-list]
  {
    echo "---"
    echo "kind: objective"
    echo "ref: $3"
    echo "initiative: $4"
    echo "name: $5"
    if [ -n "${6:-}" ]; then
      echo "after: [$6]"
    fi
    echo "---"
  } > "$1/$2"
}

write_task() { # $1=dir $2=file $3=ref $4=objective-ref $5=title
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
Deterministic no-model task: the scripted turn appends one marker line to
\`src/marker.mjs\`. Nothing else is required.
# Acceptance Criteria
- [ ] \`src/marker.mjs\` exists
# Verification
\`\`\`sh
test -f src/marker.mjs
\`\`\`
EOF
}

write_fake_agent() { # $1=dir
  cat > "$1/.fake-agent.json" <<'EOF'
[
  {
    "toolCalls": [
      {
        "name": "bash",
        "arguments": { "command": "mkdir -p src && printf '// kanthord sequencing marker\\n' >> src/marker.mjs" }
      }
    ]
  },
  { "text": "Appended one sequencing marker" }
]
EOF
}

# ---------------------------------------------------------------------------
# Package 1 — init-a. The prerequisite initiative.
# ---------------------------------------------------------------------------
write_bindings_initiative "$OUT/init-a" seq-init-a "Sequencing A (prerequisite)"
write_objective "$OUT/init-a" objective.md seq-obj-a seq-init-a "Objective A"
write_task "$OUT/init-a" task-a.md seq-task-a seq-obj-a "Sequencing A root task"
write_fake_agent "$OUT/init-a"

# ---------------------------------------------------------------------------
# Package 2 — init-b. The follow-up. Sequenced by CLI, not by the package.
# ---------------------------------------------------------------------------
write_bindings_initiative "$OUT/init-b" seq-init-b "Sequencing B (follow-up)"
write_objective "$OUT/init-b" objective.md seq-obj-b seq-init-b "Objective B"
write_task "$OUT/init-b" task-b.md seq-task-b seq-obj-b "Sequencing B root task"
write_fake_agent "$OUT/init-b"

# ---------------------------------------------------------------------------
# Package 3 — two-obj. Objective-level `after:` with TWO prerequisites.
# ---------------------------------------------------------------------------
write_bindings_initiative "$OUT/two-obj" seq-two-init "Sequencing objectives"
write_objective "$OUT/two-obj" objective-1.md  obj-1  seq-two-init "Objective one"
write_objective "$OUT/two-obj" objective-1b.md obj-1b seq-two-init "Objective one-b"
write_objective "$OUT/two-obj" objective-2.md  obj-2  seq-two-init "Objective two" "obj-1, obj-1b"
write_task "$OUT/two-obj" task-1.md  obj1-task  obj-1  "Objective one task"
write_task "$OUT/two-obj" task-1b.md obj1b-task obj-1b "Objective one-b task"
write_task "$OUT/two-obj" task-2.md  obj2-task  obj-2  "Objective two task"
write_fake_agent "$OUT/two-obj"
