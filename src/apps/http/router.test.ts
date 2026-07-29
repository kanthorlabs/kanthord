import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRoute } from "./router.ts";
import { ROUTES, type Route } from "./routes.ts";
import { InvalidInputError } from "./errors.ts";

function makeRoute(overrides: Partial<Route>): Route {
  return {
    id: "synthetic",
    method: "GET",
    path: "/x",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => ({}),
    present: (r) => r,
    ...overrides,
  };
}

test("matchRoute matches GET /healthz against the real ROUTES table", () => {
  const outcome = matchRoute(ROUTES, "GET", "/healthz");
  assert.equal(outcome.kind, "match");
  if (outcome.kind === "match") {
    assert.equal(outcome.route.id, "health.get");
    assert.deepEqual(outcome.params, {});
  }
});

test("one trailing slash is stripped: /healthz/ matches", () => {
  const outcome = matchRoute(ROUTES, "GET", "/healthz/");
  assert.equal(outcome.kind, "match");
});

test("double trailing slash does not match: /healthz// is not_found", () => {
  const outcome = matchRoute(ROUTES, "GET", "/healthz//");
  assert.equal(outcome.kind, "not_found");
});

test("POST /healthz is method_not_allowed with allow ['GET']", () => {
  const outcome = matchRoute(ROUTES, "POST", "/healthz");
  assert.equal(outcome.kind, "method_not_allowed");
  if (outcome.kind === "method_not_allowed") {
    assert.deepEqual(outcome.allow, ["GET"]);
  }
});

test("unknown path is not_found", () => {
  assert.equal(matchRoute(ROUTES, "GET", "/nope").kind, "not_found");
});

test("extra path segment beyond a known route is not_found", () => {
  assert.equal(matchRoute(ROUTES, "GET", "/healthz/extra").kind, "not_found");
});

test("path matching is case-sensitive: /HEALTHZ is not_found", () => {
  assert.equal(matchRoute(ROUTES, "GET", "/HEALTHZ").kind, "not_found");
});

test("synthetic table: :param capture, method_not_allowed sorted allow, percent-decoding, method uppercasing", () => {
  const table = [
    makeRoute({ id: "a", method: "GET", path: "/api/projects/:id" }),
    makeRoute({ id: "b", method: "PATCH", path: "/api/projects/:id" }),
  ];

  const getOutcome = matchRoute(table, "GET", "/api/projects/42");
  assert.equal(getOutcome.kind, "match");
  if (getOutcome.kind === "match") {
    assert.deepEqual(getOutcome.params, { id: "42" });
  }

  const deleteOutcome = matchRoute(table, "DELETE", "/api/projects/42");
  assert.equal(deleteOutcome.kind, "method_not_allowed");
  if (deleteOutcome.kind === "method_not_allowed") {
    assert.deepEqual(deleteOutcome.allow, ["GET", "PATCH"]);
  }

  const encodedOutcome = matchRoute(table, "GET", "/api/projects/p%20x");
  assert.equal(encodedOutcome.kind, "match");
  if (encodedOutcome.kind === "match") {
    assert.deepEqual(encodedOutcome.params, { id: "p x" });
  }

  const lowerMethodOutcome = matchRoute(table, "get", "/api/projects/42");
  assert.equal(lowerMethodOutcome.kind, "match");
});

test("malformed percent-escape in a :param segment throws InvalidInputError naming the field, not a raw URIError", () => {
  const table = [
    makeRoute({ id: "a", method: "GET", path: "/api/projects/:id" }),
  ];

  assert.throws(
    () => matchRoute(table, "GET", "/api/projects/%zz"),
    (err: unknown) =>
      err instanceof InvalidInputError &&
      err.field === "id" &&
      err.message.includes("is not valid percent-encoding"),
  );
});
