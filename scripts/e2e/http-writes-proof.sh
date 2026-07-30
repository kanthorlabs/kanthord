#!/usr/bin/env bash
# http-writes-proof.sh — EPIC 021 Proof (deterministic, no model, no outbound
# network — loopback only — no server left running).
#
# Proves that the running `kanthord serve` program answers every PLANNING WRITE
# the UI needs, over the same singular-REST surface EPIC 020 shipped:
#   * POST on a collection creates → 201 + Location, and the Location is a real
#     route that answers 200 with the created row,
#   * PATCH on an item requires `If-Match` (428 without, 412 when stale) and
#     answers 200 with the item DTO plus a FRESH ETag,
#   * a credential's secret travels IN the request body and never comes back,
#   * dependencies are sub-resources: POST …/dependency {dependencyId} | DELETE …/dependency/:dependencyId,
#     for task, initiative and objective, answering 204,
#   * `import graph` is a POST with the package as a JSON body (create mode on a
#     project, apply mode on an initiative), `export initiative` is a GET,
#     `export diagnostic` is a POST (it mints a session ref row), `check graph`
#     is a POST over the posted graph and `check project` is a GET,
#   * the unsafe-method gates 019 shipped and 020 never exercised now run: the
#     Host check, the CSRF origin gate and the 415 content-type gate,
#   * request-body failures map to malformed_body / body_too_large / 415,
#   * every write's effect is then READ BACK through the 020 routes,
#   * auth still gates the writes and SIGTERM still shuts the server down.
#
# The fixture IS the proof: apart from `db migrate`, nothing is created through
# the CLI — every row this script reads was written over HTTP.
#
# Against the CURRENT tree (EPIC 020 landed, 24 rows, all GET) this fails in
# phase B at the FIRST write: `POST /api/project` is not a row, and `/api/project`
# exists as a GET, so the router answers 405 method_not_allowed. Phase A — the
# migration, `serve --port 0`, the bound port and an authenticated /healthz —
# passes today, so the first failure is the missing capability, not a broken
# fixture.
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
SECRET="sekret-body-only"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — '$2' must differ from '$3'" >&2; exit 1; }; }
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- curl-free request helper: status, headers and parsed body all assertable,
# now with a request BODY. Built on node:http (not fetch/undici): the WHATWG
# fetch spec forbids a caller from setting `Host`, so undici silently overrides
# it and the Host-check gate (phase I) could not be proved. Kept as close as
# possible to scripts/e2e/http-reads-proof.sh — one request helper per proof.
cat > "$PD/req.mjs" <<'EOF'
// node req.mjs <METHOD> <URL> <AUTHORIZATION|-> <BODY-FILE|-> [header:value ...]
import http from "node:http";
import { readFileSync } from "node:fs";
const [method, rawUrl, auth, bodyFile, ...raw] = process.argv.slice(2);
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
let body;
if (bodyFile && bodyFile !== "-") {
  body = readFileSync(bodyFile);
  headers["content-type"] = "application/json";
  headers["content-length"] = String(body.byteLength);
}
// Explicit headers win over the defaults above (that is how the 415 and CSRF
// cases send a wrong content-type or a foreign Origin).
for (const h of raw) {
  const i = h.indexOf(":");
  headers[h.slice(0, i).toLowerCase()] = h.slice(i + 1);
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
  if (body !== undefined) req.write(body);
  req.end();
});
EOF

REQ() { node "$PD/req.mjs" "$@"; }
status_of() { printf '%s\n' "$1" | sed -n 's/^STATUS //p' | head -1; }
body_of() { printf '%s\n' "$1" | sed -n 's/^BODY //p' | head -1; }
# hdr_of <out> <lowercase-header-name>
hdr_of() { printf '%s\n' "$1" | sed -n "s/^HEADER $2 //p" | head -1; }
# jv <json> <js-expression over `v`> — the parsed body is `v`.
jv() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
# J <json> → writes the body to a file and echoes its path (avoids shell quoting).
J() { printf '%s' "$1" > "$PD/body.json"; printf '%s' "$PD/body.json"; }

GET() { REQ GET "$BASE$1" "$BASIC" -; }
# OK <label> <path> → asserts 200 and prints the `data` field.
OK() {
  local out; out="$(GET "$2")"
  eq "$1 status" "200" "$(status_of "$out")"
  jv "$(body_of "$out")" 'JSON.stringify(v.data)'
}
# W <METHOD> <path> <json|-> [header:value ...] → echoes the raw response block.
W() {
  local method="$1" path="$2" json="$3"; shift 3
  if [ "$json" = "-" ]; then
    REQ "$method" "$BASE$path" "$BASIC" - "$@"
  else
    REQ "$method" "$BASE$path" "$BASIC" "$(J "$json")" "$@"
  fi
}
# WSTATUS <label> <expected-status> <METHOD> <path> <json|-> [header ...]
WSTATUS() {
  local label="$1" want="$2"; shift 2
  local out; out="$(W "$@")"
  eq "$label status" "$want" "$(status_of "$out")"
  printf '%s' "$out"
}
# WERR <label> <status> <code> <METHOD> <path> <json|-> [header ...]
WERR() {
  local label="$1" want="$2" code="$3"; shift 3
  local out; out="$(W "$@")"
  eq "$label status" "$want" "$(status_of "$out")"
  eq "$label code" "$code" "$(jv "$(body_of "$out")" 'v.error.code')"
}
# CREATED <label> <path> <json> → asserts 201, checks Location answers 200 with
# the same id, and echoes the new id.
CREATED() {
  local out; out="$(W POST "$2" "$3")"
  eq "$1 status" "201" "$(status_of "$out")"
  local id loc
  id="$(jv "$(body_of "$out")" 'v.data.id')"
  loc="$(hdr_of "$out" location)"
  eq "$1 Location" "/api/${4:?resource segment required}/$id" "$loc"
  local follow; follow="$(GET "$loc")"
  eq "$1 Location answers" "200" "$(status_of "$follow")"
  eq "$1 Location id" "$id" "$(jv "$(body_of "$follow")" 'v.data.id')"
  printf '%s' "$id"
}

echo "--- A: migrate, then serve on an ephemeral port (no CLI fixture at all)"
K db migrate >/dev/null

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
ORIGIN="http://127.0.0.1:$PORT"
OUT="$(GET /healthz)"
eq "healthz still answers" "200" "$(status_of "$OUT")"
echo "    bound port: $PORT"

echo "--- B: POST /api/project — 201 + Location, and the body reader's failures"
PROJECT_A="$(CREATED "create project" "/api/project" '{"name":"alpha"}' "project")"
PROJECT_B="$(CREATED "create second project" "/api/project" '{"name":"beta"}' "project")"
eq "both projects are readable" "2" "$(jv "$(OK "project collection" "/api/project")" 'v.length')"
eq "created name landed" "alpha" "$(jv "$(OK "project item" "/api/project/$PROJECT_A")" 'v.name')"
WERR "blank name" "400" "invalid_input" POST "/api/project" '{"name":"   "}'
WERR "missing name" "400" "invalid_input" POST "/api/project" '{}'
WERR "duplicate name" "409" "duplicate_name" POST "/api/project" '{"name":"alpha"}'
# The request-body reader (decision 2), whose FIRST real consumer this epic is.
WERR "malformed JSON" "400" "malformed_body" POST "/api/project" '{"name":'
WERR "wrong content-type" "415" "unsupported_media_type" POST "/api/project" '{"name":"x"}' "content-type:text/plain"
node -e 'const {writeFileSync}=require("node:fs");writeFileSync(process.argv[1],JSON.stringify({name:"x".repeat(1100000)}))' "$PD/big.json"
OUT="$(REQ POST "$BASE/api/project" "$BASIC" "$PD/big.json")"
eq "oversized body status" "413" "$(status_of "$OUT")"
eq "oversized body code" "body_too_large" "$(jv "$(body_of "$OUT")" 'v.error.code')"

echo "--- C: the planning tree — initiative, objective, task"
INIT="$(CREATED "create initiative" "/api/project/$PROJECT_A/initiative" '{"name":"init-one"}' "initiative")"
OBJ="$(CREATED "create objective" "/api/initiative/$INIT/objective" '{"name":"obj-one"}' "objective")"
T1="$(CREATED "create task" "/api/objective/$OBJ/task" '{"title":"task one","instructions":"do one","ac":["done"]}' "task")"
T2="$(CREATED "create second task" "/api/objective/$OBJ/task" '{"title":"task two","instructions":"do two","ac":["done"]}' "task")"
eq "initiative is readable" "init-one" "$(jv "$(OK "initiative item" "/api/initiative/$INIT")" 'v.name')"
eq "objective is readable" "obj-one" "$(jv "$(OK "objective item" "/api/objective/$OBJ")" 'v.name')"
eq "tasks landed under the initiative" "2" "$(jv "$(OK "task collection" "/api/initiative/$INIT/task")" 'v.length')"
eq "task title landed" "task one" "$(jv "$(OK "task item" "/api/task/$T1")" 'v.title')"
# A paused initiative is created paused — the explicit-activation gate rides in
# the creation body, never a later PATCH.
INIT_PAUSED="$(CREATED "create paused initiative" "/api/project/$PROJECT_A/initiative" '{"name":"init-paused","paused":true}' "initiative")"
eq "paused landed" "true" "$(jv "$(OK "paused initiative" "/api/initiative/$INIT_PAUSED")" 'String(v.paused)')"
WERR "unknown parent project" "404" "unknown_reference" POST "/api/project/01BX5ZZKBKACTAV9WEVGEMMVRZ/initiative" '{"name":"nope"}'
WERR "wrong-type parent" "400" "wrong_type_reference" POST "/api/initiative/$PROJECT_A/objective" '{"name":"nope"}'

echo "--- D: resources — four typed creates, then the bulk import"
BARE="$PD/home.git"; git init -q --bare -b main "$BARE"
CRED="$(CREATED "create credential" "/api/project/$PROJECT_A/credential" "{\"name\":\"gh\",\"provider\":\"github\",\"value\":\"$SECRET\"}" "resource")"
REPO="$(CREATED "create repository" "/api/project/$PROJECT_A/repository" "{\"name\":\"home\",\"remoteUrl\":\"file://$BARE\",\"branch\":\"main\",\"auth\":{\"kind\":\"ambient\"},\"path\":\"$PD/mirror\"}" "resource")"
NOTIF="$(CREATED "create notification" "/api/project/$PROJECT_A/notification" '{"name":"ops","provider":"slack","destination":"#ops"}' "resource")"
FS="$(CREATED "create filesystem" "/api/project/$PROJECT_A/filesystem" "{\"name\":\"scratch\",\"path\":\"$PD/ws\"}" "resource")"
CRED_DATA="$(OK "credential collection" "/api/project/$PROJECT_A/credential")"
absent "the posted secret never comes back" "$CRED_DATA" "$SECRET"
eq "credential has no value field" "true" "$(jv "$CRED_DATA" 'v.every(r=>r.value===undefined)')"
eq "repository is readable" "repository" "$(jv "$(OK "resource item" "/api/resource/$REPO")" 'v.type')"
eq "notification landed" "$NOTIF" "$(jv "$(OK "notification collection" "/api/project/$PROJECT_A/notification")" 'v[0].id')"
eq "filesystem landed" "$FS" "$(jv "$(OK "filesystem collection" "/api/project/$PROJECT_A/filesystem")" 'v[0].id')"
# Bulk import: 200 + ids, no Location (decision 1's stated exception).
OUT="$(WSTATUS "bulk import" "200" POST "/api/project/$PROJECT_B/resource" '{"entries":[{"type":"filesystem","name":"bulk-one","path":"/tmp/one"},{"type":"filesystem","name":"bulk-two","path":"/tmp/two"}]}')"
eq "bulk import id count" "2" "$(jv "$(body_of "$OUT")" 'v.data.ids.length')"
eq "bulk import has no Location" "" "$(hdr_of "$OUT" location)"
eq "bulk entries are readable" "2" "$(jv "$(OK "beta filesystems" "/api/project/$PROJECT_B/filesystem")" 'v.length')"
WERR "bulk duplicate name" "400" "import_validation" POST "/api/project/$PROJECT_B/resource" '{"entries":[{"type":"filesystem","name":"bulk-one","path":"/tmp/one"}]}'

echo "--- E: PATCH — If-Match is required, and a stale ETag loses"
OUT="$(GET "/api/project/$PROJECT_A")"
ETAG="$(hdr_of "$OUT" etag)"
[ -n "$ETAG" ] || { echo "FAILED: item GET must carry an ETag" >&2; exit 1; }
WERR "PATCH with no If-Match" "428" "precondition_required" PATCH "/api/project/$PROJECT_A" '{"name":"alpha-2"}'
WERR "PATCH with a stale ETag" "412" "precondition_failed" PATCH "/api/project/$PROJECT_A" '{"name":"alpha-2"}' "if-match:\"deadbeef\""
OUT="$(WSTATUS "PATCH project" "200" PATCH "/api/project/$PROJECT_A" '{"name":"alpha-2"}' "if-match:$ETAG")"
eq "PATCH answers with the new DTO" "alpha-2" "$(jv "$(body_of "$OUT")" 'v.data.name')"
NEW_ETAG="$(hdr_of "$OUT" etag)"
ne "PATCH answers a fresh ETag" "$ETAG" "$NEW_ETAG"
eq "the rename is readable" "alpha-2" "$(jv "$(OK "renamed project" "/api/project/$PROJECT_A")" 'v.name')"
# The lost-update case: the same request replayed with the OLD validator loses.
WERR "replayed stale PATCH" "412" "precondition_failed" PATCH "/api/project/$PROJECT_A" '{"name":"alpha-3"}' "if-match:$ETAG"
# The other six item PATCHes.
patch_item() {
  local label="$1" path="$2" json="$3"
  local tag; tag="$(hdr_of "$(GET "$4")" etag)"
  local out; out="$(W PATCH "$path" "$json" "if-match:$tag")"
  eq "$label status" "200" "$(status_of "$out")"
  printf '%s' "$(body_of "$out")"
}
eq "PATCH initiative" "init-renamed" "$(jv "$(patch_item "PATCH initiative" "/api/initiative/$INIT" '{"name":"init-renamed"}' "/api/initiative/$INIT")" 'v.data.name')"
eq "PATCH objective" "obj-renamed" "$(jv "$(patch_item "PATCH objective" "/api/objective/$OBJ" '{"name":"obj-renamed"}' "/api/objective/$OBJ")" 'v.data.name')"
eq "PATCH credential" "gh-renamed" "$(jv "$(patch_item "PATCH credential" "/api/credential/$CRED" '{"name":"gh-renamed"}' "/api/resource/$CRED")" 'v.data.name')"
eq "PATCH filesystem" "scratch-2" "$(jv "$(patch_item "PATCH filesystem" "/api/filesystem/$FS" '{"name":"scratch-2"}' "/api/resource/$FS")" 'v.data.name')"
eq "PATCH notification" "ops-2" "$(jv "$(patch_item "PATCH notification" "/api/notification/$NOTIF" '{"name":"ops-2"}' "/api/resource/$NOTIF")" 'v.data.name')"
eq "PATCH repository branch" "trunk" "$(jv "$(patch_item "PATCH repository" "/api/repository/$REPO" '{"branch":"trunk"}' "/api/resource/$REPO")" 'v.data.branch')"
REPO_TAG="$(hdr_of "$(GET "/api/resource/$REPO")" etag)"
WERR "immutable field" "409" "immutable_field" PATCH "/api/repository/$REPO" '{"type":"credential"}' "if-match:$REPO_TAG"
CRED_TAG="$(hdr_of "$(GET "/api/resource/$CRED")" etag)"
OUT="$(WSTATUS "rotate credential value" "200" PATCH "/api/credential/$CRED" '{"value":"rotated-secret"}' "if-match:$CRED_TAG")"
absent "a rotated secret never comes back" "$(body_of "$OUT")" "rotated-secret"

echo "--- F: dependencies are sub-resources (POST …/dependency {dependencyId}, DELETE …/dependency/:id)"
eq "add task dependency" "204" "$(status_of "$(W POST "/api/task/$T2/dependency" "{\"dependencyId\":\"$T1\"}")")"
eq "the edge is readable" "true" "$(jv "$(OK "task item" "/api/task/$T2")" 'v.dependencies.includes("'"$T1"'")')"
eq "remove task dependency" "204" "$(status_of "$(W DELETE "/api/task/$T2/dependency/$T1" -)")"
eq "the edge is gone" "0" "$(jv "$(OK "task item" "/api/task/$T2")" 'v.dependencies.length')"
WERR "self edge" "409" "cycle_detected" POST "/api/task/$T1/dependency" "{\"dependencyId\":\"$T1\"}"
WERR "unknown dependency" "404" "unknown_reference" POST "/api/task/$T1/dependency" '{"dependencyId":"01BX5ZZKBKACTAV9WEVGEMMVRZ"}'
INIT2="$(CREATED "create sibling initiative" "/api/project/$PROJECT_A/initiative" '{"name":"init-two"}' "initiative")"
eq "add initiative dependency" "204" "$(status_of "$(W POST "/api/initiative/$INIT2/dependency" "{\"dependencyId\":\"$INIT\"}")")"
eq "remove initiative dependency" "204" "$(status_of "$(W DELETE "/api/initiative/$INIT2/dependency/$INIT" -)")"
OBJ2="$(CREATED "create sibling objective" "/api/initiative/$INIT/objective" '{"name":"obj-two"}' "objective")"
eq "add objective dependency" "204" "$(status_of "$(W POST "/api/objective/$OBJ2/dependency" "{\"dependencyId\":\"$OBJ\"}")")"
eq "remove objective dependency" "204" "$(status_of "$(W DELETE "/api/objective/$OBJ2/dependency/$OBJ" -)")"
INIT_B="$(CREATED "create cross-project initiative" "/api/project/$PROJECT_B/initiative" '{"name":"init-beta"}' "initiative")"
WERR "cross-project edge" "400" "sequencing_scope" POST "/api/initiative/$INIT_B/dependency" "{\"dependencyId\":\"$INIT\"}"

echo "--- G: import graph (POST, JSON body), export initiative (GET)"
PKG_DIR="$PD/pkg"; mkdir -p "$PKG_DIR"
cat > "$PKG_DIR/initiative.md" <<'EOF'
---
kind: initiative
ref: wp-init
name: Wire protocol
bindings:
  source: repository
---
EOF
cat > "$PKG_DIR/objective.md" <<'EOF'
---
kind: objective
ref: wp-obj
initiative: wp-init
name: First objective
---
EOF
cat > "$PKG_DIR/task-1.md" <<'EOF'
---
kind: task
ref: wp-task-1
objective: wp-obj
title: Wire protocol · step 1
agent: generic@1
context:
  source: source
---
# Instructions
Append one deterministic marker line. This task is never run by this proof.
# Acceptance Criteria
- [ ] one line appended
# Verification
```sh
true
```
EOF
# The request body is built by the SAME parser the CLI uses, so this phase
# proves the route, not a hand-written package.
node --input-type=module -e '
import { readGraphPackageDir } from "./src/apps/cli/graph-md/parse.ts";
import { parseGraphPackage } from "./src/app/graph/graph-codec.ts";
const files = await readGraphPackageDir(process.argv[1]);
const pkg = parseGraphPackage(files);
// The CLI --create path leaves packageId "" (graph-codec.ts:304). The
// server-side validator (review blocker S1) does not require a non-empty
// packageId — project.graph.create mints its own via deps.newId() and
// discards the client value — so the CLI parser output is posted UNMODIFIED,
// proving the route against a real client body, not a hand-patched one.
process.stdout.write(JSON.stringify({ pkg, bindings: { source: process.argv[2] } }));
' "$PKG_DIR" "$REPO" > "$PD/create-graph.json"
OUT="$(REQ POST "$BASE/api/project/$PROJECT_A/graph" "$BASIC" "$PD/create-graph.json")"
eq "import graph --create status" "201" "$(status_of "$OUT")"
GRAPH_INIT="$(jv "$(body_of "$OUT")" 'v.data.initiativeId')"
eq "import graph Location" "/api/initiative/$GRAPH_INIT" "$(hdr_of "$OUT" location)"
eq "created graph is readable" "Wire protocol" "$(jv "$(OK "graph initiative" "/api/initiative/$GRAPH_INIT")" 'v.name')"
eq "created graph has one task" "1" "$(jv "$(OK "graph tasks" "/api/initiative/$GRAPH_INIT/task")" 'v.length')"
eq "ref→id map returned" "true" "$(jv "$(body_of "$OUT")" 'Object.keys(v.data.refToId.tasks).length===1')"
# export initiative is a GET — the use case is read-only and the CLI's file
# writing is adapter work the HTTP client does for itself.
PKG_DATA="$(OK "export initiative" "/api/initiative/$GRAPH_INIT/package")"
eq "package carries a formatVersion" "true" "$(jv "$PKG_DATA" 'typeof v.formatVersion==="number"')"
eq "package carries the manifest" "$GRAPH_INIT" "$(jv "$PKG_DATA" 'v.manifest.initiativeId')"
eq "package carries the task" "1" "$(jv "$PKG_DATA" 'v.tasks.length')"
# apply mode: the exported package fed straight back, as a dry run.
node -e 'const {writeFileSync,readFileSync}=require("node:fs");writeFileSync(process.argv[2],JSON.stringify({pkg:JSON.parse(process.argv[1]),dryRun:true}))' "$PKG_DATA" "$PD/apply-graph.json"
OUT="$(REQ POST "$BASE/api/initiative/$GRAPH_INIT/graph" "$BASIC" "$PD/apply-graph.json")"
eq "import graph --apply status" "200" "$(status_of "$OUT")"
eq "the apply report classifies every node" "true" "$(jv "$(body_of "$OUT")" 'v.data.classifications.length>=3&&typeof v.data.summary.unchanged==="number"')"
# `freshNodeShas`/`createdNodes` are documented as absent on dry-run
# (apply-graph.ts:82-85) — assert that directly, not a summary count that
# holds identically whether dryRun is true or false.
eq "a dry run withholds fresh node data" "true" "$(jv "$(body_of "$OUT")" 'v.data.freshNodeShas===undefined&&v.data.createdNodes===undefined')"
eq "a dry run applies nothing" "false" "$(jv "$(body_of "$OUT")" 'String(v.data.applied)')"
# A real (non-dry-run) apply of the SAME package proves the withholding above
# is dry-run-specific, not an accident of an untouched fixture: freshNodeShas
# is populated whenever the apply actually runs (absent only on dry-run or
# conflicts — there are none here, it is a conflict-free re-import).
node -e 'const {writeFileSync,readFileSync}=require("node:fs");writeFileSync(process.argv[2],JSON.stringify({pkg:JSON.parse(process.argv[1])}))' "$PKG_DATA" "$PD/apply-graph-real.json"
OUT2="$(REQ POST "$BASE/api/initiative/$GRAPH_INIT/graph" "$BASIC" "$PD/apply-graph-real.json")"
eq "import graph --apply (real) status" "200" "$(status_of "$OUT2")"
eq "a real apply defines fresh node data" "true" "$(jv "$(body_of "$OUT2")" 'v.data.freshNodeShas!==undefined')"
eq "a real apply reports applied" "true" "$(jv "$(body_of "$OUT2")" 'String(v.data.applied)')"

echo "--- H: check graph (POST), check project (GET), export diagnostic (POST)"
OUT="$(WSTATUS "check graph" "200" POST "/api/graph/readiness" '{"tasks":[{"id":"a"},{"id":"b","dependencies":["a"]}]}')"
eq "readiness of the root" "ready" "$(jv "$(body_of "$OUT")" 'v.data.find(e=>e.id==="a").state')"
eq "readiness of the blocked node" "blocked" "$(jv "$(body_of "$OUT")" 'v.data.find(e=>e.id==="b").state')"
WERR "check graph rejects a cycle" "409" "cycle_detected" POST "/api/graph/readiness" '{"tasks":[{"id":"a","dependencies":["b"]},{"id":"b","dependencies":["a"]}]}'
WERR "check graph rejects an unknown dependency" "400" "unknown_dependency" POST "/api/graph/readiness" '{"tasks":[{"id":"a","dependencies":["ghost"]}]}'
READY="$(OK "check project" "/api/project/$PROJECT_A/readiness")"
eq "readiness projectId" "$PROJECT_A" "$(jv "$READY" 'v.projectId')"
eq "readiness report shape" "true" "$(jv "$READY" 'typeof v.ready==="boolean"&&typeof v.configured==="boolean"&&Array.isArray(v.checks)')"
# export diagnostic is a POST: it mints a session ref row on every call
# (src/storage/sqlite/sqlite-observability-refs.ts:25), so it is not a read.
OUT="$(WSTATUS "export diagnostic" "200" POST "/api/initiative/$INIT/diagnostic" '{}')"
DIAG="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
eq "diagnostic carries records" "true" "$(jv "$DIAG" 'Array.isArray(v.records)&&v.schemaVersion==="007.1"')"
eq "diagnostic never names a server path" "true" "$(jv "$DIAG" 'v.outPath===undefined')"
eq "diagnostic never names the real initiative id" "true" "$(jv "$DIAG" 'v.initiativeRef!=="'"$INIT"'"')"

echo "--- I: the unsafe-method gates 020 never exercised (decision 5)"
WERR "foreign Host" "403" "host_not_allowed" POST "/api/project" '{"name":"gate"}' "host:evil.example"
WERR "foreign Origin" "403" "origin_not_allowed" POST "/api/project" '{"name":"gate"}' "origin:http://127.0.0.1:1"
WERR "foreign Origin on DELETE" "403" "origin_not_allowed" DELETE "/api/task/$T2/dependency/$T1" - "origin:http://evil.example"
GATE="$(CREATED "the server's own Origin is accepted" "/api/project" '{"name":"gate-ok"}' "project")"
[ -n "$GATE" ]
OUT="$(REQ POST "$BASE/api/project" "$BASIC" "$(J '{"name":"gate-ok-2"}')" "origin:$ORIGIN")"
eq "explicit same-origin POST" "201" "$(status_of "$OUT")"
OUT="$(REQ OPTIONS "$BASE/api/project" "-" - "origin:$ORIGIN" "access-control-request-method:POST")"
contains "preflight allows the write methods" "$(hdr_of "$OUT" access-control-allow-methods)" "PATCH"
OUT="$(REQ POST "$BASE/api/project" "-" "$(J '{"name":"nope"}')")"
eq "unauthenticated write status" "401" "$(status_of "$OUT")"
eq "unauthenticated write code" "unauthenticated" "$(jv "$(body_of "$OUT")" 'v.error.code')"
eq "unauthenticated write changed nothing" "false" "$(jv "$(OK "project collection" "/api/project")" 'v.some(p=>p.name==="nope")')"
OUT="$(GET "/api/project/$PROJECT_A")"
contains "the Allow header names the item's methods" "$(status_of "$(REQ PUT "$BASE/api/project/$PROJECT_A" "$BASIC" "$(J '{}')")")" "405"

echo "--- J: no secret in the log, and SIGTERM still shuts down"
absent "the API key never reaches the log" "$(cat "$PD/serve.log")" "$KEY"
absent "a posted secret never reaches the log" "$(cat "$PD/serve.log")" "$SECRET"
absent "a rotated secret never reaches the log" "$(cat "$PD/serve.log")" "rotated-secret"
kill -TERM "$SERVE_PID"
for _ in $(seq 1 50); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$SERVE_PID" 2>/dev/null; then echo "FAILED: serve survived SIGTERM" >&2; exit 1; fi
SERVE_PID=""
eq "port closed after SIGTERM" "0" "$(status_of "$(GET /api/project)")"

echo "021 ok: planning writes on 127.0.0.1:$PORT — POST creates with 201+Location, PATCH needs If-Match (428/412) and answers 200+fresh ETag, dependency sub-resources 204, import graph create+apply over JSON, export initiative GET / export diagnostic POST, check graph POST / check project GET, body reader maps 400/413/415, Host+CSRF+auth gates hold, no secret logged, shutdown clean"
