#!/usr/bin/env bash
# publish-idempotency-proof.sh — EPIC 007.16 Proof Part 2 (deterministic, no
# model, no network).
#
# The discard graph of Part 1 never publishes, so the publish-idempotency and
# event-attribution claims need a SUCCESSFULLY LANDED initiative. This script
# drives the smallest such flow (1 initiative → 1 objective → 1 task) through the
# REAL CLI to `landed`, then proves:
#   7.  first publish succeeds
#   8.  re-publish is an idempotent SUCCESS with a distinct `already published` message
#   9.  ...and appends NO second `repository.published` event
#   10. the event is attributable to its repository (`repositoryId` subject)
#   11. and the text renderer no longer prints `undefined`
#
# Usage: scripts/e2e/publish-idempotency-proof.sh
#
# Assertion wording follows the REAL program: `publish repository` puts the OID on
# stdout and its human line on STDERR (commands/publish/repository.ts:28-37),
# while the `already published @<oid>` line goes to stdout (:43). Counts are
# compared with `test`, not `wc -l | grep -qx`, because BSD `wc` left-pads.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name publish-proof | head -1)

# Bare origin seeded with one commit on the configured branch + the canonical mirror.
ORIGIN="$(mktemp -d)/origin.git"; git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)/seed"; git clone -q "$ORIGIN" "$SEED" 2>/dev/null
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
MIRROR="$(mktemp -d)/mirror"

REPO=$(node src/main.ts create repository --project "$PROJECT" --name r \
        --remote-url "file://$ORIGIN" --branch main --auth ambient \
        --path "$MIRROR" | head -1)

# generic@1 now requires repository context only — the daemon auto-resolves the
# provider chain from the project's registered providers (008.3). No context
# binding is needed, but the chain must be non-empty or every task fails with
# "no AI provider available for project". Story D binds this setup to
# `register` + `assign`: registration alone would also work (the global default
# is the chain tail), but `assign` is the documented project operator flow and
# is what 008.3 actually resolves. KANTHORD_FAKE_AGENT replaces the session
# factory, so this value is never read.
DUMMY_VALUE="$(mktemp -d)/token"; printf 'dummy' > "$DUMMY_VALUE"
PROV_E2E=$(node src/main.ts register ai-provider --name e2e --provider openai-codex \
        --model gpt-5.6-sol --value-file "$DUMMY_VALUE" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV_E2E" >/dev/null

# Smallest graph that can reach `landed`: one objective, one task. Authored here
# rather than in a make-*.sh because it is used by this proof only.
GRAPH="$(mktemp -d)/graph"; mkdir -p "$GRAPH"
cat > "$GRAPH/initiative.md" <<'EOF'
---
kind: initiative
ref: publish-init
name: Publish idempotency proof
bindings:
  source: repository
---
EOF
cat > "$GRAPH/objective.md" <<'EOF'
---
kind: objective
ref: publish-obj
initiative: publish-init
name: Land one task so the initiative can be published
---
EOF
cat > "$GRAPH/task-one.md" <<'EOF'
---
kind: task
ref: publish-task
objective: publish-obj
title: Write the deterministic stub the verification looks for
agent: generic@1
context:
  source: source
---
# Instructions
Deterministic no-model task: the scripted turn writes `src/todo.mjs`.
# Acceptance Criteria
- [ ] `src/todo.mjs` exists
# Verification
```sh
test -f src/todo.mjs
```
EOF
cat > "$GRAPH/.fake-agent.json" <<'EOF'
[
  {
    "toolCalls": [
      {
        "name": "bash",
        "arguments": { "command": "mkdir -p src && printf 'export const todo = true;\\n' > src/todo.mjs" }
      }
    ]
  },
  { "text": "Created src/todo.mjs" }
]
EOF

node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
        --bind source="$REPO" >/dev/null
INIT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH")
OBJ=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).refToId.objectives["publish-obj"])' "$GRAPH")
# Story 5 (012) — required `--expected-commit` on every objective verdict.
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
obj_oid() { node src/main.ts get objective --id "$1" --json | jv 'v.commitOid'; }

export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200

OBJ_OID=$(obj_oid "$OBJ"); test -n "$OBJ_OID"
node src/main.ts approve objective --id "$OBJ" --expected-commit "$OBJ_OID" >/dev/null
test "$(node src/main.ts get initiative --id "$INIT" | sed -n 's/^status: //p')" = "landed"

BR="kanthord/init/$INIT"

# 7) first publish succeeds. Captured ONCE — a second invocation would already be
#    the idempotent path. The OID goes to stdout, the human line to stderr.
ERR_FIRST="$(mktemp)"
OID_FIRST=$(node src/main.ts publish repository --repository "$REPO" --branch "$BR" 2>"$ERR_FIRST")
grep -q 'repository published' "$ERR_FIRST"
test -n "$OID_FIRST"

# 8) re-publish is an idempotent SUCCESS with a distinct message, exit 0 — and
#    idempotent in its OUTPUT too: stdout stays the OID, so `OID=$(publish …)` is
#    safe to re-run. The human line goes to stderr.
ERR_AGAIN="$(mktemp)"
OID_AGAIN=$(node src/main.ts publish repository --repository "$REPO" --branch "$BR" 2>"$ERR_AGAIN")
grep -q 'already published' "$ERR_AGAIN"
test "$OID_AGAIN" = "$OID_FIRST"

# 9) ...and emits NO second event.
EVENTS=$(node src/main.ts list event --after 0 --limit 1000 --json 2>/dev/null)
test "$(printf '%s' "$EVENTS" | grep -o '"type":"repository.published"' | wc -l | tr -d ' ')" -eq 1

# 10) the event is attributable to its repository.
printf '%s' "$EVENTS" | grep -q "\"type\":\"repository.published\",\"repositoryId\":\"$REPO\""

# 11) and the text renderer no longer prints `undefined`. The text feed writes to
#     stderr, so capture it.
node src/main.ts list event --after 0 --limit 1000 2>&1 \
        | grep 'repository.published' | grep -qv undefined

echo "007.16 PROOF PART 2 OK (publish)"
