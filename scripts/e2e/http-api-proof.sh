#!/usr/bin/env bash
# http-api-proof.sh — EPIC 019 Proof (deterministic, no model, no outbound
# network, no server left running). Proves the REST skeleton serves one resource
# end to end: loopback bind, JWT session as a resource, the JSON envelope, the
# error/status map, REST semantics (201 + Location, 204 + empty body, 405 +
# Allow), the hardening chain, and that `GET /api/projects/:id` carries the same
# data as `kanthord get project --json`.
#
# Run from the repo root. Against the CURRENT tree phase A fails at
# `serve --port 0` (`unknown command 'serve'`) — the expected RED state.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

# Per-run scratch: no fixed /tmp names, so concurrent runs never collide.
PD="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
# The server derives its key file from the database directory, so a temp DB keeps
# the whole proof hermetic — it never touches the repo's own .data/.
KEY_FILE="$PD/http-key"

# ── Request helper ────────────────────────────────────────────────────────────
# `req <method> <path> [<<json body>>]` with optional env: TOKEN, COOKIE, CSRF,
# HOST_HEADER, ORIGIN, CTYPE. Prints three lines: status, headers JSON, body.
cat > "$PD/req.mjs" <<'EOF'
const [method, url] = process.argv.slice(2);
let body = "";
for await (const chunk of process.stdin) body += chunk;
const headers = {};
if (process.env.TOKEN) headers.authorization = `Bearer ${process.env.TOKEN}`;
if (process.env.COOKIE) headers.cookie = process.env.COOKIE;
if (process.env.CSRF) headers["x-kanthord-csrf"] = process.env.CSRF;
if (process.env.HOST_HEADER) headers.host = process.env.HOST_HEADER;
if (process.env.ORIGIN) headers.origin = process.env.ORIGIN;
if (body.length > 0) headers["content-type"] = process.env.CTYPE ?? "application/json";
const res = await fetch(url, {
  method,
  headers,
  ...(body.length > 0 ? { body } : {}),
});
const text = await res.text();
process.stdout.write(String(res.status) + "\n");
process.stdout.write(JSON.stringify(Object.fromEntries(res.headers)) + "\n");
process.stdout.write(text.replaceAll("\n", " ") + "\n");
EOF

req() {
  local method="$1" path="$2"
  node "$PD/req.mjs" "$method" "http://127.0.0.1:$PORT$path" > "$PD/res.txt"
  STATUS="$(sed -n 1p "$PD/res.txt")"
  HEADERS="$(sed -n 2p "$PD/res.txt")"
  BODY="$(sed -n 3p "$PD/res.txt")"
}
reqbody() {
  local method="$1" path="$2" payload="$3"
  printf '%s' "$payload" | node "$PD/req.mjs" "$method" "http://127.0.0.1:$PORT$path" > "$PD/res.txt"
  STATUS="$(sed -n 1p "$PD/res.txt")"
  HEADERS="$(sed -n 2p "$PD/res.txt")"
  BODY="$(sed -n 3p "$PD/res.txt")"
}
# Read a JS expression over parsed stdin JSON. `v` is the parsed value.
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }

# ── Phase A — server starts on loopback, health needs no session ─────────────
node src/main.ts db migrate >/dev/null
P=$(node src/main.ts create project --name alpha)

node src/main.ts serve --port 0 > "$PD/serve.log" 2>&1 &
SERVER_PID=$!
PORT=""
for _ in $(seq 1 100); do
  PORT="$(sed -n 1p "$PD/serve.log" | tr -dc '0-9')"
  [ -n "$PORT" ] && break
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.1
done
test -n "$PORT" || { echo "FAILED: serve printed no port; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }

test -f "$KEY_FILE"
test "$(stat -f '%Lp' "$KEY_FILE" 2>/dev/null || stat -c '%a' "$KEY_FILE")" = "600"
PAIRING="$(cat "$KEY_FILE")"

req GET /api/health
test "$STATUS" = "200"
test "$(printf '%s' "$BODY" | jv 'v.data.status')" = "ok"
echo "A ok: serve binds loopback, key file is 0600, health needs no session"

# ── Phase B — the resource refuses an unauthenticated read ───────────────────
req GET "/api/projects/$P"
test "$STATUS" = "401"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "unauthenticated"
echo "B ok: unauthenticated read is 401 with an envelope"

# ── Phase C — session is a resource: 201 + Location + HttpOnly cookie ────────
TOKEN="$PAIRING" reqbody POST /api/sessions '{}'
test "$STATUS" = "201"
test "$(printf '%s' "$HEADERS" | jv 'v.location')" = "/api/sessions/current"
test "$(printf '%s' "$HEADERS" | jv '/HttpOnly/i.test(v["set-cookie"])')" = "true"
test "$(printf '%s' "$HEADERS" | jv '/SameSite=Strict/i.test(v["set-cookie"])')" = "true"
JWT="$(printf '%s' "$BODY" | jv 'v.data.token')"
CSRF_TOKEN="$(printf '%s' "$BODY" | jv 'v.data.csrf')"
COOKIE_HEADER="kanthord_session=$JWT"

TOKEN="not-the-pairing-credential" reqbody POST /api/sessions '{}'
test "$STATUS" = "401"
echo "C ok: POST /api/sessions is 201 with Location + HttpOnly cookie; a wrong credential is 401"

# ── Phase D — the 1:1 statement: HTTP data == CLI --json data ────────────────
TOKEN="$JWT" req GET "/api/projects/$P"
test "$STATUS" = "200"
printf '%s' "$BODY" | jv 'JSON.stringify(v.data)' > "$PD/http-project.json"
node src/main.ts get project --id "$P" --json > "$PD/cli-project.json"
# Structural, key-order independent equality — NOT byte equality (see the epic's
# decision 5: byte equality would test formatting and force CLI serialisation reuse).
node -e '
const fs = require("fs");
const canon = (x) => Array.isArray(x) ? x.map(canon)
  : (x && typeof x === "object")
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])]))
    : x;
const a = canon(JSON.parse(fs.readFileSync(process.argv[1], "utf8")));
const b = canon(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
if (JSON.stringify(a) !== JSON.stringify(b)) {
  console.error("FAILED: HTTP data differs from CLI --json");
  console.error("http:", JSON.stringify(a));
  console.error("cli: ", JSON.stringify(b));
  process.exit(1);
}
' "$PD/http-project.json" "$PD/cli-project.json"

COOKIE="$COOKIE_HEADER" req GET "/api/projects/$P"
test "$STATUS" = "200"
test "$(printf '%s' "$BODY" | jv 'JSON.stringify(v.data)')" = "$(cat "$PD/http-project.json")"
echo "D ok: GET /api/projects/:id matches the CLI structurally, by bearer and by cookie"

# ── Phase E — envelope, error map and method handling ────────────────────────
TOKEN="$JWT" req GET "/api/projects/01JZZZZZZZZZZZZZZZZZZZZZZZ"
test "$STATUS" = "404"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "unknown_reference"

TOKEN="$JWT" req GET /api/nope
test "$STATUS" = "404"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "unknown_route"

TOKEN="$JWT" CSRF="$CSRF_TOKEN" req DELETE "/api/projects/$P"
test "$STATUS" = "405"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "method_not_allowed"
test "$(printf '%s' "$HEADERS" | jv 'v.allow')" = "GET"

# A flipped signature byte must not authenticate.
BAD_JWT="$(printf '%s' "$JWT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=s.trim().split("");const i=c.length-1;c[i]=c[i]==="A"?"B":"A";process.stdout.write(c.join(""))})')"
TOKEN="$BAD_JWT" req GET "/api/projects/$P"
test "$STATUS" = "401"
echo "E ok: 404 unknown_reference / 404 unknown_route / 405 with Allow / 401 on a tampered token"

# ── Phase F — REST semantics: 204 with an empty body, and CSRF ──────────────
TOKEN="$JWT" req DELETE /api/sessions/current
test "$STATUS" = "403"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "csrf_failed"

TOKEN="$JWT" CSRF="$CSRF_TOKEN" req DELETE /api/sessions/current
test "$STATUS" = "204"
test -z "$BODY"
test "$(printf '%s' "$HEADERS" | jv 'v["content-type"] === undefined')" = "true"

# The deleted session no longer authenticates.
TOKEN="$JWT" req GET "/api/projects/$P"
test "$STATUS" = "401"
echo "F ok: DELETE /api/sessions/current needs CSRF, answers 204 with no body, and revokes"

# ── Phase G — hardening over the wire ───────────────────────────────────────
TOKEN="$PAIRING" reqbody POST /api/sessions '{}'
test "$STATUS" = "201"
JWT2="$(printf '%s' "$BODY" | jv 'v.data.token')"
CSRF2="$(printf '%s' "$BODY" | jv 'v.data.csrf')"

HOST_HEADER="evil.example" TOKEN="$JWT2" req GET "/api/projects/$P"
test "$STATUS" = "403"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "host_not_allowed"

TOKEN="$PAIRING" CTYPE="text/plain" reqbody POST /api/sessions 'not json'
test "$STATUS" = "415"

ORIGIN="http://evil.example" TOKEN="$JWT2" CSRF="$CSRF2" req DELETE /api/sessions/current
test "$STATUS" = "403"
test "$(printf '%s' "$BODY" | jv 'v.error.code')" = "origin_not_allowed"

# No CORS on any response, and the pairing credential never echoes back.
TOKEN="$JWT2" req GET "/api/projects/$P"
test "$STATUS" = "200"
test "$(printf '%s' "$HEADERS" | jv 'v["access-control-allow-origin"] === undefined')" = "true"
printf '%s' "$BODY" | grep -q "$PAIRING" && { echo "FAILED: pairing credential leaked into a response" >&2; exit 1; }
grep -q "$PAIRING" "$PD/serve.log" && { echo "FAILED: pairing credential leaked into the server log" >&2; exit 1; }
echo "G ok: Host / Origin / media-type refused, no CORS header, no credential leak"

# ── Phase H — clean shutdown ────────────────────────────────────────────────
kill -TERM "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
set +e
node "$PD/req.mjs" GET "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1
RC=$?
set -e
test "$RC" != "0"
echo "H ok: SIGTERM stops the server and the port stops accepting"

echo "019 ok: REST skeleton serves one resource end to end — loopback bind, JWT session resource, envelope, status map, REST semantics, hardening"
