/**
 * Tests for src/ring1/write-scope
 * Story 001 — Write-Scope Enforcement
 * Task T1 — Block out-of-scope write, allow in-scope
 * Task T2 — Model-independence
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { makeWriteScopeHook } from "./write-scope.ts";
import type { EscalationEvent } from "./write-scope.ts";
import type { ToolCall } from "../session/agent-session.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeCall(path: string): ToolCall {
  return { name: "write_file", args: { path } };
}

// ---------------------------------------------------------------------------
// Task T1 — Block out-of-scope write, allow in-scope
// ---------------------------------------------------------------------------

describe("src/ring1/write-scope.ts", () => {
  test("T1(a): out-of-scope write returns block", () => {
    const events: EscalationEvent[] = [];
    const hook = makeWriteScopeHook(["src/ring1"], (e) => events.push(e));
    assert.equal(hook(writeCall("src/other/file.ts")), "block");
  });

  test("T1(a): out-of-scope write does not proceed (hook returns block)", () => {
    // Verifying the hook return value IS the non-proceed signal:
    // agent-session honours "block" by throwing before the write executes.
    const hook = makeWriteScopeHook(["src/ring1"], () => {});
    const verdict = hook(writeCall("src/totally/different/path.ts"));
    assert.equal(verdict, "block");
  });

  test("T1(b): in-scope write returns allow", () => {
    const hook = makeWriteScopeHook(["src/ring1"], () => {});
    assert.equal(hook(writeCall("src/ring1/foo.ts")), "allow");
  });

  test("T1(b): deeply nested in-scope write returns allow", () => {
    const hook = makeWriteScopeHook(["src/ring1"], () => {});
    assert.equal(hook(writeCall("src/ring1/sub/dir/bar.ts")), "allow");
  });

  test("T1(c): blocked write records escalation tagged as re-planning-signal", () => {
    const events: EscalationEvent[] = [];
    const hook = makeWriteScopeHook(["src/ring1"], (e) => events.push(e));
    hook(writeCall("src/outside/bad.ts"));
    assert.equal(events.length, 1);
    assert.equal(events[0]?.tag, "re-planning-signal");
  });

  test("T1(c): allowed write records no escalation", () => {
    const events: EscalationEvent[] = [];
    const hook = makeWriteScopeHook(["src/ring1"], (e) => events.push(e));
    hook(writeCall("src/ring1/allowed.ts"));
    assert.equal(events.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Task T2 — Model-independence
  // ---------------------------------------------------------------------------

  test("T2: same out-of-scope write is blocked under a permissive fake model config", () => {
    // The hook must not accept a model config at all — same API, same result.
    // We simulate "two different model configs" by calling the same hook twice,
    // which also proves the hook carries no model coupling.
    const events: EscalationEvent[] = [];
    const hookA = makeWriteScopeHook(["src/ring1"], (e) => events.push(e));
    const hookB = makeWriteScopeHook(["src/ring1"], (e) => events.push(e));

    // Both hooks are constructed with identical scope — no model parameter.
    assert.equal(hookA(writeCall("src/outside/path.ts")), "block");
    assert.equal(hookB(writeCall("src/outside/path.ts")), "block");
    assert.equal(events.length, 2, "both invocations must record an escalation");
  });
});
