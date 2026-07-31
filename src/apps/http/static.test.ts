// src/apps/http/static.test.ts — EPIC 026 S5: the static UI adapter, against a
// temp dist root. Every assertion here is one the Verification Gate names.
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Koa from "koa";
import {
  sendUiFile,
  isSafeDistPath,
  IMMUTABLE_CACHE_CONTROL,
  NO_CACHE_CACHE_CONTROL,
  type StaticFileTarget,
} from "./static.ts";
import { HttpFailure } from "./errors.ts";

/** A dist root shaped like a real Vite build. */
function makeDistRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kanthord-dist-"));
  mkdirSync(join(root, "assets"));
  mkdirSync(join(root, "icons"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html><head></head><body><div id="root"></div>' +
      '<script type="module" src="./assets/main-a1b2c3d4.js"></script></body></html>',
  );
  writeFileSync(join(root, "assets", "main-a1b2c3d4.js"), 'console.log("hi");');
  writeFileSync(join(root, "assets", "main-a1b2c3d4.css"), ":root{color:red}");
  writeFileSync(join(root, "assets", "logo-9f8e.svg"), "<svg></svg>");
  writeFileSync(join(root, "assets", "inter-1234.woff2"), "woff2-bytes");
  writeFileSync(
    join(root, "sw.js"),
    "self.addEventListener('install',()=>{});",
  );
  writeFileSync(join(root, "manifest.webmanifest"), '{"name":"kanthord"}');
  writeFileSync(join(root, "icons", "icon-192.png"), "png-bytes");
  writeFileSync(join(root, "favicon.ico"), "ico-bytes");
  writeFileSync(join(root, ".hidden", "secret.txt"), "nope");
  return root;
}

/**
 * A minimal koa app whose ONLY middleware is the adapter under test, wrapped in
 * the same kind of error boundary buildHttpApp installs — so a thrown
 * HttpFailure is observable as its status and code, exactly as in the real app.
 */
function appFor(
  distRoot: string | undefined,
  resolve: (path: string) => StaticFileTarget | undefined,
): Koa {
  const app = new Koa();
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof HttpFailure) {
        ctx.status = err.status;
        ctx.body = { error: { code: err.code, message: err.message } };
        return;
      }
      throw err;
    }
  });
  app.use(async (ctx) => {
    const target = resolve(ctx.path);
    if (target === undefined) {
      ctx.status = 418;
      ctx.body = { error: { code: "no_row", message: "no row for this test" } };
      return;
    }
    await sendUiFile(ctx, distRoot, target);
  });
  return app;
}

/** The real row shapes of EPIC 026 S6, so the tests exercise the real policy. */
function resolver(path: string): StaticFileTarget | undefined {
  if (path === "/") {
    return { file: "index.html", cache: "no-cache" };
  }
  if (path === "/sw.js") {
    return { file: "sw.js", cache: "no-cache" };
  }
  if (path === "/manifest.webmanifest") {
    return { file: "manifest.webmanifest", cache: "no-cache" };
  }
  if (path === "/favicon.ico") {
    return { file: "favicon.ico", cache: "no-cache" };
  }
  if (path.startsWith("/assets/")) {
    return {
      file: `assets/${decodeURIComponent(path.slice("/assets/".length))}`,
      cache: "immutable",
    };
  }
  if (path.startsWith("/icons/")) {
    return {
      file: `icons/${decodeURIComponent(path.slice("/icons/".length))}`,
      cache: "immutable",
    };
  }
  if (path.startsWith("/hidden/")) {
    return {
      file: `.hidden/${decodeURIComponent(path.slice("/hidden/".length))}`,
      cache: "no-cache",
    };
  }
  return undefined;
}

test("a hashed asset is public, one year, immutable", async () => {
  const root = makeDistRoot();
  try {
    const res = await request(appFor(root, resolver).callback())
      .get("/assets/main-a1b2c3d4.js")
      .expect(200);
    assert.equal(res.headers["cache-control"], IMMUTABLE_CACHE_CONTROL);
    assert.match(res.headers["cache-control"] ?? "", /max-age=31536000/);
    assert.match(res.headers["cache-control"] ?? "", /immutable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("index.html, sw.js and manifest.webmanifest are no-cache", async () => {
  const root = makeDistRoot();
  try {
    const app = appFor(root, resolver).callback();
    for (const path of ["/", "/sw.js", "/manifest.webmanifest"]) {
      const res = await request(app).get(path).expect(200);
      assert.equal(
        res.headers["cache-control"],
        NO_CACHE_CACHE_CONTROL,
        `${path} must be no-cache`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the served document IS the file from the injected root", async () => {
  const root = makeDistRoot();
  try {
    const res = await request(appFor(root, resolver).callback())
      .get("/")
      .expect(200);
    assert.match(res.headers["content-type"] ?? "", /text\/html/);
    assert.match(res.text, /<script type="module"/);
    assert.match(res.text, /id="root"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("HEAD returns the headers with no body", async () => {
  const root = makeDistRoot();
  try {
    const res = await request(appFor(root, resolver).callback())
      .head("/assets/main-a1b2c3d4.js")
      .expect(200);
    assert.equal(res.headers["cache-control"], IMMUTABLE_CACHE_CONTROL);
    assert.match(res.headers["content-type"] ?? "", /javascript/);
    assert.ok(res.headers["etag"], "HEAD must still carry the ETag");
    assert.equal(res.text, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a conditional request with the returned ETag is 304, a stale one is 200", async () => {
  const root = makeDistRoot();
  try {
    const app = appFor(root, resolver).callback();
    const first = await request(app)
      .get("/assets/main-a1b2c3d4.js")
      .expect(200);
    const etag = first.headers["etag"];
    assert.ok(etag, "the adapter must set an ETag");

    await request(app)
      .get("/assets/main-a1b2c3d4.js")
      .set("If-None-Match", etag as string)
      .expect(304);

    await request(app)
      .get("/assets/main-a1b2c3d4.js")
      .set("If-None-Match", '"bogus"')
      .expect(200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a 304 carries no content headers and no body", async () => {
  const root = makeDistRoot();
  try {
    const app = appFor(root, resolver).callback();
    const first = await request(app).get("/").expect(200);
    const res = await request(app)
      .get("/")
      .set("If-None-Match", first.headers["etag"] as string)
      .expect(304);
    assert.equal(res.headers["content-type"], undefined);
    assert.equal(res.headers["content-length"], undefined);
    assert.ok(
      res.text === undefined || res.text === "",
      `a 304 must carry no body, got ${JSON.stringify(res.text)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing file is 404 unknown_route — never a 500, never a stack trace", async () => {
  const root = makeDistRoot();
  try {
    const res = await request(appFor(root, resolver).callback())
      .get("/assets/does-not-exist.js")
      .expect(404);
    assert.equal(
      (res.body as { error: { code: string } }).error.code,
      "unknown_route",
    );
    assert.doesNotMatch(
      JSON.stringify(res.body),
      /static\.ts|at Object|ENOENT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent dist root is 404 unknown_route, not a crash", async () => {
  const res = await request(appFor(undefined, resolver).callback())
    .get("/")
    .expect(404);
  assert.equal(
    (res.body as { error: { code: string } }).error.code,
    "unknown_route",
  );
});

test("an unbuilt dist directory is 404 unknown_route, not a crash", async () => {
  const res = await request(
    appFor("/definitely/not/a/real/dist/root", resolver).callback(),
  )
    .get("/")
    .expect(404);
  assert.equal(
    (res.body as { error: { code: string } }).error.code,
    "unknown_route",
  );
});

test("../ and %2e%2e%2f in :file are rejected and leak nothing", async () => {
  const root = makeDistRoot();
  try {
    const app = appFor(root, resolver).callback();
    for (const path of [
      "/assets/..%2f..%2fpackage.json",
      "/assets/%2e%2e%2f%2e%2e%2fpackage.json",
      "/assets/%2e%2e%2findex.html",
      "/icons/..%2f..%2f..%2fetc%2fpasswd",
    ]) {
      const res = await request(app).get(path);
      assert.notEqual(res.status, 200, `${path} must not be served`);
      assert.doesNotMatch(res.text ?? "", /"name": "kanthord"/);
      assert.doesNotMatch(res.text ?? "", /root:/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a hidden segment is refused inside the envelope, not as a bare koa 404", async () => {
  const root = makeDistRoot();
  try {
    const res = await request(appFor(root, resolver).callback())
      .get("/hidden/secret.txt")
      .expect(404);
    assert.equal(
      (res.body as { error: { code: string } }).error.code,
      "unknown_route",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the served MIME types are correct for every extension the build emits", async () => {
  const root = makeDistRoot();
  try {
    const app = appFor(root, resolver).callback();
    const expected: ReadonlyArray<readonly [string, RegExp]> = [
      ["/assets/main-a1b2c3d4.js", /javascript/],
      ["/assets/main-a1b2c3d4.css", /text\/css/],
      ["/", /text\/html/],
      ["/manifest.webmanifest", /manifest/],
      ["/assets/logo-9f8e.svg", /image\/svg\+xml/],
      ["/icons/icon-192.png", /image\/png/],
      ["/assets/inter-1234.woff2", /font\/woff2/],
    ];
    for (const [path, pattern] of expected) {
      const res = await request(app).get(path).expect(200);
      assert.match(
        res.headers["content-type"] ?? "",
        pattern,
        `${path} content-type was ${res.headers["content-type"]}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isSafeDistPath accepts real build paths and refuses every escape", () => {
  for (const ok of [
    "index.html",
    "sw.js",
    "manifest.webmanifest",
    "assets/main-a1b2c3d4.js",
    "icons/icon-512.png",
    "favicon.ico",
  ]) {
    assert.equal(isSafeDistPath(ok), true, `${ok} must be accepted`);
  }
  for (const bad of [
    "",
    "..",
    "../package.json",
    "assets/../../package.json",
    "assets//main.js",
    "assets/./main.js",
    "assets\\main.js",
    "assets/main\0.js",
  ]) {
    assert.equal(isSafeDistPath(bad), false, `${bad} must be refused`);
  }
});
