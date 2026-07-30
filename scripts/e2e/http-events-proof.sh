#!/usr/bin/env bash
# http-events-proof.sh — EPIC 022 Proof (deterministic, no model, no outbound
# network — loopback only — no server left running).
#
# Proves that the running `kanthord serve` program answers the pull-based event
# feed and the per-project acknowledgement:
#   * GET /api/event is GLOBAL, ascending, with an optional ?project= filter and
#     a ?limit= bounded exactly like /api/queue,
#   * `after` is OPTIONAL and, when present, must be a ULID — the CLI's
#     `--after 0` sentinel is NOT a wire value,
#   * nextCursor is a CONTINUATION cursor: the last RETURNED event id, echoed
#     unchanged on an empty page so a poll is idempotent,
#   * events.projectId is storage-internal and never surfaced,
#   * POST /api/project/:id/acknowledgement answers 200 with the cursor really
#     IN EFFECT (the monotonic no-op is visible on the wire), needs no If-Match,
#     and rejects a non-ULID (400) or an ahead-of-feed cursor (409),
#   * a GLOBAL cursor may be ahead of one project's feed — forced and asserted,
#     not assumed,
#   * the 019 gates (auth, content-type, Host, method) hold over the new rows.
#
# Fixture assumptions, stated because a proof that hides them is not
# deterministic:
#   * SINGLE-WRITER — the fixture is built, then `serve` starts; nothing appends
#     during the read phases, so every "walks the whole feed" claim is over that
#     frozen snapshot,
#   * well under the adapter's default limit of 100 events (asserted in phase B),
#     so the unpaged page IS the whole feed,
#   * p2's task is created AFTER p1's last event, so the global cursor is
#     provably ahead of p1's scoped cursor,
#   * p3 has no initiative and no task, and no `project.*` event type exists, so
#     p3 has zero events and every ack against it is ahead-of-feed.
#
# Against the CURRENT tree this fails in phase B at the FIRST feed request:
# ROUTES has no row whose path is /api/event, so the router finds no path match
# and answers 404 unknown_route (never method_not_allowed). Phase A — the
# migration, the CLI fixture, `serve --port 0`, the bound port and an
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
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — '$2' must differ from '$3'" >&2; exit 1; }; }
# gt <label> <a> <b> — asserts a > b as a plain string compare (ULIDs sort by time).
gt() {
  node -e 'process.exit(process.argv[1] > process.argv[2] ? 0 : 1)' "$2" "$3" \
    || { echo "FAILED: $1 — '$2' must be greater than '$3'" >&2; exit 1; }
}
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

# --- curl-free request helper: status, headers and parsed body all assertable,
# with a request BODY. Built on node:http (not fetch/undici): the WHATWG fetch
# spec forbids a caller from setting `Host`, so undici silently overrides it and
# the Host-check gate (phase E) could not be proved. Kept identical to
# scripts/e2e/http-writes-proof.sh on purpose — one request-helper shape per
# HTTP proof.
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
// Explicit headers win over the defaults above (that is how the 415 and Host
// cases send a wrong content-type or a foreign Host).
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
# J <json> → writes the body to a file and echoes its path (avoids shell quoting).
J() { printf '%s' "$1" > "$PD/body.json"; printf '%s' "$PD/body.json"; }

GET() { REQ GET "$BASE$1" "$BASIC" -; }
# OK <label> <path> → asserts 200 and prints the `data` field.
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
# W <METHOD> <path> <json|-> [header:value ...] → echoes the raw response block.
W() {
  local method="$1" path="$2" json="$3"; shift 3
  if [ "$json" = "-" ]; then
    REQ "$method" "$BASE$path" "$BASIC" - "$@"
  else
    REQ "$method" "$BASE$path" "$BASIC" "$(J "$json")" "$@"
  fi
}
# WERR <label> <status> <code> <METHOD> <path> <json|-> [header ...]
WERR() {
  local label="$1" want="$2" code="$3"; shift 3
  local out; out="$(W "$@")"
  eq "$label status" "$want" "$(status_of "$out")"
  eq "$label code" "$code" "$(jv "$(body_of "$out")" 'v.error.code')"
}
# ACK <label> <projectId> <cursor> → asserts 200 and prints the effective cursor.
ACK() {
  local out; out="$(W POST "/api/project/$2/acknowledgement" "{\"cursor\":\"$3\"}")"
  eq "$1 status" "200" "$(status_of "$out")"
  jv "$(body_of "$out")" 'v.data.cursor'
}

echo "--- A: migrate, CLI fixture (p1 with events, p2 later, p3 empty), then serve"
K db migrate >/dev/null

# p1 first: `create task` and `add dependency` append real events, so the feed
# has deterministic content with a real projectId — no daemon, no model.
P1=$(K create project --name alpha)
INIT1=$(K create initiative --project "$P1" --name init-one)
OBJ1=$(K create objective --initiative "$INIT1" --name obj-one)
T1=$(K create task --objective "$OBJ1" --title "task one" --instructions x --ac y)
T2=$(K create task --objective "$OBJ1" --title "task two" --instructions x --ac y)
K add dependency --task "$T2" --dependency "$T1" >/dev/null

# p2 SECOND, so every p2 event id is greater than every p1 event id. That
# ordering is what makes the global cursor provably ahead of p1's (phase D).
P2=$(K create project --name beta)
INIT2=$(K create initiative --project "$P2" --name init-two)
OBJ2=$(K create objective --initiative "$INIT2" --name obj-two)
T3=$(K create task --objective "$OBJ2" --title "task three" --instructions x --ac y)

# p3: no initiative, no task. No `project.*` event type exists, so p3 has zero
# events and every ack against it is ahead-of-feed.
P3=$(K create project --name gamma)

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
echo "    p1=$P1 p2=$P2 p3=$P3"

echo "--- B: GET /api/event — the page, the continuation cursor, the ETag"
OUT="$(GET /api/event)"
eq "feed status" "200" "$(status_of "$OUT")"
FEED="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
# A snapshot smaller than the adapter's default limit of 100: the unpaged page
# IS the whole feed, which is what makes the paged comparison below valid.
eq "feed under the default limit" "true" "$(jv "$FEED" 'v.events.length > 0 && v.events.length < 100')"
eq "feed ascending by id" "true" "$(jv "$FEED" 'JSON.stringify(v.events.map(e=>e.id))===JSON.stringify([...v.events.map(e=>e.id)].sort())')"
eq "every event has id and type" "true" "$(jv "$FEED" 'v.events.every(e=>typeof e.id==="string"&&typeof e.type==="string")')"
# events.projectId is storage-internal (src/events/sqlite.ts:275-280).
eq "no projectId on the wire" "true" "$(jv "$FEED" 'v.events.every(e=>!("projectId" in e))')"
# No optional field is ever null — an absent field is OMITTED (decision 7).
eq "no null optional fields" "true" "$(jv "$FEED" 'v.events.every(e=>Object.values(e).every(x=>x!==null))')"
GLOBAL_CURSOR="$(jv "$FEED" 'v.nextCursor')"
eq "nextCursor is the last returned id" "$(jv "$FEED" 'v.events.at(-1).id')" "$GLOBAL_CURSOR"
ne "ETag present" "" "$(hdr_of "$OUT" etag)"

# The idempotent empty page: the cursor is echoed, so the poll is repeatable.
OUT="$(GET "/api/event?after=$GLOBAL_CURSOR")"
eq "tail page status" "200" "$(status_of "$OUT")"
TAIL="$(jv "$(body_of "$OUT")" 'JSON.stringify(v.data)')"
eq "tail page is empty" "0" "$(jv "$TAIL" 'v.events.length')"
eq "tail page echoes the cursor" "$GLOBAL_CURSOR" "$(jv "$TAIL" 'v.nextCursor')"

# ?limit=1 paging walks the same snapshot with no duplicate and no gap.
PAGED="$(GET "/api/event?limit=1")"
eq "limit=1 status" "200" "$(status_of "$PAGED")"
ONE="$(jv "$(body_of "$PAGED")" 'JSON.stringify(v.data)')"
eq "limit=1 returns one event" "1" "$(jv "$ONE" 'v.events.length')"
eq "limit=1 cursor is that event" "$(jv "$ONE" 'v.events[0].id')" "$(jv "$ONE" 'v.nextCursor')"
WALK=""
CUR=""
for _ in $(seq 1 200); do
  if [ -z "$CUR" ]; then P="/api/event?limit=1"; else P="/api/event?limit=1&after=$CUR"; fi
  PAGE="$(OK "walk page" "$P")"
  [ "$(jv "$PAGE" 'v.events.length')" = "0" ] && break
  if [ -z "$WALK" ]; then WALK="$(jv "$PAGE" 'v.events[0].id')"; else WALK="$WALK,$(jv "$PAGE" 'v.events[0].id')"; fi
  CUR="$(jv "$PAGE" 'v.nextCursor')"
done
eq "paged walk equals the unpaged page" "$(jv "$FEED" 'v.events.map(e=>e.id).join(",")')" "$WALK"

echo "--- C: the failure surface of the feed"
# The CLI sentinel `--after 0` is not a wire value: over HTTP, absent means start.
ERR "after=0 rejected" "/api/event?after=0" "400" "invalid_input"
ERR "after blank rejected" "/api/event?after=" "400" "invalid_input"
ERR "after lowercase ulid rejected" "/api/event?after=$(printf '%s' "$GLOBAL_CURSOR" | tr 'A-Z' 'a-z')" "400" "invalid_input"
ERR "limit=0 rejected" "/api/event?limit=0" "400" "invalid_input"
ERR "limit=501 rejected" "/api/event?limit=501" "400" "invalid_input"
ERR "limit=x rejected" "/api/event?limit=x" "400" "invalid_input"
# ?project= is a FILTER, not a lookup: an unknown id is an empty page, not a 404.
eq "unknown project filters to empty" "0" \
  "$(jv "$(OK "unknown project" "/api/event?project=01JZZZZZZZZZZZZZZZZZZZZZZZ")" 'v.events.length')"

echo "--- D: scoping, and the acknowledgement cursor"
P1_FEED="$(OK "p1 scoped feed" "/api/event?project=$P1")"
P2_FEED="$(OK "p2 scoped feed" "/api/event?project=$P2")"
eq "p1 has events" "true" "$(jv "$P1_FEED" 'v.events.length > 0')"
eq "p2 has events" "true" "$(jv "$P2_FEED" 'v.events.length > 0')"
eq "scoped feeds are disjoint" "true" \
  "$(node -e 'const a=JSON.parse(process.argv[1]).events.map(e=>e.id),b=new Set(JSON.parse(process.argv[2]).events.map(e=>e.id));process.stdout.write(String(a.every(id=>!b.has(id))))' "$P1_FEED" "$P2_FEED")"
eq "p3 scoped feed is empty" "0" "$(jv "$(OK "p3 scoped feed" "/api/event?project=$P3")" 'v.events.length')"
P1_CURSOR="$(jv "$P1_FEED" 'v.nextCursor')"
# Forced by the fixture order (p2 created after p1), asserted, never assumed.
gt "global cursor is ahead of p1's" "$GLOBAL_CURSOR" "$P1_CURSOR"

eq "ack p1 with its scoped cursor" "$P1_CURSOR" "$(ACK "ack p1" "$P1" "$P1_CURSOR")"
eq "overview.since matches the ack" "$P1_CURSOR" "$(jv "$(OK "p1 overview" "/api/project/$P1/overview")" 'v.since')"
# Replaying the same ack is a 200 no-op, never an error.
eq "replayed ack is idempotent" "$P1_CURSOR" "$(ACK "replay" "$P1" "$P1_CURSOR")"
# The monotonic no-op, proved on the wire: the response carries the cursor STILL
# IN EFFECT, not the older one that was sent (src/app/project/ack-project.ts:85-90).
EARLIER="$(jv "$P1_FEED" 'v.events[0].id')"
ne "an earlier cursor exists" "$EARLIER" "$P1_CURSOR"
eq "backwards ack keeps the stored cursor" "$P1_CURSOR" "$(ACK "backwards" "$P1" "$EARLIER")"
eq "overview.since did not move back" "$P1_CURSOR" "$(jv "$(OK "p1 overview again" "/api/project/$P1/overview")" 'v.since')"
# A GLOBAL cursor may be ahead of one project's feed — decision 5's trap.
WERR "global cursor acked on p1" "409" "cursor_ahead_of_feed" \
  POST "/api/project/$P1/acknowledgement" "{\"cursor\":\"$GLOBAL_CURSOR\"}"
WERR "non-ulid cursor" "400" "cursor_not_ulid" \
  POST "/api/project/$P1/acknowledgement" '{"cursor":"nope"}'
WERR "missing cursor field" "400" "invalid_input" \
  POST "/api/project/$P1/acknowledgement" '{}'
WERR "ack on an unknown project" "404" "unknown_reference" \
  POST "/api/project/01JZZZZZZZZZZZZZZZZZZZZZZZ/acknowledgement" "{\"cursor\":\"$P1_CURSOR\"}"
WERR "ack on a project with no events" "409" "cursor_ahead_of_feed" \
  POST "/api/project/$P3/acknowledgement" "{\"cursor\":\"$P1_CURSOR\"}"

echo "--- E: the inherited gates over the two new rows"
# The ack is a POST, so 021's If-Match rule does not apply: no precondition, 200.
OUT="$(W POST "/api/project/$P2/acknowledgement" "{\"cursor\":\"$(jv "$P2_FEED" 'v.nextCursor')\"}")"
eq "ack without If-Match" "200" "$(status_of "$OUT")"
OUT="$(REQ GET "$BASE/api/event" "-" -)"
eq "unauthenticated feed" "401" "$(status_of "$OUT")"
OUT="$(REQ POST "$BASE/api/project/$P1/acknowledgement" "-" "$(J "{\"cursor\":\"$P1_CURSOR\"}")")"
eq "unauthenticated ack" "401" "$(status_of "$OUT")"
eq "the rejected ack wrote nothing" "$P1_CURSOR" "$(jv "$(OK "p1 overview after 401" "/api/project/$P1/overview")" 'v.since')"
WERR "wrong content-type on the ack" "415" "unsupported_media_type" \
  POST "/api/project/$P1/acknowledgement" "{\"cursor\":\"$P1_CURSOR\"}" "content-type:text/plain"
OUT="$(REQ GET "$BASE/api/event" "$BASIC" - "host:evil.example")"
eq "foreign Host on the feed" "403" "$(status_of "$OUT")"
OUT="$(REQ PUT "$BASE/api/event" "$BASIC" -)"
eq "PUT on the feed" "405" "$(status_of "$OUT")"
ERR "plural feed path" "/api/events" "404" "unknown_route"

echo "--- F: no secret in the log, and SIGTERM still shuts down"
absent "key never in the log" "$(cat "$PD/serve.log")" "$KEY"
kill -TERM "$SERVE_PID"
for _ in $(seq 1 50); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$SERVE_PID" 2>/dev/null; then echo "FAILED: serve survived SIGTERM" >&2; exit 1; fi
SERVE_PID=""
OUT="$(GET /api/event)"
eq "port closed after SIGTERM" "0" "$(status_of "$OUT")"

echo "022 ok: pull-based feed on 127.0.0.1:$PORT — GET /api/event global + ?project= + ?limit=, continuation cursor echoed on an empty page, no projectId on the wire, POST /api/project/:id/acknowledgement 200 with the cursor in effect (monotonic no-op proved), ahead-of-feed 409, non-ULID 400, gates and shutdown intact"
