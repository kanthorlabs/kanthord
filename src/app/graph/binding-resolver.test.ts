/**
 * Story 10 T3 — BindingResolver: resolve and validate context maps
 *
 * Tests for `src/app/graph/binding-resolver.ts` (new pure helper).
 * All tests are hermetic — no I/O.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTaskContext,
  validateExecutorBindings,
} from "./binding-resolver.ts";
import { UnboundAliasError, ExecutorBindingSetError } from "./import-errors.ts";

describe("src/app/graph/binding-resolver.ts", () => {
  // -------------------------------------------------------------------------
  // resolveTaskContext
  // -------------------------------------------------------------------------

  test("(a) resolveTaskContext: resolves objective context alias → resource id via bindMap", () => {
    const result = resolveTaskContext(
      { source: "repository" }, // initiative bindings: alias → resource type
      { source: "source" }, // objective context: slot → alias
      undefined, // no task override
      { source: "ID1" }, // CLI --bind: alias → concrete resource id
    );
    assert.deepEqual(result, { repository: "ID1" });
  });

  test("(b) resolveTaskContext: alias missing from bindMap throws UnboundAliasError", () => {
    assert.throws(
      () =>
        resolveTaskContext(
          { source: "repository" },
          { source: "source" },
          undefined,
          {}, // empty bindMap — "source" alias has no binding
        ),
      (err: unknown) => {
        assert.ok(
          err instanceof UnboundAliasError,
          "should be UnboundAliasError",
        );
        assert.equal(err.alias, "source");
        return true;
      },
    );
  });

  test("(c) resolveTaskContext: task context override takes precedence over objective context", () => {
    const result = resolveTaskContext(
      { source: "repository", other: "ai_provider" }, // initiative bindings
      { source: "source" }, // objective context: slot "source" → alias "source"
      { source: "other" }, // task override: slot "source" → alias "other"
      { source: "ID1", other: "ID2" }, // bindMap
    );
    // task override uses alias "other" for slot "source" → resolves to ai_provider:"ID2"
    assert.deepEqual(result, { ai_provider: "ID2" });
  });

  // -------------------------------------------------------------------------
  // validateExecutorBindings
  // -------------------------------------------------------------------------

  test("(d) validateExecutorBindings: generic@1 with full context passes without error", () => {
    assert.doesNotThrow(() =>
      validateExecutorBindings([
        {
          ref: "task-1",
          agent: "generic@1",
          context: {
            repository: "REPO-ID",
            ai_provider: "AIP-ID",
            credential: "CRED-ID",
          },
        },
      ]),
    );
  });

  test("(e) validateExecutorBindings: generic@1 missing ai_provider throws ExecutorBindingSetError", () => {
    assert.throws(
      () =>
        validateExecutorBindings([
          {
            ref: "task-1",
            agent: "generic@1",
            context: {
              repository: "REPO-ID",
              // ai_provider absent
              credential: "CRED-ID",
            },
          },
        ]),
      (err: unknown) => {
        assert.ok(
          err instanceof ExecutorBindingSetError,
          "should be ExecutorBindingSetError",
        );
        assert.equal(err.errors.length, 1);
        assert.equal(err.errors[0]!.taskRef, "task-1");
        assert.deepEqual(err.errors[0]!.missing, ["ai_provider"]);
        return true;
      },
    );
  });

  test("(f) validateExecutorBindings: two failing tasks → single ExecutorBindingSetError listing both", () => {
    assert.throws(
      () =>
        validateExecutorBindings([
          {
            ref: "task-A",
            agent: "generic@1",
            context: { repository: "REPO-ID" }, // missing ai_provider + credential
          },
          {
            ref: "task-B",
            agent: "tdd@1",
            context: { repository: "REPO-ID", ai_provider: "AIP-ID" }, // missing credential
          },
        ]),
      (err: unknown) => {
        assert.ok(
          err instanceof ExecutorBindingSetError,
          "should be ExecutorBindingSetError",
        );
        assert.equal(err.errors.length, 2, "both tasks should be reported");
        const refs = err.errors.map((e) => e.taskRef);
        assert.ok(refs.includes("task-A"), "task-A in error list");
        assert.ok(refs.includes("task-B"), "task-B in error list");
        return true;
      },
    );
  });

  test("(g) validateExecutorBindings: unknown executor passes without error (no spec → no validation)", () => {
    assert.doesNotThrow(() =>
      validateExecutorBindings([
        {
          ref: "task-custom",
          agent: "custom@1",
          context: {}, // empty context — but no spec for custom@1
        },
      ]),
    );
  });
});
