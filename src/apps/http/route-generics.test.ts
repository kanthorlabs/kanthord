// src/apps/http/route-generics.test.ts — Story S1: defineRoute typechecks a
// matching decode/run pair, rejects a mismatched pair, and passes decoded
// input through unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineRoute, type RouteMeta } from "./routes.ts";
import type { HttpDeps } from "./deps.ts";
import type { HttpLogger } from "./logger.ts";

const meta: RouteMeta = {
  id: "test.generic",
  method: "GET",
  path: "/api/test/:id",
  successStatus: 200,
  kind: "json",
  cliCommands: [],
};

const fakeLogger: HttpLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeDeps: HttpDeps = { logger: fakeLogger } as unknown as HttpDeps;

test("defineRoute returns a row whose decode/run/present are the same function references", () => {
  const decode = () => ({ id: "x" });
  const run = async (_deps: HttpDeps, input: { id: string }) => input;
  const present = (r: { id: string }) => ({ id: r.id });
  const row = defineRoute({ ...meta, decode, run, present });
  assert.equal(row.decode, decode);
  assert.equal(row.run, run);
  assert.equal(row.present, present);
});

test("a matching decode/run pair typechecks and passes the decoded value through", async () => {
  const row = defineRoute({
    ...meta,
    decode: () => ({ id: "x" }),
    run: async (_deps: HttpDeps, input: { id: string }) => input,
    present: (r) => ({ r }),
  });
  const decoded = row.decode({
    params: { id: "x" },
    query: {},
    body: undefined,
  });
  const result = await row.run(fakeDeps, decoded);
  assert.deepEqual(result, { id: "x" });
});

test("a mismatched decode/run pair is a type error, not a runtime one", () => {
  defineRoute({
    ...meta,
    decode: () => ({ id: "x" }),
    // @ts-expect-error decode returns { id: string }, run demands { taskId: string }
    run: async (_deps: HttpDeps, input: { taskId: string }) => input.taskId,
    present: (r) => ({ r }),
  });
});
