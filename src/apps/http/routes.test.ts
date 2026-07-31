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

/**
 * Every legal STATIC path segment. Decision 1 (EPIC 020): resource segments are
 * SINGULAR nouns, so a new resource is a deliberate, reviewed entry here — the
 * same discipline BANNED_VERBS applies to verbs.
 */
const PATH_SEGMENTS = [
  "api",
  "healthz",
  "project",
  "initiative",
  "objective",
  "task",
  "resource",
  "repository",
  "credential",
  "notification",
  "filesystem",
  "ai-provider",
  "model",
  "queue",
  "overview",
  "graph",
  "conflict",
  "dependency",
  "package",
  "diagnostic",
  "readiness",
  "event",
  "acknowledgement",
  "approval",
  "rejection",
  "reattempt",
  "abandonment",
  "suspension",
];

/**
 * A plural segment is caught by the trailing `s` rule applied to the CURATED
 * list above, not to arbitrary paths: over arbitrary paths `/s$/` false-positives
 * on real singular nouns (`status`, `progress`), and a test people must disable
 * is worse than no test. A genuine singular ending in `s` is named here.
 */
const NOT_PLURAL: string[] = ["readiness"];

/**
 * PUT is admitted for state singletons ONLY, one reviewed row at a time (EPIC
 * 023 decision 2, which reverses 019's blanket PUT non-goal). Every other row
 * must use GET/POST/PATCH/DELETE.
 */
const PUT_ROWS = ["initiative.suspension.put"];

function isAllowedPutRow(route: { method: string; id: string }): boolean {
  return route.method !== "PUT" || PUT_ROWS.includes(route.id);
}

function staticSegmentsOf(path: string): string[] {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .filter((s) => !s.startsWith(":"));
}

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
      ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(route.method),
      `method ${route.method} not allowed for ${route.id}`,
    );
    assert.ok(
      isAllowedPutRow(route),
      `PUT is allowed only for a row named in PUT_ROWS (${route.id})`,
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

    if (route.successStatus === 201) {
      assert.equal(
        typeof route.location,
        "function",
        `location required for 201 (${route.id})`,
      );
    } else {
      assert.equal(
        route.location,
        undefined,
        `location forbidden unless 201 (${route.id})`,
      );
    }

    if (route.method === "PATCH") {
      assert.equal(
        typeof route.readRow,
        "string",
        `readRow required for PATCH (${route.id})`,
      );
      const target = ROUTES.find((r) => r.id === route.readRow);
      assert.ok(
        target !== undefined,
        `readRow "${route.readRow}" names no row (${route.id})`,
      );
      assert.equal(
        target.method,
        "GET",
        `readRow "${route.readRow}" must be a GET row (${route.id})`,
      );
    } else {
      assert.equal(
        route.readRow,
        undefined,
        `readRow forbidden unless PATCH (${route.id})`,
      );
    }

    if (route.successStatus === 204 || route.readRow !== undefined) {
      assert.equal(
        route.present,
        undefined,
        `present forbidden for 204 and for readRow rows (${route.id})`,
      );
    } else {
      assert.equal(
        typeof route.present,
        "function",
        `present required unless 204 or readRow (${route.id})`,
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

test("path vocabulary: every static segment is in the PATH_SEGMENTS allowlist", () => {
  for (const route of ROUTES) {
    for (const segment of staticSegmentsOf(route.path)) {
      assert.ok(
        PATH_SEGMENTS.includes(segment),
        `route ${route.id} path ${route.path} uses unlisted segment "${segment}" — add it to PATH_SEGMENTS (singular, decision 1)`,
      );
    }
  }
});

test("path vocabulary: no allowlisted segment is a plural", () => {
  for (const segment of PATH_SEGMENTS) {
    if (NOT_PLURAL.includes(segment)) {
      continue;
    }
    assert.equal(
      segment.endsWith("s"),
      false,
      `segment "${segment}" looks plural — resource segments are singular (decision 1); if it is genuinely singular, name it in NOT_PLURAL`,
    );
  }
});

test("path vocabulary: NOT_PLURAL names exactly readiness, and every NOT_PLURAL entry is allowlisted", () => {
  assert.deepEqual(NOT_PLURAL, ["readiness"]);
  for (const segment of NOT_PLURAL) {
    assert.ok(
      PATH_SEGMENTS.includes(segment),
      `NOT_PLURAL entry "${segment}" must also be in PATH_SEGMENTS`,
    );
  }
});

test("path vocabulary negative control: a plural segment is rejected, the singular is accepted", () => {
  assert.equal(
    staticSegmentsOf("/api/projects").every((s) => PATH_SEGMENTS.includes(s)),
    false,
  );
  assert.equal(
    staticSegmentsOf("/api/project/:id").every((s) =>
      PATH_SEGMENTS.includes(s),
    ),
    true,
  );
});

test("PUT policy negative control: a PUT row outside PUT_ROWS is rejected", () => {
  assert.equal(
    isAllowedPutRow({ method: "PUT", id: "initiative.suspension.put" }),
    true,
  );
  assert.equal(
    isAllowedPutRow({ method: "PUT", id: "task.approval.put" }),
    false,
  );
  assert.equal(
    isAllowedPutRow({ method: "POST", id: "task.approval.put" }),
    true,
  );
});

test("transition rows are item-scoped: every verdict path carries :id", () => {
  const transitionSegments = [
    "/approval",
    "/rejection",
    "/reattempt",
    "/abandonment",
    "/suspension",
  ];
  for (const route of ROUTES) {
    if (!transitionSegments.some((seg) => route.path.includes(seg))) {
      continue;
    }
    assert.ok(
      route.path.includes("/:id/"),
      `transition route ${route.id} (${route.path}) must be item-scoped`,
    );
    const segments = staticSegmentsOf(route.path);
    const secondSegment = segments[1];
    assert.ok(
      secondSegment === undefined ||
        !transitionSegments.includes(`/${secondSegment}`),
      `route ${route.id} (${route.path}) has a collection-level transition segment`,
    );
  }
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
  const fakeDeps = { logger: fakeLogger } as unknown as HttpDeps;
  const result = await row.run(fakeDeps, {});
  assert.deepEqual(result, { status: "ok", version: packageVersion });
});

test("health.get row: present returns a DTO with exactly status and version keys", () => {
  const row = ROUTES.find((r) => r.id === "health.get") as Route;
  const view = row.present!({ status: "ok", version: packageVersion });
  assert.deepEqual(Object.keys(view as object).sort(), ["status", "version"]);
});

test("ROUTES holds exactly 63 rows: 54 from 019+020+021+022, plus the 2 task-verdict rows of EPIC 023 Story S2, the 2 reattempt/abandonment rows of Story S3, the 3 objective verdict rows of Story S4, and the 2 suspension rows of Story S5", () => {
  assert.equal(ROUTES.length, 63);
});

test("every route id from the EPIC 020 and 021 route tables is present in ROUTES", () => {
  const ids = new Set(ROUTES.map((r) => r.id));
  const expected = [
    "project.list",
    "project.get",
    "project.overview.get",
    "project.initiative.list",
    "project.repository.list",
    "project.credential.list",
    "project.notification.list",
    "project.filesystem.list",
    "project.ai-provider.list",
    "initiative.get",
    "initiative.graph.get",
    "initiative.objective.list",
    "initiative.task.list",
    "objective.get",
    "objective.conflict.get",
    "task.get",
    "task.conflict.get",
    "resource.get",
    "ai-provider.list",
    "ai-provider.get",
    "model.list",
    "queue.get",
    "project.create",
    "project.patch",
    "project.initiative.create",
    "initiative.patch",
    "initiative.objective.create",
    "objective.patch",
    "objective.task.create",
    "project.repository.create",
    "project.credential.create",
    "project.notification.create",
    "project.filesystem.create",
    "repository.patch",
    "credential.patch",
    "notification.patch",
    "filesystem.patch",
    "project.resource.create",
    "task.dependency.create",
    "task.dependency.delete",
    "initiative.dependency.create",
    "initiative.dependency.delete",
    "objective.dependency.create",
    "objective.dependency.delete",
    "project.graph.create",
    "initiative.graph.apply",
    "initiative.package.get",
    "initiative.diagnostic.export",
    "graph.readiness.check",
    "project.readiness.get",
    "event.list",
    "project.acknowledgement.create",
    "task.approval.create",
    "task.rejection.create",
    "task.reattempt.create",
    "task.abandonment.create",
    "objective.approval.create",
    "objective.rejection.create",
    "objective.reattempt.create",
    "initiative.suspension.put",
    "initiative.suspension.delete",
  ];
  for (const id of expected) {
    assert.ok(ids.has(id), `missing route id ${id}`);
  }
});
