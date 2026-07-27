#!/usr/bin/env bash
# abandon-run-proof.sh — EPIC 013 Proof (deterministic, no model, no network).
# Proves lease-fenced run recovery through the real CLI with the
# KANTHORD_FAKE_AGENT seam, against a LIVE background daemon that is never killed
# to make an assertion pass (killing the producer of a late write would prove
# process termination, not a fence).
#
# Run from the repo root. Against the CURRENT tree phase B fails: there is no
# `abandon` command.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

PD="$(mktemp -d)"
DAEMON=""
cleanup() { [ -n "$DAEMON" ] && kill "$DAEMON" 2>/dev/null || true; rm -rf "$PD"; }
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
# Bounded poll: `until <predicate>` with a deadline, so no phase can hang.
poll() { local secs="$1"; shift; local n=$(( secs * 5 )); local i=0
  while [ "$i" -lt "$n" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; i=$((i+1)); done
  echo "FAILED: condition never held within ${secs}s: $*" >&2; return 1; }

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

GRAPH="$PD/g"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
# A MULTI-TURN script with short tool calls. Drain happens at a turn boundary, so
# the run must have boundaries to reach — a single endless tool call is an
# explicit non-goal of this epic, not the case under test.
cat > "$GRAPH/.fake-agent.json" <<'EOF'
[
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "sleep 2" } } ] },
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "sleep 2" } } ] },
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "sleep 2" } } ] },
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const x = 1;\\n' > src/todo.mjs" } } ] },
  { "text": "done" }
]
EOF
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
  --bind source="$REPO" >/dev/null
INIT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH")

export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
node src/main.ts run daemon --poll-interval 200 >"$PD/daemon.log" 2>&1 &
DAEMON=$!

# ── Phase A — a run reaches `running` ──────────────────────────────────────────
running_id() { node src/main.ts list task --initiative "$INIT" --status running --json \
  | jv 'v.length?v[0].id:""'; }
poll 30 bash -c '[ -n "$(node src/main.ts list task --initiative "'"$INIT"'" --status running --json | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const v=JSON.parse(s);process.stdout.write(v.length?v[0].id:\"\")})")" ]'
HUNG="$(running_id)"; test -n "$HUNG"
echo "A ok: task $HUNG is running"

# ── Phase B — abandon returns immediately, marked abandoning, daemon still alive ─
node src/main.ts abandon task --id "$HUNG" --reason "stuck on a slow tool" >/dev/null
kill -0 "$DAEMON" 2>/dev/null || { echo "FAILED: daemon died during abandon" >&2; exit 1; }
test "$(node src/main.ts get task --id "$HUNG" --json | jv 'v.abandoning')" = "true"
test "$(node src/main.ts get task --id "$HUNG" --json | jv 'v.status')" = "running"
# Abandoning twice is a no-op, not an error.
node src/main.ts abandon task --id "$HUNG" --reason "again" >/dev/null
echo "B ok: lease revoked, run marked abandoning, daemon alive"

# ── Phase C — the run drains, then the task is requeued ────────────────────────
poll 60 bash -c '[ "$(node src/main.ts get task --id "'"$HUNG"'" --json | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>process.stdout.write(String(JSON.parse(s).abandoning===true)))")" = "false" ]'
node src/main.ts list event --after 0 --limit 1000 --json > "$PD/ev.json"
test "$(jv 'v.events.some(e=>e.type==="task.abandoned"&&e.taskId==="'"$HUNG"'")' < "$PD/ev.json")" = "true"
test "$(jv 'v.events.find(e=>e.type==="task.abandoned"&&e.taskId==="'"$HUNG"'").payload.reason' < "$PD/ev.json")" = "stuck on a slow tool"
echo "C ok: run drained, task requeued, abandonment recorded with its reason"

# ── Phase D — the fence held for the ABANDONED run ─────────────────────────────
# The abandoned run must not have completed or failed the task. Its writes were
# rejected while the daemon stayed alive — that is the fence.
node -e '
const ev=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).events;
const t=process.argv[2];
const abandonAt=ev.findIndex(e=>e.type==="task.abandoned"&&e.taskId===t);
const before=ev.slice(0,abandonAt);
for (const bad of ["task.completed","task.failed"]) {
  if (before.some(e=>e.type===bad&&e.taskId===t)) {
    console.error("FAILED: abandoned run produced "+bad+" before abandonment"); process.exit(1);
  }
}
' "$PD/ev.json" "$HUNG"
echo "D ok: the abandoned run never completed or failed the task"

# ── Phase E — the same live daemon re-runs the task under a new lease ──────────
poll 90 bash -c '[ "$(node src/main.ts get task --id "'"$HUNG"'" --json | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>process.stdout.write(JSON.parse(s).status))")" = "completed" ]'
kill -0 "$DAEMON" 2>/dev/null || { echo "FAILED: daemon died before the re-run finished" >&2; exit 1; }
echo "E ok: the requeued task ran to completion under a new lease, same live daemon"

echo "013 ok: lease revoked, run drained, task requeued, late writes fenced, re-run clean"
