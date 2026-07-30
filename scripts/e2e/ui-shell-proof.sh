#!/usr/bin/env bash
# ui-shell-proof.sh — EPIC 026 Proof (deterministic, no model, no outbound
# network — loopback only — no server and no dev server left running).
#
# Proves that:
#   * the guards are workspace-aware: `npm test` cannot execute a UI test file,
#     and `eslint .` really configures ui/**/*.tsx with rule R4,
#   * `npm run build:ui` emits a real Vite bundle (hashed asset + module script),
#   * `kanthord serve` serves THAT build through the route table — index, the
#     hashed asset with an immutable cache header, ETag/304, HEAD, sw.js and the
#     manifest with no-cache — while `GET /nope` STILL answers 404 unknown_route
#     and traversal is refused,
#   * the dev loop works for WRITES, not just reads: an unauthenticated
#     POST /api/project through the Vite proxy is 201 + Location, because the
#     proxy does not rewrite Host (EPIC 026 decision 4). The opposite case — a
#     rewritten Host — is asserted to be 403 origin_not_allowed, so the failure
#     mode is pinned rather than remembered,
#   * the API key never appears in a response body or a log line.
#
# Phase E records — does not assert — the observed behaviour of the PWA files
# under Basic auth (EPIC 026 decision 5: Ulrich keeps Basic on every path and
# accepts that the browser may refuse to register the service worker).
#
# EXPECTED FAILURE against the CURRENT tree: phase A fails at the first check,
# because `package.json`'s `test` script is still bare `node --test` and the
# `ui/` workspace does not exist. Nothing before that check can fail, so the
# first failure is the missing capability, not a broken fixture.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PD="$(mktemp -d)"
SERVE_PID=""
VITE_PID=""
cleanup() {
  if [ -n "$VITE_PID" ]; then kill "$VITE_PID" 2>/dev/null || true; fi
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — must not equal '$2'" >&2; exit 1; }; }
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- request helper (node:http, not fetch: the fetch spec forbids setting Host,
# which phase D needs to spoof). Same contract as http-serve-proof.sh.
cat > "$PD/req.mjs" <<'EOF'
// node req.mjs <METHOD> <URL> <AUTHORIZATION|-> [header:value ...] [--body=<json>]
import http from "node:http";
const argv = process.argv.slice(2);
let body;
const rest = argv.filter((a) => {
  if (a.startsWith("--body=")) {
    body = a.slice("--body=".length);
    return false;
  }
  return true;
});
const [method, rawUrl, auth, ...raw] = rest;
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
for (const h of raw) {
  const i = h.indexOf(":");
  headers[h.slice(0, i)] = h.slice(i + 1);
}
if (body !== undefined) {
  headers["content-type"] = headers["content-type"] ?? "application/json";
  headers["content-length"] = String(Buffer.byteLength(body));
}
const url = new URL(rawUrl);
await new Promise((resolve) => {
  const req = http.request(
    { method, hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, headers },
    (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { out += c; });
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
header_of() { printf '%s\n' "$1" | sed -n "s/^HEADER $2 //p" | head -1; }
jfield() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(process.argv[2].split(".").reduce((a,k)=>a?.[k],v)))' "$1" "$2"; }
free_port() {
  node -e 'const n=require("node:net"),s=n.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close();});'
}

echo "--- A: the guards are workspace-aware"
# A1 — the root test script must scope discovery to src/, because bare
# `node --test` walks the whole tree and would execute ui/**/*.test.ts.
TEST_SCRIPT="$(node -e 'process.stdout.write(require("node:fs").existsSync(process.argv[1])?(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).scripts?.test ?? ""):"")' "$ROOT/package.json")"
contains "package.json test script scopes discovery to src/" "$TEST_SCRIPT" 'src/**/*.test.ts'
# A2 — and the mechanism itself holds on this Node version: bare discovery finds
# a UI-shaped test, the glob does not. Proved hermetically in a scratch tree so
# the repo is never mutated and the real suite is never run twice.
mkdir -p "$PD/guard/src/apps/http" "$PD/guard/ui/src/components"
printf 'import test from "node:test";\ntest("backend", () => {});\n' > "$PD/guard/src/apps/http/a.test.ts"
printf 'import test from "node:test";\ntest("ui-leaked", () => {});\n' > "$PD/guard/ui/src/components/b.test.ts"
BARE="$(cd "$PD/guard" && node --test 2>&1 || true)"
contains "bare node --test really does reach ui/ (the reason A1 exists)" "$BARE" "ui-leaked"
SCOPED="$(cd "$PD/guard" && node --test "src/**/*.test.ts" 2>&1 || true)"
contains "the glob still runs nested backend tests" "$SCOPED" "backend"
absent "the glob does not run UI tests" "$SCOPED" "ui-leaked"
# A3 — eslint must actually configure .tsx under ui/, or rule R4 is only prose.
UI_CONFIG="$(cd "$ROOT" && npx --no-install eslint --print-config ui/src/probe.tsx 2>&1 || true)"
contains "eslint configures ui/**/*.tsx" "$UI_CONFIG" "no-restricted-imports"
contains "R4 bans node: imports in the UI" "$UI_CONFIG" "node:"
# A4 — the TDD roles own ui/**, otherwise every future screen is maintainer-only.
"$ROOT/scripts/lane-check.sh" software-engineer "ui/src/lib/api-client.ts"
"$ROOT/scripts/lane-check.sh" test-engineer "ui/src/lib/api-client.test.ts"
if "$ROOT/scripts/lane-check.sh" software-engineer "package.json" 2>/dev/null; then
  echo "FAILED: lane-check must still forbid package.json" >&2; exit 1
fi

echo "--- B: npm run build:ui emits a real Vite bundle"
( cd "$ROOT" && npm run build:ui ) >"$PD/build.log" 2>&1 \
  || { echo "FAILED: npm run build:ui; log:" >&2; tail -30 "$PD/build.log" >&2; exit 1; }
DIST="$ROOT/ui/dist"
[ -f "$DIST/index.html" ] || { echo "FAILED: no $DIST/index.html" >&2; exit 1; }
INDEX_HTML="$(cat "$DIST/index.html")"
contains "index.html loads a module bundle" "$INDEX_HTML" '<script type="module"'
contains "index.html carries the R5 CSP" "$INDEX_HTML" "Content-Security-Policy"
ASSET_COUNT="$(find "$DIST/assets" -maxdepth 1 -name '*.js' | wc -l | tr -d ' ')"
ne "at least one hashed asset was emitted" "0" "$ASSET_COUNT"

echo "--- C: the daemon serves that build, and the 404 policy survives"
K db migrate >/dev/null
# The dist root is injected, never discovered from cwd — serve runs in an
# isolated directory so it loads the proof's .env, never the developer's.
export KANTHORD_UI_DIST="$DIST"
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
      try { const o = JSON.parse(line);
        if (o.msg === "listening" && typeof o.port === "number") { process.stdout.write(String(o.port)); break; }
      } catch {}
    }' "$PD/serve.log")"
  [ -n "$PORT" ] && break
  sleep 0.2
done
[ -n "$PORT" ] || { echo "FAILED: no listening log line; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }
BASE="http://127.0.0.1:$PORT"
echo "    daemon port: $PORT"

OUT="$(REQ GET "$BASE/" "$BASIC")"
eq "index status" "200" "$(status_of "$OUT")"
contains "index content-type" "$(header_of "$OUT" "content-type")" "text/html"
SERVED_INDEX="$(body_of "$OUT")"
contains "the served index IS the built bundle" "$SERVED_INDEX" '<script type="module"'
contains "index is not cached" "$(header_of "$OUT" "cache-control")" "no-cache"
absent "the retired inline shell is gone" "$SERVED_INDEX" 'id="health"'

# The asset URL is EXTRACTED from the served HTML — never a guessed hash.
ASSET_PATH="$(node -e '
  const m = process.argv[1].match(/<script[^>]+src="([^"]+)"/);
  if (!m) { process.stderr.write("no module script tag in served index\n"); process.exit(1); }
  process.stdout.write(m[1].replace(/^\.\//, "/"));' "$SERVED_INDEX")"
echo "    asset extracted from the served HTML: $ASSET_PATH"
OUT="$(REQ GET "$BASE$ASSET_PATH" "$BASIC")"
eq "asset status" "200" "$(status_of "$OUT")"
contains "asset content-type" "$(header_of "$OUT" "content-type")" "javascript"
contains "hashed asset is immutable" "$(header_of "$OUT" "cache-control")" "immutable"
ASSET_ETAG="$(header_of "$OUT" "etag")"
ne "asset carries an ETag" "" "$ASSET_ETAG"
OUT="$(REQ HEAD "$BASE$ASSET_PATH" "$BASIC")"
eq "HEAD agrees with GET" "200" "$(status_of "$OUT")"
eq "HEAD has no body" "" "$(body_of "$OUT")"
OUT="$(REQ GET "$BASE$ASSET_PATH" "$BASIC" "if-none-match:$ASSET_ETAG")"
eq "matching ETag is 304" "304" "$(status_of "$OUT")"
OUT="$(REQ GET "$BASE$ASSET_PATH" "$BASIC" 'if-none-match:"bogus"')"
eq "stale ETag is 200" "200" "$(status_of "$OUT")"

OUT="$(REQ GET "$BASE/assets/does-not-exist.js" "$BASIC")"
eq "missing asset status" "404" "$(status_of "$OUT")"
eq "missing asset stays inside the envelope" "unknown_route" "$(jfield "$(body_of "$OUT")" "error.code")"
OUT="$(REQ GET "$BASE/assets/%2e%2e%2f%2e%2e%2fpackage.json" "$BASIC")"
ne "traversal is refused" "200" "$(status_of "$OUT")"
absent "traversal leaked nothing" "$(body_of "$OUT")" '"name": "kanthord"'

# EPIC 026 decision 3: hash routing means NO SPA fallback, so this pin holds.
OUT="$(REQ GET "$BASE/nope" "$BASIC")"
eq "unknown path is still 404" "404" "$(status_of "$OUT")"
eq "unknown path code unchanged" "unknown_route" "$(jfield "$(body_of "$OUT")" "error.code")"

OUT="$(REQ GET "$BASE/" "-")"
eq "the shell itself needs auth (decision 5)" "401" "$(status_of "$OUT")"
absent "key not in any served body" "$SERVED_INDEX" "$KEY"
absent "key not in the log" "$(cat "$PD/serve.log")" "$KEY"

echo "--- D: the dev loop — a WRITE through the Vite proxy (decision 4)"
VITE_PORT="$(free_port)"
(
  cd "$ROOT/ui" \
    && KANTHORD_API_TARGET="$BASE" API_KEY="$KEY" \
       exec npx --no-install vite --host 127.0.0.1 --port "$VITE_PORT" --strictPort
) >"$PD/vite.log" 2>&1 &
VITE_PID=$!
DEV="http://localhost:$VITE_PORT"
READY=""
for _ in $(seq 1 150); do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "FAILED: vite exited during startup; log:" >&2; tail -30 "$PD/vite.log" >&2; exit 1
  fi
  if [ "$(status_of "$(REQ GET "$DEV/" "-")")" = "200" ]; then READY="yes"; break; fi
  sleep 0.2
done
[ -n "$READY" ] || { echo "FAILED: vite never served /; log:" >&2; tail -30 "$PD/vite.log" >&2; exit 1; }
echo "    vite dev port: $VITE_PORT"

# No Authorization header from the browser side: the proxy injects it.
OUT="$(REQ GET "$DEV/healthz" "-" "accept:application/json")"
eq "proxied read status" "200" "$(status_of "$OUT")"
eq "proxied read version == CLI" "$(K --version)" "$(jfield "$(body_of "$OUT")" "data.version")"

# THE load-bearing assertion. A same-origin browser write: Origin is the dev
# server, and because the proxy leaves Host alone, the daemon's serverOrigin
# (protocol://Host) equals it and the CSRF gate at app.ts:186 passes.
OUT="$(REQ POST "$DEV/api/project" "-" "origin:$DEV" "--body={\"name\":\"proxy-write\"}")"
eq "proxied write status" "201" "$(status_of "$OUT")"
contains "proxied write Location" "$(header_of "$OUT" "location")" "/api/project/"
PROJECT_ID="$(jfield "$(body_of "$OUT")" "data.id")"
ne "proxied write returned an id" "" "$PROJECT_ID"
OUT="$(REQ GET "$DEV/api/project/$PROJECT_ID" "-" "accept:application/json")"
eq "the proxied write really persisted" "proxy-write" "$(jfield "$(body_of "$OUT")" "data.name")"

# The pinned failure mode: this is what changeOrigin:true would produce.
OUT="$(REQ POST "$BASE/api/project" "$BASIC" "origin:$DEV" "--body={\"name\":\"rewritten-host\"}")"
eq "rewritten Host is refused" "403" "$(status_of "$OUT")"
eq "rewritten Host code" "origin_not_allowed" "$(jfield "$(body_of "$OUT")" "error.code")"

echo "--- E: recorded (not asserted) — PWA files under Basic auth, decision 5"
for p in /sw.js /manifest.webmanifest /favicon.ico; do
  OUT="$(REQ GET "$BASE$p" "$BASIC")"
  printf '    %-24s authed: status=%s cache-control=%s content-type=%s\n' \
    "$p" "$(status_of "$OUT")" "$(header_of "$OUT" "cache-control")" "$(header_of "$OUT" "content-type")"
  OUT="$(REQ GET "$BASE$p" "-")"
  printf '    %-24s no auth: status=%s\n' "$p" "$(status_of "$OUT")"
done
# The two that ARE policy, not observation: the SW must never be cached, and it
# must sit at the root so its scope covers the whole app.
OUT="$(REQ GET "$BASE/sw.js" "$BASIC")"
eq "sw.js is served from the root scope" "200" "$(status_of "$OUT")"
contains "sw.js is never cached" "$(header_of "$OUT" "cache-control")" "no-cache"
OUT="$(REQ GET "$BASE/manifest.webmanifest" "$BASIC")"
eq "manifest is served" "200" "$(status_of "$OUT")"
contains "manifest content-type" "$(header_of "$OUT" "content-type")" "manifest"

kill "$VITE_PID" 2>/dev/null || true; VITE_PID=""
kill -TERM "$SERVE_PID" 2>/dev/null || true
for _ in $(seq 1 50); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$SERVE_PID" 2>/dev/null; then echo "FAILED: serve survived SIGTERM" >&2; exit 1; fi
SERVE_PID=""

echo "026 ok: guards workspace-aware, Vite build served from $ASSET_PATH with immutable+304, /nope still 404, proxied POST /api/project 201 (Host preserved) and 403 when rewritten"
