#!/usr/bin/env bash
# http-execution-proof.sh — EPIC 025 Proof.
#
# Deterministic, no model, no outbound network (loopback only), no server and no
# orphan child left running. Run from the repo root:
#
#   scripts/e2e/http-execution-proof.sh
#
# It must print `025 ok: …`.
#
# WHAT IT PROVES — that `kanthord serve` HOSTS the execution loop, and that an
# initiative's `paused` flag is the run control over HTTP:
#   * serve runs the daemon (readiness reports daemon: running),
#   * a PAUSED initiative enqueues nothing even while the daemon demonstrably
#     scans (a probe initiative's task completes in the same window),
#   * PATCH /api/initiative/:id honours If-Match — absent -> 428,
#     stale -> 412, unknown id -> 404 (the pre-read runs first), valid -> 200
#     with a CHANGED ETag,
#   * resume starts work; pause DURING an in-flight task lets that task finish
#     and holds back its dependent (the advertised enqueue-time semantics),
#   * GET /api/database answers with no project scope,
#   * SIGTERM drains an in-flight task instead of killing it, and leaves no
#     running job, no surviving child, and a stale heartbeat.
#
# EXPECTED FAILURE ON THE CURRENT TREE — phase B. Plain `serve` starts no daemon
# today, so `check project`'s `daemon` check reports `stopped`. Phase A asserts
# ONLY capabilities that already exist (the fixture through the real CLI, serve on
# an ephemeral port, an authenticated /healthz, and one existing /api read), so a
# phase-A pass proves the fixture is sound and the first failure is the missing
# capability. The fixture's own logic was additionally validated end to end
# against the existing `run daemon`, which exercises every later phase's
# predicate without `serve`.
#
# UPDATE-SEMANTICS DECISIONS these phases encode (read the code before changing
# them — each was checked against the tree, not assumed):
#   * NO new domain transition functions. `PauseInitiative` / `ResumeInitiative`
#     are `resolveKind` + `repo.setPaused(id, bool)` — no rule, no state machine —
#     and `domain/initiative.ts` documents `paused` as an "explicit-activation
#     gate; orthogonal to status" whose only post-creation mutator is `setPaused`.
#     There is nothing to extract into `domain/`.
#   * Pause/resume are IDEMPOTENT for free: `setPaused` is an unconditional write,
#     so a repeated pause is a 200 with an unchanged ETag (phase D2).
#   * Three refusals, all registered by 019/024: `InvalidInputError` -> 400
#     `invalid_input`, `NoUpdateFieldsError` -> 400 `no_update_fields` (added by
#     EPIC 024), `UnknownReferenceError` -> 404. 025 adds no registry entry.
#   * `wrong_type_reference` is UNOBSERVABLE on a PATCH. `PauseInitiative` raises
#     it for a non-initiative id, but the dispatcher's pre-read (`initiative.get`)
#     runs first and 404s. Do not write a test expecting 400 here.
#   * Validate-then-write, so no partial mutation: `decode` rejects bad SHAPE
#     (mistyped `paused`, blank `name`) -> 400 invalid_input, and the USE CASE
#     rejects an EMPTY patch -> 400 no_update_fields (EPIC 024's convention, so
#     the CLI shares the guard). Both fire before the aggregate is touched.
#   * A combined name+paused update is ONE write. Rename is `get`+`save` and pause
#     is `setPaused`; the use case must apply both inside
#     `UnitOfWork.transaction` — usable here precisely because it is synchronous
#     and the use case is too (contrast story S10, where the async dispatcher
#     cannot use it).
#   * NO `initiative.paused` event. None exists in EVENT_TYPES and 025 adds none:
#     it would cost a twelfth `events` table rebuild for no consumer. Run control
#     is not the event feed's job.
#
# DETERMINISM NOTES (why there are no bare sleeps around behaviour):
#   * "the daemon had a chance and did not take it" is never a timeout. The probe
#     initiative is a CHAIN, so exactly one probe task is ready at a time and each
#     probe completion is proof of a FRESH enqueue+dispatch cycle. Every negative
#     assertion is made immediately after such a witness.
#   * a task is held in flight by a BLOCKING bash turn in the KANTHORD_FAKE_AGENT
#     script, not by a gate inside the provider mock: the agent makes one provider
#     call per turn, so a provider-level gate latches, and `jobs.status='running'`
#     proves only that a job was claimed. The tool-call boundary is the exact point
#     where the run is provably in flight. Same seam as abandon-run-proof.sh.
#   * assertions read the PROGRAM surface (CLI --json, HTTP responses). Direct
#     SQLite is used only for the two post-shutdown invariants, where no server is
#     left to ask.
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
# Small staleness window so the post-shutdown heartbeat assertion is fast AND
# unambiguous. Read by resolveStaleMs(); the beat interval is floor(stale/3).
export KANTHORD_HEARTBEAT_STALE_MS=900
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"
GATE_A="$PD/gate-a"
GATE_B="$PD/gate-b"

K() { node "$ROOT/src/main.ts" "$@"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — expected a value different from '$2'" >&2; exit 1; }; }
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
# Bounded poll: no phase can hang, and a timeout names the condition.
poll() { local secs="$1"; shift; local n=$(( secs * 5 )); local i=0
  while [ "$i" -lt "$n" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; i=$((i+1)); done
  echo "FAILED: condition never held within ${secs}s: $*" >&2; return 1; }
# Milliseconds since the Unix epoch. `strftime('%s')` is SECOND precision, which
# races a 900ms staleness window, so the julianday form is used instead.
NOW_MS_SQL="CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

# --- curl-free request helper: status, headers and parsed body all assertable.
# Built on node:http (not fetch/undici): the WHATWG fetch spec forbids a caller
# from setting the `Host` header, so undici silently drops/overrides it. Kept
# identical in shape to scripts/e2e/http-reads-proof.sh on purpose.
cat > "$PD/req.mjs" <<'EOF'
// node req.mjs <METHOD> <URL> <AUTHORIZATION|-> [header:value ...] [--body <json>]
import http from "node:http";
const argv = process.argv.slice(2);
let body;
const bodyAt = argv.indexOf("--body");
if (bodyAt !== -1) { body = argv[bodyAt + 1]; argv.splice(bodyAt, 2); }
const [method, rawUrl, auth, ...raw] = argv;
const headers = {};
if (auth && auth !== "-") headers["authorization"] = auth;
for (const h of raw) {
  const at = h.indexOf(":");
  headers[h.slice(0, at).toLowerCase()] = h.slice(at + 1);
}
if (body !== undefined) {
  headers["content-type"] = "application/json";
  headers["content-length"] = String(Buffer.byteLength(body));
}
const url = new URL(rawUrl);
const req = http.request(
  { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
  (res) => {
    let text = "";
    res.on("data", (c) => (text += c));
    res.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      process.stdout.write(JSON.stringify({ status: res.statusCode, headers: res.headers, body: parsed }));
    });
  },
);
req.on("error", (err) => { process.stdout.write(JSON.stringify({ status: 0, headers: {}, body: String(err) })); });
if (body !== undefined) req.write(body);
req.end();
EOF
REQ() { node "$PD/req.mjs" "$@"; }

# Status / ETag / paused readers over one captured response.
rstatus() { jv 'v.status' ; }
retag()   { jv 'v.headers.etag' ; }
rpaused() { jv 'v.body.data.paused' ; }
# One task's status, straight from the CLI read model.
tstatus() { K list task --initiative "$1" --json | jv 'v.find(t=>t.title==="'"$2"'").status'; }
# Poll wrapper for a task status — no inline node quoting gymnastics.
wait_task() { poll "$3" bash -c "[ \"\$(cd '$ROOT' && KANTHORD_DB='$KANTHORD_DB' node src/main.ts list task --initiative '$1' --json | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const v=JSON.parse(s);const t=v.find(x=>x.title===\"$2\");process.stdout.write(t?t.status:\"\")})')\" = '$4' ]"; }

echo "--- A: fixture through the real CLI, then serve on an ephemeral port"
K db migrate >/dev/null
PROJECT="$(K create project --name proof)"
HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED" 2>/dev/null
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO="$(K create repository --project "$PROJECT" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror")"
# A provider must RESOLVE (the runner's chain check) but is never called: the
# KANTHORD_FAKE_AGENT seam replaces the session factory, so there is no model and
# no network. Registering it is what proves provider resolution still works.
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV="$(K register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')"
K assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null

GRAPH="$PD/g"
scripts/e2e/make-025-execution-graph.sh "$GRAPH" "$GATE_A" "$GATE_B" >/dev/null
K import graph "$GRAPH/probe" --create --project "$PROJECT" --bind source="$REPO" >/dev/null
PROBE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH/probe")"
K import graph "$GRAPH/gated" --create --paused --project "$PROJECT" --bind source="$REPO" >/dev/null
GATED="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH/gated")"
[ -n "$PROBE" ] && [ -n "$GATED" ] || { echo "FAILED: A — no initiative ids captured" >&2; exit 1; }

export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
( cd "$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
SERVE_PID=$!
PORT=""
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    echo "FAILED: A — serve exited during startup; log:" >&2; cat "$PD/serve.log" >&2; exit 1
  fi
  PORT="$(node -e '
    const fs=require("fs");
    const t=fs.existsSync(process.argv[1])?fs.readFileSync(process.argv[1],"utf8"):"";
    for (const line of t.split("\n")) {
      try { const o=JSON.parse(line); if (o.msg==="listening" && o.port) { process.stdout.write(String(o.port)); break; } } catch {}
    }' "$PD/serve.log")"
  [ -n "$PORT" ] && break
  sleep 0.1
done
[ -n "$PORT" ] || { echo "FAILED: A — no {\"msg\":\"listening\",\"port\":N} line; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }
BASE="http://127.0.0.1:$PORT"
eq "healthz is authenticated and up" "200" "$(REQ GET "$BASE/healthz" "$BASIC" | rstatus)"
# Only capabilities that ALREADY exist are asserted in phase A, so a phase-A pass
# means the fixture is sound and every later failure is a missing 025 capability.
eq "an existing read still works" "200" "$(REQ GET "$BASE/api/initiative/$GATED" "$BASIC" | rstatus)"
echo "A ok: fixture built, serve listening on $PORT"

echo "--- B: serve HOSTS the daemon (readiness reports daemon: running)"
READY="$(REQ GET "$BASE/api/project/$PROJECT/readiness" "$BASIC")"
eq "readiness read" "200" "$(echo "$READY" | rstatus)"
eq "daemon check" "running" "$(echo "$READY" | jv 'v.body.data.checks.find(c=>c.name==="daemon").status')"
echo "B ok: the serve process is running the execution loop"

echo "--- C: the daemon scans, and the PAUSED initiative is skipped"
wait_task "$PROBE" "probe 1" 120 "completed"
eq "gate a untouched"  "pending" "$(tstatus "$GATED" 'gate a')"
eq "after a untouched" "pending" "$(tstatus "$GATED" 'after a')"
echo "C ok: a full enqueue+dispatch cycle ran while the paused initiative stayed idle"

echo "--- D: If-Match on PATCH /api/initiative/:id"
# The dispatcher order is pre-read -> 428 -> 412 -> write, so an unknown id 404s
# before either precondition check. Asserting all three locks that order.
eq "absent If-Match"  "428" "$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" --body '{"paused":false}' | rstatus)"
eq "stale If-Match"   "412" "$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" 'if-match:"stale"' --body '{"paused":false}' | rstatus)"
eq "unknown id first" "404" "$(REQ PATCH "$BASE/api/initiative/01ZZZZZZZZZZZZZZZZZZZZZZZZ" "$BASIC" --body '{"paused":false}' | rstatus)"
echo "D ok: 428 / 412 / 404 all as specified"

echo "--- D2: PATCH body semantics (S4) and combined-update behaviour (B4)"
# `decode` runs AFTER the precondition checks (app.ts), so every body-shape case
# below carries a CURRENT validator — otherwise it would 428 before decode.
etag_now() { REQ GET "$BASE/api/initiative/$GATED" "$BASIC" | retag; }
# The empty patch is refused by the USE CASE (`NoUpdateFieldsError`), not by
# `decode` — EPIC 024's convention, reused here. Assert the CODE, not just 400,
# so a decode-level guard would fail this line.
EMPTY="$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$(etag_now)" --body '{}')"
eq "empty patch status" "400"                "$(echo "$EMPTY" | rstatus)"
eq "empty patch code"   "no_update_fields"   "$(echo "$EMPTY" | jv 'v.body.error.code')"
eq "paused null"        "400" "$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$(etag_now)" --body '{"paused":null}' | rstatus)"
eq "paused wrong type"  "400" "$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$(etag_now)" --body '{"paused":"yes"}' | rstatus)"
eq "blank name"         "400" "$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$(etag_now)" --body '{"name":"   "}' | rstatus)"
# A name-only patch must NOT disturb `paused` — absent means unchanged, never false.
NAMEONLY="$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$(etag_now)" --body '{"name":"renamed"}')"
eq "name-only status"        "200"      "$(echo "$NAMEONLY" | rstatus)"
eq "name-only applied"       "renamed"  "$(echo "$NAMEONLY" | jv 'v.body.data.name')"
eq "name-only left paused"   "true"     "$(echo "$NAMEONLY" | rpaused)"
# Both fields in one request, and pausing an already-paused initiative is a
# no-op success rather than a refusal.
BOTH="$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$(etag_now)" --body '{"name":"025 gated","paused":true}')"
eq "combined status"     "200"        "$(echo "$BOTH" | rstatus)"
eq "combined name"       "025 gated"  "$(echo "$BOTH" | jv 'v.body.data.name')"
eq "pause is idempotent" "true"       "$(echo "$BOTH" | rpaused)"
# The CLI read model agrees — the write went to one aggregate, not two.
eq "CLI agrees on name" "025 gated" "$(K get initiative --id "$GATED" --json | jv 'v.name')"
echo "D2 ok: empty/null/mistyped bodies refused, name-only preserves paused, combined update is one write"

echo "--- E: resume over HTTP; gate a runs and blocks in flight"
ETAG1="$(REQ GET "$BASE/api/initiative/$GATED" "$BASIC" | retag)"
[ -n "$ETAG1" ] && [ "$ETAG1" != "undefined" ] || { echo "FAILED: E — no ETag on the initiative read" >&2; exit 1; }
RES="$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$ETAG1" --body '{"paused":false}')"
eq "resume status"     "200"   "$(echo "$RES" | rstatus)"
eq "paused now false"  "false" "$(echo "$RES" | rpaused)"
ne "ETag changed"      "$ETAG1" "$(echo "$RES" | retag)"
wait_task "$GATED" "gate a" 120 "running"
echo "E ok: resume started work and gate a is in flight"

echo "--- F: pause DURING flight — gate a finishes, after a is held back"
ETAG2="$(REQ GET "$BASE/api/initiative/$GATED" "$BASIC" | retag)"
PAU="$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$ETAG2" --body '{"paused":true}')"
eq "pause status"    "200"  "$(echo "$PAU" | rstatus)"
eq "paused now true" "true" "$(echo "$PAU" | rpaused)"
touch "$GATE_A"                      # release the in-flight tool call
wait_task "$GATED" "gate a" 180 "completed"
# probe 2 completing is the WITNESS that a fresh cycle ran after gate a finished,
# so "after a is pending" is a real refusal to enqueue and not a race.
wait_task "$PROBE" "probe 2" 180 "completed"
eq "after a held back" "pending" "$(tstatus "$GATED" 'after a')"
echo "F ok: the in-flight task completed and its dependent was not enqueued"

echo "--- G: resume again; after a runs, then gate b takes flight"
ETAG3="$(REQ GET "$BASE/api/initiative/$GATED" "$BASIC" | retag)"
eq "resume again" "200" "$(REQ PATCH "$BASE/api/initiative/$GATED" "$BASIC" "if-match:$ETAG3" --body '{"paused":false}' | rstatus)"
wait_task "$GATED" "after a" 180 "completed"
wait_task "$GATED" "gate b"  180 "running"
echo "G ok: work resumed and gate b is in flight"

echo "--- H: db status over HTTP, with no project scope"
# This is the whole point of the row: check project's `database` check needs a
# project id, so it cannot answer "is this database usable" before any project
# exists. No ordering claim is made — the assertion is that it answers at all.
DBOUT="$(REQ GET "$BASE/api/database" "$BASIC")"
eq "database read" "200" "$(echo "$DBOUT" | rstatus)"
DBVER="$(echo "$DBOUT" | jv 'v.body.data.schemaVersion')"
[ -n "$DBVER" ] && [ "$DBVER" != "undefined" ] || { echo "FAILED: H — no schemaVersion in /api/database" >&2; exit 1; }
# 025 adds `db status --json`, so the parity check compares two JSON reads rather
# than scraping formatted text.
eq "schema matches the CLI" "$(K db status --json | jv 'v.schemaVersion')" "$DBVER"
echo "H ok: /api/database reports schema $DBVER, matching the CLI"

echo "--- I: SIGTERM drains the in-flight task; nothing is left behind"
# Record the whole descendant set BEFORE signalling. `|| true` because pgrep exits
# 1 when there are no matches, which would abort under `set -e`/pipefail.
descendants() {
  local pid="$1" kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do
    echo "$kid"; descendants "$kid"
  done
}
KIDS="$(descendants "$SERVE_PID" | sort -u | tr '\n' ' ')"
kill -TERM "$SERVE_PID"
touch "$GATE_B"                      # let gate b's tool call return so it can drain
set +e; wait "$SERVE_PID"; SERVE_RC=$?; set -e
SERVE_PID=""                         # claimed; cleanup must not re-kill
case "$SERVE_RC" in
  0|143) : ;;
  *) echo "FAILED: I — serve exited $SERVE_RC (not a clean SIGTERM shutdown); log:" >&2
     tail -20 "$PD/serve.log" >&2; exit 1 ;;
esac
# Drained, not killed: the task that was in flight reached a terminal state.
eq "gate b drained" "completed" "$(tstatus "$GATED" 'gate b')"
for kid in $KIDS; do
  if kill -0 "$kid" 2>/dev/null; then
    echo "FAILED: I — descendant $kid survived shutdown" >&2; exit 1
  fi
done
# No server is left to ask, so these two invariants read the database directly.
# ALL running rows, not just unrevoked ones: a revoked row stuck in `running`
# would still be a leaked lease.
eq "no running job" "0" "$(sqlite3 "$KANTHORD_DB" "SELECT count(*) FROM jobs WHERE status='running'")"
# The heartbeat ROW SURVIVES by design (HeartbeatStore exposes only beat()), so
# liveness is a staleness comparison, never a row count.
poll 20 bash -c "[ \"\$(sqlite3 '$KANTHORD_DB' \"SELECT CASE WHEN ($NOW_MS_SQL - MAX(lastBeatMs)) > $KANTHORD_HEARTBEAT_STALE_MS THEN 1 ELSE 0 END FROM daemon_heartbeats\")\" = '1' ]"
echo "I ok: clean drain, no surviving descendant, no running job, heartbeat stale"

echo "025 ok: serve hosts the daemon; paused gates enqueue; pause-in-flight drains; SIGTERM leaves nothing"
