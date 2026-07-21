#!/usr/bin/env bash
# make-landing-graph.sh — assemble the deterministic landing-proof package used
# by EPIC 007.3 Proof Part A. No model, no network: the ROOT task runs through
# the real CLI daemon with the KANTHORD_FAKE_AGENT seam (see src/main.ts), whose
# scripted bash turn writes a fixed file into the workspace so the run gates as a
# `candidate` and can be landed by `approve task`.
#
# Usage: scripts/e2e/make-landing-graph.sh <out-dir>
#
# The graph package itself is the real TODO-API feature graph authored by
# make-todo-graph.sh (5 endpoint tasks; `create-task` is the root — the others
# depend on it, so only `create-task` runs in the no-model daemon pass). This
# script adds the two proof-only files on top:
#   .expected-output-path   the repo-relative path the root task lands
#   .fake-agent.json         scripted FakeTurn[] for KANTHORD_FAKE_AGENT
#
# The fake turn writes `src/todo.mjs` (valid JS) so the root task's lightweight
# verification (`test -f src/todo.mjs`) passes deterministically without a model.
set -euo pipefail

OUT="${1:?usage: make-landing-graph.sh <out-dir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Author the TODO-API graph package (initiative + objective + 5 tasks).
"$HERE/make-todo-graph.sh" "$OUT"

# 2. Proof-only: the repo-relative file the root task creates and that must land
#    on the canonical branch.
printf '%s' "src/todo.mjs" > "$OUT/.expected-output-path"

# 3. Proof-only: scripted no-model turns. One bash tool call writes a deterministic
#    valid-JS stub (the workspace change → candidate), then a closing text turn.
cat > "$OUT/.fake-agent.json" <<'EOF'
[
  {
    "toolCalls": [
      {
        "name": "bash",
        "arguments": { "command": "mkdir -p src && printf 'import http from \"node:http\";\\nconst tasks = new Map();\\nhttp.createServer((req, res) => { res.end(\"todo api\"); }).listen(0);\\n' > src/todo.mjs" }
      }
    ]
  },
  { "text": "Created src/todo.mjs" }
]
EOF
