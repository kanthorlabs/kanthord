#!/usr/bin/env bash
# http-serve-proof.sh — EPIC 019 Proof (deterministic, no model, no outbound
# network — loopback only — no server left running).
#
# Proves that `kanthord serve` runs a koa server on 127.0.0.1 which:
#   * answers GET /healthz with the SAME version `kanthord --version` prints,
#   * gates every route behind HTTP Basic auth against API_KEY from .env,
#   * serves the UI shell at GET / and the shell's data path really works,
#   * answers unknown paths / wrong methods / hostile Host / hostile Origin
#     inside the JSON envelope instead of crashing,
#   * refuses to start with no API_KEY,
#   * shuts down on SIGTERM.
#
# Against the CURRENT tree this fails in phase A at `serve --port 0` with
# `unknown command 'serve'` (src/apps/http/ does not exist). Phase A's setup up
# to that point (db migrate) passes today, so the first failure is the missing
# capability and not a broken fixture.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
BASIC_LOWER="basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"
BASIC_WRONG="Basic $(printf 'kanthord:%s' "ffffffffffffffffffffffffffffffff" | base64 | tr -d '\n')"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- curl-free request helper: status, headers and parsed body all assertable.
cat > "$PD/req.mjs" <<'EOF'
// node req.mjs <METHOD> <URL> <AUTHORIZATION|-> [header:value ...]
const [method, url, auth, ...raw] = process.argv.slice(2);
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
for (const h of raw) {
  const i = h.indexOf(":");
  headers[h.slice(0, i)] = h.slice(i + 1);
}
let res;
try {
  res = await fetch(url, { method, headers, redirect: "manual" });
} catch (err) {
  process.stdout.write(`STATUS 0\nBODY network-error ${err.code ?? err.message}\n`);
  process.exit(0);
}
const body = (await res.text()).replace(/\r?\n/g, " ");
const lines = [`STATUS ${res.status}`];
for (const [k, v] of res.headers) lines.push(`HEADER ${k.toLowerCase()} ${v}`);
lines.push(`BODY ${body}`);
process.stdout.write(lines.join("\n") + "\n");
EOF

REQ() { node "$PD/req.mjs" "$@"; }
status_of() { printf '%s\n' "$1" | sed -n 's/^STATUS //p' | head -1; }
body_of() { printf '%s\n' "$1" | sed -n 's/^BODY //p' | head -1; }
header_of() { printf '%s\n' "$1" | sed -n "s/^HEADER $2 //p" | head -1; }
jfield() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(process.argv[2].split(".").reduce((a,k)=>a?.[k],v)))' "$1" "$2"; }

echo "--- A: migrate, start serve on an ephemeral port, read the bound port"
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
echo "    bound port: $PORT"

echo "--- B: GET /healthz version == kanthord --version (the 1:1 statement)"
CLI_VERSION="$(K --version)"
OUT="$(REQ GET "$BASE/healthz" "$BASIC")"
eq "healthz status" "200" "$(status_of "$OUT")"
HEALTH_BODY="$(body_of "$OUT")"
eq "healthz version" "$CLI_VERSION" "$(jfield "$HEALTH_BODY" "data.version")"

echo "--- C: Basic auth is required, case-insensitive, and wrong keys fail"
OUT="$(REQ GET "$BASE/healthz" "-")"
eq "no-credential status" "401" "$(status_of "$OUT")"
contains "no-credential challenge" "$(header_of "$OUT" "www-authenticate")" 'Basic realm="kanthord"'
eq "no-credential code" "unauthenticated" "$(jfield "$(body_of "$OUT")" "error.code")"
OUT="$(REQ GET "$BASE/healthz" "$BASIC_WRONG")"
eq "wrong-key status" "401" "$(status_of "$OUT")"
OUT="$(REQ GET "$BASE/healthz" "$BASIC_LOWER")"
eq "lower-case scheme status" "200" "$(status_of "$OUT")"

echo "--- D: the UI shell is served, and the shell's data path works"
OUT="$(REQ GET "$BASE/" "$BASIC")"
eq "ui status" "200" "$(status_of "$OUT")"
contains "ui content-type" "$(header_of "$OUT" "content-type")" "text/html"
UI_BODY="$(body_of "$OUT")"
contains "ui references healthz" "$UI_BODY" "/healthz"
# No browser runs here, so the DOM is not proved. The shell's request IS:
OUT="$(REQ GET "$BASE/healthz" "$BASIC" "accept:application/json")"
eq "shell data path status" "200" "$(status_of "$OUT")"
eq "shell data path version" "$CLI_VERSION" "$(jfield "$(body_of "$OUT")" "data.version")"

echo "--- E: unknown route and wrong method answer inside the envelope"
OUT="$(REQ GET "$BASE/nope" "$BASIC")"
eq "unknown-route status" "404" "$(status_of "$OUT")"
eq "unknown-route code" "unknown_route" "$(jfield "$(body_of "$OUT")" "error.code")"
OUT="$(REQ POST "$BASE/healthz" "$BASIC" "content-type:application/json")"
eq "wrong-method status" "405" "$(status_of "$OUT")"
eq "wrong-method allow" "GET" "$(header_of "$OUT" "allow")"

echo "--- F: hardening — Host, CORS, and no key leak"
OUT="$(REQ GET "$BASE/healthz" "$BASIC" "host:evil.example")"
eq "hostile-host status" "403" "$(status_of "$OUT")"
eq "hostile-host code" "host_not_allowed" "$(jfield "$(body_of "$OUT")" "error.code")"
OUT="$(REQ GET "$BASE/healthz" "$BASIC" "origin:https://evil.example")"
eq "hostile-origin allow-origin header" "" "$(header_of "$OUT" "access-control-allow-origin")"
OUT="$(REQ GET "$BASE/healthz" "$BASIC" "origin:http://127.0.0.1:$PORT")"
eq "own-origin allow-origin header" "http://127.0.0.1:$PORT" "$(header_of "$OUT" "access-control-allow-origin")"
eq "never allow credentials" "" "$(header_of "$OUT" "access-control-allow-credentials")"
absent "key not in any response body" "$HEALTH_BODY$UI_BODY$(body_of "$OUT")" "$KEY"
absent "key not in the log" "$(cat "$PD/serve.log")" "$KEY"

echo "--- G: serve refuses to start with no API_KEY"
ND="$(mktemp -d)"
set +e
( cd "$ND" && env -u API_KEY node "$ROOT/src/main.ts" serve --port "$PORT" ) >"$ND/out.log" 2>&1
NO_KEY_RC=$?
set -e
[ "$NO_KEY_RC" -ne 0 ] || { echo "FAILED: serve started with no API_KEY" >&2; exit 1; }
contains "no-key message names API_KEY" "$(cat "$ND/out.log")" "API_KEY"
rm -rf "$ND"

echo "--- H: SIGTERM shuts the server down"
kill -TERM "$SERVE_PID"
for _ in $(seq 1 50); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$SERVE_PID" 2>/dev/null; then echo "FAILED: serve survived SIGTERM" >&2; exit 1; fi
SERVE_PID=""
OUT="$(REQ GET "$BASE/healthz" "$BASIC")"
eq "port closed after SIGTERM" "0" "$(status_of "$OUT")"

echo "019 ok: serve on 127.0.0.1:$PORT — /healthz version $CLI_VERSION == CLI, Basic auth enforced, UI shell served, envelope + hardening + shutdown proved"
