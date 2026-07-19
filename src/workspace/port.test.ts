import { test } from "node:test";
import assert from "node:assert/strict";
import { FetchError, DivergenceError, type CachedModePolicy } from "./port.ts";

// Suite: src/workspace/port.ts — Story 12 T1

test("FetchError has name === 'FetchError' and .repoId", () => {
  const cause = new Error("network failure");
  const err = new FetchError("R1", cause);
  assert.equal(err.name, "FetchError");
  assert.equal(err.repoId, "R1");
  assert.equal(err.cause, cause);
  assert.ok(err instanceof Error);
});

test("DivergenceError has name === 'DivergenceError' and carries both SHAs", () => {
  const sha1 = "aaa000";
  const sha2 = "bbb111";
  const err = new DivergenceError("R1", sha1, sha2);
  assert.equal(err.name, "DivergenceError");
  assert.equal(err.repoId, "R1");
  assert.equal(err.localSHA, sha1);
  assert.equal(err.originSHA, sha2);
  assert.ok(err instanceof Error);
});

// Compile test: CachedModePolicy interface fields are importable
test("CachedModePolicy interface fields are importable (compile test)", () => {
  const policy: CachedModePolicy = {
    repoId: "repo-1",
    lastFetchedOriginSHA: "abc123",
    fetchTime: new Date().toISOString(),
    baseSHA: "def456",
  };
  assert.equal(policy.repoId, "repo-1");
  assert.equal(policy.lastFetchedOriginSHA, "abc123");
  assert.equal(policy.baseSHA, "def456");
  assert.ok(typeof policy.fetchTime === "string");
});
