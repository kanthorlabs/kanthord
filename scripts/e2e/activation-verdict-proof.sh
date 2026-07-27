#!/usr/bin/env bash
# activation-verdict-proof.sh — EPIC 012 Proof (deterministic, no model, no
# network) through the real CLI with the KANTHORD_FAKE_AGENT seam.
#
# Proves (1) a graph can be imported INERT and started only by an explicit act,
# and (2) a verdict carrying a stale candidate id is refused and changes nothing.
#
# Scope honesty: a sequential CLI proof shows REFUSAL and NO STATE CHANGE. That
# the comparison happens inside the write transaction is proven hermetically in
# `npm run verify`, not here — a CLI cannot interleave two writers.
#
# Run from the repo root. Against the CURRENT tree every phase fails.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

PD="$(mktemp -d)"; trap 'rm -rf "$PD"' EXIT
export KANTHORD_DB="$PD/kanthord.db"
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
# Run a command that MUST exit non-zero. The ERR trap is detached for the call:
# with `set -E` bash fires it inside functions even under `set +e`, which would
# print a misleading FAILED line for an expected failure.
expect_fail() { local out="$1"; shift
  trap - ERR; set +e; "$@" >"$out" 2>&1; local rc=$?; set -e
  trap 'echo "FAILED: $0 line $LINENO" >&2' ERR
  [ "$rc" -ne 0 ] || { echo "FAILED: expected non-zero exit from: $*" >&2; exit 1; }; }

# Bounded daemon pass: `--until-idle` must never hang this proof. A daemon still
# alive after the deadline is itself a failure (a paused initiative must not keep
# the daemon busy).
daemon_pass() {
  node src/main.ts run daemon --until-idle --poll-interval 200 >"$PD/daemon.log" 2>&1 &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.2; waited=$((waited+1))
    if [ "$waited" -gt 150 ]; then   # 30s
      kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
      echo "FAILED: run daemon --until-idle did not finish in 30s" >&2; return 1
    fi
  done
  wait "$pid"
}

node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name demo)

HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO=$(node src/main.ts create repository --project "$PROJECT" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror")
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV=$(node src/main.ts register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null

# ── Phase A — `create initiative --paused` reports two independent axes ────────
INIT_A=$(node src/main.ts create initiative --project "$PROJECT" --name paused-one --paused)
test "$(node src/main.ts get initiative --id "$INIT_A" --json | jv 'v.paused')" = "true"
test "$(node src/main.ts get initiative --id "$INIT_A" --json | jv 'v.status')" = "building"
echo "A ok: paused is reported separately from lifecycle status"

# ── Phase B — an imported paused graph is INERT under a full daemon pass ───────
GRAPH="$PD/g"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
  --bind source="$REPO" --paused >/dev/null
INIT_B=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH")
test "$(node src/main.ts get initiative --id "$INIT_B" --json | jv 'v.paused')" = "true"

EV_BEFORE=$(node src/main.ts list event --after 0 --limit 1000 --json | jv 'v.events.length')
export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
daemon_pass

# Inert means: no task left `pending`, and no execution event was appended.
test "$(node src/main.ts list task --initiative "$INIT_B" --json | jv 'v.every(t=>t.status==="pending")')" = "true"
node src/main.ts list event --after 0 --limit 1000 --json > "$PD/ev.json"
test "$(jv 'v.events.length' < "$PD/ev.json")" = "$EV_BEFORE"
test "$(jv 'v.events.every(e=>!["task.started","agent.started","task.ready","objective.building"].includes(e.type))' < "$PD/ev.json")" = "true"
# The workspace was never provisioned for a paused initiative.
test "$(node src/main.ts get initiative --id "$INIT_B" --json | jv 'v.workspace===undefined||v.workspace===null')" = "true"
echo "B ok: a paused import is inert — no status change, no execution event, no workspace"

# ── Phase C — the explicit start gate releases it ──────────────────────────────
node src/main.ts resume initiative --id "$INIT_B" >/dev/null
test "$(node src/main.ts get initiative --id "$INIT_B" --json | jv 'v.paused')" = "false"
daemon_pass
test "$(node src/main.ts list task --initiative "$INIT_B" --json | jv 'v.some(t=>t.status!=="pending")')" = "true"
echo "C ok: the explicit start gate is what begins execution"

# ── Phase D — a stale verdict is refused and changes nothing ───────────────────
OBJ=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).refToId.objectives["todo-api-obj"])' "$GRAPH")
test "$(node src/main.ts get objective --id "$OBJ" --json | jv 'v.status')" = "awaiting_confirmation"

# The candidate id the client reviewed must be readable, to be echoed back.
GOOD=$(node src/main.ts get objective --id "$OBJ" --json | jv 'v.commitOid')
test -n "$GOOD"
BRANCH_BEFORE=$(git --git-dir="$PD/mirror" rev-parse "refs/heads/kanthord/init/$INIT_B" 2>/dev/null || echo none)

STALE="0000000000000000000000000000000000000000"
expect_fail "$PD/stale.txt" node src/main.ts approve objective --id "$OBJ" --expected-commit "$STALE"
grep -qiE 'stale|expected|moved' "$PD/stale.txt"
test "$(node src/main.ts get objective --id "$OBJ" --json | jv 'v.status')" = "awaiting_confirmation"
# Refusal happens BEFORE any git mutation: SQLite cannot roll back a moved ref.
test "$(git --git-dir="$PD/mirror" rev-parse "refs/heads/kanthord/init/$INIT_B" 2>/dev/null || echo none)" = "$BRANCH_BEFORE"

# A stale REJECT must not discard a candidate the client never saw.
expect_fail "$PD/stale-reject.txt" node src/main.ts reject objective --id "$OBJ" \
  --resolution retry --reason x --expected-commit "$STALE"
test "$(node src/main.ts get objective --id "$OBJ" --json | jv 'v.status')" = "awaiting_confirmation"

# Omitting the required guard is a usage error, not a silent unguarded verdict.
expect_fail "$PD/missing-guard.txt" node src/main.ts approve objective --id "$OBJ"
test "$(node src/main.ts get objective --id "$OBJ" --json | jv 'v.status')" = "awaiting_confirmation"

# The matching id is accepted and integrates.
node src/main.ts approve objective --id "$OBJ" --expected-commit "$GOOD" >/dev/null
test "$(node src/main.ts get objective --id "$OBJ" --json | jv 'v.status')" = "integrated"
echo "D ok: stale + missing verdict guards refused with no state change; matching verdict integrates"

echo "012 ok: inert paused import, explicit start gate, guarded objective verdicts"
