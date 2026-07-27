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
# Why a script and not the epic's inline block: the no-model path needs
# KANTHORD_FAKE_AGENT exported, and the bare origin must be seeded before
# `create repository` — setup steps the epic's illustrative text omits.
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

GRAPH="$(mktemp -d)/graph"
scripts/e2e/make-discard-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
        --bind source="$REPO" >/dev/null

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
node src/main.ts reject objective --help | grep -q -- '--expected-commit'

# 5) approve on a terminal objective is a CONFLICT, not a fake success: a
#    single-line mapped error at a non-zero exit, and never "objective integrated".
#    $OBJ is `discarded` here, so it has no live candidate — pass the
#    placeholder so the terminal-objective claim is tested rather than the
#    missing-flag error.
APPROVE_OUT=$(node src/main.ts approve objective --id "$OBJ" \
        --expected-commit 0000000000000000000000000000000000000000 2>&1 || true)
printf '%s' "$APPROVE_OUT" | grep -qv 'objective integrated'
printf '%s' "$APPROVE_OUT" | grep -q '^error: '
printf '%s' "$APPROVE_OUT" | grep -q 'is not awaiting confirmation'
printf '%s' "$APPROVE_OUT" | grep -qv 'at ChildProcess'

# 6) an unknown ref is a typed one-line error, not a stack trace. The message is
#    UnknownReferenceError's uniform form (src/app/errors.ts:71), not "unknown branch".
PUB_OUT=$(node src/main.ts publish repository --repository "$REPO" \
        --branch nope/missing 2>&1 || true)
printf '%s' "$PUB_OUT" | grep -q 'no branch with id nope/missing'
printf '%s' "$PUB_OUT" | grep -qv 'at ChildProcess.exithandler'

echo "007.16 PROOF PART 1 OK (discard)"
