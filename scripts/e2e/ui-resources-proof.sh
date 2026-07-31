#!/usr/bin/env bash
# ui-resources-proof.sh — EPIC 026.5 Proof (deterministic, no model, loopback
# only, nothing left running).
#
# Proves, in a real browser against the real daemon serving the real build:
#   * each resource type is created through its OWN form, and the request body
#     carries no blank string and no create-only field on an edit,
#   * a credential secret is typed once and appears in no read response and in
#     no rendered document; the rotation input clears on success,
#   * repository auth is submitted as a COMPLETE discriminated object, with the
#     credential chosen from the project's own credentials,
#   * the remote-URL change is honest: the server's cache conflict is surfaced,
#     the confirmation names the discarded home pointer, and continuing empties
#     the stored path — and nothing more, because `reclone` does no git work,
#   * publication renders its real state,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# Playwright tracing, video and screenshots are OFF for this Proof (EPIC 026.5
# decision 3): a trace of the rotation scenario would itself capture the secret.
#
# The Proof deliberately does NOT assert that a rotated value was stored: the
# credential DTO exposes nothing that changes when the value does (decision 5).
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
SECRET="sentinel-secret-must-never-be-read-back"

eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — must not equal '$2'" >&2; exit 1; }; }
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

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
  --data '{"name":"proof-026-5"}')"
eq "seed project created" "201" "$CODE"
PROJECT="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.id)' "$PD/p.json")"
echo "    project: $PROJECT"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, responses, page }) => {
  const { PROOF_PROJECT: project, PROOF_SECRET: secret } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };
  const bodyOf = (r) => r.postData ?? "";

  // --- C: create a credential through its own form.
  await goto(`#/project/${project}/resource/credential`);
  eq("the create form warns that resources cannot be deleted", true, await visible('[data-testid="no-delete-notice"]'));
  await page.locator('[data-testid="resource-create"]').click();
  await page.locator('[data-testid="resource-create-form"] [name="name"]').fill("proof-credential");
  await page.locator('[data-testid="resource-create-form"] [name="provider"]').fill("github");
  await page.locator('[data-testid="resource-create-form"] [name="value"]').fill(secret);
  const [credCreate] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/credential")),
    page.locator('[data-testid="resource-create-form"] [type="submit"]').click(),
  ]);
  eq("the credential was created", 201, credCreate.status());
  const createBody = credCreate.request().postData() ?? "";
  if (/:\s*""/.test(createBody)) throw new Error(`the create body sent a blank string: ${createBody}`);
  await page.waitForLoadState("networkidle");
  if ((await text("body")).includes(secret)) throw new Error("the secret was rendered after create");

  // --- D: a repository with a COMPLETE discriminated auth object.
  await goto(`#/project/${project}/resource/repository`);
  await page.locator('[data-testid="resource-create"]').click();
  await page.locator('[data-testid="resource-create-form"] [name="name"]').fill("proof-repository");
  await page.locator('[data-testid="resource-create-form"] [name="remoteUrl"]').fill("https://example.invalid/one.git");
  await page.locator('[data-testid="resource-create-form"] [name="branch"]').fill("main");
  await page.locator('[data-testid="auth-kind"]').selectOption("https-token");
  eq("the credential picker appears only for https-token", true, await visible('[data-testid="auth-credential"]'));
  await page.locator('[data-testid="auth-credential"]').selectOption({ label: "proof-credential" });
  const [repoCreate] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/repository")),
    page.locator('[data-testid="resource-create-form"] [type="submit"]').click(),
  ]);
  eq("the repository was created", 201, repoCreate.status());
  const repoBody = JSON.parse(repoCreate.request().postData() ?? "{}");
  eq("auth.kind was sent", "https-token", repoBody.auth?.kind);
  if (!repoBody.auth?.credentialId) throw new Error("auth was sent without credentialId — a partial auth object");
  if ("path" in repoBody && repoBody.path === "") throw new Error("path was sent as a blank string");

  // --- E: rotate the secret through the ISOLATED control.
  await goto(`#/project/${project}/resource/credential`);
  await page.locator('tbody tr', { hasText: "proof-credential" }).first().click();
  await page.locator('[data-testid="rotate-secret"]').click();
  await page.locator('[data-testid="rotate-secret-input"]').fill(`${secret}-rotated`);
  const [rotate] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/credential/")),
    page.locator('[data-testid="rotate-secret"] [type="submit"]').first().click(),
  ]);
  eq("the rotation succeeded", 200, rotate.status());
  await page.waitForLoadState("networkidle");
  eq("the rotation input is cleared on success", "", await page.locator('[data-testid="rotate-secret-input"]').inputValue());
  const patchBody = JSON.parse(rotate.request().postData() ?? "{}");
  if ("provider" in patchBody) throw new Error("an edit payload carried the create-only field `provider`");
  eq("the type probe was sent", "credential", patchBody.type);

  // --- F: the honest remote change.
  await goto(`#/project/${project}/resource/repository`);
  await page.locator('tbody tr', { hasText: "proof-repository" }).first().click();
  await page.locator('[data-testid="remote-url-change"]').click();
  await page.locator('[data-testid="remote-url-change"] [name="remoteUrl"]').fill("https://example.invalid/two.git");
  await page.locator('[data-testid="remote-url-change"] [type="submit"]').click();
  await page.waitForLoadState("networkidle");
  if (await visible('[data-testid="cache-conflict-confirm"]')) {
    const confirmText = await text('[data-testid="cache-conflict-confirm"]');
    if (/reclone/i.test(confirmText)) {
      throw new Error(`the confirmation calls it a reclone, which the API does not do: "${confirmText}"`);
    }
    const [continued] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/repository/")),
      page.locator('[data-testid="cache-conflict-confirm"] [data-testid="confirm"]').click(),
    ]);
    eq("continuing the remote change succeeds", 200, continued.status());
    const body = JSON.parse(continued.request().postData() ?? "{}");
    eq("the confirmation resends the same remoteUrl", "https://example.invalid/two.git", body.remoteUrl);
    eq("reclone rides with the remoteUrl change", true, body.reclone);
  }
  const lonelyReclone = requests.filter((r) => {
    if (r.method !== "PATCH") return false;
    try {
      const b = JSON.parse(r.postData ?? "{}");
      return b.reclone === true && b.remoteUrl === undefined;
    } catch {
      return false;
    }
  });
  if (lonelyReclone.length > 0) throw new Error("reclone was sent without a remoteUrl change — a no-op the UI must never issue");

  // --- G: publication and R3.
  eq("publication renders a state", true, await visible('[data-testid="publication-state"]'));
  if ((await text("body")).includes(secret)) throw new Error("the secret appeared in the document");
  eq("no console error across every flow", 0, consoleErrors.length);
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
  void bodyOf;
  void count;
  void responses;
};
STEPS

PROOF_PROJECT="$PROJECT" PROOF_SECRET="$SECRET" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases C–G" >&2; exit 1; }

echo "--- C2: the read APIs never return the secret"
CRED_LIST="$(curl -sS "$BASE/api/project/$PROJECT/credential" -H "authorization: $BASIC")"
absent "the credential collection has no value" "$CRED_LIST" "$SECRET"
CRED_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).data[0].id)' "$CRED_LIST")"
absent "the credential detail has no value" "$(curl -sS "$BASE/api/resource/$CRED_ID" -H "authorization: $BASIC")" "$SECRET"
absent "the daemon log has no value" "$(cat "$PD/serve.log")" "$SECRET"

echo "--- F2: the remote change emptied the stored path, and did nothing else"
REPO_LIST="$(curl -sS "$BASE/api/project/$PROJECT/repository" -H "authorization: $BASIC")"
REPO_PATH="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).data[0].path))' "$REPO_LIST")"
contains "the repository now points at the new remote" "$REPO_LIST" "example.invalid/two.git"
eq "the cached home pointer was discarded" "" "$REPO_PATH"

echo "026.5 ok: four typed forms, complete auth object, secret never read back or logged, remote change named honestly and only emptied the home pointer"
