/**
 * src/git/delivery-preflight.test.ts
 *
 * Suite: src/git/delivery-preflight.ts
 * Story 002 / Task T1 — makeDeliveryVerifySetup preflight helper
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { makeDeliveryVerifySetup } from "./delivery-preflight.ts";
import type { RunGitSeam } from "./verify-setup.ts";

// ---------------------------------------------------------------------------
// Helper — create a minimal git repo in a temp dir
// ---------------------------------------------------------------------------

async function makeTmpRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "delivery-preflight-test-"));
  execSync(`git init "${dir}"`, { stdio: "pipe" });
  execSync(`git -C "${dir}" config user.email "test@test"`, { stdio: "pipe" });
  execSync(`git -C "${dir}" config user.name "Test"`, { stdio: "pipe" });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// T1.a — passing preflight (non-empty token + working git) returns ok: true
// ---------------------------------------------------------------------------

test("019.16 S002 T1-a — makeDeliveryVerifySetup returns ok:true when git works and token is non-empty", async () => {
  const { dir, cleanup } = await makeTmpRepo();
  try {
    const preflight = makeDeliveryVerifySetup({
      token: "ghp_valid_token_abc123",
      gitBin: "git",
      cwd: dir,
    });
    const report = await preflight();
    assert.equal(report.ok, true, "report.ok must be true");
    assert.equal(report.inboxItems.length, 0, "inboxItems must be empty");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T1.b — failing preflight (empty token) returns ok: false + inboxItems
// ---------------------------------------------------------------------------

test("019.16 S002 T1-b — makeDeliveryVerifySetup returns ok:false when token is empty", async () => {
  const { dir, cleanup } = await makeTmpRepo();
  try {
    const preflight = makeDeliveryVerifySetup({
      token: "",
      gitBin: "git",
      cwd: dir,
    });
    const report = await preflight();
    assert.equal(report.ok, false, "report.ok must be false for empty token");
    assert.ok(report.inboxItems.length > 0, "inboxItems must be non-empty");
    assert.equal(report.inboxItems[0]?.kind, "system:setup");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T1.c — failing preflight (runGit seam returns non-success) returns ok: false
// ---------------------------------------------------------------------------

test("019.16 S002 T1-c — makeDeliveryVerifySetup returns ok:false when runGit seam reports failure", async () => {
  const { dir, cleanup } = await makeTmpRepo();
  try {
    const failingRunGit: RunGitSeam = async (_args, _opts) => ({
      kind: "not-found",
      stdout: "",
      stderr: "git not found",
    });
    const preflight = makeDeliveryVerifySetup({
      token: "ghp_valid_token_abc123",
      gitBin: "git",
      cwd: dir,
      runGit: failingRunGit,
    });
    const report = await preflight();
    assert.equal(report.ok, false, "report.ok must be false when runGit fails");
    assert.ok(report.inboxItems.length > 0, "inboxItems must be non-empty");
  } finally {
    await cleanup();
  }
});
