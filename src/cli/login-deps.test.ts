/**
 * src/cli/login-deps.test.ts
 *
 * Story 006 T1 — hermetic test for buildLoginDeps:
 * asserts the factory binds the real pi-ai device-code login functions by
 * identity and constructs a registry + store rooted at dataRoot, with no
 * network call.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loginOpenAICodexDeviceCode,
  loginGitHubCopilot,
} from "@earendil-works/pi-ai/oauth";
import { buildLoginDeps } from "./login-deps.ts";

test("buildLoginDeps — openai-codex loginFn is loginOpenAICodexDeviceCode by identity", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "kanthord-login-deps-"));
  try {
    const deps = buildLoginDeps({ dataRoot });
    const fn = deps.loginFns["openai-codex"];
    assert.strictEqual(
      fn,
      loginOpenAICodexDeviceCode,
      "loginFns['openai-codex'] must be the real loginOpenAICodexDeviceCode from @earendil-works/pi-ai/oauth",
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("buildLoginDeps — github-copilot loginFn is loginGitHubCopilot by identity", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "kanthord-login-deps-"));
  try {
    const deps = buildLoginDeps({ dataRoot });
    const fn = deps.loginFns["github-copilot"];
    assert.strictEqual(
      fn,
      loginGitHubCopilot,
      "loginFns['github-copilot'] must be the real loginGitHubCopilot from @earendil-works/pi-ai/oauth",
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("buildLoginDeps — registry and store are constructed without network", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "kanthord-login-deps-"));
  try {
    const deps = buildLoginDeps({ dataRoot });
    assert.ok(deps.registry != null, "registry must be constructed");
    assert.ok(deps.store != null, "store must be constructed");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
