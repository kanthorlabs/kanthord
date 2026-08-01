#!/usr/bin/env bash
# ui-writes-proof.sh — EPIC 026.4 Proof (deterministic, no model, loopback only,
# nothing left running).
#
# Proves, in a real browser against the real daemon serving the real build:
#   * the operator can build a plan through the UI — initiative, objective and
#     task created in the browser (phase C) and verified through the API
#     afterwards (phase C2),
#   * the conditional-edit layer really freezes the validator: a stale submit is
#     a 412, seen on the response stream, with the operator's draft still on
#     screen and base/draft/current all rendered,
#   * recovery works and the invalidation matrix holds — after the resubmit the
#     new name appears in the collection AND in the breadcrumb,
#   * a dependency edge that closes a cycle renders the server's own error
#     inline, not a generic toast,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# There is NO race and NO timing trick: the intervening version is written by
# this script's own HTTP client, and the browser submits a validator it froze
# when the form opened.
#
# EXPECTED FAILURE against the CURRENT tree (re-measured 2026-07-31, after
# EPIC 026.1 landed the shell): phases A and B pass — the build exists, Chromium
# is installed and the daemon serves the build — and the run fails in phase C at
# `[data-testid="create-initiative"]`, which no screen renders yet.
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
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }

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

echo "--- B: a seeded project, and the daemon serving the build"
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

CODE="$(curl -sS -o "$PD/p.json" -w '%{http_code}' -X POST "$BASE/api/project" \
  -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
  --data '{"name":"proof-026-4-original"}')"
eq "seed project created" "201" "$CODE"
PROJECT="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.id)' "$PD/p.json")"

POST() {
  local path="$1" body="$2" code
  code="$(curl -sS -o "$PD/post.json" -w '%{http_code}' -X POST "$BASE$path" \
    -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
    --data "$body")"
  [ "$code" = "201" ] || { echo "FAILED: POST $path — expected 201, got $code: $(cat "$PD/post.json")" >&2; exit 1; }
  node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.id))' "$PD/post.json"
}

# Phase E needs an edge that would close a cycle: A already depends on B, so
# adding B → A through the UI must be refused with the server's own code.
INIT="$(POST "/api/project/$PROJECT/initiative" '{"name":"cycle-initiative"}')"
OBJ="$(POST "/api/initiative/$INIT/objective" '{"name":"cycle-objective"}')"
TASK_B="$(POST "/api/objective/$OBJ/task" '{"title":"task-b"}')"
TASK_A="$(POST "/api/objective/$OBJ/task" "{\"title\":\"task-a\",\"dependencies\":[\"$TASK_B\"]}")"
echo "    project: $PROJECT   taskA: $TASK_A depends on taskB: $TASK_B"

# The intervening writer, phase D step 2. It is THIS script, not a second tab,
# so the ordering is exact and nothing races.
cat > "$PD/intervene.mjs" <<'EOF'
// node intervene.mjs <base> <basic> <projectId> <newName>
const [base, basic, id, newName] = process.argv.slice(2);
const head = await fetch(`${base}/api/project/${id}`, { headers: { authorization: basic } });
const etag = head.headers.get("etag");
if (!etag) throw new Error("the detail GET returned no ETag");
const res = await fetch(`${base}/api/project/${id}`, {
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

# Resolves an id by name from a collection endpoint, for the steps module and for
# phase C2. It exits 1 on zero or on more than one match, so nothing downstream
# can pass on an ambiguity.
cat > "$PD/lookup.mjs" <<'EOF'
// node lookup.mjs <base> <basic> <collectionPath> <field> <value>
const [base, basic, path, field, value] = process.argv.slice(2);
const res = await fetch(`${base}${path}`, { headers: { authorization: basic } });
if (res.status !== 200) throw new Error(`GET ${path} expected 200, got ${res.status}`);
const body = await res.json();
const matches = (body.data ?? []).filter((entry) => entry[field] === value);
if (matches.length !== 1) {
  throw new Error(`GET ${path} — expected exactly 1 entry with ${field}='${value}', got ${matches.length}`);
}
process.stdout.write(String(matches[0].id));
EOF

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, waitVisible, activeText, consoleErrors, requests, responses, page }) => {
  const { PROOF_PROJECT: project, PROOF_INTERVENE: intervene, PROOF_LOOKUP: lookup } = process.env;
  const { execFileSync } = await import("node:child_process");
  const idByName = (collectionPath, field, value) =>
    execFileSync(process.execPath, [
      lookup, process.env.PROOF_BASE, process.env.PROOF_BASIC, collectionPath, field, value,
    ]).toString().trim();
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };
  // Every PATCH the page issued, for the closing audit below.
  const patches = () => responses.filter((r) => r.method === "PATCH" && r.url.includes(`/api/project/${project}`));

  // --- C: build a plan THROUGH THE UI.
  await goto(`#/project/${project}/overview`);
  await page.locator('[data-testid="create-initiative"]').click();
  await page.locator('[data-testid="create-initiative-name"]').fill("ui-made-initiative");
  await page.locator('[data-testid="create-initiative-submit"]').click();
  await page.waitForLoadState("networkidle");
  await page.locator('text=ui-made-initiative').first().waitFor({ state: "visible", timeout: 15_000 });
  has("the new initiative appears on the Overview", await text("body"), "ui-made-initiative");

  // The objective, on the initiative's own page — the surface that lists them.
  const init2 = idByName(`/api/project/${project}/initiative`, "name", "ui-made-initiative");
  await goto(`#/project/${project}/initiative/${init2}`);
  await page.locator('[data-testid="entity-tabs"] [role="tab"]', { hasText: "Objectives" }).first().click();
  await page.locator('[data-testid="create-objective"]').click();
  await page.locator('[data-testid="create-objective-name"]').fill("ui-made-objective");
  await page.locator('[data-testid="create-objective-submit"]').click();
  await page.waitForLoadState("networkidle");
  await page.locator('text=ui-made-objective').first().waitFor({ state: "visible", timeout: 15_000 });
  has("the new objective appears on the initiative page", await text("body"), "ui-made-objective");

  // The task, through the full-page create form of decision 8.
  const obj2 = idByName(`/api/initiative/${init2}/objective`, "name", "ui-made-objective");
  await goto(`#/project/${project}/initiative/${init2}/objective/${obj2}`);
  await page.locator('[data-testid="entity-tabs"] [role="tab"]', { hasText: "Tasks" }).first().click();
  await page.locator('[data-testid="create-task"]').click();
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="task-title"]').fill("ui-made-task");
  await page.locator('[data-testid="create-task-submit"]').click();
  await page.waitForLoadState("networkidle");
  await page.waitForURL(/\/task\/[A-Z0-9]+$/, { timeout: 15_000 });
  const landed = new URL(page.url()).hash;
  if (!/\/task\/[^/]+$/.test(landed)) {
    throw new Error(`task create did not land on the created task's page: ${landed}`);
  }

  // --- D: the deterministic 412.
  await goto("#/project", '[data-testid="project-table"]');
  await page.locator(`tr[data-project-id="${project}"] [data-testid="rename-open"]`).click();
  await page.locator('[data-testid="rename-input"]').fill("name-typed-by-operator");
  // The form is open and dirty; the validator is frozen. Now a DIFFERENT client
  // writes an intervening version.
  execFileSync(process.execPath, [intervene, process.env.PROOF_BASE, process.env.PROOF_BASIC, project, "name-from-elsewhere"]);
  const [staleResponse] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/project/${project}`)),
    page.locator('[data-testid="rename-submit"]').click(),
  ]);
  await page.waitForLoadState("networkidle");
  eq("the stale submit is a 412", 412, staleResponse.status());
  await waitVisible('[data-testid="conflict"]');
  eq("the three-version conflict state is shown", true, await visible('[data-testid="conflict"]'));
  has("the operator's draft survived", await text('[data-testid="conflict-draft"]'), "name-typed-by-operator");
  has("the base version is shown", await text('[data-testid="conflict-base"]'), "proof-026-4-original");
  has("the current server version is shown", await text('[data-testid="conflict-current"]'), "name-from-elsewhere");

  await page.locator('[data-testid="conflict-reload"]').click();
  await page.waitForLoadState("networkidle");
  const [applied] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/project/${project}`)),
    page.locator('[data-testid="rename-submit"]').click(),
  ]);
  eq("the resubmit against the fresh validator succeeds", 200, applied.status());
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="project-table"]').locator('text=name-typed-by-operator').first().waitFor({ state: "visible", timeout: 15_000 });
  has("the collection shows the new name", await text('[data-testid="project-table"]'), "name-typed-by-operator");
  await goto(`#/project/${project}/overview`);
  await page.locator('[data-testid="breadcrumb"]').locator('text=name-typed-by-operator').first().waitFor({ state: "visible", timeout: 15_000 });
  has("the breadcrumb shows the new name — the invalidation matrix held",
    await text('[data-testid="breadcrumb"]'), "name-typed-by-operator");

  // --- E: task A already depends on task B. Adding B → A closes a cycle, and
  // the server refuses it with its own error code, rendered inline.
  const { PROOF_INIT: init, PROOF_OBJ: obj, PROOF_TASK_A: taskA, PROOF_TASK_B: taskB } = process.env;
  await goto(`#/project/${project}/initiative/${init}/objective/${obj}/task/${taskB}`);
  await page.locator('[data-testid="entity-tabs"] [role="tab"]', { hasText: "Dependencies" }).first().click();
  await page.locator('[data-testid="dependency-add"]').click();
  const [edgeResponse] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/task/${taskB}/dependency`)),
    page.locator(`[data-testid="dependency-option"][data-task-id="${taskA}"]`).click(),
  ]);
  if (edgeResponse.status() < 400) throw new Error("the server accepted an edge that closes a cycle");
  eq("a rejected edge renders its own inline error", true, await visible('[data-testid="dependency-error"]'));
  const errorText = await text('[data-testid="dependency-error"]');
  if (errorText.trim() === "") throw new Error("the dependency error is empty");
  if (/error|failed/i.test(errorText) && errorText.length < 12) {
    throw new Error(`the dependency error is generic, not the server's code: "${errorText}"`);
  }

  eq("exactly two project PATCHes were issued — the stale one and the recovery",
    2, patches().length);
  const realErrors = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
  eq("no console error across every flow", 0, realErrors.length);

  // --- F: R3.
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
  console.log("    412 observed on the response stream, draft preserved, resubmit 200");
};
STEPS

PROOF_PROJECT="$PROJECT" PROOF_INTERVENE="$PD/intervene.mjs" PROOF_LOOKUP="$PD/lookup.mjs" \
PROOF_BASE="$BASE" PROOF_BASIC="$BASIC" \
PROOF_INIT="$INIT" PROOF_OBJ="$OBJ" PROOF_TASK_A="$TASK_A" PROOF_TASK_B="$TASK_B" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases C–F" >&2; exit 1; }

echo "--- C2: the API agrees the plan was built through the UI"
INITIATIVES="$(curl -sS "$BASE/api/project/$PROJECT/initiative" -H "authorization: $BASIC")"
contains "the UI-made initiative is on the wire" "$INITIATIVES" "ui-made-initiative"
UI_INIT="$(node "$PD/lookup.mjs" "$BASE" "$BASIC" "/api/project/$PROJECT/initiative" name ui-made-initiative)"
OBJECTIVES="$(curl -sS "$BASE/api/initiative/$UI_INIT/objective" -H "authorization: $BASIC")"
contains "the UI-made objective is on the wire" "$OBJECTIVES" "ui-made-objective"
TASKS="$(curl -sS "$BASE/api/initiative/$UI_INIT/task" -H "authorization: $BASIC")"
contains "the UI-made task is on the wire" "$TASKS" "ui-made-task"

echo "--- D2: the API agrees with the screen"
FINAL="$(curl -sS "$BASE/api/project/$PROJECT" -H "authorization: $BASIC")"
contains "the server holds the operator's name, not the intervening one" "$FINAL" "name-typed-by-operator"

echo "026.4 ok: initiative, objective and task built through the UI and confirmed through the API, frozen validator produced a real 412, draft survived, recovery resubmit landed and invalidated the breadcrumb"
