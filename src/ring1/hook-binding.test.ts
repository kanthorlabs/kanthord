/**
 * Tests for src/ring1/hook-binding
 * Story 015/002 — Write-Scope on the SU3-Documented Hook Shape
 * Task T1 — Hook binding adapter
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRing1HookAdapter } from "./hook-binding.ts";
import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
  Ring1HookAdapterOpts,
} from "./hook-binding.ts";
import type { RolePathRegistry } from "./role-path-policy.ts";
import type { EscalationEvent } from "./write-scope.ts";

// ---------------------------------------------------------------------------
// Test helpers / fakes
// ---------------------------------------------------------------------------

function makeRegistry(
  allowWriteGlobs: string[],
  denyWriteGlobs: string[],
): RolePathRegistry {
  return {
    roles: {
      coding: {
        read: { allow: ["/workspace/**"], deny: [] },
        write: { allow: allowWriteGlobs, deny: denyWriteGlobs },
      },
    },
  };
}

/** Build a scripted BeforeToolCallContext as pi would supply it per SU3. */
function fakeContext(toolName: string, args: Record<string, unknown>): BeforeToolCallContext {
  return {
    assistantMessage: { role: "assistant" as const, content: [] },
    toolCall: { id: "tc-1", name: toolName, input: args },
    args,
    context: {
      systemPrompt: "KAN THORD SYSTEM BRIEF: test",
      messages: [],
      tools: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Task T1(a) — Out-of-scope write → blocked, effect not executed, re-planning tag
// ---------------------------------------------------------------------------

describe("src/ring1/hook-binding.ts", () => {
  test("T1(a): out-of-scope write is blocked; effect not executed; escalation carries re-planning tag", async () => {
    const registry = makeRegistry(
      ["/workspace/src/**"], // allow
      [],                    // no explicit deny — out-of-scope alone is sufficient
    );

    const effectCalled: string[] = [];
    const escalations: (EscalationEvent & { path?: string })[] = [];

    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e as EscalationEvent & { path?: string }),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    // Simulate pi calling beforeToolCall: write to an out-of-scope path
    const ctx = fakeContext("write_file", { path: "/etc/passwd", content: "bad" });
    const result: BeforeToolCallResult | undefined = await hook(ctx);

    // Must return block with a reason
    assert.ok(result !== undefined, "result is defined (not pass-through)");
    assert.equal((result as BeforeToolCallResult).block, true, "block is true");
    assert.ok(
      typeof (result as BeforeToolCallResult).reason === "string" &&
        (result as BeforeToolCallResult).reason!.length > 0,
      "reason is a non-empty string",
    );
    // Effect must NOT have been called
    assert.equal(effectCalled.length, 0, "tool execute must not have been called");
    // Escalation carries re-planning tag
    assert.equal(escalations.length, 1, "one escalation emitted");
    const esc = escalations[0];
    assert.ok(esc !== undefined, "escalation exists");
    assert.equal(esc!.tag, "re-planning-signal", "escalation carries re-planning tag");
  });

  // -------------------------------------------------------------------------
  // Task T1(b) — In-scope, role-allowed write executes
  // -------------------------------------------------------------------------

  test("T1(b): in-scope role-allowed write passes through (returns undefined)", async () => {
    const registry = makeRegistry(["/workspace/src/**"], []);

    const escalations: EscalationEvent[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("write_file", {
      path: "/workspace/src/main.ts",
      content: "// ok",
    });
    const result: BeforeToolCallResult | undefined = await hook(ctx);

    // Pass-through means the hook returns undefined (pi then executes the tool)
    assert.equal(result, undefined, "allowed write returns undefined (pass-through)");
    assert.equal(escalations.length, 0, "no escalation for allowed write");
  });

  // -------------------------------------------------------------------------
  // Task T1(c) — Pathless (pure computation) tool passes through
  // -------------------------------------------------------------------------

  test("T1(c): pathless pure-computation tool passes through unchanged", async () => {
    const registry = makeRegistry(["/workspace/src/**"], []);

    const escalations: EscalationEvent[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    // A pure tool has no "path" arg — it is not classifiable as an effectful write
    const ctx = fakeContext("calculate_hash", { input: "hello" });
    const result: BeforeToolCallResult | undefined = await hook(ctx);

    assert.equal(result, undefined, "pathless tool returns undefined (pass-through)");
    assert.equal(escalations.length, 0, "no escalation for pathless tool");
  });

  // -------------------------------------------------------------------------
  // Task T1(d) — Unclassifiable effectful tool is blocked fail-closed
  // -------------------------------------------------------------------------

  test("T1(d): unclassifiable effectful tool is blocked fail-closed with escalation naming the tool", async () => {
    const registry = makeRegistry(["/workspace/src/**"], []);

    const escalations: Array<EscalationEvent & { toolName?: string }> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e as EscalationEvent & { toolName?: string }),
      // unknownEffectfulTools: tools whose names indicate potential side-effects
      // but that have no "path" arg for scope checking must be fail-closed
      unknownEffectfulToolNames: new Set(["exec_command", "shell_run"]),
    };
    const hook = makeRing1HookAdapter(opts);

    // exec_command has no path but is classified as effectful
    const ctx = fakeContext("exec_command", { command: "rm -rf /" });
    const result: BeforeToolCallResult | undefined = await hook(ctx);

    assert.ok(result !== undefined, "result is defined (not pass-through)");
    assert.equal((result as BeforeToolCallResult).block, true, "unclassifiable effectful tool is blocked");
    assert.equal(escalations.length, 1, "one escalation emitted");
    const esc = escalations[0];
    assert.ok(esc !== undefined, "escalation exists");
    // escalation names the tool
    assert.equal(esc!.toolName, "exec_command", "escalation names the tool");
  });

  // -------------------------------------------------------------------------
  // Task T2 — Model-independence on the bound seam
  // Same call set under two different fake model configurations must yield
  // identical block/pass decisions (PRD §4 — no model input in any decision).
  // -------------------------------------------------------------------------

  test("T2: identical block/pass decisions regardless of fake model configuration", async () => {
    // Model config A — minimal
    const optsA: Ring1HookAdapterOpts = {
      registry: makeRegistry(["/workspace/src/**"], []),
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: () => {},
      unknownEffectfulToolNames: new Set<string>(),
      // No model reference; but we pass an extra opaque "modelConfig" field to
      // simulate a real caller who injects model config into opts accidentally.
      ...({ modelConfig: { provider: "openai", model: "gpt-4o" } } as unknown as object),
    };

    // Model config B — different provider/model
    const optsB: Ring1HookAdapterOpts = {
      registry: makeRegistry(["/workspace/src/**"], []),
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: () => {},
      unknownEffectfulToolNames: new Set<string>(),
      ...({ modelConfig: { provider: "anthropic", model: "claude-opus-4" } } as unknown as object),
    };

    const hookA = makeRing1HookAdapter(optsA);
    const hookB = makeRing1HookAdapter(optsB);

    // Case 1: out-of-scope write — both must block
    const blockedCtx = fakeContext("write_file", { path: "/etc/shadow", content: "x" });
    const resA_block = await hookA(blockedCtx);
    const resB_block = await hookB(blockedCtx);
    assert.ok(resA_block !== undefined && resA_block.block === true, "A blocks out-of-scope write");
    assert.ok(resB_block !== undefined && resB_block.block === true, "B blocks out-of-scope write");
    assert.equal(resA_block!.block, resB_block!.block, "block decision identical across model configs");

    // Case 2: in-scope write — both must allow
    const allowedCtx = fakeContext("write_file", { path: "/workspace/src/index.ts", content: "x" });
    const resA_allow = await hookA(allowedCtx);
    const resB_allow = await hookB(allowedCtx);
    assert.equal(resA_allow, undefined, "A allows in-scope write");
    assert.equal(resB_allow, undefined, "B allows in-scope write");

    // Case 3: pathless tool — both must pass through
    const pathlessCtx = fakeContext("get_time", {});
    const resA_path = await hookA(pathlessCtx);
    const resB_path = await hookB(pathlessCtx);
    assert.equal(resA_path, undefined, "A passes through pathless tool");
    assert.equal(resB_path, undefined, "B passes through pathless tool");
  });

  // -------------------------------------------------------------------------
  // BLOCKER B4 — hook-fail-open-effectful
  // unknownEffectfulToolNames must be a required field on Ring1HookAdapterOpts.
  // When absent (optional), a pathless effectful tool passes by default — fail-open.
  // With it required, the caller is forced to explicitly declare the effectful set
  // and the hook is always fail-closed for tools in that set.
  // -------------------------------------------------------------------------

  test("B4: pathless effectful tool is blocked fail-closed when unknownEffectfulToolNames is required", async () => {
    const registry = makeRegistry(["/workspace/src/**"], []);
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    // unknownEffectfulToolNames is required — must be supplied
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set(["exec_command"]),
    };
    const hook = makeRing1HookAdapter(opts);
    const ctx = fakeContext("exec_command", { command: "rm -rf /" });
    const result = await hook(ctx);
    assert.ok(result !== undefined && result.block === true, "exec_command blocked via required effectful set");
    assert.equal(escalations.length, 1, "one escalation emitted");
  });

  test("B4: omitting unknownEffectfulToolNames passes exec_command (current fail-open bug) — MUST BLOCK after fix", async () => {
    const registry = makeRegistry(["/workspace/src/**"], []);
    // Cast to bypass TypeScript's current optional check — simulates the fail-open gap.
    // After the B4 fix: Ring1HookAdapterOpts.unknownEffectfulToolNames is REQUIRED,
    // so this cast will produce a typecheck error (TS2352) AND the adapter must
    // treat the absent field as if it were an empty set — exec_command still passes.
    // Currently (unfixed): unknownEffectfulToolNames is optional, cast succeeds,
    // exec_command passes through (undefined) — this is the fail-open bug.
    const optsWithout = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: () => {},
    } as unknown as Ring1HookAdapterOpts;
    const hook = makeRing1HookAdapter(optsWithout);
    const ctx = fakeContext("exec_command", { command: "rm -rf /" });
    const result = await hook(ctx);
    // Currently: result is undefined (fail-open). MUST be block: true after fix.
    assert.ok(
      result !== undefined && result.block === true,
      "exec_command must be blocked fail-closed even when effectful set is cast-omitted",
    );
  });
});

// ---------------------------------------------------------------------------
// B2 — hook-relative-worktree
// The adapter must accept a `worktree` field in Ring1HookAdapterOpts and
// forward it to ring1PolicyChain so that relative paths in args.path are
// resolved against the worktree, not process.cwd().
//
// B3 — hook-multipath-gap
// For rename/copy calls, args.destination (or args.newPath) is the second
// path involved.  The adapter must forward it as secondaryPath so that a
// denied destination is also blocked.
// ---------------------------------------------------------------------------

describe("B2+B3: hook worktree forwarding and multi-path secondary check", () => {
  test("B2: relative args.path resolved against worktree — allowed inside worktree/src/**", async () => {
    // worktree=/workspace; allow=/workspace/src/**
    // args.path="src/main.ts" (relative) → /workspace/src/main.ts → inside allowlist → pass
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: EscalationEvent[] = [];
    const opts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      worktree: "/workspace",
      onEscalate: (e: EscalationEvent & Record<string, unknown>) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    } as Ring1HookAdapterOpts;
    const hook = makeRing1HookAdapter(opts);
    const ctx = fakeContext("write_file", { path: "src/main.ts", content: "ok" });
    const result = await hook(ctx);
    assert.equal(result, undefined, "relative path resolved into worktree/src/** must be allowed");
    assert.equal(escalations.length, 0, "no escalation for allowed relative path");
  });

  test("B2: relative args.path with ../.. escape blocked when resolved against worktree", async () => {
    // worktree=/workspace; args.path="src/../../etc/passwd" → /etc/passwd → outside allowlist → block
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: EscalationEvent[] = [];
    const opts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      worktree: "/workspace",
      onEscalate: (e: EscalationEvent & Record<string, unknown>) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    } as Ring1HookAdapterOpts;
    const hook = makeRing1HookAdapter(opts);
    const ctx = fakeContext("write_file", { path: "src/../../etc/passwd", content: "evil" });
    const result = await hook(ctx);
    assert.ok(result !== undefined && result.block === true, "path escaping worktree via ../.. must be blocked");
    assert.equal(escalations.length, 1, "one escalation emitted for escape attempt");
  });

  test("B3: rename call with allowed source but denied destination is blocked (secondary path checked)", async () => {
    // args.path = /workspace/src/a.ts (allowed source)
    // args.destination = /etc/shadow (denied destination)
    // The adapter must forward destination as secondaryPath → blocked
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: EscalationEvent[] = [];
    const opts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e: EscalationEvent & Record<string, unknown>) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    } as Ring1HookAdapterOpts;
    const hook = makeRing1HookAdapter(opts);
    const ctx = fakeContext("rename_file", {
      path: "/workspace/src/a.ts",
      destination: "/etc/shadow",
    });
    const result = await hook(ctx);
    assert.ok(result !== undefined && result.block === true, "rename with denied destination must be blocked");
    assert.equal(escalations.length, 1, "one escalation emitted for denied destination");
  });

  test("B3: rename call where both paths are allowed passes through", async () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: EscalationEvent[] = [];
    const opts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e: EscalationEvent & Record<string, unknown>) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    } as Ring1HookAdapterOpts;
    const hook = makeRing1HookAdapter(opts);
    const ctx = fakeContext("rename_file", {
      path: "/workspace/src/a.ts",
      destination: "/workspace/src/b.ts",
    });
    const result = await hook(ctx);
    assert.equal(result, undefined, "rename with both paths allowed must pass through");
    assert.equal(escalations.length, 0, "no escalation when both paths are allowed");
  });
});

// ---------------------------------------------------------------------------
// B1 — hook-read-forced-through-write (3rd review)
// The adapter currently passes operation:"write" for ALL path-bearing tools.
// A read tool (e.g. read_file) must use operation:"read" so that read-dimension
// deny rules fire on the hook seam.
// Story 001:31-32 — "Reads are subject to the same role policy (denied paths
// are unreadable)".
// ---------------------------------------------------------------------------

describe("B1: hook read-tool uses read operation against role-policy", () => {
  test("B1: read tool hitting a read-denied path is blocked (read dimension checked, not write)", async () => {
    // read.deny includes /workspace/secrets/**; write.deny is empty so the
    // same path would PASS a write-dimension check.  The adapter must use
    // operation:"read" for read_file so the correct dimension fires.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: ["/workspace/secrets/**"] },
          write: { allow: ["/workspace/**"], deny: [] },
        },
      },
    };
    const escalations: EscalationEvent[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("read_file", { path: "/workspace/secrets/api.key" });
    const result = await hook(ctx);

    assert.ok(result !== undefined, "read of read-denied path must return a defined result");
    assert.equal(
      (result as BeforeToolCallResult).block,
      true,
      "read_file on a read-denied path must be blocked (read-dimension deny rule fired)",
    );
    assert.equal(escalations.length, 1, "one escalation emitted for read-denied path");
  });

  test("B1: read tool on a read-allowed (but write-denied) path passes through", async () => {
    // read.allow covers /workspace/src/**; write.deny blocks /workspace/src/generated/**
    // reading a generated file is allowed (read dimension) even though writing is denied.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/src/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: ["/workspace/src/generated/**"] },
        },
      },
    };
    const escalations: EscalationEvent[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("read_file", { path: "/workspace/src/generated/model.ts" });
    const result = await hook(ctx);

    assert.equal(result, undefined, "read tool on a read-allowed path must pass through");
    assert.equal(escalations.length, 0, "no escalation for read-allowed path");
  });
});

// ---------------------------------------------------------------------------
// B2 — secondary-path-write-scope-bypass (3rd review)
// ring1PolicyChain checks role policy on secondaryPath but then runs
// writeScopeCheck only on the primary path.  A rename where the destination is
// role-allowed but outside write_scope must still be blocked.
// Epic 015:70 — "rename/copy checks every involved path".
// ---------------------------------------------------------------------------

describe("B2: secondary path checked against write-scope (not just role policy)", () => {
  test("B2: rename with in-scope source but out-of-scope destination is blocked by write-scope", async () => {
    // Role allows all of /workspace/src/** for writes.
    // writeScope is narrowed to /workspace/src/core/**.
    // source path /workspace/src/core/a.ts is in scope.
    // destination /workspace/src/utils/b.ts is role-allowed but OUT of writeScope.
    // The write-scope check must fire on the destination too.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/core/**"],   // narrower than role allowlist
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("rename_file", {
      path: "/workspace/src/core/a.ts",          // in scope (primary)
      destination: "/workspace/src/utils/b.ts",  // role-allowed but out of scope
    });
    const result = await hook(ctx);

    assert.ok(
      result !== undefined && (result as BeforeToolCallResult).block === true,
      "rename with out-of-scope destination must be blocked by write-scope check",
    );
    assert.equal(escalations.length, 1, "one escalation emitted for out-of-scope destination");
    const esc = escalations[0];
    assert.ok(esc !== undefined, "escalation exists");
    assert.equal(esc!.tag, "re-planning-signal", "write-scope escalation carries re-planning tag");
  });

  test("B2: rename with both source and destination in write-scope passes through", async () => {
    // Both paths are role-allowed AND in writeScope → pure pass-through.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/core/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("rename_file", {
      path: "/workspace/src/core/a.ts",
      destination: "/workspace/src/core/b.ts",
    });
    const result = await hook(ctx);

    assert.equal(result, undefined, "rename with both paths in write-scope must pass through");
    assert.equal(escalations.length, 0, "no escalation when both paths are in scope");
  });
});

// ---------------------------------------------------------------------------
// B5 — hook-write-scope-test-gap (2nd review)
// T1(a) proves role-policy blocking (/etc/passwd is not in the role allowlist).
// This suite isolates write-scope blocking: the path IS inside the role
// allowlist but falls outside the narrower write_scope — so it is the
// write-scope check (step 1b of ring1PolicyChain), not role-policy, that
// must block and emit the re-planning escalation.
// Story 002:18 — "out-of-scope write … escalated with the re-planning tag"
// ---------------------------------------------------------------------------

describe("B5: write-scope blocking isolated from role-policy blocking", () => {
  test("B5: role-allowed but out-of-write-scope path is blocked with re-planning escalation", async () => {
    // Role allows ALL of /workspace/src/** (so role check passes for this path).
    // Write scope is narrower: only /workspace/src/core/**.
    // Write to /workspace/src/config/secrets.ts is role-allowed but out of scope.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/core/**"],   // narrower than role allowlist
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("write_file", {
      path: "/workspace/src/config/secrets.ts",
      content: "x",
    });
    const result = await hook(ctx);

    assert.ok(result !== undefined, "result is defined — not pass-through");
    assert.equal((result as BeforeToolCallResult).block, true, "path is blocked by write-scope check");
    assert.equal(escalations.length, 1, "exactly one escalation emitted");
    const esc = escalations[0];
    assert.ok(esc !== undefined, "escalation exists");
    assert.equal(esc!.tag, "re-planning-signal", "escalation carries re-planning tag");
  });

  test("B5: role-allowed AND in-write-scope path passes through unchanged", async () => {
    // Same registry / write-scope as above.
    // Write to /workspace/src/core/main.ts is both role-allowed AND in-scope → pass.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/core/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("write_file", {
      path: "/workspace/src/core/main.ts",
      content: "ok",
    });
    const result = await hook(ctx);

    assert.equal(result, undefined, "role-allowed + in-scope write passes through");
    assert.equal(escalations.length, 0, "no escalation for allowed + in-scope write");
  });
});

// ---------------------------------------------------------------------------
// B3-symlink — symlink-resolution-not-enforced-on-hook (3rd review)
// The `evaluatePathPolicy` seam already accepts `canonicalPath` (symlink target).
// But `makeRing1HookAdapter` currently never reads `args["canonical_path"]`, so a
// symlink inside an allowed dir that resolves to a denied target is not blocked.
// Story 001:18-21 — "symlink inside an allowed dir pointing at a denied target is
// blocked"; the hook MUST forward args["canonical_path"] as `canonicalPath` to
// `ring1PolicyChain`.
// ---------------------------------------------------------------------------

describe("B3-symlink: hook forwards canonical_path arg to enforce symlink resolution", () => {
  // Registry: coding can write anywhere under /workspace/src/**; nothing denied.
  // The symlink itself (/workspace/src/link.ts) is inside the allow list.
  // The resolved target (/workspace/.ssh/id_rsa) is OUTSIDE the allow list.
  const registry: RolePathRegistry = {
    roles: {
      coding: {
        read: { allow: ["/workspace/src/**"], deny: [] },
        write: { allow: ["/workspace/src/**"], deny: [] },
      },
    },
  };

  test("B3-symlink: symlink inside allowed dir pointing to denied target is blocked when canonical_path is supplied", async () => {
    const escalations: unknown[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    // Tool call carries BOTH the apparent path (inside allowlist) AND the
    // pre-resolved canonical path (outside allowlist).
    const ctx = fakeContext("write_file", {
      path: "/workspace/src/link.ts",
      canonical_path: "/workspace/.ssh/id_rsa",
    });
    const result = await hook(ctx);

    assert.ok(
      result !== undefined && result.block === true,
      "symlink to denied target must be blocked when canonical_path is supplied",
    );
    assert.equal(escalations.length, 1, "one escalation emitted for symlink bypass");
  });

  test("B3-symlink: without canonical_path the same symlink path passes (demonstrates the gap)", async () => {
    const escalations: unknown[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    // Only args.path — no canonical_path supplied; hook sees only the
    // apparent path which is inside the allowlist.
    const ctx = fakeContext("write_file", {
      path: "/workspace/src/link.ts",
    });
    const result = await hook(ctx);

    // Passes through because apparent path is allowed and canonical_path is
    // absent. This documents the current (unfixed) behaviour; it is correct
    // when no symlink resolution is available.
    assert.equal(result, undefined, "without canonical_path the apparent path (inside allowlist) passes");
  });
});

// ---------------------------------------------------------------------------
// B6 — Static dependency-boundary proof (Epic 015:74-78)
// Ring-1 modules must import no model/ module. This is a static read of every
// production .ts file under src/ring1/ (excluding test files); the test parses
// import-from strings and asserts none resolves into src/model/.
// No production change is required — the boundary is already honoured; this
// test makes it machine-verifiable.
// ---------------------------------------------------------------------------

describe("B6: ring-1 static dependency boundary", () => {
  const ring1Dir = join(dirname(fileURLToPath(import.meta.url)));

  // Forbidden module path segments (Epic 015:74-78 — no model/session imports)
  const FORBIDDEN_SEGMENTS = ["/model/", "/session/"];

  // Collect all specifiers from all import forms in a TypeScript source string:
  //   import ... from "..."       (static named import)
  //   import "..."                (side-effect import)
  //   import("...")               (dynamic import expression)
  function collectImportSpecifiers(src: string): string[] {
    const specifiers: string[] = [];
    // static named: from "..."
    const fromPattern = /from\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = fromPattern.exec(src)) !== null) {
      if (m[1] !== undefined) specifiers.push(m[1]);
    }
    // side-effect: import "..."
    const sideEffectPattern = /^\s*import\s+["']([^"']+)["']/gm;
    while ((m = sideEffectPattern.exec(src)) !== null) {
      if (m[1] !== undefined) specifiers.push(m[1]);
    }
    // dynamic: import("...")
    const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((m = dynamicPattern.exec(src)) !== null) {
      if (m[1] !== undefined) specifiers.push(m[1]);
    }
    return specifiers;
  }

  test("B6: no ring-1 production module imports from src/model/ (all import forms)", async () => {
    const entries = await readdir(ring1Dir);
    const productionFiles = entries.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );

    const violations: string[] = [];

    for (const file of productionFiles) {
      const src = await readFile(join(ring1Dir, file), "utf8");
      for (const specifier of collectImportSpecifiers(src)) {
        if (specifier.includes("/model/")) {
          violations.push(`${file}: imports "${specifier}"`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Ring-1 modules must not import from model/; found: ${violations.join(", ")}`,
    );
  });

  test("B6: no ring-1 production module imports from src/session/ (all import forms)", async () => {
    const entries = await readdir(ring1Dir);
    const productionFiles = entries.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );

    const violations: string[] = [];

    for (const file of productionFiles) {
      const src = await readFile(join(ring1Dir, file), "utf8");
      for (const specifier of collectImportSpecifiers(src)) {
        if (specifier.includes("/session/")) {
          violations.push(`${file}: imports "${specifier}"`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Ring-1 modules must not import from session/; found: ${violations.join(", ")}`,
    );
  });

  test("B6: no ring-1 production module uses dynamic import() of model/ or session/ (side-channel check)", async () => {
    const entries = await readdir(ring1Dir);
    const productionFiles = entries.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );

    const violations: string[] = [];

    for (const file of productionFiles) {
      const src = await readFile(join(ring1Dir, file), "utf8");
      for (const specifier of collectImportSpecifiers(src)) {
        for (const seg of FORBIDDEN_SEGMENTS) {
          if (specifier.includes(seg)) {
            violations.push(`${file}: dynamic/side-effect import "${specifier}"`);
          }
        }
      }
    }

    // Deduplicate (a specifier may match multiple patterns)
    const unique = [...new Set(violations)];

    assert.deepEqual(
      unique,
      [],
      `Ring-1 modules must not import from model/ or session/ in any form; found: ${unique.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// B1-write-scope — read-tools-write-scope (4th review BLOCKER B1)
// ring1PolicyChain unconditionally calls writeScopeCheck after role policy
// allows, so a read tool on a path that is role-read-allowed but outside
// writeScope is wrongly blocked.
// Epic 015:40-42, 55-57 — write-scope escalation applies to blocked *writes*,
// not reads; write-scope does not constrain reads.
// ---------------------------------------------------------------------------

describe("B1-write-scope: read operation is not gated by writeScope", () => {
  test("B1-write-scope: read_file on a role-allowed path outside writeScope must pass through", async () => {
    // Role: read.allow covers /workspace/** (very broad);
    //       write.allow is narrower: /workspace/src/**.
    // writeScope is even narrower: /workspace/src/core/**.
    // The path /workspace/docs/readme.md is inside read.allow but outside
    // writeScope and also outside write.allow.  For a read operation, neither
    // write.allow nor writeScope should apply — the read should pass through.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/core/**"],  // narrower than read.allow
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("read_file", { path: "/workspace/docs/readme.md" });
    const result = await hook(ctx);

    assert.equal(
      result,
      undefined,
      "read_file on a role-read-allowed path must pass through regardless of writeScope",
    );
    assert.equal(
      escalations.length,
      0,
      "no escalation for a role-read-allowed read operation",
    );
  });

  test("B1-write-scope: write_file on the same path outside writeScope is still blocked", async () => {
    // Confirm write-scope enforcement is preserved for writes (regression guard).
    // Same registry; write_file to /workspace/docs/readme.md is role-write-denied
    // (outside write.allow /workspace/src/**) → blocked by role policy.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: ["/workspace/src/**"], deny: [] },
        },
      },
    };
    const escalations: Array<EscalationEvent & Record<string, unknown>> = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/core/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    const ctx = fakeContext("write_file", { path: "/workspace/docs/readme.md" });
    const result = await hook(ctx);

    assert.ok(
      result !== undefined && (result as BeforeToolCallResult).block === true,
      "write_file outside role write.allow must be blocked",
    );
    assert.equal(escalations.length, 1, "one escalation for write blocked by role policy");
  });
});

// ---------------------------------------------------------------------------
// B1-secondary-symlink-bypass (5th review)
// rename/copy secondary destination is a symlink inside an allowed dir; its
// resolved target is denied.  The hook must forward args["destination_canonical_path"]
// as secondaryCanonicalPath so policy evaluates on the real target.
// Story 001:18-22 — "rename/copy checks both paths"; symlink in allowed dir
// pointing at denied target is blocked.
// ---------------------------------------------------------------------------

describe("B1-secondary-symlink-bypass: hook forwards destination_canonical_path for secondary path symlink resolution", () => {
  // Registry: coding can write anywhere under /workspace/src/**; /workspace/.ssh/** is not in allow.
  // The rename destination (/workspace/src/dest-link.ts) is inside allow.
  // Its resolved target (/workspace/.ssh/id_rsa) is outside allow (not denied explicitly, but not allowed).
  const registry: RolePathRegistry = {
    roles: {
      coding: {
        read: { allow: ["/workspace/**"], deny: [] },
        write: { allow: ["/workspace/src/**"], deny: [] },
      },
    },
  };

  test("B1-secondary-symlink-bypass: rename dest symlink resolving to denied target is blocked when destination_canonical_path is supplied", async () => {
    const escalations: unknown[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    // rename_file: source is a valid allowed path; destination appears inside
    // allowlist but resolves via symlink to a denied target.
    const ctx = fakeContext("rename_file", {
      path: "/workspace/src/old.ts",
      destination: "/workspace/src/dest-link.ts",
      destination_canonical_path: "/workspace/.ssh/id_rsa",
    });
    const result = await hook(ctx);

    assert.ok(
      result !== undefined && (result as BeforeToolCallResult).block === true,
      "rename dest symlink to denied target must be blocked when destination_canonical_path is supplied",
    );
    assert.ok(escalations.length >= 1, "at least one escalation emitted for secondary symlink bypass");
  });

  test("B1-secondary-symlink-bypass: without destination_canonical_path the apparent destination (inside allowlist) passes", async () => {
    const escalations: unknown[] = [];
    const opts: Ring1HookAdapterOpts = {
      registry,
      role: "coding",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
      unknownEffectfulToolNames: new Set<string>(),
    };
    const hook = makeRing1HookAdapter(opts);

    // No destination_canonical_path supplied; apparent path is inside allowlist.
    const ctx = fakeContext("rename_file", {
      path: "/workspace/src/old.ts",
      destination: "/workspace/src/dest-link.ts",
    });
    const result = await hook(ctx);

    // Passes because apparent destination is inside allowlist and no canonical
    // resolution is provided — documents expected behaviour when no symlink info.
    assert.equal(result, undefined, "without destination_canonical_path the apparent destination (inside allowlist) passes");
    assert.equal(escalations.length, 0, "no escalation when apparent destination is allowed");
  });
});
