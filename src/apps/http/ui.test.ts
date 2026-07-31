// src/apps/http/ui.test.ts — EPIC 026 S6, the WIRING test for the built UI.
//
// This file replaces the Story-06 shell tests. The old `UI_SHELL_HTML` constant,
// its "no <script src>" assertion and the inline `ui.get` row are gone: a Vite
// build emits exactly a `<script type="module" src=…>` tag, so the assertion had
// to be replaced rather than worked around. What is asserted now is that the
// served document IS the built `index.html` from the INJECTED dist root, and that
// every UI row goes through the route table with the pinned 404 policy intact.
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHttpApp } from "./app.ts";
import { ROUTES } from "./routes.ts";
import type { HttpDeps } from "./deps.ts";
import { IMMUTABLE_CACHE_CONTROL, NO_CACHE_CACHE_CONTROL } from "./static.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");

function makeDeps(): HttpDeps {
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  return { logger } as unknown as HttpDeps;
}

const BUILT_INDEX =
  '<!doctype html><html lang="en"><head>' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">' +
  "<title>kanthord</title>" +
  '<script type="module" crossorigin src="./assets/index-o3mnBGfu.js"></script>' +
  '</head><body><div id="root"></div></body></html>';

/** A dist root with the six files the six UI rows name. */
function makeDistRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kanthord-uidist-"));
  mkdirSync(join(root, "assets"));
  mkdirSync(join(root, "icons"));
  writeFileSync(join(root, "index.html"), BUILT_INDEX);
  writeFileSync(join(root, "assets", "index-o3mnBGfu.js"), "export default 1;");
  writeFileSync(join(root, "sw.js"), "self.skipWaiting();");
  writeFileSync(join(root, "manifest.webmanifest"), '{"name":"kanthord"}');
  writeFileSync(join(root, "icons", "icon-192.png"), "png-bytes");
  writeFileSync(join(root, "favicon.ico"), "ico-bytes");
  return root;
}

function withDistRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = makeDistRoot();
  return run(root).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}

test("the six UI rows are declared, all GET, all static, all claiming no CLI leaf", () => {
  const expected = [
    ["ui.index.get", "/"],
    ["ui.asset.get", "/assets/:file"],
    ["ui.sw.get", "/sw.js"],
    ["ui.manifest.get", "/manifest.webmanifest"],
    ["ui.icon.get", "/icons/:file"],
    ["ui.favicon.get", "/favicon.ico"],
  ] as const;
  for (const [id, path] of expected) {
    const row = ROUTES.find((r) => r.id === id);
    assert.ok(row !== undefined, `row ${id} must exist`);
    assert.equal(row.path, path);
    assert.equal(row.method, "GET");
    assert.equal(row.kind, "static");
    assert.equal(row.successStatus, 200);
    assert.deepEqual(row.cliCommands, []);
  }
});

test("the retired inline shell is gone from the route table", () => {
  assert.equal(
    ROUTES.find((r) => r.id === "ui.get"),
    undefined,
    "the inline ui.get row must not come back",
  );
  assert.equal(
    ROUTES.some((r) => (r.kind as string) === "html"),
    false,
    'no row may declare kind "html" — the UI is a built artifact now',
  );
});

test("GET / serves the built index.html from the injected dist root", async () => {
  await withDistRoot(async (uiDistRoot) => {
    const app = buildHttpApp(makeDeps(), { apiKey: KEY, uiDistRoot });
    const res = await request(app.callback())
      .get("/")
      .set("Authorization", AUTH);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"] ?? "", /text\/html/);
    assert.equal(res.text, BUILT_INDEX);
    assert.match(res.text, /<script type="module"/);
    assert.equal(res.headers["cache-control"], NO_CACHE_CACHE_CONTROL);
    assert.doesNotMatch(res.text, /id="health"/);
  });
});

test("the hashed asset named by the served index is served immutable", async () => {
  await withDistRoot(async (uiDistRoot) => {
    const app = buildHttpApp(makeDeps(), { apiKey: KEY, uiDistRoot });
    const index = await request(app.callback())
      .get("/")
      .set("Authorization", AUTH);
    // Extracted from the served HTML, never guessed — the Proof follows the same rule.
    const src = /<script[^>]+src="([^"]+)"/.exec(index.text)?.[1];
    assert.ok(src !== undefined, "the served index must name a module bundle");
    const res = await request(app.callback())
      .get(src.replace(/^\.\//, "/"))
      .set("Authorization", AUTH);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"] ?? "", /javascript/);
    assert.equal(res.headers["cache-control"], IMMUTABLE_CACHE_CONTROL);
  });
});

test("sw.js sits at the root scope and the manifest is served, both no-cache", async () => {
  await withDistRoot(async (uiDistRoot) => {
    const app = buildHttpApp(makeDeps(), { apiKey: KEY, uiDistRoot });
    for (const path of ["/sw.js", "/manifest.webmanifest"]) {
      const res = await request(app.callback())
        .get(path)
        .set("Authorization", AUTH);
      assert.equal(res.status, 200, `${path} must be served`);
      assert.equal(res.headers["cache-control"], NO_CACHE_CACHE_CONTROL);
    }
  });
});

test("the icons and the favicon are served", async () => {
  await withDistRoot(async (uiDistRoot) => {
    const app = buildHttpApp(makeDeps(), { apiKey: KEY, uiDistRoot });
    const icon = await request(app.callback())
      .get("/icons/icon-192.png")
      .set("Authorization", AUTH);
    assert.equal(icon.status, 200);
    assert.match(icon.headers["content-type"] ?? "", /image\/png/);
    const favicon = await request(app.callback())
      .get("/favicon.ico")
      .set("Authorization", AUTH);
    assert.equal(favicon.status, 200);
  });
});

// Decision 3: hash routing means no SPA fallback, which is what keeps this pin
// alive. A regression here means someone added a catch-all.
test("GET /nope is still 404 unknown_route with static serving wired in", async () => {
  await withDistRoot(async (uiDistRoot) => {
    const app = buildHttpApp(makeDeps(), { apiKey: KEY, uiDistRoot });
    const res = await request(app.callback())
      .get("/nope")
      .set("Authorization", AUTH);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "unknown_route");
  });
});

test("every UI surface still needs credentials (decision 5)", async () => {
  await withDistRoot(async (uiDistRoot) => {
    const app = buildHttpApp(makeDeps(), { apiKey: KEY, uiDistRoot });
    for (const path of [
      "/",
      "/assets/index-o3mnBGfu.js",
      "/sw.js",
      "/manifest.webmanifest",
      "/icons/icon-192.png",
      "/favicon.ico",
    ]) {
      const res = await request(app.callback()).get(path);
      assert.equal(res.status, 401, `${path} must challenge`);
    }
  });
});

// `ui/dist` is gitignored, so every backend test run would otherwise depend on a
// prior UI build.
test("buildHttpApp constructs and /healthz answers with ui/dist absent", async () => {
  const app = buildHttpApp(makeDeps(), { apiKey: KEY });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Accept", "application/json");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.version, "string");
});
