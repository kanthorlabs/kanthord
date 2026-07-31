#!/usr/bin/env bash
# ui-graph-proof.sh — EPIC 026.6 Proof (deterministic, no model, loopback only,
# nothing left running).
#
# Proves, in a real browser against the real daemon serving the real build:
#   * the initiative graph renders as objective LANES with task nodes inside
#     their own lane — position, not merely presence — after the application's
#     own layout-ready state,
#   * a bound lane names its repository by NAME, never by resource id, and an
#     unbound lane states that it has no repository binding (decision 1),
#   * the rendered edge count equals the API's edges.length,
#   * selecting a node opens an inspector that fetches GET /api/task/:id and
#     shows that task's real title,
#   * the critical-path toggle marks exactly the nodes and consecutive edges the
#     API listed,
#   * readiness renders the API's checks and its next.command verbatim — the
#     seed is configured up to `daemon: stopped`, so next.command is always
#     present and this phase can never pass by skipping,
#   * the Plan tab is an explicit unavailable state — import is blocked by four
#     API gaps and belongs to EPIC 026.15,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# The seeded graph is deliberately tiny and exactly known, so every count in
# this script is compared against the API rather than against a guess.
#
# EXPECTED FAILURE against the CURRENT tree (measured 2026-07-31): phases A and
# B pass — `ui/` and `build:ui` exist since EPIC 026, and the seed is correct —
# and phase C fails waiting for `[data-testid="layout-ready"]`, because no graph
# canvas is built yet.
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

export KANTHORD_DB="$PD/kanthord.db"
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — must not equal '$2'" >&2; exit 1; }; }

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

echo "--- B: seed a small, exactly-known graph"
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

POST() {
  local path="$1" body="$2" code
  code="$(curl -sS -o "$PD/post.json" -w '%{http_code}' -X POST "$BASE$path" \
    -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
    --data "$body")"
  [ "$code" = "201" ] || { echo "FAILED: POST $path — expected 201, got $code: $(cat "$PD/post.json")" >&2; exit 1; }
  node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.id))' "$PD/post.json"
}

PROJECT="$(POST /api/project '{"name":"proof-026-6"}')"

# One repository resource, used twice: it binds lane one's tasks (so decision 1's
# chip has a real id to resolve to the name `proof-repo`) and it satisfies the
# readiness repository check. `ambient` auth is metadata only — no clone, no
# network.
REPO_NAME="proof-repo"
REPO="$(POST "/api/project/$PROJECT/repository" \
  "{\"name\":\"$REPO_NAME\",\"remoteUrl\":\"https://example.invalid/proof.git\",\"branch\":\"main\",\"auth\":{\"kind\":\"ambient\"}}")"

INIT="$(POST "/api/project/$PROJECT/initiative" '{"name":"graph-initiative"}')"
OBJ_ONE="$(POST "/api/initiative/$INIT/objective" '{"name":"lane-one"}')"
OBJ_TWO="$(POST "/api/initiative/$INIT/objective" "{\"name\":\"lane-two\",\"after\":[\"$OBJ_ONE\"]}")"
# Lane one's tasks carry the repository binding; lane two's task carries none,
# so the two lane states of decision 1 are both on screen at once.
T1="$(POST "/api/objective/$OBJ_ONE/task" "{\"title\":\"task-one\",\"context\":{\"repository\":\"$REPO\"}}")"
T2="$(POST "/api/objective/$OBJ_ONE/task" "{\"title\":\"task-two\",\"dependencies\":[\"$T1\"],\"context\":{\"repository\":\"$REPO\"}}")"
T3="$(POST "/api/objective/$OBJ_TWO/task" "{\"title\":\"task-three\",\"dependencies\":[\"$T2\"]}")"

# Readiness must reach a next action that carries a command, or phase G would
# prove nothing about CommandHandoff. The repository above plus an assigned ai
# provider (a fake key file — never probed, the probe flags are hardcoded false)
# make repository/ai_provider `unverified`, initiative `ok`, and daemon
# `stopped`, whose action carries `kanthord run daemon`.
printf 'sk-proof' > "$PD/.provider-value"
PROVIDER="$(node "$ROOT/src/main.ts" register ai-provider --name proof-provider \
  --provider openai-codex --model gpt-5.6-sol --value-file "$PD/.provider-value" 2>/dev/null)"
[ -n "$PROVIDER" ] || { echo "FAILED: register ai-provider produced no id" >&2; exit 1; }
node "$ROOT/src/main.ts" assign ai-provider --project "$PROJECT" --provider "$PROVIDER" >/dev/null

# Every expectation below comes from the API, never from a guess.
GRAPH="$(curl -sS "$BASE/api/initiative/$INIT/graph" -H "authorization: $BASIC")"
EXPECT_LANES="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).data.groups.length))' "$GRAPH")"
EXPECT_NODES="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).data.nodes.length))' "$GRAPH")"
EXPECT_EDGES="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).data.edges.length))' "$GRAPH")"
CRITICAL="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).data.criticalPath.nodeIds.join(","))' "$GRAPH")"
echo "    lanes=$EXPECT_LANES nodes=$EXPECT_NODES edges=$EXPECT_EDGES criticalPath=[$CRITICAL]"
eq "the seeded graph really has two lanes" "2" "$EXPECT_LANES"
eq "the seeded graph really has three nodes" "3" "$EXPECT_NODES"
eq "the seeded graph really has two edges" "2" "$EXPECT_EDGES"

# Decision 1: the API reports lane one's repository as a resource ID, and lane
# two's as nothing. The browser must show the NAME and the empty-binding state.
LANE_ONE_REPOS="$(node -e '
  const g = JSON.parse(process.argv[1]).data;
  const group = g.groups.find((x) => x.id === process.argv[2]);
  process.stdout.write((group?.repositories ?? []).join(","));' "$GRAPH" "$OBJ_ONE")"
LANE_TWO_REPOS="$(node -e '
  const g = JSON.parse(process.argv[1]).data;
  const group = g.groups.find((x) => x.id === process.argv[2]);
  process.stdout.write((group?.repositories ?? []).join(","));' "$GRAPH" "$OBJ_TWO")"
echo "    lane-one repositories=[$LANE_ONE_REPOS] lane-two repositories=[$LANE_TWO_REPOS]"
eq "lane one is bound to the repository resource ID" "$REPO" "$LANE_ONE_REPOS"
eq "lane two has no repository binding" "" "$LANE_TWO_REPOS"

READINESS="$(curl -sS "$BASE/api/project/$PROJECT/readiness" -H "authorization: $BASIC")"
EXPECT_CHECKS="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).data.checks.length))' "$READINESS")"
NEXT_COMMAND="$(node -e 'const r=JSON.parse(process.argv[1]).data;process.stdout.write(r.next?.command ?? "")' "$READINESS")"
echo "    readiness checks=$EXPECT_CHECKS next.command=${NEXT_COMMAND:-<none>}"
eq "the seeded project really has six readiness checks" "6" "$EXPECT_CHECKS"
eq "the seeded project's next action is the stopped daemon" "kanthord run daemon" "$NEXT_COMMAND"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page }) => {
  const {
    PROOF_PROJECT: project, PROOF_INIT: init, PROOF_OBJ_ONE: objOne, PROOF_OBJ_TWO: objTwo,
    PROOF_T1: t1, PROOF_T2: t2, PROOF_T3: t3, PROOF_LANES: lanes, PROOF_NODES: nodes,
    PROOF_EDGES: edges, PROOF_REPO: repo, PROOF_REPO_NAME: repoName,
    PROOF_CRITICAL: critical, PROOF_CHECKS: checks, PROOF_NEXT_COMMAND: nextCommand,
  } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };
  const box = async (selector) => page.locator(selector).first().boundingBox();

  // --- C: lanes and nodes, positioned.
  await goto(`#/project/${project}/initiative/${init}/graph`);
  await page.locator('[data-testid="layout-ready"]').waitFor({ timeout: 20_000 });
  eq("one lane per objective", lanes, await count('[data-testid="graph-lane"]'));
  eq("one node per task", nodes, await count('[data-testid="graph-node"]'));
  const canvas = await box('[data-testid="graph-canvas"]');
  if (!canvas || canvas.width === 0 || canvas.height === 0) throw new Error("the canvas has no size");

  for (const [taskId, objectiveId] of [[t1, objOne], [t2, objOne], [t3, objTwo]]) {
    const node = await box(`[data-testid="graph-node"][data-task-id="${taskId}"]`);
    const lane = await box(`[data-lane-objective-id="${objectiveId}"]`);
    if (!node || node.width === 0 || node.height === 0) throw new Error(`node ${taskId} has no size`);
    if (!lane) throw new Error(`lane ${objectiveId} was not rendered`);
    const inside =
      node.x >= lane.x - 1 &&
      node.y >= lane.y - 1 &&
      node.x + node.width <= lane.x + lane.width + 1 &&
      node.y + node.height <= lane.y + lane.height + 1;
    if (!inside) throw new Error(`node ${taskId} is not inside the lane of objective ${objectiveId}`);
  }

  // --- C2: decision 1 — lane one shows the resolved repository NAME, never the
  // resource id; lane two shows the explicit empty-binding state.
  const laneOne = `[data-lane-objective-id="${objOne}"]`;
  const laneTwo = `[data-lane-objective-id="${objTwo}"]`;
  eq("lane one shows one repository chip", 1, await count(`${laneOne} [data-testid="lane-repository-chip"]`));
  const chip = await text(`${laneOne} [data-testid="lane-repository-chip"]`);
  has("the chip shows the repository name", chip, repoName);
  if (chip.includes(repo)) throw new Error(`the chip shows the resource id: "${chip}"`);
  eq("lane one is not an empty binding", 0, await count(`${laneOne} [data-testid="lane-no-repository"]`));
  eq("lane two states it has no repository binding", 1, await count(`${laneTwo} [data-testid="lane-no-repository"]`));
  eq("lane two shows no repository chip", 0, await count(`${laneTwo} [data-testid="lane-repository-chip"]`));

  // --- D: edges.
  eq("every API edge is rendered", edges, await count('[data-testid="graph-edge"]'));

  // --- E: the inspector fetches the real task.
  const [inspectorFetch] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes(`/api/task/${t1}`)),
    page.locator(`[data-testid="graph-node"][data-task-id="${t1}"]`).click(),
  ]);
  eq("the inspector's task fetch succeeded", 200, inspectorFetch.status());
  eq("the inspector is open", true, await visible('[data-testid="graph-inspector"]'));
  has("the inspector shows the real task title", await text('[data-testid="graph-inspector"]'), "task-one");

  // --- F: the critical path marks exactly what the API listed.
  const expected = critical === "" ? [] : critical.split(",");
  await page.locator('[data-testid="critical-path-toggle"]').click();
  await page.waitForLoadState("networkidle");
  const marked = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="graph-node"][data-critical="true"]')).map(
      (el) => el.getAttribute("data-task-id"),
    ),
  );
  eq("the marked node count matches the API", expected.length, marked.length);
  for (const id of expected) {
    if (!marked.includes(id)) throw new Error(`critical node ${id} was not marked`);
  }
  const expectedEdges = expected.slice(0, -1).map((from, index) => `${from}->${expected[index + 1]}`);
  const markedEdges = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="graph-edge"][data-critical="true"]')).map(
      (el) => `${el.getAttribute("data-edge-from")}->${el.getAttribute("data-edge-to")}`,
    ),
  );
  eq("the marked edge count matches the API path", expectedEdges.length, markedEdges.length);
  for (const edge of expectedEdges) {
    if (!markedEdges.includes(edge)) throw new Error(`critical edge ${edge} was not marked`);
  }

  // --- G: readiness.
  await goto(`#/project/${project}/readiness`);
  eq("every readiness check is rendered", checks, await count('[data-testid="readiness-check"]'));
  // The seed guarantees a command, and the page renders the next.command
  // handoff before the live-probe handoff, so `.first()` is the one under test.
  has("next.command is handed over verbatim", await text('[data-testid="command-handoff"]'), nextCommand);

  // --- H: Plan is honestly unavailable, and R3 holds.
  await goto(`#/project/${project}/plan`);
  eq("the Plan tab states why import is unavailable", true, await visible('[data-testid="plan-unavailable"]'));
  const planText = await text('[data-testid="plan-unavailable"]');
  if (planText.trim().length < 40) throw new Error(`the Plan state does not explain itself: "${planText}"`);
  eq("no console error across every surface", 0, consoleErrors.length);
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
};
STEPS

PROOF_PROJECT="$PROJECT" PROOF_INIT="$INIT" PROOF_OBJ_ONE="$OBJ_ONE" PROOF_OBJ_TWO="$OBJ_TWO" \
PROOF_T1="$T1" PROOF_T2="$T2" PROOF_T3="$T3" PROOF_LANES="$EXPECT_LANES" PROOF_NODES="$EXPECT_NODES" \
PROOF_EDGES="$EXPECT_EDGES" PROOF_CRITICAL="$CRITICAL" PROOF_CHECKS="$EXPECT_CHECKS" \
PROOF_REPO="$REPO" PROOF_REPO_NAME="$REPO_NAME" \
PROOF_NEXT_COMMAND="$NEXT_COMMAND" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases C–H" >&2; exit 1; }

echo "026.6 ok: $EXPECT_LANES objective lanes ('$REPO_NAME' resolved on one, no binding on the other), $EXPECT_NODES positioned nodes, $EXPECT_EDGES edges, inspector fetched the real task, critical path matched the API, $EXPECT_CHECKS readiness checks with next.command '$NEXT_COMMAND' verbatim, Plan honestly unavailable"
