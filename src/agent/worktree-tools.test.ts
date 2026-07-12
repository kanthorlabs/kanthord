/**
 * src/agent/worktree-tools.test.ts
 *
 * Characterizes + asserts the buildWorktreeTools(cwd) helper:
 *   - returns exactly the six real pi factory tools (read/write/edit/grep/find/ls)
 *   - excludes bash
 *   - write creates a file under cwd; read returns its content
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWorktreeTools } from "./worktree-tools.ts";

describe("src/agent/worktree-tools.ts", () => {
  test("returns tools named exactly read,write,edit,grep,find,ls and no bash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-tools-"));
    try {
      const tools = buildWorktreeTools(dir);
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ["edit", "find", "grep", "ls", "read", "write"]);
      assert.equal(
        tools.some((t) => t.name === "bash"),
        false,
        "bash must not be included",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("write tool creates file under cwd with given content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-tools-"));
    try {
      const tools = buildWorktreeTools(dir);
      const write = tools.find((t) => t.name === "write");
      assert.ok(write, "write tool must exist");

      const relPath = "hello.txt";
      const content = "hello kanthord";
      await write.execute("call-w1", { path: relPath, content });

      const onDisk = await readFile(join(dir, relPath), "utf8");
      assert.equal(onDisk, content);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("read tool returns the content written by write tool", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-tools-"));
    try {
      const tools = buildWorktreeTools(dir);
      const write = tools.find((t) => t.name === "write");
      const read = tools.find((t) => t.name === "read");
      assert.ok(write, "write tool must exist");
      assert.ok(read, "read tool must exist");

      const relPath = "greet.txt";
      const content = "real-tool-content-kanthord";
      await write.execute("call-w2", { path: relPath, content });

      const result = await read.execute("call-r1", { path: relPath });
      const textItems = result.content.filter(
        (c): c is { type: "text"; text: string } => c.type === "text",
      );
      assert.ok(textItems.length > 0, "read must return at least one text block");
      assert.ok(
        textItems.some((c) => c.text.includes(content)),
        "read result text must include the written content",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
