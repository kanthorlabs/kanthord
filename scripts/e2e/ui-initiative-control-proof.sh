#!/usr/bin/env bash
# ui-initiative-control-proof.sh — EPIC 026.11 Proof (deterministic, no model,
# no outbound network, nothing left running).
#
# Proves, against the real daemon serving the real build:
#   * pause and resume are reachable over HTTP as `PATCH /api/initiative/:id`
#     with a `paused` boolean, under the existing If-Match machinery,
#   * the mutual-exclusion decode of decision 2 and the four refusals of
#     phase D, none of which may be a 500,
#   * decision 5's helper text is TRUE and not marketing: a paused initiative
#     claims no new task (phase E), and a task already running when the pause
#     lands still finishes (phase F),
#   * decision 6's two new events reach the feed, so a second tab's graph has a
#     reason to refetch,
#   * decision 7's structured readiness target exists on the wire, so the
#     button never parses a shell command (phase G),
#   * the browser can pause from the workspace, recover from a real 412, resume
#     from readiness and create a paused initiative (phases H–K),
#   * R3 holds — no request the page issued carried an Authorization header.
#
# Every daemon run uses the KANTHORD_FAKE_AGENT turn-script seam
# (scripts/e2e/abandon-run-proof.sh:42-59): no provider call, no model, no
# network. The only git remotes are local bare repositories under $PD.
#
# EXPECTED FAILURE against the CURRENT tree (measured 2026-07-31, before any
# 026.11 work): phases A and B pass — the build exists, Chromium is installed,
# the daemon serves the build and the graph imports — and the run fails in
# phase C at the first `PATCH /api/initiative/:id` with `{"paused":true}`,
# which answers `400` because `initiative.patch` decodes `name` only
# (src/apps/http/routes.ts:595-607, requireBodyString at body.ts:20).
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PD="$(mktemp -d)"
SERVE_PID=""
DAEMON_PID=""
cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — must not equal '$2'" >&2; exit 1; }; }
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
# Bounded poll: no phase may hang.
poll() { local secs="$1"; shift; local n=$(( secs * 5 )); local i=0
  while [ "$i" -lt "$n" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; i=$((i+1)); done
  echo "FAILED: condition never held within ${secs}s: $*" >&2; return 1; }
sql() { node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const rows = db.prepare(process.argv[2]).all();
  process.stdout.write(rows.map((r) => Object.values(r).join("|")).join("\n"));
' "$KANTHORD_DB" "$1"; }

echo "--- A: the build exists and the browser is installed"
BUILD_SCRIPT="$(node -e 'const fs=require("node:fs");const p=process.argv[1];process.stdout.write(fs.existsSync(p)?(JSON.parse(fs.readFileSync(p,"utf8")).scripts?.["build:ui"] ?? ""):"")' "$ROOT/package.json")"
ne "package.json defines build:ui (EPIC 026 S1)" "" "$BUILD_SCRIPT"
( cd "$ROOT" && npm run build:ui ) >"$PD/build.log" 2>&1 \
  || { echo "FAILED: npm run build:ui; log:" >&2; tail -30 "$PD/build.log" >&2; exit 1; }
DIST="$ROOT/ui/dist"
[ -f "$DIST/index.html" ] || { echo "FAILED: no $DIST/index.html" >&2; exit 1; }
node --input-type=module -e '
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true });
  await b.close();
' >"$PD/browser.log" 2>&1 || {
  echo "FAILED: Playwright Chromium is unavailable. Install it once, outside the Proof:" >&2
  echo "    npx playwright install chromium" >&2
  tail -5 "$PD/browser.log" >&2
  exit 1
}

echo "--- B: a real graph, a served build, and an initiative that is not paused"
node "$ROOT/src/main.ts" db migrate >/dev/null
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

# One local bare remote, one project, one ai provider with a fake key file. The
# provider is never probed and never called: KANTHORD_FAKE_AGENT owns every turn.
PROJECT="$(node "$ROOT/src/main.ts" create project --name proof-026-11)"
HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO="$(node "$ROOT/src/main.ts" create repository --project "$PROJECT" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror")"
printf 'sk-proof' > "$PD/.provider-value"
PROVIDER="$(node "$ROOT/src/main.ts" register ai-provider --name proof-provider \
  --provider openai-codex --model gpt-5.6-sol --value-file "$PD/.provider-value" 2>/dev/null)"
[ -n "$PROVIDER" ] || { echo "FAILED: register ai-provider produced no id" >&2; exit 1; }
node "$ROOT/src/main.ts" assign ai-provider --project "$PROJECT" --provider "$PROVIDER" >/dev/null

GRAPH="$PD/graph-e"
scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
node "$ROOT/src/main.ts" import graph "$GRAPH" --create --project "$PROJECT" \
  --bind source="$REPO" >/dev/null
INIT="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH")"
[ -n "$INIT" ] || { echo "FAILED: import produced no initiative id" >&2; exit 1; }
eq "the seeded initiative starts un-paused" "0" "$(sql "SELECT paused FROM initiatives WHERE id='$INIT'")"
echo "    project: $PROJECT   initiative: $INIT"

echo "--- C: PATCH {paused:true} under If-Match, and the event that follows"
ETAG="$(curl -sS -D - -o "$PD/init.json" "$BASE/api/initiative/$INIT" \
  -H "authorization: $BASIC" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
ne "the initiative detail GET returns an ETag" "" "$ETAG"
CODE="$(curl -sS -o "$PD/patch.json" -w '%{http_code}' -X PATCH "$BASE/api/initiative/$INIT" \
  -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
  -H "if-match: $ETAG" --data '{"paused":true}')"
eq "PATCH {paused:true} with a matching If-Match answers 200" "200" "$CODE"
eq "the response body carries the new paused state" "true" \
  "$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.paused))' "$PD/patch.json")"
eq "SQLite agrees the initiative is paused" "1" "$(sql "SELECT paused FROM initiatives WHERE id='$INIT'")"
eq "an initiative.paused event was appended for this initiative" "1" \
  "$(sql "SELECT COUNT(*) FROM events WHERE type='initiative.paused' AND initiativeId='$INIT'")"
eq "that event is project-scoped, so digest.latest moves (decision 6)" "1" \
  "$(sql "SELECT COUNT(*) FROM events WHERE type='initiative.paused' AND projectId='$PROJECT'")"

echo "--- D: the four refusals, and none of them is a 500"
STALE="$ETAG"
FRESH="$(curl -sS -D - -o /dev/null "$BASE/api/initiative/$INIT" \
  -H "authorization: $BASIC" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
ne "the ETag moved after the write" "$STALE" "$FRESH"
refuse() { # refuse <what> <expected-code> <extra-header-or-empty> <body>
  local what="$1" expected="$2" header="$3" body="$4" code
  if [ -n "$header" ]; then
    code="$(curl -sS -o "$PD/r.json" -w '%{http_code}' -X PATCH "$BASE/api/initiative/$INIT" \
      -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
      -H "$header" --data "$body")"
  else
    code="$(curl -sS -o "$PD/r.json" -w '%{http_code}' -X PATCH "$BASE/api/initiative/$INIT" \
      -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
      --data "$body")"
  fi
  eq "$what" "$expected" "$code"
  ne "$what is a named refusal, never a 500" "500" "$code"
}
refuse "name and paused together are refused (decision 2)" "400" "if-match: $FRESH" '{"name":"x","paused":true}'
refuse "an empty body is refused (decision 2)"             "400" "if-match: $FRESH" '{}'
refuse "a non-boolean paused is refused"                   "400" "if-match: $FRESH" '{"paused":"true"}'
refuse "a missing If-Match is 428"                         "428" ""                '{"paused":false}'
refuse "a stale If-Match is 412"                           "412" "if-match: $STALE" '{"paused":false}'
# Decision 2's stated tolerance: an unknown key is ignored, not rejected.
CODE="$(curl -sS -o "$PD/r.json" -w '%{http_code}' -X PATCH "$BASE/api/initiative/$INIT" \
  -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
  -H "if-match: $FRESH" --data '{"paused":true,"bogus":1}')"
eq "an unknown key is ignored, not rejected (decision 2)" "200" "$CODE"

echo "--- E: paused means no new claim; resumed means the work runs"
export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"
ROOT_TASK="$(sql "SELECT t.id FROM tasks t JOIN objectives o ON t.objectiveId=o.id WHERE o.initiativeId='$INIT' AND t.status='pending' ORDER BY t.id LIMIT 1")"
ne "the seeded initiative has a pending task" "" "$ROOT_TASK"
node "$ROOT/src/main.ts" run daemon --until-idle --poll-interval 200 >"$PD/daemon-paused.log" 2>&1
eq "while paused, the task was never claimed" "pending" \
  "$(sql "SELECT status FROM tasks WHERE id='$ROOT_TASK'")"
eq "while paused, no job is running" "0" "$(sql "SELECT COUNT(*) FROM jobs WHERE status='running'")"
FRESH="$(curl -sS -D - -o /dev/null "$BASE/api/initiative/$INIT" \
  -H "authorization: $BASIC" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
CODE="$(curl -sS -o "$PD/resume.json" -w '%{http_code}' -X PATCH "$BASE/api/initiative/$INIT" \
  -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
  -H "if-match: $FRESH" --data '{"paused":false}')"
eq "PATCH {paused:false} answers 200" "200" "$CODE"
eq "an initiative.resumed event was appended" "1" \
  "$(sql "SELECT COUNT(*) FROM events WHERE type='initiative.resumed' AND initiativeId='$INIT'")"
node "$ROOT/src/main.ts" run daemon --until-idle --poll-interval 200 >"$PD/daemon-resumed.log" 2>&1
ne "after the resume the same task ran" "pending" "$(sql "SELECT status FROM tasks WHERE id='$ROOT_TASK'")"
echo "    root task after resume: $(sql "SELECT status FROM tasks WHERE id='$ROOT_TASK'")"

echo "--- F: a pause during a run does not stop the run (decision 5's second half)"
PROJECT2="$(node "$ROOT/src/main.ts" create project --name proof-026-11-inflight)"
HOME2="$PD/home2.git"; git init -q --bare -b main "$HOME2"
SEED2="$PD/seed2"; git clone -q "$HOME2" "$SEED2"
git -C "$SEED2" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED2" push -q origin main
REPO2="$(node "$ROOT/src/main.ts" create repository --project "$PROJECT2" --name home \
  --remote-url "file://$HOME2" --branch main --auth ambient --path "$PD/mirror2")"
node "$ROOT/src/main.ts" assign ai-provider --project "$PROJECT2" --provider "$PROVIDER" >/dev/null
GRAPH2="$PD/graph-f"
scripts/e2e/make-landing-graph.sh "$GRAPH2" >/dev/null
# Slow, MULTI-TURN script: the pause must land while a lease is genuinely held,
# and the run must still have turn boundaries left to finish through.
cat > "$GRAPH2/.fake-agent.json" <<'EOF'
[
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "sleep 6" } } ] },
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "sleep 6" } } ] },
  { "toolCalls": [ { "name": "bash", "arguments": { "command": "mkdir -p src && printf 'export const x = 1;\\n' > src/todo.mjs" } } ] },
  { "text": "done" }
]
EOF
node "$ROOT/src/main.ts" import graph "$GRAPH2" --create --project "$PROJECT2" \
  --bind source="$REPO2" >/dev/null
INIT2="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$GRAPH2")"
export KANTHORD_FAKE_AGENT="$GRAPH2/.fake-agent.json"
node "$ROOT/src/main.ts" run daemon --poll-interval 200 >"$PD/daemon-inflight.log" 2>&1 &
DAEMON_PID=$!
poll 30 bash -c "[ \"\$(node -e '
  const { DatabaseSync } = require(\"node:sqlite\");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const r = db.prepare(\"SELECT COUNT(*) AS c FROM jobs WHERE status='running'\").get();
  process.stdout.write(String(r.c));' \"$KANTHORD_DB\")\" = \"1\" ]"
RUNNING_TASK="$(sql "SELECT taskId FROM jobs WHERE status='running' LIMIT 1")"
ne "a task is genuinely running before the pause" "" "$RUNNING_TASK"
FRESH2="$(curl -sS -D - -o /dev/null "$BASE/api/initiative/$INIT2" \
  -H "authorization: $BASIC" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/initiative/$INIT2" \
  -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
  -H "if-match: $FRESH2" --data '{"paused":true}')"
eq "the pause lands while the task runs" "200" "$CODE"
kill -0 "$DAEMON_PID" 2>/dev/null || { echo "FAILED: the daemon died at the pause" >&2; exit 1; }
poll 60 bash -c "[ \"\$(node -e '
  const { DatabaseSync } = require(\"node:sqlite\");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const r = db.prepare(\"SELECT status FROM tasks WHERE id = ?\").get(process.argv[2]);
  process.stdout.write(String(r ? r.status : \"\"));' \"$KANTHORD_DB\" \"$RUNNING_TASK\")\" != \"running\" ]"
IN_FLIGHT_STATUS="$(sql "SELECT status FROM tasks WHERE id='$RUNNING_TASK'")"
ne "the in-flight task finished rather than being killed by the pause" "running" "$IN_FLIGHT_STATUS"
ne "the in-flight task was not reset to pending" "pending" "$IN_FLIGHT_STATUS"
kill -0 "$DAEMON_PID" 2>/dev/null || { echo "FAILED: the daemon died before the run finished" >&2; exit 1; }
kill "$DAEMON_PID" 2>/dev/null || true; wait "$DAEMON_PID" 2>/dev/null || true; DAEMON_PID=""
echo "    in-flight task ended '$IN_FLIGHT_STATUS' with the initiative paused"

echo "--- G: readiness carries a STRUCTURED target, not a shell string (decision 7)"
READINESS="$(curl -sS "$BASE/api/project/$PROJECT2/readiness" -H "authorization: $BASIC")"
NEXT_CHECK="$(node -e 'const r=JSON.parse(process.argv[1]).data;process.stdout.write(r.next?.check ?? "")' "$READINESS")"
eq "the next action for an all-paused project is the initiative check" "initiative" "$NEXT_CHECK"
NEXT_KIND="$(node -e 'const r=JSON.parse(process.argv[1]).data;process.stdout.write(r.next?.target?.kind ?? "")' "$READINESS")"
NEXT_ID="$(node -e 'const r=JSON.parse(process.argv[1]).data;process.stdout.write(r.next?.target?.id ?? "")' "$READINESS")"
eq "next.target names an initiative" "initiative" "$NEXT_KIND"
eq "next.target.id is the paused initiative's id" "$INIT2" "$NEXT_ID"

echo "--- H–L: the browser"
# The intervening writer for phase I. It is THIS script, not a second tab, so the
# ordering is exact and nothing races.
cat > "$PD/intervene.mjs" <<'EOF'
// node intervene.mjs <base> <basic> <initiativeId> <newName>
const [base, basic, id, newName] = process.argv.slice(2);
const head = await fetch(`${base}/api/initiative/${id}`, { headers: { authorization: basic } });
const etag = head.headers.get("etag");
if (!etag) throw new Error("the detail GET returned no ETag");
const res = await fetch(`${base}/api/initiative/${id}`, {
  method: "PATCH",
  headers: {
    authorization: basic,
    origin: base,
    "content-type": "application/json",
    "if-match": etag,
  },
  body: JSON.stringify({ name: newName }),
});
if (res.status !== 200) throw new Error(`intervening PATCH expected 200, got ${res.status}`);
process.stdout.write("intervened");
EOF

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, visible, consoleErrors, requests, page }) => {
  const {
    PROOF_PROJECT: project, PROOF_INIT: init,
    PROOF_PROJECT2: project2, PROOF_INIT2: init2,
    PROOF_INTERVENE: intervene,
  } = process.env;
  const { execFileSync } = await import("node:child_process");
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };
  const apiJson = async (path) => {
    const res = await fetch(`${process.env.PROOF_BASE}${path}`, {
      headers: { authorization: process.env.PROOF_BASIC },
    });
    if (res.status !== 200) throw new Error(`GET ${path} expected 200, got ${res.status}`);
    return (await res.json()).data;
  };

  // --- H: pause from the workspace, and the overview agrees.
  await goto(`#/project/${project}/initiative/${init}`);
  eq("the workspace names the paused state (decision 12)", true,
    await visible('[data-testid="initiative-paused-state"]'));
  has("the helper text is the daemon's truth, not 'work stopped' (decision 5)",
    await text('[data-testid="initiative-pause-note"]'), "no new task will be claimed");
  const [pauseResponse] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/initiative/${init}`)),
    page.locator('[data-testid="initiative-pause-toggle"]').click(),
  ]);
  eq("the workspace pause is a 200", 200, pauseResponse.status());
  await page.waitForLoadState("networkidle");
  has("the workspace re-rendered from the response, not optimistically",
    await text('[data-testid="initiative-paused-state"]'), "paused");
  eq("the API agrees", true, (await apiJson(`/api/initiative/${init}`)).paused);
  await goto(`#/project/${project}/overview`);
  const overviewRow = await text(`[data-initiative-id="${init}"]`);
  has("the overview row agrees after invalidation (decision 11)", overviewRow, "paused");

  // --- I: a real 412 through the workspace toggle, and the shared recovery.
  await goto(`#/project/${project}/initiative/${init}`);
  // Open the toggle's edit session so the validator is frozen, then let a
  // DIFFERENT client write an intervening version.
  await page.locator('[data-testid="initiative-pause-toggle"]').focus();
  execFileSync(process.execPath, [
    intervene, process.env.PROOF_BASE, process.env.PROOF_BASIC, init, "renamed-from-elsewhere",
  ]);
  const [staleResponse] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/initiative/${init}`)),
    page.locator('[data-testid="initiative-pause-toggle"]').click(),
  ]);
  eq("the stale toggle submit is a 412", 412, staleResponse.status());
  eq("the three-version conflict state is shown", true, await visible('[data-testid="edit-conflict-current"]'));
  has("the current server version is shown",
    await text('[data-testid="edit-conflict-current"]'), "renamed-from-elsewhere");
  await page.locator('[data-testid="conflict-reload"]').click();
  await page.waitForLoadState("networkidle");
  const [recovered] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/initiative/${init}`)),
    page.locator('[data-testid="initiative-pause-toggle"]').click(),
  ]);
  eq("the resubmit against the fresh validator succeeds", 200, recovered.status());
  eq("the resume landed", false, (await apiJson(`/api/initiative/${init}`)).paused);

  // --- J: resume from the readiness page, through the structured target.
  await goto(`#/project/${project2}/readiness`);
  eq("readiness offers a real resume control (decisions 7, 8)", true,
    await visible('[data-testid="readiness-resume"]'));
  const [readinessGet] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes(`/api/initiative/${init2}`)),
    page.locator('[data-testid="readiness-resume"]').click(),
  ]);
  eq("the button read the detail first, for its ETag (decision 8)", 200, readinessGet.status());
  await page.waitForLoadState("networkidle");
  eq("the readiness resume landed", false, (await apiJson(`/api/initiative/${init2}`)).paused);

  // --- K: create a paused initiative (decision 9).
  await goto(`#/project/${project}/overview`);
  await page.locator('[data-testid="create-initiative"]').click();
  await page.locator('[data-testid="create-initiative-name"]').fill("born-paused");
  await page.locator('[data-testid="create-initiative-paused"]').check();
  await page.locator('[data-testid="create-initiative-submit"]').click();
  await page.waitForLoadState("networkidle");
  const created = (await apiJson(`/api/project/${project}/initiative`))
    .filter((row) => row.name === "born-paused");
  eq("exactly one initiative was created", 1, created.length);
  eq("it was created paused", true, created[0].paused);

  eq("no console error across every flow", 0, consoleErrors.length);

  // --- L: R3.
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
  console.log("    workspace pause, 412 recovery, readiness resume and paused create all observed");
};
STEPS

PROOF_PROJECT="$PROJECT" PROOF_INIT="$INIT" \
PROOF_PROJECT2="$PROJECT2" PROOF_INIT2="$INIT2" \
PROOF_INTERVENE="$PD/intervene.mjs" PROOF_BASE="$BASE" PROOF_BASIC="$BASIC" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases H–L" >&2; exit 1; }

echo "026.11 ok: pause and resume over HTTP under If-Match, both events on the feed, a paused initiative claimed nothing and a resumed one ran, an in-flight run survived its pause, readiness carried a structured target, and the browser paused, recovered from a 412, resumed from readiness and created a paused initiative"
