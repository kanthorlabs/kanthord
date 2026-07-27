#!/usr/bin/env bash
# landing-proof.sh — EPIC 007.3 Proof Part A (deterministic, no model, no network).
# Proves the full candidate→approve→land lifecycle through the REAL CLI against
# real git in temp dirs, using the KANTHORD_FAKE_AGENT executor seam.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name demo)

# Bare "home" remote seeded with one commit on the configured branch.
HOME_REMOTE="$(mktemp -d)/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$(mktemp -d)/seed"; git clone -q "$HOME_REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
BASE_SHA=$(git -C "$SEED" rev-parse HEAD)

# The repository keeps a CANONICAL LOCAL MIRROR at --path; landing updates that
# mirror's configured branch (007.3 = local landing only, no push). Same-repo
# dependents clone this mirror, so it IS the canonical branch.
MIRROR="$(mktemp -d)/mirror"
REPO=$(node src/main.ts create repository --project "$PROJECT" --name home \
        --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$MIRROR")

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

GRAPH="$(mktemp -d)/g"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
        --bind source="$REPO" >/dev/null
INIT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH")
OBJ=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).refToId.objectives["todo-api-obj"])' "$GRAPH")
# Story 5 (012) — required `--expected-commit` on every objective verdict. The
# client reads the candidate id from the real read surface (`get objective
# --json`) and echoes it back; never hard-code and never bypass the guard.
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
obj_oid() { node src/main.ts get objective --id "$1" --json | jv 'v.commitOid'; }
# Pick the ROOT task (create-task — "Create Task — POST /tasks"); the other four
# endpoint tasks depend on it.
TASK=$(node src/main.ts list task --initiative "$INIT" --json \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(t=>/Create Task/.test(t.title||"")).id))')

export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200

# 007.12 changed the integration unit from the TASK to the OBJECTIVE: a task that
# runs in an initiative clone carries a `workspace` binding, and RunNextTask
# completes such a task directly (run-next-task.ts:365-372) instead of holding it
# at awaiting_confirmation. The human gate moved to `approve objective`. This
# script asserts that current lifecycle; the old task-level candidate gate is only
# reachable for tasks with NO workspace binding.
test "$(node src/main.ts get task --id "$TASK" --json | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).status))')" = "completed"
test "$(node src/main.ts get objective --id "$OBJ" | sed -n 's/^status: //p')" = "awaiting_confirmation"
# Nothing integrated before approval: the initiative branch is not yet advanced.
INIT_BR="refs/heads/kanthord/init/$INIT"
git --git-dir="$MIRROR" cat-file -e "$INIT_BR:$(cat "$GRAPH"/.expected-output-path)" 2>/dev/null \
        && { echo "FAILED: output present on $INIT_BR before approve objective" >&2; exit 1; }
# `main` is never touched by a land: delivery to a remote is the separate,
# human-gated `publish repository` step (007.13 delivery contract).
test "$(git --git-dir="$MIRROR" rev-parse main)" = "$BASE_SHA"

OBJ_OID=$(obj_oid "$OBJ"); test -n "$OBJ_OID"
node src/main.ts approve objective --id "$OBJ" --expected-commit "$OBJ_OID" >/dev/null
test "$(node src/main.ts get objective --id "$OBJ" | sed -n 's/^status: //p')" = "integrated"
# The initiative branch in the bare managed home ADVANCED and now has the output.
git --git-dir="$MIRROR" cat-file -e "$INIT_BR:$(cat "$GRAPH"/.expected-output-path)"
# `main` STILL untouched — a local land is not a remote delivery.
test "$(git --git-dir="$MIRROR" rev-parse main)" = "$BASE_SHA"
# A7: base_commit recorded (canonical SHA), not null.
test "$(node src/main.ts get task --id "$TASK" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.baseCommit||""))')" != ""

echo "007.3 PROOF PART A OK"
