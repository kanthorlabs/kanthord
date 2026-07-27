#!/usr/bin/env bash
# make-verify-fail-graph.sh — assemble the deterministic verify-fail package
# used by EPIC 008.4 Proof Part C. No model, no network: the ROOT task runs
# through the real CLI daemon with the KANTHORD_FAKE_AGENT seam (see src/main.ts),
# but the scripted bash turn writes a file to a WRONG path so the root task's
# lightweight verification (`test -f src/todo.mjs`) fails. The failure is
# task-level (verification), NOT a provider error — and MUST NOT trigger a
# `provider.failover` event (Story C: the failover branch is gated on
# `result.providerError === true`; a verify-fail result leaves that flag unset).
#
# Usage: scripts/e2e/make-verify-fail-graph.sh <out-dir>
#
# This is a deliberate mirror of make-landing-graph.sh's structure: delegate to
# make-todo-graph.sh, then write the two proof-only files. The only behavioural
# difference from make-landing-graph.sh is that the root task's bash turn
# writes to `src/wrong.mjs` (not `src/todo.mjs`) — so the same root task that
# passes verification in the landing proof fails it here, deterministically.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-verify-fail-graph.sh <out-dir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Author the TODO-API graph package (same as make-landing-graph.sh).
"$HERE/make-todo-graph.sh" "$OUT"

# 2. Proof-only: the path the root task expects (unchanged — verification is the
#    same `test -f src/todo.mjs`; we just arrange for the file NOT to exist).
printf '%s' "src/todo.mjs" > "$OUT/.expected-output-path"

# 3. Proof-only: scripted no-model turns. The bash tool call writes a file to
#    the WRONG path (src/wrong.mjs, not src/todo.mjs), so the root task's
#    lightweight verification (`test -f src/todo.mjs`) fails deterministically.
#    The fake session completes successfully (it returns a normal
#    fauxAssistantMessage turn) — the failure happens at verification, with
#    `providerError` unset, exercising Story C's no-failover guard.
cat > "$OUT/.fake-agent.json" <<'EOF'
[
  {
    "toolCalls": [
      {
        "name": "bash",
        "arguments": { "command": "mkdir -p src && printf 'export const wrong=1;\\n' > src/wrong.mjs" }
      }
    ]
  },
  { "text": "Wrote src/wrong.mjs (not src/todo.mjs — verification will fail)" }
]
EOF
