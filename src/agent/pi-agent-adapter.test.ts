/**
 * pi Agent adapter unit tests — B1 review fix + Story 003 T2
 *
 * Asserts that makeAgentOpts maps allowed pi tool names → AgentTool[] and that
 * beforeToolCall is bound from opts.  The module under test
 * (src/agent/pi-agent-adapter.ts) must be created by the SE.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { makeAgentOpts } from "./pi-agent-adapter.ts";
import { PI_DEFAULT_ALLOWED_MANIFEST, PI_EXEC_TOOLS } from "./pi-tools.ts";

test(
  "B1-review — makeAgentOpts maps each allowed name to one AgentTool (bash absent, beforeToolCall bound)",
  () => {
    const allowedNames = [...PI_DEFAULT_ALLOWED_MANIFEST];
    const dummyHook = async (): Promise<undefined> => undefined;

    const opts = makeAgentOpts({ tools: allowedNames, beforeToolCall: dummyHook });

    // One AgentTool per allowed name
    const tools = (opts.initialState?.tools ?? []) as Array<{ name: string }>;
    assert.equal(
      tools.length,
      allowedNames.length,
      "AgentTool[] must have exactly one entry per allowed tool name",
    );

    // Each allowed name is present
    const names = new Set(tools.map((t) => t.name));
    for (const name of allowedNames) {
      assert.ok(names.has(name), `AgentTool for "${name}" must be present`);
    }

    // bash (exec tool) is absent
    for (const execName of PI_EXEC_TOOLS) {
      assert.ok(!names.has(execName), `exec tool "${execName}" must NOT be in tools`);
    }

    // beforeToolCall is bound to the provided function
    assert.strictEqual(
      opts.beforeToolCall,
      dummyHook,
      "beforeToolCall must be exactly the function passed in",
    );
  },
);

// ---------------------------------------------------------------------------
// GAP3 — model + API-key threading
// ---------------------------------------------------------------------------

test(
  "GAP3 — makeAgentOpts threads model id into initialState.model and getApiKey into AgentOptions",
  () => {
    // Minimal model stub — we only assert on id; full Model<any> shape owned by SE.
    const fakeModel = { id: "claude-sonnet-gap3-test", name: "test-model" } as unknown;
    const keyFn = (provider: string): string | undefined =>
      provider === "anthropic" ? "sk-test-key-sentinel" : undefined;
    const dummyHook = async (): Promise<undefined> => undefined;

    // Cast input via 'any': the extended fields (model, getApiKey) do not exist
    // on AgentAdapterOpts yet — SE adds them.  Runtime: makeAgentOpts currently
    // ignores them and the assertions below fail for the right reason.
    const result = makeAgentOpts({
      tools: [],
      beforeToolCall: dummyHook,
      model: fakeModel,
      getApiKey: keyFn,
    } as unknown as Parameters<typeof makeAgentOpts>[0]);

    assert.ok(
      result.initialState?.model !== undefined,
      "initialState.model must be set when a model is supplied — GAP3: not threaded yet",
    );
    assert.equal(
      (result.initialState?.model as { id?: string })?.id,
      "claude-sonnet-gap3-test",
      "initialState.model.id must match the supplied model id",
    );
    assert.ok(
      result.getApiKey !== undefined,
      "getApiKey must be present in AgentOptions when supplied — GAP3: not set yet",
    );
    assert.equal(
      result.getApiKey!("anthropic"),
      "sk-test-key-sentinel",
      "getApiKey('anthropic') must return the provisioned key",
    );
  },
);

test(
  "GAP3 — makeAgentOpts never emits the API key value to process.stdout (characterization — safety net)",
  () => {
    // Characterization test: passes now and must stay green after implementation.
    // If the SE accidentally logs opts.getApiKey() or the raw key string, this fails.
    const CANARY = "sk-canary-zyx987-MUSTNOTLEAK";
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (chunk: string | Buffer, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    };
    try {
      makeAgentOpts({
        tools: [],
        beforeToolCall: async (): Promise<undefined> => undefined,
        getApiKey: () => CANARY,
      } as unknown as Parameters<typeof makeAgentOpts>[0]);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = origWrite;
    }
    const leaked = captured.join("").includes(CANARY);
    assert.equal(
      leaked,
      false,
      "API key canary value must NOT appear in any stdout output from makeAgentOpts",
    );
  },
);

// ---------------------------------------------------------------------------
// T2 (Story 003) — model + streamFn threading; no getApiKey when streamFn present
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BLOCKER-1 (019.15 S2) — opts.tools filtering must apply when worktreePath present
// ---------------------------------------------------------------------------

test(
  "BLOCKER-1 (019.15 S2) — makeAgentOpts with worktreePath + restricted opts.tools only builds the allowed tools",
  async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "kanthord-b1-"));
    try {
      const dummyHook = async (): Promise<undefined> => undefined;
      const opts = makeAgentOpts({
        tools: ["read"], // only "read" in the manifest
        beforeToolCall: dummyHook,
        worktreePath: tmpDir,
      });
      const tools = (opts.initialState?.tools ?? []) as Array<{ name: string }>;
      const names = tools.map((t) => t.name);
      assert.ok(names.includes("read"), "BLOCKER-1: read tool must be present");
      for (const absent of ["write", "edit", "grep", "find", "ls", "bash"]) {
        assert.ok(
          !names.includes(absent),
          `BLOCKER-1: ${absent} must NOT be in tool set when opts.tools restricts to ["read"]`,
        );
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// BLOCKER-2 (019.15 S3) — fallback (no worktreePath) must NOT silently succeed
// ---------------------------------------------------------------------------

test(
  "BLOCKER-2 (019.15 S3) — makeAgentOpts with no worktreePath: fallback tool execute throws a loud error",
  async () => {
    const dummyHook = async (): Promise<undefined> => undefined;
    const opts = makeAgentOpts({
      tools: ["read"],
      beforeToolCall: dummyHook,
      // intentionally no worktreePath — fallback stub path
    });
    type LooseTool = {
      name: string;
      execute: (...args: unknown[]) => Promise<unknown>;
    };
    const tools = (opts.initialState?.tools ?? []) as LooseTool[];
    const readTool = tools.find((t) => t.name === "read");
    if (readTool == null) throw new Error("BLOCKER-2: read stub tool missing (test setup)");
    // Fallback stub must throw — silent empty-success (returning {content:[], details:undefined})
    // is forbidden. Tools signal errors by throwing (pi-agent-core semantics).
    await assert.rejects(
      () => readTool.execute("id-001", { path: "foo.txt" }),
      (err: unknown) => {
        assert.ok(err instanceof Error, "BLOCKER-2: execute must throw an Error instance");
        assert.ok(
          (err as Error).message.length > 0,
          "BLOCKER-2: thrown error message must not be empty",
        );
        return true;
      },
      "BLOCKER-2: fallback stub execute must throw — silent empty-success is forbidden (no workspace bound)",
    );
  },
);

test(
  "T2 (Story 003) — makeAgentOpts threads streamFn into AgentOptions and omits getApiKey",
  () => {
    const fakeModel = { id: "gpt-4.1", name: "gpt-4.1", provider: "acct_test-001" } as unknown;
    // Minimal StreamFn-shaped function; cast satisfies the type without importing
    // all pi-ai event-stream types.
    const fakeStreamFn: StreamFn = (() => {
      throw new Error("not called in test");
    }) as unknown as StreamFn;
    const dummyHook = async (): Promise<undefined> => undefined;

    // streamFn is not on AgentAdapterOpts yet — cast via unknown so the runtime
    // receives the field; makeAgentOpts currently ignores it, so result.streamFn
    // is undefined and the assertion fails for the right reason (RED).
    const result = makeAgentOpts({
      tools: [],
      beforeToolCall: dummyHook,
      model: fakeModel,
      streamFn: fakeStreamFn,
    } as unknown as Parameters<typeof makeAgentOpts>[0]);

    assert.strictEqual(
      result.streamFn,
      fakeStreamFn,
      "T2: streamFn must be forwarded into AgentOptions.streamFn — not yet threaded (RED)",
    );
    assert.strictEqual(
      result.getApiKey,
      undefined,
      "T2: getApiKey must be absent when streamFn is provided (no api-key branch)",
    );
  },
);
