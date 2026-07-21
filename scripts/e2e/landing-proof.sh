#!/usr/bin/env bash
# landing-proof.sh — EPIC 007.3 Proof Part A (deterministic, no model, no network).
# Proves the full candidate→approve→land lifecycle through the REAL CLI against
# real git in temp dirs, using the KANTHORD_FAKE_AGENT executor seam.
set -euo pipefail
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

# generic@1 requires repository + ai_provider + credential context. Part A runs
# NO real model, so a DUMMY provider+credential suffices (the fake factory ignores them).
CREDVAL="$(mktemp)"; printf 'dummy-token' > "$CREDVAL"
CRED=$(node src/main.ts create credential --project "$PROJECT" --name c1 --provider openai-codex --value-file "$CREDVAL")
PROV=$(node src/main.ts create ai-provider --project "$PROJECT" --name p1 --provider openai-codex --model gpt-5.6-terra)

GRAPH="$(mktemp -d)/g"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
        --bind source="$REPO" --bind provider="$PROV" --bind cred="$CRED" >/dev/null
INIT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH")
# Pick the ROOT task (create-task — "Create Task — POST /tasks"); the other four
# endpoint tasks depend on it and stay pending in the no-model daemon pass.
TASK=$(node src/main.ts list task --initiative "$INIT" --json \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(t=>/Create Task/.test(t.title||"")).id))')

export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200

# Changed task must await confirmation with a candidate — NOT completed yet.
test "$(node src/main.ts get task --id "$TASK" --json | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).status))')" = "awaiting_confirmation"
# Canonical mirror branch still at BASE_SHA (nothing landed before approval).
test "$(git -C "$MIRROR" rev-parse main)" = "$BASE_SHA"

node src/main.ts approve task --id "$TASK"
test "$(node src/main.ts get task --id "$TASK" --json | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).status))')" = "completed"
# Canonical branch ADVANCED and now contains the task output.
NEW_SHA=$(git -C "$MIRROR" rev-parse main); test "$NEW_SHA" != "$BASE_SHA"
git -C "$MIRROR" cat-file -e "main:$(cat "$GRAPH"/.expected-output-path)"
# A7: base_commit recorded (canonical SHA), not null.
test "$(node src/main.ts get task --id "$TASK" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.baseCommit||""))')" != ""

echo "007.3 PROOF PART A OK"
