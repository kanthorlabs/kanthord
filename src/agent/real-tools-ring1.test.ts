/**
 * src/agent/real-tools-ring1.test.ts
 *
 * Story 002 T1 (019.15) — ring-1 gates the real pi tools (write + edit).
 *
 * Drives buildWorktreeTools' write/edit tools through makeRing1HookAdapter
 * with the same temp dir as both the tool cwd and ring-1's worktree:
 *   T1(a): out-of-scope write is blocked + escalates.
 *   T1(b): in-scope write passes hook + execute creates file on disk.
 *   T1(c): out-of-scope edit is blocked + escalates.
 *   T1(d): in-scope edit passes hook (undefined / pass-through).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWorktreeTools } from "./worktree-tools.ts";
import { makeRing1HookAdapter } from "../ring1/hook-binding.ts";
import type { BeforeToolCallContext } from "../ring1/hook-binding.ts";
import type { RolePathRegistry } from "../ring1/role-path-policy.ts";

function makePermissiveRegistry(worktreeDir: string): RolePathRegistry {
  return {
    roles: {
      coding: {
        read: { allow: [worktreeDir + "/**"], deny: [] },
        write: { allow: [worktreeDir + "/**"], deny: [] },
      },
    },
  };
}

function fakeCtx(
  toolName: string,
  args: Record<string, unknown>,
): BeforeToolCallContext {
  return {
    assistantMessage: { role: "assistant" as const, content: [] },
    toolCall: { id: "tc-1", name: toolName, input: args },
    args,
    context: { systemPrompt: "", messages: [], tools: [] },
  };
}

test(
  "T1(a) 019.15-S002 — real write tool: out-of-scope path blocked by ring-1 + escalates",
  async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ring1-real-"));
    try {
      const escalations: unknown[] = [];
      const hook = makeRing1HookAdapter({
        registry: makePermissiveRegistry(tmpDir),
        role: "coding",
        writeScope: ["**"],
        onEscalate: (e) => escalations.push(e),
        unknownEffectfulToolNames: new Set(),
        worktree: tmpDir,
      });

      const ctx = fakeCtx("write", { path: "/etc/kanthord-test-outside.txt", content: "bad" });
      const result = await hook(ctx);

      assert.ok(result !== undefined, "T1(a): hook must not return undefined for out-of-scope write");
      assert.equal(result.block, true, "T1(a): result.block must be true");
      assert.ok(escalations.length >= 1, "T1(a): at least one escalation must fire");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test(
  "T1(b) 019.15-S002 — real write tool: in-scope path passes ring-1 + execute creates file",
  async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ring1-real-"));
    try {
      const tools = buildWorktreeTools(tmpDir);
      const escalations: unknown[] = [];
      const hook = makeRing1HookAdapter({
        registry: makePermissiveRegistry(tmpDir),
        role: "coding",
        writeScope: ["**"],
        onEscalate: (e) => escalations.push(e),
        unknownEffectfulToolNames: new Set(),
        worktree: tmpDir,
      });

      const relPath = "ring1-allowed.txt";
      const content = "kanthord-ring1-in-scope-content";
      const hookResult = await hook(fakeCtx("write", { path: relPath, content }));

      assert.equal(hookResult, undefined, "T1(b): hook must return undefined (pass-through) for in-scope write");
      assert.equal(escalations.length, 0, "T1(b): no escalation for in-scope write");

      const writeTool = tools.find((t) => t.name === "write");
      assert.ok(writeTool, "T1(b): write tool must exist");
      await writeTool.execute("call-ring1-w", { path: relPath, content });

      const onDisk = await readFile(join(tmpDir, relPath), "utf-8");
      assert.equal(onDisk, content, "T1(b): file content must match written content");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test(
  "T1(c) 019.15-S002 — real edit tool: out-of-scope path blocked by ring-1 + escalates",
  async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ring1-real-"));
    try {
      const escalations: unknown[] = [];
      const hook = makeRing1HookAdapter({
        registry: makePermissiveRegistry(tmpDir),
        role: "coding",
        writeScope: ["**"],
        onEscalate: (e) => escalations.push(e),
        unknownEffectfulToolNames: new Set(),
        worktree: tmpDir,
      });

      const ctx = fakeCtx("edit", { path: "/etc/kanthord-test-outside-edit.txt", edits: [] });
      const result = await hook(ctx);

      assert.ok(result !== undefined, "T1(c): hook must not return undefined for out-of-scope edit");
      assert.equal(result.block, true, "T1(c): result.block must be true");
      assert.ok(escalations.length >= 1, "T1(c): at least one escalation must fire for out-of-scope edit");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test(
  "T1(d) 019.15-S002 — real edit tool: in-scope path passes ring-1 hook",
  async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ring1-real-"));
    try {
      const escalations: unknown[] = [];
      const hook = makeRing1HookAdapter({
        registry: makePermissiveRegistry(tmpDir),
        role: "coding",
        writeScope: ["**"],
        onEscalate: (e) => escalations.push(e),
        unknownEffectfulToolNames: new Set(),
        worktree: tmpDir,
      });

      const result = await hook(fakeCtx("edit", { path: "in-scope-edit-target.txt", edits: [] }));

      assert.equal(result, undefined, "T1(d): hook must return undefined (pass-through) for in-scope edit");
      assert.equal(escalations.length, 0, "T1(d): no escalation for in-scope edit");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
);
