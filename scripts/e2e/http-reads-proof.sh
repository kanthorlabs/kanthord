#!/usr/bin/env bash
# http-reads-proof.sh — EPIC 020 Proof (deterministic, no model, no outbound
# network — loopback only — no server left running).
#
# Proves that the running `kanthord serve` program answers the read surface the
# UI's first screens need, over REST with SINGULAR resource segments:
#   * collections and items for project / initiative / objective / task /
#     resource / ai-provider / model, plus the computed reads (overview, graph,
#     queue, conflict),
#   * `?name=` on a collection replaces `find <kind> --name` (no /find route),
#   * a plural path is NOT served (decision 1),
#   * project scoping holds and a credential never leaks its secret,
#   * an existing initiative with zero tasks is `200 []`, not `404`,
#   * unknown id → 404 unknown_reference, blank id → 400 invalid_input,
#     a task with no conflict → 409 no_conflict_candidate,
#   * every read equals what the CLI prints for the same id (CLI/HTTP parity),
#   * Basic auth still gates the new routes, and SIGTERM still shuts down.
#
# Against the CURRENT tree (EPIC 019 landed, no /api route exists) this fails in
# phase B at the FIRST /api request with `404 unknown_route`. Phase A — fixture
# creation through the CLI, `serve --port 0`, the bound port, and an
# authenticated /healthz — passes today, so the first failure is the missing
# capability and not a broken fixture.
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
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- curl-free request helper: status, headers and parsed body all assertable.
# Built on node:http (not fetch/undici): the WHATWG fetch spec forbids a caller
# from setting the `Host` header, so undici silently drops/overrides it. Kept
# identical to scripts/e2e/http-serve-proof.sh on purpose — one request helper
# shape for every HTTP proof.
cat > "$PD/req.mjs" <<'EOF'
// node req.mjs <METHOD> <URL> <AUTHORIZATION|-> [header:value ...]
import http from "node:http";
const [method, rawUrl, auth, ...raw] = process.argv.slice(2);
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
for (const h of raw) {
  const i = h.indexOf(":");
  headers[h.slice(0, i)] = h.slice(i + 1);
}
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
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const lines = [`STATUS ${res.statusCode}`];
        for (const [k, v] of Object.entries(res.headers)) {
          lines.push(`HEADER ${k.toLowerCase()} ${Array.isArray(v) ? v.join(", ") : v}`);
        }
        lines.push(`BODY ${body.replace(/\r?\n/g, " ")}`);
        process.stdout.write(lines.join("\n") + "\n");
        resolve();
      });
    },
  );
  req.on("error", (err) => {
    process.stdout.write(`STATUS 0\nBODY network-error ${err.code ?? err.message}\n`);
    resolve();
  });
  req.end();
});
EOF

REQ() { node "$PD/req.mjs" "$@"; }
status_of() { printf '%s\n' "$1" | sed -n 's/^STATUS //p' | head -1; }
body_of() { printf '%s\n' "$1" | sed -n 's/^BODY //p' | head -1; }
# jv <json> <js-expression over `v`> — the parsed body is `v`.
jv() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
# GET <path> → echoes "STATUS n" + body lines; asserts nothing.
GET() { REQ GET "$BASE$1" "$BASIC"; }
# OK <label> <path> → prints the `data` field of a 200 JSON response.
OK() {
  local out; out="$(GET "$2")"
  eq "$1 status" "200" "$(status_of "$out")"
  jv "$(body_of "$out")" 'JSON.stringify(v.data)'
}
# ERR <label> <path> <status> <code>
ERR() {
  local out; out="$(GET "$2")"
  eq "$1 status" "$3" "$(status_of "$out")"
  eq "$1 code" "$4" "$(jv "$(body_of "$out")" 'v.error.code')"
}

echo "--- A: fixture through the CLI, then serve on an ephemeral port"
K db migrate >/dev/null

PROJECT_A=$(K create project --name alpha)
PROJECT_B=$(K create project --name beta)

HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
REPO=$(K create repository --project "$PROJECT_A" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient \
  --path "$PD/mirror")
printf 'sekret' > "$PD/cred.txt"
CRED=$(K create credential --project "$PROJECT_A" --name gh --provider github \
  --value-file "$PD/cred.txt")
NOTIF=$(K create notification --project "$PROJECT_A" --name ops \
  --provider slack --destination '#ops')
FS=$(K create filesystem --project "$PROJECT_A" --name scratch --path "$PD/ws")

INIT=$(K create initiative --project "$PROJECT_A" --name init-one)
EMPTY_INIT=$(K create initiative --project "$PROJECT_A" --name init-empty)
OBJ=$(K create objective --initiative "$INIT" --name obj-one)
T1=$(K create task --objective "$OBJ" --title "task one" --instructions x --ac y)
T2=$(K create task --objective "$OBJ" --title "task two" --instructions x --ac y)

( cd "$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
SERVE_PID=$!

PORT=""
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    echo "FAILED: serve exited during startup; log:" >&2
    cat "$PD/serve.log" >&2
    exit 1
  fi
  PORT="$(node -e '
    const { readFileSync } = require("node:fs");
    for (const line of readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const o = JSON.parse(line);
        if (o.msg === "listening" && typeof o.port === "number") {
          process.stdout.write(String(o.port));
          break;
        }
      } catch {}
    }' "$PD/serve.log")"
  [ -n "$PORT" ] && break
  sleep 0.2
done
[ -n "$PORT" ] || { echo "FAILED: no {\"msg\":\"listening\",\"port\":N} line; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }
BASE="http://127.0.0.1:$PORT"
OUT="$(GET /healthz)"
eq "healthz still answers" "200" "$(status_of "$OUT")"
echo "    bound port: $PORT — fixture: project $PROJECT_A, initiative $INIT, task $T1"

echo "--- B: project collection + item, ?name= replaces find, plural is not served"
DATA="$(OK "project collection" "/api/project")"
eq "project count" "2" "$(jv "$DATA" 'v.length')"
eq "project ids ascending" "true" "$(jv "$DATA" 'JSON.stringify(v.map(p=>p.id))===JSON.stringify([...v.map(p=>p.id)].sort())')"
DATA="$(OK "project ?name=alpha" "/api/project?name=alpha")"
eq "name filter count" "1" "$(jv "$DATA" 'v.length')"
eq "name filter id" "$PROJECT_A" "$(jv "$DATA" 'v[0].id')"
eq "name filter miss" "0" "$(jv "$(OK "project ?name=nope" "/api/project?name=nope")" 'v.length')"
DATA="$(OK "project item" "/api/project/$PROJECT_A")"
eq "project item id" "$PROJECT_A" "$(jv "$DATA" 'v.id')"
eq "project item name" "alpha" "$(jv "$DATA" 'v.name')"
# Decision 1: segments are singular. The plural path is not a route at all.
ERR "plural path" "/api/projects" "404" "unknown_route"
# Decision: `find` is a query parameter, never a path.
ERR "no find path" "/api/project/find" "404" "unknown_reference"

echo "--- C: initiative / objective / task — parent scope in the path"
DATA="$(OK "initiative collection" "/api/project/$PROJECT_A/initiative")"
eq "initiative count" "2" "$(jv "$DATA" 'v.length')"
eq "initiative ?name=" "1" "$(jv "$(OK "initiative ?name=" "/api/project/$PROJECT_A/initiative?name=init-one")" 'v.length')"
eq "initiative scoping" "0" "$(jv "$(OK "initiative of beta" "/api/project/$PROJECT_B/initiative")" 'v.length')"
DATA="$(OK "initiative item" "/api/initiative/$INIT")"
eq "initiative item id" "$INIT" "$(jv "$DATA" 'v.id')"
eq "initiative item name" "init-one" "$(jv "$DATA" 'v.name')"
DATA="$(OK "objective collection" "/api/initiative/$INIT/objective")"
eq "objective count" "1" "$(jv "$DATA" 'v.length')"
eq "objective ?name=" "1" "$(jv "$(OK "objective ?name=" "/api/initiative/$INIT/objective?name=obj-one")" 'v.length')"
eq "objective item id" "$OBJ" "$(jv "$(OK "objective item" "/api/objective/$OBJ")" 'v.id')"
DATA="$(OK "task collection" "/api/initiative/$INIT/task")"
eq "task count" "2" "$(jv "$DATA" 'v.length')"
STATUS_ONE="$(jv "$DATA" 'v[0].status')"
eq "task ?objective=" "2" "$(jv "$(OK "task ?objective=" "/api/initiative/$INIT/task?objective=$OBJ")" 'v.length')"
eq "task ?status=" "2" "$(jv "$(OK "task ?status=" "/api/initiative/$INIT/task?status=$STATUS_ONE")" 'v.length')"
# An initiative that EXISTS but owns no task is an empty collection, not a 404.
eq "empty initiative task list" "0" "$(jv "$(OK "empty task collection" "/api/initiative/$EMPTY_INIT/task")" 'v.length')"
DATA="$(OK "task item" "/api/task/$T1")"
eq "task item id" "$T1" "$(jv "$DATA" 'v.id')"
eq "task item title" "task one" "$(jv "$DATA" 'v.title')"
eq "task item objective" "$OBJ" "$(jv "$DATA" 'v.objectiveId')"

echo "--- D: resource sub-collections are typed paths; the item is type-agnostic"
DATA="$(OK "repository collection" "/api/project/$PROJECT_A/repository")"
eq "repository count" "1" "$(jv "$DATA" 'v.length')"
eq "repository name" "home" "$(jv "$DATA" 'v[0].name')"
eq "repository ?name=" "1" "$(jv "$(OK "repository ?name=" "/api/project/$PROJECT_A/repository?name=home")" 'v.length')"
CRED_DATA="$(OK "credential collection" "/api/project/$PROJECT_A/credential")"
eq "credential count" "1" "$(jv "$CRED_DATA" 'v.length')"
eq "credential id" "$CRED" "$(jv "$CRED_DATA" 'v[0].id')"
absent "credential secret never leaves" "$CRED_DATA" "sekret"
eq "credential has no value field" "true" "$(jv "$CRED_DATA" 'v.every(r=>r.value===undefined)')"
eq "notification id" "$NOTIF" "$(jv "$(OK "notification collection" "/api/project/$PROJECT_A/notification")" 'v[0].id')"
eq "filesystem id" "$FS" "$(jv "$(OK "filesystem collection" "/api/project/$PROJECT_A/filesystem")" 'v[0].id')"
eq "resource scoping" "0" "$(jv "$(OK "beta repositories" "/api/project/$PROJECT_B/repository")" 'v.length')"
DATA="$(OK "resource item" "/api/resource/$REPO")"
eq "resource item id" "$REPO" "$(jv "$DATA" 'v.id')"
eq "resource item type" "repository" "$(jv "$DATA" 'v.type')"

echo "--- E: computed reads — overview, graph, queue, model, ai-provider"
DATA="$(OK "overview" "/api/project/$PROJECT_A/overview")"
eq "overview projectId" "$PROJECT_A" "$(jv "$DATA" 'v.projectId')"
eq "overview lists the initiative" "true" "$(jv "$DATA" 'v.initiatives.some(i=>i.id==="'"$INIT"'")')"
eq "overview has lanes+decisions+digest" "true" "$(jv "$DATA" 'Array.isArray(v.lanes)&&Array.isArray(v.decisions)&&typeof v.digest==="object"')"
DATA="$(OK "graph" "/api/initiative/$INIT/graph")"
eq "graph initiative id" "$INIT" "$(jv "$DATA" 'v.initiative.id')"
eq "graph node count" "2" "$(jv "$DATA" 'v.nodes.length')"
eq "graph group count" "1" "$(jv "$DATA" 'v.groups.length')"
eq "graph counts.pending" "2" "$(jv "$DATA" 'v.counts.pending')"
DATA="$(OK "queue" "/api/queue?limit=5")"
eq "queue shape" "true" "$(jv "$DATA" 'Array.isArray(v.items)&&typeof v.counts==="object"&&Array.isArray(v.warnings)')"
DATA="$(OK "model catalog" "/api/model")"
eq "model catalog is non-empty" "true" "$(jv "$DATA" 'v.length>0')"
eq "model rows carry id+provider" "true" "$(jv "$DATA" 'v.every(m=>typeof m.id==="string"&&typeof m.provider==="string")')"
eq "model ?provider= narrows" "true" "$(jv "$(OK "model ?provider=" "/api/model?provider=anthropic")" 'v.every(m=>m.provider==="anthropic")')"
eq "ai-provider registry" "0" "$(jv "$(OK "ai-provider collection" "/api/ai-provider")" 'v.length')"
eq "project provider chain" "0" "$(jv "$(OK "provider chain" "/api/project/$PROJECT_A/ai-provider")" 'v.length')"

echo "--- F: error mapping over the wire"
ERR "unknown project" "/api/project/01BX5ZZKBKACTAV9WEVGEMMVRZ" "404" "unknown_reference"
ERR "unknown task" "/api/task/01BX5ZZKBKACTAV9WEVGEMMVRZ" "404" "unknown_reference"
# A single space, percent-encoded: requirePathParam must reject it before any use case.
ERR "blank id" "/api/project/%20" "400" "invalid_input"
ERR "task with no conflict" "/api/task/$T1/conflict" "409" "no_conflict_candidate"
ERR "objective not in conflict" "/api/objective/$OBJ/conflict" "409" "objective_not_in_conflict"

echo "--- G: CLI/HTTP parity — the same id gives the same values"
CLI_PROJECTS="$(K list project --json)"
eq "parity: project count" "$(jv "$CLI_PROJECTS" 'v.length')" \
  "$(jv "$(OK "parity project" "/api/project")" 'v.length')"
CLI_TASK="$(K get task --id "$T1" --json)"
HTTP_TASK="$(OK "parity task" "/api/task/$T1")"
eq "parity: task id" "$(jv "$CLI_TASK" 'v.id')" "$(jv "$HTTP_TASK" 'v.id')"
eq "parity: task title" "$(jv "$CLI_TASK" 'v.title')" "$(jv "$HTTP_TASK" 'v.title')"
eq "parity: task status" "$(jv "$CLI_TASK" 'v.status')" "$(jv "$HTTP_TASK" 'v.status')"
CLI_TASKS="$(K list task --initiative "$INIT" --json)"
eq "parity: task list length" "$(jv "$CLI_TASKS" 'v.length')" "$(jv "$(OK "parity task list" "/api/initiative/$INIT/task")" 'v.length')"
CLI_OVERVIEW="$(K get overview --project "$PROJECT_A" --json)"
eq "parity: overview initiative count" "$(jv "$CLI_OVERVIEW" 'v.initiatives.length')" \
  "$(jv "$(OK "parity overview" "/api/project/$PROJECT_A/overview")" 'v.initiatives.length')"

echo "--- H: auth still gates the new routes, and SIGTERM still shuts down"
OUT="$(REQ GET "$BASE/api/project" "-")"
eq "unauthenticated read status" "401" "$(status_of "$OUT")"
eq "unauthenticated read code" "unauthenticated" "$(jv "$(body_of "$OUT")" 'v.error.code')"
absent "key never in the log" "$(cat "$PD/serve.log")" "$KEY"
kill -TERM "$SERVE_PID"
for _ in $(seq 1 50); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$SERVE_PID" 2>/dev/null; then echo "FAILED: serve survived SIGTERM" >&2; exit 1; fi
SERVE_PID=""
OUT="$(GET /api/project)"
eq "port closed after SIGTERM" "0" "$(status_of "$OUT")"

echo "020 ok: singular REST reads on 127.0.0.1:$PORT — project/initiative/objective/task/resource/ai-provider/model collections + items, ?name= replaces find, overview+graph+queue+conflict, empty list is 200 [], errors mapped, CLI parity held, auth + shutdown intact"
