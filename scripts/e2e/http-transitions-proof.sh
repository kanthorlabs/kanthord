#!/usr/bin/env bash
# http-transitions-proof.sh — EPIC 023 Proof (deterministic, no model, no
# outbound network — loopback and file:// only — no server and no daemon left
# running).
#
# Proves that the running `kanthord serve` program answers every HUMAN VERDICT on
# work that already ran, as REST on item-scoped noun paths:
#   * a real escalated task is approved over HTTP and the repeat is the
#     idempotent 200 branch,
#   * a real failed task is rejected over HTTP: the dry run writes nothing, a
#     stale impact digest LOSES with 409 impact_changed, the fresh one discards,
#     and a second, different resolution is refused,
#   * an objective verdict without its `expectedCommit` is 400 and with a stale
#     one LOSES with 409 stale_candidate before any git work,
#   * `retry` is a noun (`reattempt`) and abandonment refuses a non-running task,
#   * pausing is STATE: PUT/DELETE on the suspension singleton, idempotent both
#     ways, readable as `paused` on the initiative,
#   * 021's If-Match convention still refuses a stale validator (regression),
#   * no route encourages bulk approval, and every 019 gate still fires.
#
# Against the CURRENT tree phases A and B pass — they are CLI fixture work plus
# 019/020 wiring that already exists — and phase C fails at the FIRST verdict
# with `404 unknown_route`, because `/api/task/:id/approval` is not a route yet.
# That is the exactly right failure: the missing thing is the transition row.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PD="$(mktemp -d)"
SERVE_PID=""
cleanup() {
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

# Hermetic: an isolated database, and an isolated working directory so `serve`
# loads the proof's .env and NEVER the developer's real .env.
export KANTHORD_DB="$PD/kanthord.db"
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — '$3' must differ from '$2'" >&2; exit 1; }; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- curl-free request helper: status, headers and parsed body all assertable.
# Built on node:http (not fetch/undici): the WHATWG fetch spec forbids a caller
# from setting the `Host` header, so undici silently drops/overrides it. Kept in
# the shape of scripts/e2e/http-reads-proof.sh — one request helper for every
# HTTP proof — plus a request BODY, read from $REQ_BODY so no quoting in argv can
# break on JSON.
cat > "$PD/req.mjs" <<'EOF'
// node req.mjs <METHOD> <URL> <AUTHORIZATION|-> [header:value ...]
// The request body, if any, comes from $REQ_BODY.
import http from "node:http";
const [method, rawUrl, auth, ...raw] = process.argv.slice(2);
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
for (const h of raw) {
  const i = h.indexOf(":");
  headers[h.slice(0, i)] = h.slice(i + 1);
}
const body = process.env.REQ_BODY ?? "";
if (body.length > 0) headers["content-length"] = Buffer.byteLength(body);
const url = new URL(rawUrl);
await new Promise((resolve) => {
  const req = http.request(
    {
      method,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers,
    },
    (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        out += chunk;
      });
      res.on("end", () => {
        const lines = [`STATUS ${res.statusCode}`];
        for (const [k, v] of Object.entries(res.headers)) {
          lines.push(`HEADER ${k.toLowerCase()} ${Array.isArray(v) ? v.join(", ") : v}`);
        }
        lines.push(`BODY ${out.replace(/\r?\n/g, " ")}`);
        process.stdout.write(lines.join("\n") + "\n");
        resolve();
      });
    },
  );
  req.on("error", (err) => {
    process.stdout.write(`STATUS 0\nBODY network-error ${err.code ?? err.message}\n`);
    resolve();
  });
  if (body.length > 0) req.write(body);
  req.end();
});
EOF

REQ() { node "$PD/req.mjs" "$@"; }
status_of() { printf '%s\n' "$1" | sed -n 's/^STATUS //p' | head -1; }
body_of() { printf '%s\n' "$1" | sed -n 's/^BODY //p' | head -1; }
header_of() { printf '%s\n' "$2" | sed -n "s/^HEADER $1 //p" | head -1; }
# jv <json> <js-expression over `v`> — the parsed body is `v`.
jv() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
# exportval <package-dir> <js-expression over `j`> — reads .kanthord-export.json.
exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }

GET() { REQ GET "$BASE$1" "$BASIC"; }
# WRITE <METHOD> <path> <json-body> [extra header:value ...] — an unsafe method
# ALWAYS carries Content-Type: application/json, even with an empty body: the
# gate at src/apps/http/app.ts:170 keys off the method, not the bytes.
WRITE() {
  local method="$1" path="$2" body="$3"; shift 3
  REQ_BODY="$body" REQ "$method" "$BASE$path" "$BASIC" "content-type:application/json" "$@"
}
# W <label> <METHOD> <path> <body> <expected-status> → echoes the raw response.
W() {
  local label="$1" method="$2" path="$3" body="$4" want="$5"; shift 5
  local out; out="$(WRITE "$method" "$path" "$body" "$@")"
  eq "$label status" "$want" "$(status_of "$out")"
  printf '%s\n' "$out"
}
# W_ERR <label> <METHOD> <path> <body> <status> <code>
W_ERR() {
  local label="$1" method="$2" path="$3" body="$4" want="$5" code="$6"; shift 6
  local out; out="$(WRITE "$method" "$path" "$body" "$@")"
  eq "$label status" "$want" "$(status_of "$out")"
  eq "$label code" "$code" "$(jv "$(body_of "$out")" 'v.error.code')"
}
# G_DATA <label> <path> → prints the `data` field of a 200 GET.
G_DATA() {
  local out; out="$(GET "$2")"
  eq "$1 status" "200" "$(status_of "$out")"
  jv "$(body_of "$out")" 'JSON.stringify(v.data)'
}
task_status() { jv "$(G_DATA "task $1" "/api/task/$1")" 'v.status'; }

# Bounded daemon pass: `--until-idle` must never hang this proof. The daemon
# exits NON-ZERO when any task failed, and this fixture fails two tasks on
# purpose, so the exit code is ignored here — the fixture invariants asserted
# immediately below are what this phase actually proves.
daemon_pass() {
  node "$ROOT/src/main.ts" run daemon --until-idle --poll-interval 200 \
    >>"$PD/daemon.log" 2>&1 &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.2; waited=$((waited+1))
    if [ "$waited" -gt 300 ]; then   # 60s
      kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
      echo "FAILED: run daemon --until-idle did not finish in 60s" >&2; return 1
    fi
  done
  wait "$pid" || true
}

echo "--- A: fixture through the CLI only — one escalated task, one integrated-ready objective, two failed tasks"
K db migrate >/dev/null
PROJECT=$(K create project --name transitions)

HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO=$(K create repository --project "$PROJECT" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror")
# The provider chain must be non-empty or every task fails (008.3). Under the
# fake-agent seam the value is never read.
printf 'dummy' > "$PD/token"
PROV=$(K register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$PD/token" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
K assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null

GRAPHS="$PD/graphs"; scripts/e2e/make-transitions-graph.sh "$GRAPHS" >/dev/null
export KANTHORD_FAKE_AGENT="$GRAPHS/.fake-agent.json"
for pkg in verdict integration failure; do
  K import graph "$GRAPHS/$pkg" --create --project "$PROJECT" --bind source="$REPO" >/dev/null
done

TASK_APPROVE=$(exportval "$GRAPHS/verdict" 'j.refToId.tasks["tr-verdict-task"]')
INIT_I=$(exportval "$GRAPHS/integration" 'j.initiativeId')
OBJ_I=$(exportval "$GRAPHS/integration" 'j.refToId.objectives["tr-integration-obj"]')
INIT_F=$(exportval "$GRAPHS/failure" 'j.initiativeId')
TASK_REJECT=$(exportval "$GRAPHS/failure" 'j.refToId.tasks["tr-failure-reject"]')
TASK_REATTEMPT=$(exportval "$GRAPHS/failure" 'j.refToId.tasks["tr-failure-reattempt"]')

daemon_pass

# Fixture invariants, asserted through the CLI BEFORE any HTTP call: a later
# phase asserting against the wrong state would prove nothing.
eq "approve target status" "awaiting_confirmation" \
  "$(K get task --id "$TASK_APPROVE" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).status))')"
PROPOSAL=$(K get task --id "$TASK_APPROVE" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result?.proposalCommit??""))')
[ -n "$PROPOSAL" ] || { echo "FAILED: the escalated task carries no proposalCommit — the repeat-approve branch would be unreachable" >&2; exit 1; }
eq "objective verdict target status" "awaiting_confirmation" \
  "$(K get objective --id "$OBJ_I" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).status))')"
for t in "$TASK_REJECT" "$TASK_REATTEMPT"; do
  eq "failure fixture $t status" "failed" \
    "$(K get task --id "$t" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).status))')"
done
echo "    escalated task $TASK_APPROVE (proposal ${PROPOSAL:0:8}), objective $OBJ_I, failed tasks $TASK_REJECT / $TASK_REATTEMPT"

echo "--- B: serve on an ephemeral port"
( cd "$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
SERVE_PID=$!
PORT=""
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    echo "FAILED: serve exited during startup; log:" >&2; cat "$PD/serve.log" >&2; exit 1
  fi
  PORT="$(node -e '
    const { readFileSync } = require("node:fs");
    for (const line of readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const o = JSON.parse(line);
        if (o.msg === "listening" && typeof o.port === "number") {
          process.stdout.write(String(o.port)); break;
        }
      } catch {}
    }' "$PD/serve.log")"
  [ -n "$PORT" ] && break
  sleep 0.2
done
[ -n "$PORT" ] || { echo "FAILED: no {\"msg\":\"listening\",\"port\":N} line; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }
BASE="http://127.0.0.1:$PORT"
eq "healthz answers" "200" "$(status_of "$(GET /healthz)")"
echo "    bound port: $PORT"

echo "--- C: approve a real escalated task over HTTP, then prove the repeat is idempotent"
OUT="$(W "approve task" POST "/api/task/$TASK_APPROVE/approval" '{}' 200)"
DATA="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
eq "approve outcome" "approved" "$(jv "$DATA" 'v.outcome')"
eq "approve DTO has no kind field" "false" "$(jv "$DATA" '"kind" in v')"
eq "approve DTO has no cause field" "false" "$(jv "$DATA" '"cause" in v')"
ETAG_APPROVE="$(header_of etag "$OUT")"
[ -n "$ETAG_APPROVE" ] || { echo "FAILED: a 200 json transition response carries no ETag" >&2; exit 1; }
eq "approved task status" "completed" "$(task_status "$TASK_APPROVE")"
# The repeat: `completed` + commitSha === proposalCommit is the idempotent branch
# (src/app/task/approve-task.ts:132-138), so the SAME 200 answer, not a 409.
OUT="$(W "approve task replayed" POST "/api/task/$TASK_APPROVE/approval" '{}' 200)"
eq "replayed outcome" "approved" "$(jv "$(body_of "$OUT")" 'v.data.outcome')"
eq "replayed task status" "completed" "$(task_status "$TASK_APPROVE")"
echo "C ok: a real escalated task is approved over HTTP and the repeat is a 200 no-op"

echo "--- D: reject a real failed task — the dry run writes nothing and a stale digest LOSES"
OUT="$(W "reject dry run" POST "/api/task/$TASK_REJECT/rejection" \
  '{"resolution":"discard","dryRun":true}' 200)"
DIGEST="$(jv "$(body_of "$OUT")" 'v.data.preview.digest')"
[ -n "$DIGEST" ] || { echo "FAILED: the dry run returned no impact digest" >&2; exit 1; }
eq "dry run wrote nothing" "failed" "$(task_status "$TASK_REJECT")"
# The stale guard: `dryRun` returns BEFORE the digest check
# (src/app/task/reject-task.ts:203-206 then :205), so the stale assertion must be
# sent WITHOUT dryRun or it would never reach the comparison.
W_ERR "reject with a stale digest" POST "/api/task/$TASK_REJECT/rejection" \
  "{\"resolution\":\"discard\",\"expectImpact\":\"0000000000000000000000000000000000000000\"}" \
  409 impact_changed
eq "stale digest changed nothing" "failed" "$(task_status "$TASK_REJECT")"
W "reject with the fresh digest" POST "/api/task/$TASK_REJECT/rejection" \
  "{\"resolution\":\"discard\",\"reason\":\"not needed\",\"expectImpact\":\"$DIGEST\"}" 200 >/dev/null
eq "rejected task status" "discarded" "$(task_status "$TASK_REJECT")"
# A second, DIFFERENT resolution on the same task is refused, not silently applied.
W_ERR "reject with a conflicting resolution" POST "/api/task/$TASK_REJECT/rejection" \
  '{"resolution":"retry"}' 409 rejection_conflict
eq "conflicting resolution changed nothing" "discarded" "$(task_status "$TASK_REJECT")"
echo "D ok: a dry run writes nothing, a stale impact digest loses, and a conflicting resolution is refused"

echo "--- E: the objective verdict guard — missing is 400, stale is 409, fresh integrates"
OBJ_DATA="$(G_DATA "objective" "/api/objective/$OBJ_I")"
COMMIT_OID="$(jv "$OBJ_DATA" 'v.commitOid')"
[ -n "$COMMIT_OID" ] || { echo "FAILED: the objective exposes no commitOid to echo back" >&2; exit 1; }
INIT_BR="refs/heads/kanthord/init/$INIT_I"
BR_BEFORE="$(git --git-dir="$PD/mirror" rev-parse "$INIT_BR" 2>/dev/null || echo none)"
W_ERR "objective approval with no guard" POST "/api/objective/$OBJ_I/approval" '{}' 400 invalid_input
W_ERR "objective approval with a stale guard" POST "/api/objective/$OBJ_I/approval" \
  '{"expectedCommit":"0000000000000000000000000000000000000000"}' 409 stale_candidate
eq "stale guard changed no status" "awaiting_confirmation" "$(jv "$(G_DATA "objective" "/api/objective/$OBJ_I")" 'v.status')"
# The refusal precedes any git work: SQLite cannot roll back a moved ref.
eq "stale guard moved no ref" "$BR_BEFORE" "$(git --git-dir="$PD/mirror" rev-parse "$INIT_BR" 2>/dev/null || echo none)"
OUT="$(W "objective approval with the real guard" POST "/api/objective/$OBJ_I/approval" \
  "{\"expectedCommit\":\"$COMMIT_OID\"}" 200)"
eq "objective outcome" "integrated" "$(jv "$(body_of "$OUT")" 'v.data.outcome')"
eq "objective status" "integrated" "$(jv "$(G_DATA "objective" "/api/objective/$OBJ_I")" 'v.status')"
W_ERR "objective approval replayed" POST "/api/objective/$OBJ_I/approval" \
  "{\"expectedCommit\":\"$COMMIT_OID\"}" 409 objective_not_awaiting_confirmation
echo "E ok: an objective verdict without its candidate is 400, with a stale one 409 before any git work"

echo "--- F: reattempt is a noun, and abandonment refuses a task that is not running"
W "reattempt the failed task" POST "/api/task/$TASK_REATTEMPT/reattempt" \
  '{"note":"try harder"}' 204 >/dev/null
eq "reattempt requeued the task" "pending" "$(task_status "$TASK_REATTEMPT")"
eq "reattempt persisted the note" "try harder" "$(jv "$(G_DATA "task" "/api/task/$TASK_REATTEMPT")" 'v.note')"
# A second reattempt sees `pending`, which is not retryable (retry-task.ts:130-131).
W_ERR "reattempt replayed" POST "/api/task/$TASK_REATTEMPT/reattempt" '{}' 409 task_not_retryable
# The status guard fires before the running-job query (abandon-task.ts:117-120),
# so a non-running task is `task_not_abandonable`, never `no_running_job`.
W_ERR "abandon a non-running task" POST "/api/task/$TASK_REATTEMPT/abandonment" \
  '{"reason":"stuck"}' 409 task_not_abandonable
W_ERR "abandon with no reason" POST "/api/task/$TASK_REATTEMPT/abandonment" '{}' 400 invalid_input
echo "F ok: reattempt re-queues once and keeps its note; abandonment refuses a task that is not running"

echo "--- G: pausing is STATE — the suspension singleton, idempotent both ways"
paused_of() { jv "$(G_DATA "initiative" "/api/initiative/$INIT_F")" 'v.paused'; }
OUT="$(W "pause" PUT "/api/initiative/$INIT_F/suspension" '{}' 204)"
eq "pause sends no body" "" "$(body_of "$OUT")"
eq "pause sends no ETag" "" "$(header_of etag "$OUT")"
eq "initiative is paused" "true" "$(paused_of)"
W "pause replayed" PUT "/api/initiative/$INIT_F/suspension" '{}' 204 >/dev/null
eq "pause is idempotent" "true" "$(paused_of)"
W "resume" DELETE "/api/initiative/$INIT_F/suspension" '' 204 >/dev/null
eq "initiative is resumed" "false" "$(paused_of)"
W "resume replayed" DELETE "/api/initiative/$INIT_F/suspension" '' 204 >/dev/null
eq "resume is idempotent" "false" "$(paused_of)"
echo "G ok: PUT/DELETE on the suspension singleton flips paused and both are idempotent"

echo "--- H: 021's If-Match convention is not weakened by this epic (regression)"
INIT_DATA="$(GET "/api/initiative/$INIT_F")"
ETAG_INIT="$(header_of etag "$INIT_DATA")"
[ -n "$ETAG_INIT" ] || { echo "FAILED: the initiative item carries no ETag" >&2; exit 1; }
W_ERR "PATCH with no If-Match" PATCH "/api/initiative/$INIT_F" '{"name":"renamed"}' \
  428 precondition_required
W_ERR "PATCH with a stale If-Match" PATCH "/api/initiative/$INIT_F" '{"name":"renamed"}' \
  412 precondition_failed 'if-match:"0000000000000000000000000000000000000000000000000000000000000000"'
eq "the stale PATCH changed nothing" "Transitions failure" \
  "$(jv "$(G_DATA "initiative" "/api/initiative/$INIT_F")" 'v.name')"
OUT="$(W "PATCH with the real validator" PATCH "/api/initiative/$INIT_F" '{"name":"renamed"}' \
  200 "if-match:$ETAG_INIT")"
eq "the PATCH applied" "renamed" "$(jv "$(body_of "$OUT")" 'v.data.name')"
ne "the validator changed" "$ETAG_INIT" "$(header_of etag "$OUT")"
echo "H ok: a stale If-Match still loses on the item PATCH, and the fresh one wins"

echo "--- I: no bulk approval, and the 019 gates still fire on a transition row"
# There is no collection-level verdict route, and the verb form is not a route.
W_ERR "collection-level approval" POST "/api/task/approval" '{}' 404 unknown_route
W_ERR "the verb form" POST "/api/task/$TASK_APPROVE/approve" '{}' 404 unknown_route
OUT="$(REQ_BODY='{}' REQ POST "$BASE/api/task/$TASK_APPROVE/approval" "$BASIC" "content-type:text/plain")"
eq "text/plain is rejected" "415" "$(status_of "$OUT")"
OUT="$(WRITE POST "/api/initiative/$INIT_F/suspension" '{}' "origin:http://127.0.0.1:1")"
eq "a foreign Origin is rejected" "403" "$(status_of "$OUT")"
OUT="$(REQ_BODY='{}' REQ PUT "$BASE/api/initiative/$INIT_F/suspension" "-" "content-type:application/json")"
eq "an unauthenticated write is rejected" "401" "$(status_of "$OUT")"
eq "the rejected write changed nothing" "false" "$(paused_of)"
echo "I ok: no bulk verdict route exists, and the media-type, Origin and auth gates all fire"

echo "--- J: hygiene — no secret in the log, and SIGTERM stops the port"
absent "API_KEY never logged" "$(cat "$PD/serve.log")" "$KEY"
kill "$SERVE_PID"; wait "$SERVE_PID" 2>/dev/null || true; SERVE_PID=""
eq "the port stops accepting" "0" "$(status_of "$(GET /healthz)")"

echo "023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk"
