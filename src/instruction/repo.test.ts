/**
 * Story 05 T1 (k) — RepoInstructionLoader hermetic tests
 *
 * Verifies workspace-root-only discovery semantics:
 *   - INSTRUCTION_CANDIDATES constant order
 *   - both AGENTS.md + CLAUDE.md → both returned in candidate order
 *   - only one present → single entry
 *   - neither present → []
 *   - nested sub/AGENTS.md NOT returned (no descendant walk)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoInstructionLoader, INSTRUCTION_CANDIDATES } from "./repo.ts";

test("INSTRUCTION_CANDIDATES is ['AGENTS.md', 'CLAUDE.md']", () => {
  assert.deepEqual(INSTRUCTION_CANDIDATES, ["AGENTS.md", "CLAUDE.md"]);
});

test("both AGENTS.md and CLAUDE.md: load returns both in order with workspace-relative paths and correct content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-loader-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "agents content");
    await writeFile(join(dir, "CLAUDE.md"), "claude content");
    const loader = new RepoInstructionLoader(dir);
    const result = loader.load();
    assert.equal(result.length, 2, "both files returned");
    assert.deepEqual(result[0], {
      path: "AGENTS.md",
      content: "agents content",
    });
    assert.deepEqual(result[1], {
      path: "CLAUDE.md",
      content: "claude content",
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("only CLAUDE.md present: load returns one entry with workspace-relative path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-loader-"));
  try {
    await writeFile(join(dir, "CLAUDE.md"), "claude only");
    const loader = new RepoInstructionLoader(dir);
    const result = loader.load();
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { path: "CLAUDE.md", content: "claude only" });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("neither file present: load returns empty array", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-loader-"));
  try {
    const loader = new RepoInstructionLoader(dir);
    const result = loader.load();
    assert.deepEqual(result, []);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("nested sub/AGENTS.md is not returned (workspace-root only, no ancestor/descendant walk)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-loader-"));
  try {
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "AGENTS.md"), "nested agents");
    const loader = new RepoInstructionLoader(dir);
    const result = loader.load();
    assert.deepEqual(result, []);
  } finally {
    await rm(dir, { recursive: true });
  }
});
