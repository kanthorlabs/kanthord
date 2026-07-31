#!/usr/bin/env bash
# ui-collections-proof.sh — EPIC 026.2 Proof (deterministic, no model, loopback
# only, nothing left running).
#
# Proves, in a real browser against the real daemon serving the real build:
#   * the Projects collection renders seeded projects and its toolbar search is
#     SERVER-side (the request carries ?name=),
#   * the project Overview renders the approved composition in its fixed order —
#     initiative cards with the six real task counts, decisions, digest,
#   * Resources is one screen with four URL-addressable typed tabs: a cold load
#     of the credential tab shows credential grammar, the repository tab shows a
#     branch column, a reload keeps the tab, an unknown type is the missing state,
#   * the polling engine works: a task created THROUGH THE API while the page
#     sits untouched raises the pending count on screen with no interaction,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# EXPECTED FAILURE against the CURRENT tree: phase A fails at the first check,
# because `ui/` does not exist and `npm run build:ui` is not a script yet.
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

echo "--- B: seed real data through the real API"
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

POST() { # POST <path> <json> -> prints the created id
  local path="$1" body="$2" code
  code="$(curl -sS -o "$PD/post.json" -w '%{http_code}' -X POST "$BASE$path" \
    -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
    --data "$body")"
  [ "$code" = "201" ] || { echo "FAILED: POST $path — expected 201, got $code: $(cat "$PD/post.json")" >&2; exit 1; }
  node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.id))' "$PD/post.json"
}

PROJECT_A="$(POST /api/project '{"name":"proof-026-2-alpha"}')"
POST /api/project '{"name":"proof-026-2-beta"}' >/dev/null
INIT_A="$(POST "/api/project/$PROJECT_A/initiative" '{"name":"initiative-one"}')"
POST "/api/project/$PROJECT_A/initiative" '{"name":"initiative-two"}' >/dev/null
OBJ_A="$(POST "/api/initiative/$INIT_A/objective" '{"name":"objective-one"}')"
POST "/api/objective/$OBJ_A/task" '{"title":"task-one"}' >/dev/null
POST "/api/objective/$OBJ_A/task" '{"title":"task-two"}' >/dev/null
POST "/api/project/$PROJECT_A/repository" \
  '{"name":"repo-one","remoteUrl":"https://example.invalid/x.git","branch":"main","auth":{"kind":"ambient"}}' >/dev/null
POST "/api/project/$PROJECT_A/credential" \
  '{"name":"cred-one","provider":"github","value":"s3cr3t-not-rendered"}' >/dev/null
echo "    project: $PROJECT_A   initiative: $INIT_A   objective: $OBJ_A"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page, base }) => {
  const { PROOF_PROJECT_ID: projectId, PROOF_INITIATIVE_ID: initiativeId, PROOF_KEY: key } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };

  // --- C: the Projects collection, with SERVER-side search.
  await goto("#/project");
  eq("both seeded projects are listed", 2, await count('[data-testid="project-table"] tbody tr'));
  eq("the seeded project has its own row", 1, await count(`tr[data-project-id="${projectId}"]`));
  const before = requests.length;
  const searchResponse = page.waitForResponse(r => r.url().includes("/api/project") && r.url().includes("name="));
  await page.locator('[data-testid="collection-search"]').fill("alpha");
  await searchResponse;
  const searched = requests.slice(before).filter((r) => r.url.includes("/api/project") && r.url.includes("name="));
  if (searched.length === 0) throw new Error("the toolbar search did not send ?name= to the server");
  eq("the table narrowed to the matching project", 1, await count('[data-testid="project-table"] tbody tr'));

  // --- D: the Overview composition, in its fixed order.
  await goto(`#/project/${projectId}/overview`, '[data-testid="overview-initiative-card"]');
  eq("one card per initiative", 2, await count('[data-testid="overview-initiative-card"]'));
  const card = `[data-initiative-id="${initiativeId}"]`;
  has("the card names the real initiative", await text(card), "initiative-one");
  eq("the card shows the two seeded pending tasks", "2", (await text(`${card} [data-testid="count-pending"]`)).replace(/\D/g, ""));
  eq("the decisions section is present", true, await visible('[data-testid="overview-decisions"]'));
  eq("the digest section is present", true, await visible('[data-testid="overview-digest"]'));
  const order = await page.evaluate(() => {
    const ids = ["overview-initiative-card", "overview-decisions", "overview-digest"];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el ? el.getBoundingClientRect().top : Number.NaN;
    });
  });
  if (!(order[0] < order[1] && order[1] < order[2])) {
    throw new Error(`Overview order must be cards → decisions → digest, got tops ${order.join(", ")}`);
  }

  // --- E: Resources — four typed tabs, the tab lives in the URL.
  await goto(`#/project/${projectId}/resource/credential`, '[data-testid="resource-table"]');
  eq("four resource tabs", 4, await count('[data-testid="resource-tabs"] a'));
  eq("one seeded credential", 1, await count('[data-testid="resource-table"] tbody tr'));
  eq("the credential tab has no repository-only column", 0, await count('[data-testid="resource-col-branch"]'));
  has("the credential secret is never rendered", await text("body"), "cred-one");
  if ((await text("body")).includes("s3cr3t-not-rendered")) throw new Error("a credential secret was rendered");
  await page.locator('[data-testid="resource-tabs"] a', { hasText: "Repositor" }).first().click();
  await page.locator('[data-testid="resource-col-branch"]').first().waitFor({ state: "visible", timeout: 10_000 });
  has("switching tab changes the URL", page.url(), `/resource/repository`);
  eq("the repository grammar has a branch column", 1, await count('[data-testid="resource-col-branch"]'));
  await page.reload();
  await page.locator('[data-testid="resource-col-branch"]').first().waitFor({ state: "visible", timeout: 10_000 });
  eq("a reload keeps the repository tab", 1, await count('[data-testid="resource-col-branch"]'));
  await goto(`#/project/${projectId}/resource/not-a-type`);
  eq("an unknown resource type is the missing state", true, await visible('[data-testid="async-missing"]'));

  // --- F: the polling engine. The page is untouched from here on.
  await goto(`#/project/${projectId}/overview`, '[data-testid="overview-initiative-card"]');
  const pendingBefore = Number((await text(`${card} [data-testid="count-pending"]`)).replace(/\D/g, ""));
  const created = await page.evaluate(async ({ base, key, objectiveId }) => {
    const res = await fetch(`${base}/api/objective/${objectiveId}/task`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`kanthord:${key}`)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "task-three-from-proof" }),
    });
    return res.status;
  }, { base, key, objectiveId: process.env.PROOF_OBJECTIVE_ID });
  eq("the out-of-band task was created", 201, created);
  await page
    .locator(`${card} [data-testid="count-pending"]`)
    .filter({ hasText: String(pendingBefore + 1) })
    .first()
    .waitFor({ timeout: 35_000 });

  eq("the page booted and polled with no console error", 0, consoleErrors.length);

  // --- G: R3 — the page's own code never sets Authorization. The evaluate()
  // call above is the Proof's instrument, not ui/ source, so it is excluded.
  const offenders = requests.filter(
    (r) => r.authorization !== null && !r.url.includes("/api/objective/"),
  );
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
  console.log(`    pending count rose ${pendingBefore} → ${pendingBefore + 1} with no interaction`);
};
STEPS

PROOF_PROJECT_ID="$PROJECT_A" PROOF_INITIATIVE_ID="$INIT_A" PROOF_OBJECTIVE_ID="$OBJ_A" PROOF_KEY="$KEY" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases C–G" >&2; exit 1; }

echo "026.2 ok: projects listed + server-side search, Overview composition in order, four typed resource tabs deep-linked, polling raised a task count with no interaction"
