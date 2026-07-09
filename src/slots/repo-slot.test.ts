/**
 * Tests for src/slots/repo-slot
 * Story 001 — Repo Slots & Worktrees
 * Task T1 — Slot registry + registration validation
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import {
  loadRepoSlot,
  SlotConfigError,
  SlotRegistrationError,
  type RepoSlot,
} from "./repo-slot.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeTempYaml(dir: string, name: string, content: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, content, "utf8");
  return p;
}

async function makeTempGitRepo(dir: string): Promise<string> {
  const repoDir = join(dir, "myrepo");
  await mkdir(repoDir, { recursive: true });
  execSync("git init -q", { cwd: repoDir });
  execSync('git config user.email "t@t.com"', { cwd: repoDir });
  execSync('git config user.name "T"', { cwd: repoDir });
  return repoDir;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/slots/repo-slot", () => {
  // -------------------------------------------------------------------------
  // (a) Valid slot yaml loads into a typed RepoSlot
  // -------------------------------------------------------------------------

  describe("loadRepoSlot — valid yaml", () => {
    test("a complete valid slot yaml loads into a typed RepoSlot with all fields", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kslot-t1-a-"));
      try {
        const repoPath = await makeTempGitRepo(dir);
        const yamlContent = [
          `repo: ${repoPath}`,
          `strategy: worktree`,
          `max_concurrent_tasks: 2`,
          `workflows_allowed:`,
          `  - tdd`,
          `identity: deploy-bot`,
        ].join("\n");
        const yamlPath = await writeTempYaml(dir, "slot.yaml", yamlContent);

        const slot: RepoSlot = await loadRepoSlot(yamlPath);

        assert.strictEqual(slot.repo, repoPath, "slot.repo must match yaml repo field");
        assert.strictEqual(slot.strategy, "worktree", "slot.strategy must be 'worktree'");
        assert.strictEqual(slot.maxConcurrentTasks, 2, "slot.maxConcurrentTasks must be 2");
        assert.deepEqual(slot.workflowsAllowed, ["tdd"], "slot.workflowsAllowed must match");
        assert.strictEqual(slot.identity, "deploy-bot", "slot.identity must match");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (b) Unknown strategy → typed SlotConfigError naming the file
  // -------------------------------------------------------------------------

  describe("loadRepoSlot — invalid strategy", () => {
    test("unknown strategy value throws SlotConfigError naming the yaml file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kslot-t1-b1-"));
      try {
        const repoPath = await makeTempGitRepo(dir);
        const yamlContent = [
          `repo: ${repoPath}`,
          `strategy: unknown_strategy`,
          `max_concurrent_tasks: 1`,
          `workflows_allowed: []`,
          `identity: deploy-bot`,
        ].join("\n");
        const yamlPath = await writeTempYaml(dir, "slot.yaml", yamlContent);

        await assert.rejects(
          () => loadRepoSlot(yamlPath),
          (err: unknown) => {
            assert.ok(err instanceof SlotConfigError, `must throw SlotConfigError; got ${String(err)}`);
            const configErr = err as SlotConfigError;
            assert.ok(
              configErr.message.includes(yamlPath),
              `error message must include the file path; got: ${configErr.message}`,
            );
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (b) Missing repo field → typed SlotConfigError naming the file
  // -------------------------------------------------------------------------

  describe("loadRepoSlot — missing repo field", () => {
    test("missing repo field throws SlotConfigError naming the yaml file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kslot-t1-b2-"));
      try {
        const yamlContent = [
          `strategy: worktree`,
          `max_concurrent_tasks: 1`,
          `workflows_allowed: []`,
          `identity: deploy-bot`,
        ].join("\n");
        const yamlPath = await writeTempYaml(dir, "slot.yaml", yamlContent);

        await assert.rejects(
          () => loadRepoSlot(yamlPath),
          (err: unknown) => {
            assert.ok(err instanceof SlotConfigError, `must throw SlotConfigError; got ${String(err)}`);
            const configErr = err as SlotConfigError;
            assert.ok(
              configErr.message.includes(yamlPath),
              `error message must include the file path; got: ${configErr.message}`,
            );
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (b) Missing identity field → typed SlotConfigError naming the file
  // -------------------------------------------------------------------------

  describe("loadRepoSlot — missing identity field", () => {
    test("missing identity field throws SlotConfigError naming the yaml file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kslot-t1-b3-"));
      try {
        const repoPath = await makeTempGitRepo(dir);
        const yamlContent = [
          `repo: ${repoPath}`,
          `strategy: worktree`,
          `max_concurrent_tasks: 1`,
          `workflows_allowed: []`,
        ].join("\n");
        const yamlPath = await writeTempYaml(dir, "slot.yaml", yamlContent);

        await assert.rejects(
          () => loadRepoSlot(yamlPath),
          (err: unknown) => {
            assert.ok(err instanceof SlotConfigError, `must throw SlotConfigError; got ${String(err)}`);
            const configErr = err as SlotConfigError;
            assert.ok(
              configErr.message.includes(yamlPath),
              `error message must include the file path; got: ${configErr.message}`,
            );
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (c) Non-git path → SlotRegistrationError at registration
  // -------------------------------------------------------------------------

  describe("loadRepoSlot — non-git repo path", () => {
    test("a path that is not a git repository throws SlotRegistrationError", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kslot-t1-c-"));
      try {
        // Use a plain directory that is NOT a git repo
        const plainDir = join(dir, "notgit");
        await mkdir(plainDir, { recursive: true });

        const yamlContent = [
          `repo: ${plainDir}`,
          `strategy: worktree`,
          `max_concurrent_tasks: 1`,
          `workflows_allowed: []`,
          `identity: deploy-bot`,
        ].join("\n");
        const yamlPath = await writeTempYaml(dir, "slot.yaml", yamlContent);

        await assert.rejects(
          () => loadRepoSlot(yamlPath),
          (err: unknown) => {
            assert.ok(
              err instanceof SlotRegistrationError,
              `must throw SlotRegistrationError; got ${String(err)}`,
            );
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("a path that does not exist throws SlotRegistrationError", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kslot-t1-c2-"));
      try {
        const nonExistentPath = join(dir, "does-not-exist");
        const yamlContent = [
          `repo: ${nonExistentPath}`,
          `strategy: worktree`,
          `max_concurrent_tasks: 1`,
          `workflows_allowed: []`,
          `identity: deploy-bot`,
        ].join("\n");
        const yamlPath = await writeTempYaml(dir, "slot.yaml", yamlContent);

        await assert.rejects(
          () => loadRepoSlot(yamlPath),
          (err: unknown) => {
            assert.ok(
              err instanceof SlotRegistrationError,
              `must throw SlotRegistrationError; got ${String(err)}`,
            );
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
