import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTES, type Route } from "./routes.ts";
import { packageVersion } from "../version.ts";
import type { HttpDeps } from "./deps.ts";
import type { HttpLogger } from "./logger.ts";

const BANNED_VERBS = [
  "get",
  "create",
  "list",
  "find",
  "add",
  "remove",
  "approve",
  "reject",
  "land",
  "publish",
  "pause",
  "resume",
  "retry",
  "abandon",
  "assign",
  "unassign",
  "register",
  "login",
  "logout",
  "update",
  "rename",
  "run",
  "setup",
  "ack",
  "check",
  "set-default",
];

function hasBannedVerbSegment(path: string): boolean {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments.some(
    (s) => !s.startsWith(":") && BANNED_VERBS.includes(s.toLowerCase()),
  );
}

test("route policy: every ROUTES row satisfies the declared contract", () => {
  const seenIds = new Set<string>();
  const seenMethodPath = new Set<string>();
  for (const route of ROUTES) {
    assert.ok(route.id.length > 0, `id must be non-empty (${route.path})`);
    assert.ok(!seenIds.has(route.id), `duplicate id ${route.id}`);
    seenIds.add(route.id);

    assert.ok(
      ["GET", "POST", "PATCH", "DELETE"].includes(route.method),
      `method ${route.method} not allowed for ${route.id}`,
    );
    assert.notEqual(
      (route.method as string) === "PUT",
      true,
      "PUT must never appear",
    );

    assert.ok(
      route.path.startsWith("/"),
      `path must start with / (${route.id})`,
    );
    assert.ok(
      [200, 201, 204].includes(route.successStatus),
      `successStatus invalid for ${route.id}`,
    );
    assert.ok(
      ["json", "html"].includes(route.kind),
      `kind invalid for ${route.id}`,
    );

    assert.ok(
      Array.isArray(route.cliCommands),
      `cliCommands must be an array (${route.id})`,
    );
    for (const c of route.cliCommands) {
      assert.equal(typeof c, "string");
      assert.ok(
        c.length > 0,
        `cliCommands entries must be non-empty (${route.id})`,
      );
    }

    assert.equal(
      typeof route.decode,
      "function",
      `decode must be a function (${route.id})`,
    );
    assert.equal(
      typeof route.run,
      "function",
      `run must be a function (${route.id})`,
    );

    if (route.successStatus === 204) {
      assert.equal(
        route.present,
        undefined,
        `present forbidden for 204 (${route.id})`,
      );
    } else {
      assert.equal(
        typeof route.present,
        "function",
        `present required unless 204 (${route.id})`,
      );
    }

    if (route.kind === "html") {
      assert.equal(
        route.successStatus,
        200,
        `html row must be 200 (${route.id})`,
      );
      assert.equal(
        typeof route.present,
        "function",
        `html row requires present (${route.id})`,
      );
    }

    const key = `${route.method} ${route.path}`;
    assert.ok(!seenMethodPath.has(key), `duplicate method+path ${key}`);
    seenMethodPath.add(key);
  }
});

test("REST shape: no static path segment matches a banned verb", () => {
  for (const route of ROUTES) {
    assert.equal(
      hasBannedVerbSegment(route.path),
      false,
      `route ${route.id} path ${route.path} contains a banned verb segment`,
    );
  }
});

test("REST shape negative control: /api/tasks/approve is rejected by the predicate", () => {
  assert.equal(hasBannedVerbSegment("/api/tasks/approve"), true);
});

test("health.get row: decode ignores input and returns {}", () => {
  const row = ROUTES.find((r) => r.id === "health.get") as Route;
  assert.ok(row, "health.get row must exist");
  const decoded = row.decode({ params: {}, query: {}, body: undefined });
  assert.deepEqual(decoded, {});
});

test("health.get row: run returns { status: 'ok', version: packageVersion }", async () => {
  const row = ROUTES.find((r) => r.id === "health.get") as Route;
  const fakeLogger: HttpLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const fakeDeps: HttpDeps = { logger: fakeLogger };
  const result = await row.run(fakeDeps, {});
  assert.deepEqual(result, { status: "ok", version: packageVersion });
});

test("health.get row: present returns a DTO with exactly status and version keys", () => {
  const row = ROUTES.find((r) => r.id === "health.get") as Route;
  const view = row.present!({ status: "ok", version: packageVersion });
  assert.deepEqual(Object.keys(view as object).sort(), ["status", "version"]);
});
