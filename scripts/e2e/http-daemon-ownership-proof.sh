#!/usr/bin/env bash
# http-daemon-ownership-proof.sh — EPIC 025 Proof, part 2 (S2 + B7).
#
# Deterministic, no model, no outbound network (loopback only). Run from the repo
# root:
#
#   scripts/e2e/http-daemon-ownership-proof.sh
#
# It must print `025 ownership ok: …`.
#
# WHY A SECOND PROOF — http-execution-proof.sh proves ONE serve process executes
# work. Two claims cannot be made with one server:
#
#   S2  EXACTLY ONE daemon runs, even with two `serve` processes on one database,
#       and ownership is acquired ATOMICALLY. A preflight "is a heartbeat fresh?"
#       read followed by a start is not mutual exclusion: two processes can both
#       read "stale" and both start. The design under test is a lease row claimed
#       with `UPDATE … WHERE (unowned OR expired) RETURNING` — the same atomic
#       claim AGENTS.md already prescribes for the job queue — renewed by the
#       heartbeat and RELEASED on shutdown.
#
#   B7  A daemon that FAILS does not leave a UI that silently executes nothing.
#       The host keeps serving reads, and it RELEASES the lease. Releasing is the
#       load-bearing part: if a failed daemon only let its lease expire, no
#       replacement could start for a full staleness window even though nothing
#       is running — the exact tension between S2 and B7.
#
# SEAM — `KANTHORD_DAEMON_FAIL_AT=<n>` makes the hosted daemon reject on its nth
# loop iteration. Hermetic, off by default, mirroring KANTHORD_FAKE_AGENT and
# KANTHORD_FAKE_FAIL_PROVIDERS.
#
# EXPECTED FAILURE ON THE CURRENT TREE — phase B: plain `serve` starts no daemon,
# so readiness reports `stopped` and there is no owner to contend for. Phase A
# asserts only what exists today.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PD="$(mktemp -d)"
PIDS=""
cleanup() {
  for p in $PIDS; do kill "$p" 2>/dev/null || true; done
  rm -rf "$PD"
}
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
export KANTHORD_HEARTBEAT_STALE_MS=900
KEY="0123456789abcdef0123456789abcdef"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
poll() { local secs="$1"; shift; local n=$(( secs * 5 )); local i=0
  while [ "$i" -lt "$n" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; i=$((i+1)); done
  echo "FAILED: condition never held within ${secs}s: $*" >&2; return 1; }
# Register a started server for cleanup. Must be called in the PARENT shell.
track() { PIDS="$PIDS $1"; }

cat > "$PD/req.mjs" <<'EOF'
import http from "node:http";
const [method, rawUrl, auth] = process.argv.slice(2);
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
const url = new URL(rawUrl);
const req = http.request(
  { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
  (res) => {
    let text = "";
    res.on("data", (c) => (text += c));
    res.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      process.stdout.write(JSON.stringify({ status: res.statusCode, body: parsed }));
    });
  },
);
req.on("error", () => process.stdout.write(JSON.stringify({ status: 0, body: null })));
req.end();
EOF
REQ() { node "$PD/req.mjs" "$@"; }

# Start a serve process in its own dir, echo "<pid> <port>".
#
# NOTE: callers MUST run `track <pid>` on the result. This function is invoked
# inside a command substitution, so any PIDS assignment made HERE happens in a
# subshell and is lost — which would leak a live server on every failed phase.
start_serve() {
  local tag="$1"; shift
  local dir="$PD/$tag"
  mkdir -p "$dir"
  printf 'API_KEY=%s\n' "$KEY" > "$dir/.env"
  ( cd "$dir" && exec env "$@" node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/$tag.log" 2>&1 &
  local pid=$!
  # Registered in the parent by `track`, not here.
  echo "$pid" > "$PD/$tag.pid"
  local port=""
  for _ in $(seq 1 100); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "FAILED: $tag exited during startup; log:" >&2; cat "$PD/$tag.log" >&2; return 1
    fi
    port="$(node -e '
      const fs=require("fs");
      const t=fs.existsSync(process.argv[1])?fs.readFileSync(process.argv[1],"utf8"):"";
      for (const line of t.split("\n")) {
        try { const o=JSON.parse(line); if (o.msg==="listening" && o.port) { process.stdout.write(String(o.port)); break; } } catch {}
      }' "$PD/$tag.log")"
    [ -n "$port" ] && break
    sleep 0.1
  done
  [ -n "$port" ] || { echo "FAILED: $tag never logged a listening port" >&2; cat "$PD/$tag.log" >&2; return 1; }
  echo "$pid $port"
}
daemon_status() { REQ GET "http://127.0.0.1:$1/api/project/$PROJECT/readiness" "$BASIC" \
  | jv 'v.body.data.checks.find(c=>c.name==="daemon").status'; }
tstatus() { K list task --initiative "$PROBE" --json | jv 'v.find(t=>t.title==="'"$1"'").status'; }
wait_task() { poll "$2" bash -c "[ \"\$(cd '$ROOT' && KANTHORD_DB='$KANTHORD_DB' node src/main.ts list task --initiative '$PROBE' --json | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const v=JSON.parse(s);const t=v.find(x=>x.title===\"$1\");process.stdout.write(t?t.status:\"\")})')\" = 'completed' ]"; }

echo "--- A: fixture and one serve"
K db migrate >/dev/null
PROJECT="$(K create project --name owner)"
HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED" 2>/dev/null
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO="$(K create repository --project "$PROJECT" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror")"
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV="$(K register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')"
K assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null
GRAPH="$PD/g"
scripts/e2e/make-025-execution-graph.sh "$GRAPH" "$PD/unused-a" "$PD/unused-b" >/dev/null
K import graph "$GRAPH/probe" --create --project "$PROJECT" --bind source="$REPO" >/dev/null
PROBE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH/probe")"
export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"

read -r S1_PID S1_PORT <<< "$(start_serve s1)"
track "$S1_PID"
eq "s1 healthz" "200" "$(REQ GET "http://127.0.0.1:$S1_PORT/healthz" "$BASIC" | jv 'v.status')"
echo "A ok: fixture built, s1 listening on $S1_PORT"

echo "--- B: s1 owns the daemon and executes"
eq "s1 daemon" "running" "$(daemon_status "$S1_PORT")"
wait_task "probe 1" 120
echo "B ok: s1 owns the lease and completed probe 1"

echo "--- C: a SECOND serve serves reads but runs NO daemon"
read -r S2_PID S2_PORT <<< "$(start_serve s2)"
track "$S2_PID"
eq "s2 healthz"    "200" "$(REQ GET "http://127.0.0.1:$S2_PORT/healthz" "$BASIC" | jv 'v.status')"
eq "s2 read works" "200" "$(REQ GET "http://127.0.0.1:$S2_PORT/api/initiative/$PROBE" "$BASIC" | jv 'v.status')"
# The load-bearing assertion: with TWO serve processes live, exactly one daemon
# beats, so readiness must NOT report `multiple`.
eq "still one daemon (s1 view)" "running" "$(daemon_status "$S1_PORT")"
eq "still one daemon (s2 view)" "running" "$(daemon_status "$S2_PORT")"
echo "C ok: two servers, one daemon — the lease was not double-claimed"

echo "--- D: s1 shuts down and RELEASES; s2 takes over"
kill -TERM "$S1_PID"
set +e; wait "$S1_PID"; S1_RC=$?; set -e
case "$S1_RC" in 0|143) : ;; *) echo "FAILED: D — s1 exited $S1_RC" >&2; tail -20 "$PD/s1.log" >&2; exit 1 ;; esac
# Takeover must not wait for expiry — a clean shutdown releases the lease.
wait_task "probe 2" 120
eq "s2 now owns it" "running" "$(daemon_status "$S2_PORT")"
echo "D ok: the lease was released on shutdown and s2 took over"

echo "--- E: a FAILING daemon keeps serving reads and releases the lease"
kill -TERM "$S2_PID"; set +e; wait "$S2_PID"; set -e
read -r S3_PID S3_PORT <<< "$(start_serve s3 KANTHORD_DAEMON_FAIL_AT=1)"
track "$S3_PID"
eq "s3 still serves reads" "200" "$(REQ GET "http://127.0.0.1:$S3_PORT/api/initiative/$PROBE" "$BASIC" | jv 'v.status')"
# The failure is VISIBLE: readiness stops claiming a live daemon.
poll 20 bash -c "[ \"\$(cd '$ROOT' && KANTHORD_DB='$KANTHORD_DB' node '$PD/req.mjs' GET 'http://127.0.0.1:$S3_PORT/api/project/$PROJECT/readiness' '$BASIC' | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const v=JSON.parse(s);process.stdout.write(v.body.data.checks.find(c=>c.name===\"daemon\").status)})')\" = 'stopped' ]"
eq "s3 is alive" "0" "$(kill -0 "$S3_PID" 2>/dev/null; echo $?)"
# And the lease is free IMMEDIATELY, not after a staleness window: a replacement
# claims it and makes progress.
read -r S4_PID S4_PORT <<< "$(start_serve s4)"
track "$S4_PID"
eq "s4 daemon" "running" "$(daemon_status "$S4_PORT")"
wait_task "probe 3" 120
echo "E ok: the failed daemon stayed observable and freed the lease for s4"

echo "025 ownership ok: atomic single-daemon lease, clean release on shutdown, and a failing daemon stays visible"
