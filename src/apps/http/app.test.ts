// src/apps/http/app.test.ts — Story 05: buildHttpApp middleware order, gates, and dispatch.
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildHttpApp,
  requiresJsonContentType,
  requiresOriginCheck,
} from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import type { Route } from "./routes.ts";
import { packageVersion } from "../version.ts";
import { MissingApiKeyError } from "./api-key.ts";
import { UI_SHELL_HTML } from "./ui.ts";
import { PinoLogger } from "../../logger/pino.ts";
import type { DestinationStream } from "pino";
import { UnknownReferenceError } from "../../app/errors.ts";
import { etagOf } from "./etag.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  const lines: string[] = [];
  return {
    lines,
    info(message: string, fields?: Record<string, unknown>) {
      lines.push(JSON.stringify({ level: "info", message, ...fields }));
    },
    warn(message: string, fields?: Record<string, unknown>) {
      lines.push(JSON.stringify({ level: "warn", message, ...fields }));
    },
    error(message: string, fields?: Record<string, unknown>) {
      lines.push(JSON.stringify({ level: "error", message, ...fields }));
    },
  };
}

function makeDeps(): { deps: HttpDeps; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  return { deps: { logger } as unknown as HttpDeps, logger };
}

const postTestRoute: Route = {
  id: "test.post",
  method: "POST",
  path: "/api/test",
  successStatus: 200,
  kind: "json",
  cliCommands: [],
  decode: (i) => i.body,
  run: async (_d, i) => i,
  present: (r) => ({ echo: (r as { echo?: unknown }).echo ?? null }),
};

const deleteTestRoute: Route = {
  id: "test.delete",
  method: "DELETE",
  path: "/api/test",
  successStatus: 204,
  kind: "json",
  cliCommands: [],
  decode: () => ({}),
  run: async () => undefined,
};

const getByIdTestRoute: Route = {
  id: "test.getById",
  method: "GET",
  path: "/api/test/:id",
  successStatus: 200,
  kind: "json",
  cliCommands: [],
  decode: (i) => i.params,
  run: async (_d, i) => i,
  present: (r) => r,
};

test("GET /healthz with valid auth returns 200 and the envelope", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    data: { status: "ok", version: packageVersion },
  });
  assert.equal(
    res.headers["content-type"]?.startsWith("application/json"),
    true,
  );
});

test("no Authorization header returns 401 with WWW-Authenticate and envelope", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback()).get("/healthz");
  assert.equal(res.status, 401);
  assert.equal(res.headers["www-authenticate"], 'Basic realm="kanthord"');
  assert.equal(res.body.error.code, "unauthenticated");
  assert.equal(typeof res.body.error.message, "string");
  assert.equal(res.body.error.requestId, REQUEST_ID);
});

test("wrong key returns 401", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const wrongAuth =
    "Basic " +
    Buffer.from("kanthord:wrongwrongwrongwrongwrongwr").toString("base64");
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", wrongAuth);
  assert.equal(res.status, 401);
});

test("lower-case basic scheme with the right key returns 200", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const lower = "basic " + Buffer.from("kanthord:" + KEY).toString("base64");
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", lower);
  assert.equal(res.status, 200);
});

test("auth precedes routing: unknown path with no header is 401 not 404", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback()).get("/nope");
  assert.equal(res.status, 401);
});

test("no handler leak: unauthenticated request never reaches an injected route's run", async () => {
  const { deps } = makeDeps();
  let calls = 0;
  const spyRoute: Route = {
    id: "test.spy",
    method: "GET",
    path: "/api/spy",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => {
      calls += 1;
      return {};
    },
    present: (r) => r,
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [spyRoute],
    newRequestId: () => REQUEST_ID,
  });
  await request(app.callback()).get("/api/spy");
  assert.equal(calls, 0);
});

test("unknown path with valid auth is 404 unknown_route", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/nope")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_route");
});

test("POST /healthz with valid auth is 405 with Allow: GET", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/healthz")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "GET");
  assert.equal(res.body.error.code, "method_not_allowed");
});

test("Host: evil.example is 403 host_not_allowed", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Host", "evil.example");
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "host_not_allowed");
});

test("Host: localhost:4100 is 200", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Host", "localhost:4100");
  assert.equal(res.status, 200);
});

test("Host: 127.0.0.1:4100 is 200", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Host", "127.0.0.1:4100");
  assert.equal(res.status, 200);
});

test("CORS: allowed origin is echoed in Access-Control-Allow-Origin", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Origin", "http://127.0.0.1:4100");
  assert.equal(
    res.headers["access-control-allow-origin"],
    "http://127.0.0.1:4100",
  );
});

test("CORS: disallowed origin carries no Access-Control-Allow-Origin header", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Origin", "https://evil.example");
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("CORS: no response ever carries Access-Control-Allow-Credentials", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH)
    .set("Origin", "http://127.0.0.1:4100");
  assert.equal(res.headers["access-control-allow-credentials"], undefined);
});

test("CORS preflight from allowed origin succeeds without credentials", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .options("/healthz")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "GET");
  assert.ok(res.status === 204 || res.status === 200);
});

test("unsafe-method gates: Content-Type text/plain on POST is 415", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/test")
    .set("Authorization", AUTH)
    .set("Content-Type", "text/plain")
    .send("hello");
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, "unsupported_media_type");
});

test("unsafe-method gates: valid JSON body on POST is 200 with echoed field", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/test")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ echo: "x" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.echo, "x");
});

test("unsafe-method gates: invalid JSON body is 400 malformed_body and never echoes bytes", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/test")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send("{");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "malformed_body");
  // The envelope itself is JSON, so it always contains "{" — the real
  // no-leak invariant is that the message is the fixed registry text, never
  // the parser's own diagnostic (which could echo input/position details).
  assert.equal(res.body.error.message, "malformed request body");
});

// R2-B1 repair (AUTO_REVIEW FAIL): supertest/superagent sends
// `Connection: close`, so Node destroySoon()s the socket right after
// res.end() while the 1.2 MB body is still being written, RSTing the
// still-inbound bytes (client-side `write ECONNRESET`) on a small fraction
// of runs — a client artifact, not a production defect (`ctx.req.resume()`
// in app.ts is correct and stays). This case is driven over a real
// `node:http` KEEP-ALIVE connection instead, so the socket is never torn
// down mid-write, while still asserting the identical 413 + body_too_large
// envelope the supertest version asserted.
test("unsafe-method gates: body over 1 MiB is 413 body_too_large (real socket, keep-alive)", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true });
  try {
    const body = JSON.stringify({ echo: "x".repeat(1_200_000) });
    const { status, json } = await new Promise<{
      status: number;
      json: unknown;
    }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/test",
          method: "POST",
          agent,
          headers: {
            Authorization: AUTH,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                json: JSON.parse(
                  Buffer.concat(chunks).toString("utf8"),
                ) as unknown,
              });
            } catch (err) {
              reject(err as Error);
            }
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(status, 413);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "body_too_large",
    );
  } finally {
    agent.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("unsafe-method gates: foreign Origin with valid JSON body is 403 origin_not_allowed", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/test")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("Origin", "https://evil.example")
    .send({ echo: "x" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "origin_not_allowed");
});

test("unsafe-method gates: origin matching the server's own origin (same host+port) is 200", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/test")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("Host", "127.0.0.1:4100")
    .set("Origin", "http://127.0.0.1:4100")
    .send({ echo: "x" });
  assert.equal(res.status, 200);
});

test("unsafe-method gates: a foreign loopback PORT (Origin != server's own origin) is 403 origin_not_allowed", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [postTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/test")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("Host", "127.0.0.1:4100")
    .set("Origin", "http://127.0.0.1:9999")
    .send({ echo: "x" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "origin_not_allowed");
});

test("DELETE with no Content-Type header still succeeds (media-type gate exempts DELETE)", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [deleteTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/test")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.equal(res.text, "");
});

test("DELETE with a foreign Origin is still 403 origin_not_allowed", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [deleteTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/test")
    .set("Authorization", AUTH)
    .set("Origin", "https://evil.example");
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "origin_not_allowed");
});

test("DELETE with an origin matching the server's own origin is 204", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [deleteTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/test")
    .set("Authorization", AUTH)
    .set("Host", "localhost:4100")
    .set("Origin", "http://localhost:4100");
  assert.equal(res.status, 204);
});

test("DELETE with a foreign-port Origin (!= server's own origin) is still 403 origin_not_allowed", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [deleteTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/test")
    .set("Authorization", AUTH)
    .set("Host", "localhost:4100")
    .set("Origin", "http://localhost:5173");
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "origin_not_allowed");
});

// R2-S2 repair (AUTO_REVIEW FAIL): S4 (router.test.ts) proves matchRoute
// throws InvalidInputError for a malformed :param percent-escape at the unit
// level only — nothing before this drove that path over the wire. This
// case injects a GET /api/test/:id route (decision-18 `routes` seam) and
// requests a malformed escape, asserting the observed wire status/code.
test("wire-level: malformed percent-escape in a :param segment is 400 invalid_input, no request bytes echoed", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [getByIdTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/test/%zz")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.ok(!res.text.includes("%zz"));
});

test("requiresJsonContentType is true for POST, PUT, PATCH only", () => {
  assert.equal(requiresJsonContentType("POST"), true);
  assert.equal(requiresJsonContentType("PUT"), true);
  assert.equal(requiresJsonContentType("PATCH"), true);
  assert.equal(requiresJsonContentType("DELETE"), false);
  assert.equal(requiresJsonContentType("GET"), false);
  assert.equal(requiresJsonContentType("HEAD"), false);
  assert.equal(requiresJsonContentType("OPTIONS"), false);
  assert.equal(requiresJsonContentType("post"), true);
});

test("requiresOriginCheck is true for POST, PUT, PATCH, DELETE only", () => {
  assert.equal(requiresOriginCheck("POST"), true);
  assert.equal(requiresOriginCheck("PUT"), true);
  assert.equal(requiresOriginCheck("PATCH"), true);
  assert.equal(requiresOriginCheck("DELETE"), true);
  assert.equal(requiresOriginCheck("GET"), false);
  assert.equal(requiresOriginCheck("HEAD"), false);
  assert.equal(requiresOriginCheck("OPTIONS"), false);
});

test("204 row: status 204, empty text body, no content-type header", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [deleteTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/test")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.equal(res.text, "");
  assert.equal(res.headers["content-type"], undefined);
});

test("500 catch-all: a thrown Error never leaks its message and logs once", async () => {
  const { deps, logger } = makeDeps();
  const boomRoute: Route = {
    id: "test.boom",
    method: "GET",
    path: "/api/boom",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => {
      throw new Error("boom");
    },
    present: (r) => r,
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [boomRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/boom")
    .set("Authorization", AUTH);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, {
    error: {
      code: "internal",
      message: "internal error",
      requestId: REQUEST_ID,
    },
  });
  assert.ok(!res.text.includes("boom"));
  const errorLines = logger.lines.filter(
    (l) => JSON.parse(l).level === "error",
  );
  assert.equal(errorLines.length, 1);
  assert.equal(JSON.parse(errorLines[0]!).requestId, REQUEST_ID);
});

test("boundary is outermost: an error thrown by an early middleware is still caught", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => {
      throw new Error("id boom");
    },
  });
  const res = await request(app.callback())
    .get("/healthz")
    .set("Authorization", AUTH);
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
  assert.notEqual(res.text, "Internal Server Error");
  assert.ok(!res.text.includes("id boom"));
});

test("redaction: capture logger output contains neither the API key nor 'authorization'", async () => {
  const { deps, logger } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  await request(app.callback()).get("/healthz").set("Authorization", AUTH);
  await request(app.callback()).get("/healthz");
  const joined = logger.lines.join("\n");
  assert.ok(!joined.includes(KEY));
  assert.ok(!joined.toLowerCase().includes("authorization"));
});

test("buildHttpApp refuses a blank key", () => {
  const { deps } = makeDeps();
  assert.throws(() => buildHttpApp(deps, { apiKey: "" }), MissingApiKeyError);
});

test("buildHttpApp refuses a 15-character key", () => {
  const { deps } = makeDeps();
  assert.throws(
    () => buildHttpApp(deps, { apiKey: "0123456789abcde" }),
    MissingApiKeyError,
  );
});

test("buildHttpApp has no process.env fallback even when API_KEY is set", () => {
  const { deps } = makeDeps();
  process.env["API_KEY"] = KEY;
  try {
    assert.throws(() => buildHttpApp(deps, { apiKey: "" }), MissingApiKeyError);
  } finally {
    delete process.env["API_KEY"];
  }
});

test("GET / with valid auth returns 200, text/html, and the exact UI shell body", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, { apiKey: KEY });
  const res = await request(app.callback()).get("/").set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"]?.startsWith("text/html"), true);
  assert.equal(res.text, UI_SHELL_HTML);
});

test("GET / without credentials returns 401 with the www-authenticate challenge", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, { apiKey: KEY });
  const res = await request(app.callback()).get("/");
  assert.equal(res.status, 401);
  assert.equal(res.headers["www-authenticate"], 'Basic realm="kanthord"');
});

test("request log status matches the wire status on an error path (401, not koa's default 404)", async () => {
  const { deps, logger } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback()).get("/healthz");
  assert.equal(res.status, 401);
  const requestLines = logger.lines
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.message === "request");
  assert.equal(requestLines.length, 1);
  assert.equal(requestLines[0]!.status, 401);
});

function buildCaptureStream(lines: string[]): DestinationStream {
  return {
    write: (s: string) => {
      lines.push(s);
      return true;
    },
  } as DestinationStream;
}

test("a non-204 row with present omitted returns 500 internal, not a TypeError", async () => {
  const { deps, logger } = makeDeps();
  const noPresentRoute: Route = {
    id: "test.noPresent",
    method: "GET",
    path: "/api/no-present",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => ({}),
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [noPresentRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/no-present")
    .set("Authorization", AUTH);
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
  assert.equal(res.body.error.requestId, REQUEST_ID);
  const errorLines = logger.lines.filter(
    (l) => JSON.parse(l).level === "error",
  );
  assert.equal(errorLines.length, 1);
  assert.ok(!JSON.parse(errorLines[0]!).cause.includes("is not a function"));
});

test("021 S1: a 201 row sets Location from location(), no ETag, and the presented body", async () => {
  const { deps } = makeDeps();
  const createRoute: Route = {
    id: "test.create",
    method: "POST",
    path: "/api/thing",
    successStatus: 201,
    kind: "json",
    cliCommands: [],
    location: (result) => `/api/thing/${result as string}`,
    decode: () => ({}),
    run: async () => "abc",
    present: (result) => ({ id: result as string }),
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [createRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/thing")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 201);
  assert.equal(res.headers["location"], "/api/thing/abc");
  assert.equal(res.headers["etag"], undefined);
  assert.deepEqual(res.body.data, { id: "abc" });
});

test("021 S1: a 201 row with location omitted answers 500 internal", async () => {
  const { deps } = makeDeps();
  const brokenCreateRoute: Route = {
    id: "test.create.broken",
    method: "POST",
    path: "/api/broken-thing",
    successStatus: 201,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => "abc",
    present: (result) => ({ id: result as string }),
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [brokenCreateRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/broken-thing")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
});

test("021 S1: a 200 json row's ETag equals etagOf(dto)", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [getByIdTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/test/xyz")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(res.headers["etag"], etagOf(res.body.data));
});

test("021 S1: a 204 row answers 204 with no body, no ETag, no Content-Type", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [deleteTestRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/test")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.equal(res.headers["etag"], undefined);
  assert.equal(res.headers["content-type"], undefined);
  assert.equal(res.text, "");
});

function makePatchFixture(behavior: "ok" | "unknown-reference") {
  let readCalls = 0;
  let runCalls = 0;
  let hasRun = false;
  const readRoute: Route = {
    id: "test.patchable.get",
    method: "GET",
    path: "/api/patchable/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: (i) => i.params,
    run: async () => {
      readCalls++;
      if (behavior === "unknown-reference") {
        throw new UnknownReferenceError("project", "p1");
      }
      return hasRun
        ? { id: "p1", name: "after" }
        : { id: "p1", name: "before" };
    },
    present: (r) => r,
  };
  const patchRoute: Route = {
    id: "test.patchable.patch",
    method: "PATCH",
    path: "/api/patchable/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    readRow: "test.patchable.get",
    decode: (i) => i.body,
    run: async () => {
      runCalls++;
      hasRun = true;
      return undefined;
    },
  };
  return {
    readRoute,
    patchRoute,
    getReadCalls: () => readCalls,
    getRunCalls: () => runCalls,
  };
}

test("021 S1: PATCH with readRow and no If-Match answers 428, run not called", async () => {
  const { deps } = makeDeps();
  const fx = makePatchFixture("ok");
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [fx.readRoute, fx.patchRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .patch("/api/patchable/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "new" });
  assert.equal(res.status, 428);
  assert.equal(res.body.error.code, "precondition_required");
  assert.equal(fx.getRunCalls(), 0);
});

test("021 S1: PATCH with a stale If-Match answers 412, run not called", async () => {
  const { deps } = makeDeps();
  const fx = makePatchFixture("ok");
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [fx.readRoute, fx.patchRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .patch("/api/patchable/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"deadbeef"')
    .send({ name: "new" });
  assert.equal(res.status, 412);
  assert.equal(res.body.error.code, "precondition_failed");
  assert.equal(fx.getRunCalls(), 0);
});

test("021 S1: PATCH with a matching If-Match runs once and answers 200 with the re-read DTO and a fresh ETag", async () => {
  const { deps } = makeDeps();
  const fx = makePatchFixture("ok");
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [fx.readRoute, fx.patchRoute],
    newRequestId: () => REQUEST_ID,
  });
  const before = await request(app.callback())
    .get("/api/patchable/p1")
    .set("Authorization", AUTH);
  const sentIfMatch = before.headers["etag"] as string;

  const res = await request(app.callback())
    .patch("/api/patchable/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", sentIfMatch)
    .send({ name: "new" });
  assert.equal(res.status, 200);
  assert.equal(fx.getRunCalls(), 1);
  assert.deepEqual(res.body.data, { id: "p1", name: "after" });
  assert.notEqual(res.headers["etag"], sentIfMatch);
});

test("021 S1: PATCH whose read row throws UnknownReferenceError answers 404, run not called", async () => {
  const { deps } = makeDeps();
  const fx = makePatchFixture("unknown-reference");
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [fx.readRoute, fx.patchRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .patch("/api/patchable/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"deadbeef"')
    .send({ name: "new" });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
  assert.equal(fx.getRunCalls(), 0);
});

test("021 S1: PATCH whose readRow names a non-existent id answers 500 internal", async () => {
  const { deps } = makeDeps();
  const brokenPatchRoute: Route = {
    id: "test.patchable.patch.broken",
    method: "PATCH",
    path: "/api/patchable-broken/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    readRow: "no.such.row",
    decode: (i) => i.body,
    run: async () => undefined,
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    routes: [brokenPatchRoute],
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .patch("/api/patchable-broken/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"deadbeef"')
    .send({ name: "new" });
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
});

test("redaction over a real pino stream: captured lines contain neither the API key nor 'authorization'", async () => {
  const lines: string[] = [];
  const deps = {
    logger: new PinoLogger(buildCaptureStream(lines)),
  } as unknown as HttpDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  await request(app.callback()).get("/healthz").set("Authorization", AUTH);
  await request(app.callback()).get("/healthz");
  const joined = lines.join("\n");
  assert.ok(!joined.includes(KEY));
  assert.ok(!joined.toLowerCase().includes("authorization"));
});
