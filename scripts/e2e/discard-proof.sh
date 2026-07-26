#!/usr/bin/env bash
# discard-proof.sh — EPIC 007.16 Proof Part 1 (deterministic, no model, no network).
#
# Proves the failure-observability + terminal-discard claims through the REAL CLI
# against real git in temp dirs, using the KANTHORD_FAKE_AGENT executor seam:
#   1. a failed task explains itself      (`reason:` on `get task`)
#   2. discard from `failed` cascades     (root + dependent both `discarded`)
#   3. `discarded` is UNSUCCESSFUL        (objective + initiative terminal, no
#                                          `objective.integrated` event)
#   4. `reject objective` exists          (`--resolution` in `--help`)
#   5. approve on a terminal objective    (a conflict, not a fake success)
#   6. an unknown ref                     (typed one-line error, no stack trace)
#
# Usage: scripts/e2e/discard-proof.sh
#
# Why a script and not the epic's inline block: `generic@1` requires
# repository + ai_provider + credential context, the no-model path needs
# KANTHORD_FAKE_AGENT exported, and the bare origin must be seeded before
# `create repository` — three setup steps the epic's illustrative text omits.
# Assertion wording follows the REAL program: `UnknownReferenceError` renders
# uniformly as `no <kind> with id <ref>` (src/app/errors.ts:71), and the publish
# command writes its human line to stderr (commands/publish/repository.ts:33).
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name discard-proof | head -1)

# Bare origin seeded with one commit on the configured branch, plus the
# canonical local mirror the repository keeps at --path.
ORIGIN="$(mktemp -d)/origin.git"; git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)/seed"; git clone -q "$ORIGIN" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
MIRROR="$(mktemp -d)/mirror"

REPO=$(node src/main.ts create repository --project "$PROJECT" --name r \
        --remote-url "file://$ORIGIN" --branch main --auth ambient \
        --path "$MIRROR" | head -1)

# generic@1 requires repository + ai_provider + credential context. This proof
# runs NO real model, so a DUMMY provider+credential suffices (the fake session
# factory ignores them — they only satisfy the runner's binding check).
CREDVAL="$(mktemp)"; printf 'dummy-token' > "$CREDVAL"
CRED=$(node src/main.ts create credential --project "$PROJECT" --name c1 \
        --provider openai-codex --value-file "$CREDVAL" | head -1)
PROV=$(node src/main.ts create ai-provider --project "$PROJECT" --name p1 \
        --provider openai-codex --model gpt-5.6-terra | head -1)

GRAPH="$(mktemp -d)/graph"
scripts/e2e/make-discard-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
        --bind source="$REPO" --bind provider="$PROV" --bind cred="$CRED" >/dev/null

read_manifest() {
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));
           const p=process.argv[2].split(".");let v=m;for(const k of p)v=v[k];console.log(v)' "$GRAPH" "$1"
}
ROOT_TASK=$(read_manifest 'refToId.tasks.root-task')
DEP_TASK=$(read_manifest 'refToId.tasks.dep-task')
OBJ=$(read_manifest 'refToId.objectives.discard-obj')
INIT=$(read_manifest 'initiativeId')

export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200 || true

status_of() { node src/main.ts get "$1" --id "$2" | sed -n 's/^status: //p'; }

# 1) the failed task now EXPLAINS ITSELF.
test "$(status_of task "$ROOT_TASK")" = "failed"
node src/main.ts get task --id "$ROOT_TASK" | grep -q '^reason: VerificationFailedError'

# 2) discard from `failed` reaches a terminal state and CASCADES.
node src/main.ts reject task --id "$ROOT_TASK" --resolution discard \
        --reason 'unachievable' >/dev/null
test "$(status_of task "$ROOT_TASK")" = "discarded"
test "$(status_of task "$DEP_TASK")" = "discarded"

# 3) `discarded` is UNSUCCESSFUL — objective and initiative are terminal, and no
#    integration ever happened. `grep -c` on zero matches exits 1, so compare the
#    count with `test` instead of letting `set -e` abort the script.
test "$(status_of objective "$OBJ")" = "discarded"
test "$(status_of initiative "$INIT")" = "discarded"
EVENTS=$(node src/main.ts list event --after 0 --limit 1000 --json 2>/dev/null)
test "$(printf '%s' "$EVENTS" | grep -c '"type":"objective.integrated"' || true)" -eq 0

# 4) `reject objective` exists beside approve/retry.
node src/main.ts reject objective --help | grep -q -- '--resolution'

# 5) approve on a terminal objective is a CONFLICT, not a fake success: a
#    single-line mapped error at a non-zero exit, and never "objective integrated".
APPROVE_OUT=$(node src/main.ts approve objective --id "$OBJ" 2>&1 || true)
printf '%s' "$APPROVE_OUT" | grep -qv 'objective integrated'
printf '%s' "$APPROVE_OUT" | grep -q '^error: '
printf '%s' "$APPROVE_OUT" | grep -qv 'at ChildProcess'

# 6) an unknown ref is a typed one-line error, not a stack trace. The message is
#    UnknownReferenceError's uniform form (src/app/errors.ts:71), not "unknown branch".
PUB_OUT=$(node src/main.ts publish repository --repository "$REPO" \
        --branch nope/missing 2>&1 || true)
printf '%s' "$PUB_OUT" | grep -q 'no branch with id nope/missing'
printf '%s' "$PUB_OUT" | grep -qv 'at ChildProcess.exithandler'

echo "007.16 PROOF PART 1 OK (discard)"
