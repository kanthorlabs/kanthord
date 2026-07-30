#!/usr/bin/env bash
# http-provider-writes-proof.sh — EPIC 024 Proof (deterministic, no real model,
# no outbound network beyond loopback, no server and no mock left running).
#
# Proves that the running `kanthord serve` program answers every AI-PROVIDER
# WRITE, so a project can reach `configured: true` over HTTP alone:
#   * POST /api/ai-provider registers with a URL + an API key → 201 + Location,
#     and the secret travels in the BODY and never comes back,
#   * GET /api/project/:id/readiness flips `configured` false → true, which is
#     the whole point of the epic (an empty provider chain makes run-next-task
#     fail every task with `no_provider_available` without attempting it),
#   * POST /api/project/:id/ai-provider assigns (provider id in the BODY, per the
#     RESTful ruling) and DELETE …/ai-provider/:providerId unassigns, both 204,
#     and `rank` makes the chain ORDER expressible,
#   * PUT /api/ai-provider/default repoints the global default (204) and says so
#     idempotently in the protocol — the identical PUT twice is one outcome,
#   * PATCH /api/ai-provider/:id edits config and rotates the secret under
#     If-Match (428 absent, 412 stale), answering 200 + a fresh ETag,
#   * DELETE /api/ai-provider/:id/credential is `logout` and
#     DELETE /api/ai-provider/:id is `remove`, both with their human-gated
#     escapes as EXPLICIT query parameters, never defaults,
#   * POST /api/ai-provider/:id/probe and POST /api/ai-provider/:id/completion
#     are the ONLY two routes allowed a real outbound call: the probe returns a
#     fixed detail and reports a dead endpoint as 200/failed (never 500), while
#     the completion returns the caller's prompt and the MODEL's own reply and
#     reports a dead endpoint as 502 provider_call_failed,
#   * no secret appears in any response body or any server log line.
#
# Hermetic: the outbound call goes to scripts/e2e/mock-openai-completions.mjs on
# loopback, registered as a custom OpenAI-compatible provider with the explicit
# `allowInsecure` opt-in — the same recipe 008.1's proof already uses.
#
# EXPECTED FAILURE TODAY. This script is written before the implementation, as
# AGENTS.md requires. Phase A ends with a PREREQ probe so a missing dependency
# is never mistaken for a missing 024 capability:
#   * EPICs 021/022/023 are planned but NOT built, so the fixture writes this
#     proof needs (POST /api/project and friends) do not exist yet. The PREREQ
#     probe reports that and exits 2.
#   * Once 021-023 land, the first failure moves to phase C: POST
#     /api/ai-provider answers 405 method_not_allowed, because /api/ai-provider
#     IS a route today as a GET only (src/apps/http/routes.ts:309-317), so
#     matchRoute reports method_not_allowed rather than unknown_route. The
#     missing thing is the write row — exit 1.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PD="$(mktemp -d)"
SERVE_PID=""
MOCK_PID=""
cleanup() {
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi
  if [ -n "$MOCK_PID" ]; then kill "$MOCK_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

# Hermetic: an isolated database, and an isolated working directory so `serve`
# loads the proof's .env and NEVER the developer's real .env.
export KANTHORD_DB="$PD/kanthord.db"
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"
# The two provider secrets. Distinct strings so phase J can prove BOTH are
# absent from every log line — the rotated one as well as the registered one.
SECRET1="sk-PROOF-SECRET-REGISTERED"
SECRET2="sk-PROOF-SECRET-ROTATED"
# The marker the mock streams (scripts/e2e/mock-openai-completions.mjs:22). Phase
# H asserts it comes back as the completion `reply` and NEVER as a probe detail;
# phase J asserts the model's words reach no log line.
MARKER="DATETIME-OK"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — '$2' must differ from '$3'" >&2; exit 1; }; }
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- curl-free request helper, identical in shape to http-writes-proof.sh's:
# status, headers and parsed body all assertable, with a request BODY. Built on
# node:http (not fetch/undici) so a caller can set `Host` — undici silently
# overrides it, which would make the Host-check gate unprovable.
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
hdr_of() { printf '%s\n' "$1" | sed -n "s/^HEADER $2 //p" | head -1; }
# jv <json> <js-expression over `v`> — the parsed body is `v`.
jv() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
# J <json> → writes the body to a UNIQUE file and echoes its path. Unique per
# call: a shared body.json breaks the moment one helper nests inside another.
BODY_SEQ=0
J() { BODY_SEQ=$((BODY_SEQ + 1)); printf '%s' "$1" > "$PD/body-$BODY_SEQ.json"; printf '%s' "$PD/body-$BODY_SEQ.json"; }

GET() { REQ GET "$BASE$1" "$BASIC" -; }
# OK <label> <path> → asserts 200 and prints the `data` field as JSON.
OK() {
  local out; out="$(GET "$2")"
  eq "$1 status" "200" "$(status_of "$out")"
  jv "$(body_of "$out")" 'JSON.stringify(v.data)'
}
# ETAG <path> → the item's current strong validator.
ETAG() { hdr_of "$(GET "$1")" etag; }
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
# CREATED <label> <path> <json> <location-segment> → asserts 201, follows
# Location to a 200 with the same id, echoes the new id.
CREATED() {
  local out; out="$(W POST "$2" "$3")"
  eq "$1 status" "201" "$(status_of "$out")"
  local id loc
  id="$(jv "$(body_of "$out")" 'v.data.id')"
  loc="$(hdr_of "$out" location)"
  eq "$1 Location" "/api/${4:?location segment required}/$id" "$loc"
  local follow; follow="$(GET "$loc")"
  eq "$1 Location answers" "200" "$(status_of "$follow")"
  eq "$1 Location id" "$id" "$(jv "$(body_of "$follow")" 'v.data.id')"
  printf '%s' "$id"
}
# CHECK <readiness-json> <check-name> <field> → that check's field.
CHECK() { jv "$1" "v.checks.find(c=>c.name===$(printf '%s' "'$2'")).$3"; }

echo "--- A: migrate, start the loopback model mock, then serve on an ephemeral port"
K db migrate >/dev/null

node "$ROOT/scripts/e2e/mock-openai-completions.mjs" > "$PD/mock.url" 2>"$PD/mock.log" &
MOCK_PID=$!
for _ in $(seq 1 50); do [ -s "$PD/mock.url" ] && break; sleep 0.1; done
[ -s "$PD/mock.url" ] || { echo "FAILED: model mock printed no base URL" >&2; cat "$PD/mock.log" >&2; exit 1; }
# The mock prints its FULL base URL, already including /v1. Used verbatim —
# appending /v1 here would produce /v1/v1/chat/completions.
MOCK_URL="$(cat "$PD/mock.url")"
echo "    mock base URL: $MOCK_URL"

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
echo "    bound port: $PORT"

# --- PREREQ: 024 builds its fixture over the 021 planning-write rows. If those
# do not exist, the failure below is a DEPENDENCY gap, not a 024 gap. Reported
# separately (exit 2) so the two can never be confused.
PREREQ="$(W POST "/api/project" '{"name":"prereq-probe"}')"
PREREQ_STATUS="$(status_of "$PREREQ")"
if [ "$PREREQ_STATUS" != "201" ]; then
  echo "PREREQ MISSING: POST /api/project answered $PREREQ_STATUS, expected 201." >&2
  echo "  EPIC 024's fixture is written over the EPIC 021 planning-write rows." >&2
  echo "  Build 021 (and 022/023) first; then this proof's first failure moves" >&2
  echo "  to phase C, on POST /api/ai-provider — the capability 024 adds." >&2
  exit 2
fi

echo "--- B: the project a readiness check needs, built entirely over 021 rows"
PROJECT="$(CREATED "create project" "/api/project" '{"name":"provider-proof"}' "project")"
BARE="$PD/home.git"; git init -q --bare -b main "$BARE"
REPO="$(CREATED "create repository" "/api/project/$PROJECT/repository" \
  "{\"name\":\"home\",\"remoteUrl\":\"file://$BARE\",\"branch\":\"main\",\"auth\":{\"kind\":\"ambient\"},\"path\":\"$PD/mirror\"}" "resource")"
# The initiative check needs a BUILDING, unpaused initiative with at least one
# INCOMPLETE task (src/app/project/project-readiness.ts:341-343) — so an
# objective and a task are part of the fixture, not decoration.
INIT="$(CREATED "create initiative" "/api/project/$PROJECT/initiative" '{"name":"init-one"}' "initiative")"
OBJ="$(CREATED "create objective" "/api/initiative/$INIT/objective" '{"name":"obj-one"}' "objective")"
TASK="$(CREATED "create task" "/api/objective/$OBJ/task" \
  '{"title":"task one","instructions":"do one","ac":["done"]}' "task")"

READY="$(OK "readiness before any provider" "/api/project/$PROJECT/readiness")"
eq "database check is ok" "ok" "$(CHECK "$READY" database status)"
eq "initiative check is ok" "ok" "$(CHECK "$READY" initiative status)"
# A recorded-but-unprobed repository is `unverified`, which is NOT in
# NOT_CONFIGURED_STATUSES — so it does not hold `configured` down.
eq "repository check is unverified" "unverified" "$(CHECK "$READY" repository status)"
eq "ai_provider check is missing" "missing" "$(CHECK "$READY" ai_provider status)"
eq "the project is NOT configured" "false" "$(jv "$READY" 'String(v.configured)')"
echo "    configured=false, ai_provider=missing — the exact gap EPIC 024 closes"

echo "--- C: POST /api/ai-provider — 201 + Location, secret in the body only"
P1="$(CREATED "register custom provider" "/api/ai-provider" \
  "{\"name\":\"qwen-local\",\"api\":\"openai-completions\",\"customProviderId\":\"qwen-token-plan\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"qwen-max\",\"allowInsecure\":true,\"value\":\"$SECRET1\"}" \
  "ai-provider")"
P1_DATA="$(OK "provider item" "/api/ai-provider/$P1")"
eq "the DTO has exactly the eight literal keys" \
  "baseUrl,effort,id,isDefault,model,name,provider,state" \
  "$(jv "$P1_DATA" 'Object.keys(v).sort().join(",")')"
absent "the registered secret never comes back" "$P1_DATA" "$SECRET1"
eq "the new provider is active" "active" "$(jv "$P1_DATA" 'v.state')"
eq "the first provider wins the default" "true" "$(jv "$P1_DATA" 'String(v.isDefault)')"
eq "it appears in the collection" "1" "$(jv "$(OK "provider collection" "/api/ai-provider")" 'v.length')"
# Registration failure paths, each at a throw site the error registry maps.
WERR "loopback base URL without the opt-in" "400" "insecure_endpoint" POST "/api/ai-provider" \
  "{\"name\":\"no-optin\",\"api\":\"openai-completions\",\"customProviderId\":\"qwen-token-plan\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"qwen-max\",\"value\":\"$SECRET1\"}"
WERR "missing value" "400" "invalid_input" POST "/api/ai-provider" \
  "{\"name\":\"no-value\",\"api\":\"openai-completions\",\"customProviderId\":\"qwen-token-plan\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"qwen-max\",\"allowInsecure\":true}"
WERR "empty value" "400" "empty_value" POST "/api/ai-provider" \
  "{\"name\":\"empty\",\"api\":\"openai-completions\",\"customProviderId\":\"qwen-token-plan\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"qwen-max\",\"allowInsecure\":true,\"value\":\"\"}"
WERR "bad api flavor" "400" "invalid_api_flavor" POST "/api/ai-provider" \
  "{\"name\":\"bad-api\",\"api\":\"nope\",\"customProviderId\":\"x\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"m\",\"allowInsecure\":true,\"value\":\"$SECRET1\"}"
WERR "custom without customProviderId" "400" "missing_custom_provider_id" POST "/api/ai-provider" \
  "{\"name\":\"no-cpid\",\"api\":\"openai-completions\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"m\",\"allowInsecure\":true,\"value\":\"$SECRET1\"}"
WERR "builtin with an unknown model" "400" "unknown_model" POST "/api/ai-provider" \
  "{\"name\":\"bad-model\",\"provider\":\"openai-codex\",\"model\":\"no-such-model-exists\",\"value\":\"$SECRET1\"}"
WERR "unknown provider kind" "400" "unknown_provider" POST "/api/ai-provider" \
  "{\"name\":\"bad-kind\",\"provider\":\"no-such-provider\",\"model\":\"m\",\"value\":\"$SECRET1\"}"

echo "--- D: configured flips true — through the GLOBAL DEFAULT, with no assignment"
READY="$(OK "readiness after register" "/api/project/$PROJECT/readiness")"
eq "ai_provider check is ok" "ok" "$(CHECK "$READY" ai_provider status)"
eq "the project IS configured" "true" "$(jv "$READY" 'String(v.configured)')"
# The chain resolved via the default pointer, so the detail says so — the
# implicit dependency a project that never ran `assign` would not otherwise see.
contains "the detail names the global-default route" "$(CHECK "$READY" ai_provider detail)" "global default provider"
echo "    configured=true over HTTP alone — the epic's goal"

echo "--- E: the project chain — assignment, and ORDER via rank"
WSTATUS "assign p1" "204" POST "/api/project/$PROJECT/ai-provider" "{\"providerId\":\"$P1\"}" >/dev/null
CHAIN="$(OK "chain after assign" "/api/project/$PROJECT/ai-provider")"
eq "the chain holds one provider" "1" "$(jv "$CHAIN" 'v.length')"
eq "and it is p1" "$P1" "$(jv "$CHAIN" 'v[0].id')"
# The assign write now participates in the configured path: the check resolves
# through the ASSIGNMENT, so the default-suffix leaves the detail.
READY="$(OK "readiness after assign" "/api/project/$PROJECT/readiness")"
eq "ai_provider still ok" "ok" "$(CHECK "$READY" ai_provider status)"
absent "the default-suffix is gone once assigned" "$(CHECK "$READY" ai_provider detail)" "global default provider"
# A second provider, inserted at the HEAD of the chain — order is expressible.
P2="$(CREATED "register second provider" "/api/ai-provider" \
  "{\"name\":\"qwen-second\",\"api\":\"openai-completions\",\"customProviderId\":\"qwen-token-plan\",\"baseUrl\":\"$MOCK_URL\",\"model\":\"qwen-max\",\"allowInsecure\":true,\"value\":\"$SECRET1\"}" \
  "ai-provider")"
WSTATUS "assign p2 at rank 0" "204" POST "/api/project/$PROJECT/ai-provider" "{\"providerId\":\"$P2\",\"rank\":0}" >/dev/null
CHAIN="$(OK "chain after ranked assign" "/api/project/$PROJECT/ai-provider")"
eq "the chain holds two providers" "2" "$(jv "$CHAIN" 'v.length')"
eq "rank 0 put p2 at the head" "$P2" "$(jv "$CHAIN" 'v[0].id')"
eq "and pushed p1 down" "$P1" "$(jv "$CHAIN" 'v[1].id')"
WERR "duplicate assignment" "409" "duplicate_assignment" POST "/api/project/$PROJECT/ai-provider" "{\"providerId\":\"$P2\"}"
WERR "negative rank" "400" "invalid_rank" POST "/api/project/$PROJECT/ai-provider" "{\"providerId\":\"$P1\",\"rank\":-1}"
WERR "unknown provider id" "404" "unknown_reference" POST "/api/project/$PROJECT/ai-provider" '{"providerId":"01BX5ZZKBKACTAV9WEVGEMMVRZ"}'
WERR "unknown project id" "404" "unknown_reference" POST "/api/project/01BX5ZZKBKACTAV9WEVGEMMVRZ/ai-provider" "{\"providerId\":\"$P1\"}"
WSTATUS "unassign p2" "204" DELETE "/api/project/$PROJECT/ai-provider/$P2" - >/dev/null
eq "p2 left the chain" "1" "$(jv "$(OK "chain after unassign" "/api/project/$PROJECT/ai-provider")" 'v.length')"
WSTATUS "unassign p2 again is idempotent" "204" DELETE "/api/project/$PROJECT/ai-provider/$P2" - >/dev/null

echo "--- F: PUT /api/ai-provider/default repoints the global default, idempotently"
eq "p1 is the default before" "true" "$(jv "$(OK "p1" "/api/ai-provider/$P1")" 'String(v.isDefault)')"
WSTATUS "set default to p2" "204" PUT "/api/ai-provider/default" "{\"providerId\":\"$P2\"}" >/dev/null
eq "p1 is no longer the default" "false" "$(jv "$(OK "p1" "/api/ai-provider/$P1")" 'String(v.isDefault)')"
eq "p2 is the default now" "true" "$(jv "$(OK "p2" "/api/ai-provider/$P2")" 'String(v.isDefault)')"
# PUT was chosen over POST so the idempotence is stated in the protocol, not
# merely true by accident in setDefault. Proved, not asserted.
WSTATUS "the identical PUT again" "204" PUT "/api/ai-provider/default" "{\"providerId\":\"$P2\"}" >/dev/null
eq "p2 is still the only default" "true" "$(jv "$(OK "p2" "/api/ai-provider/$P2")" 'String(v.isDefault)')"
eq "exactly one provider is default" "1" "$(jv "$(OK "provider collection" "/api/ai-provider")" 'v.filter(p=>p.isDefault).length')"
WERR "default to an unknown provider" "404" "unknown_reference" PUT "/api/ai-provider/default" '{"providerId":"01BX5ZZKBKACTAV9WEVGEMMVRZ"}'
# `default` can never shadow a real id: ids are 26-char ULIDs.
eq "GET /api/ai-provider/default is just an unknown id" "404" "$(status_of "$(GET "/api/ai-provider/default")")"

echo "--- G: PATCH under If-Match — config edit, then secret rotation"
TAG="$(ETAG "/api/ai-provider/$P1")"
contains "the item GET carries an ETag" "$TAG" '"'
WERR "PATCH with no If-Match" "428" "precondition_required" PATCH "/api/ai-provider/$P1" '{"model":"qwen-plus"}'
WERR "PATCH with a stale validator" "412" "precondition_failed" PATCH "/api/ai-provider/$P1" '{"model":"qwen-plus"}' "if-match:\"deadbeef\""
OUT="$(WSTATUS "PATCH model" "200" PATCH "/api/ai-provider/$P1" '{"model":"qwen-plus"}' "if-match:$TAG")"
eq "the response carries the new model" "qwen-plus" "$(jv "$(body_of "$OUT")" 'v.data.model')"
NEWTAG="$(hdr_of "$OUT" etag)"
ne "the ETag is fresh" "$TAG" "$NEWTAG"
# The lost update, proved: replaying the same request with the old validator.
WERR "replay with the old validator" "412" "precondition_failed" PATCH "/api/ai-provider/$P1" '{"model":"qwen-max"}' "if-match:$TAG"
WERR "PATCH with no fields" "400" "no_update_fields" PATCH "/api/ai-provider/$P1" '{}' "if-match:$NEWTAG"
# A builtin row refuses the custom-only fields.
P3="$(CREATED "register builtin provider" "/api/ai-provider" \
  "{\"name\":\"codex\",\"provider\":\"openai-codex\",\"model\":\"gpt-5.6-terra\",\"value\":\"$SECRET1\"}" "ai-provider")"
WERR "builtin patched with baseUrl" "400" "builtin_provider_field" PATCH "/api/ai-provider/$P3" \
  "{\"baseUrl\":\"$MOCK_URL\"}" "if-match:$(ETAG "/api/ai-provider/$P3")"
# Secret rotation: the body carries the new secret and the response carries
# neither the old nor the new one.
OUT="$(WSTATUS "rotate the secret" "200" PATCH "/api/ai-provider/$P1" \
  "{\"value\":\"$SECRET2\"}" "if-match:$(ETAG "/api/ai-provider/$P1")")"
absent "the rotated secret is not echoed" "$(body_of "$OUT")" "$SECRET2"
absent "the old secret is not echoed either" "$(body_of "$OUT")" "$SECRET1"

echo "--- H: the two outbound rows — a readiness probe and a real model test"
OUT="$(WSTATUS "probe a live provider" "200" POST "/api/ai-provider/$P1/probe" '{}')"
PROBE="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
eq "the probe DTO has exactly three keys" "detail,id,status" "$(jv "$PROBE" 'Object.keys(v).sort().join(",")')"
eq "the probe reached the mock" "ok" "$(jv "$PROBE" 'v.status')"
eq "the detail is the fixed confirmation, never the model reply" \
  "provider answered the probe prompt" "$(jv "$PROBE" 'v.detail')"
absent "no secret in the probe response" "$PROBE" "$SECRET2"
absent "the probe never carries the model's words" "$PROBE" "$MARKER"
# The completion row is the `test ai-provider` twin: the CALLER's prompt goes
# out and the MODEL's own text comes back. This is what the probe row can never
# show, and why decision 6 needs two rows rather than one.
OUT="$(WSTATUS "complete with a caller prompt" "200" POST "/api/ai-provider/$P1/completion" \
  '{"prompt":"What is today'"'"'s datetime?"}')"
COMPLETION="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
eq "the completion DTO has exactly three keys" "id,prompt,reply" "$(jv "$COMPLETION" 'Object.keys(v).sort().join(",")')"
eq "the caller's prompt echoes back" "What is today's datetime?" "$(jv "$COMPLETION" 'v.prompt')"
contains "the MODEL's own text comes back" "$COMPLETION" "$MARKER"
absent "no secret in the completion response" "$COMPLETION" "$SECRET2"
# Take the endpoint away. The two rows now diverge, by design: the probe reports
# a negative RESULT (200), the completion reports a failed CALL (502).
kill "$MOCK_PID" 2>/dev/null || true
wait "$MOCK_PID" 2>/dev/null || true
MOCK_PID=""
OUT="$(WSTATUS "probe a dead provider" "200" POST "/api/ai-provider/$P1/probe" '{}')"
PROBE="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
eq "a dead endpoint reports failed, not 500" "failed" "$(jv "$PROBE" 'v.status')"
absent "the failure detail is redacted" "$PROBE" "$SECRET2"
WERR "complete against a dead provider" "502" "provider_call_failed" POST "/api/ai-provider/$P1/completion" '{}'
WERR "probe an unknown provider" "404" "unknown_reference" POST "/api/ai-provider/01BX5ZZKBKACTAV9WEVGEMMVRZ/probe" '{}'
WERR "complete on an unknown provider" "404" "unknown_reference" POST "/api/ai-provider/01BX5ZZKBKACTAV9WEVGEMMVRZ/completion" '{}'

echo "--- I: logout is DELETE …/credential; remove is DELETE on the item"
# p1 is not the default (p2 is), so no-flag logout is allowed and idempotent.
WSTATUS "logout p1" "204" DELETE "/api/ai-provider/$P1/credential" - >/dev/null
eq "p1 is logged out" "logged_out" "$(jv "$(OK "p1" "/api/ai-provider/$P1")" 'v.state')"
WSTATUS "logout p1 again is idempotent" "204" DELETE "/api/ai-provider/$P1/credential" - >/dev/null
WERR "set-default onto a logged-out provider" "409" "logged_out_provider" PUT "/api/ai-provider/default" "{\"providerId\":\"$P1\"}"
# The DEFAULT needs an explicit escape — never a default value.
WERR "logout the default with no escape" "409" "default_needs_replacement" DELETE "/api/ai-provider/$P2/credential" -
WERR "replacement that is itself logged out" "409" "logged_out_provider" DELETE "/api/ai-provider/$P2/credential?replacement=$P1" -
WERR "both escapes at once" "400" "conflicting_default_choice" DELETE "/api/ai-provider/$P2/credential?replacement=$P3&confirmNoDefault=true" -
WSTATUS "logout the default with a replacement" "204" DELETE "/api/ai-provider/$P2/credential?replacement=$P3" - >/dev/null
eq "the default moved to p3" "true" "$(jv "$(OK "p3" "/api/ai-provider/$P3")" 'String(v.isDefault)')"
# remove: p1 is still assigned to the project.
WERR "remove an assigned provider" "409" "assigned_provider" DELETE "/api/ai-provider/$P1" -
WERR "cascade and replacement together" "400" "ambiguous_options" DELETE "/api/ai-provider/$P1?cascade=true&replacement=$P3" -
WSTATUS "remove with cascade" "204" DELETE "/api/ai-provider/$P1?cascade=true" - >/dev/null
eq "p1 is gone" "404" "$(status_of "$(GET "/api/ai-provider/$P1")")"
eq "and the project chain no longer holds it" "0" \
  "$(jv "$(OK "chain after cascade" "/api/project/$PROJECT/ai-provider")" 'v.filter(p=>p.id==="'"$P1"'").length')"

echo "--- J: no secret in any log line, and a clean shutdown"
LOG="$(cat "$PD/serve.log")"
absent "the registered secret is not logged" "$LOG" "$SECRET1"
absent "the rotated secret is not logged" "$LOG" "$SECRET2"
absent "the API key is not logged" "$LOG" "$KEY"
absent "the model's reply is not logged" "$LOG" "$MARKER"
kill -TERM "$SERVE_PID"
for _ in $(seq 1 50); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.1; done
kill -0 "$SERVE_PID" 2>/dev/null && { echo "FAILED: serve survived SIGTERM" >&2; exit 1; }
SERVE_PID=""
eq "the port stops accepting" "0" "$(status_of "$(GET /healthz)")"

echo "024 ok: registered a provider over HTTP with the secret in the body only, flipped GET /api/project/$PROJECT/readiness to configured=true, assigned and ordered the chain, repointed the default, rotated the secret under If-Match, probed the live endpoint (ok) and the dead one (200/failed, not 500), got the model's own reply back from …/completion and a 502 when the endpoint died, logged out and cascade-removed — no secret and no model text in any log line."
