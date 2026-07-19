/**
 * Story 05 T4 — CLI `update <type>` commands via dispatch.
 *
 * Fails today: none of "update ai-provider", "update credential",
 * "update repository" etc. exist in COMMANDS → dispatch returns
 * exitCode 1 "unknown command" for every case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { dispatch } from "./router.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4-upd-"));
  return { dir, dbPath: join(dir, "kanthord.db") };
}

async function bootstrapProject(
  deps: ReturnType<typeof buildDeps>,
  name: string,
): Promise<string> {
  await dispatch(["db", "migrate"], deps);
  const rp = await dispatch(["create", "project", "--name", name], deps);
  assert.equal(
    rp.exitCode,
    0,
    `create project '${name}' failed: ${rp.stderr.join("")}`,
  );
  return rp.stdout[0]!;
}

// ---------------------------------------------------------------------------
// T4a: update ai-provider with valid model → exitCode 0
// ---------------------------------------------------------------------------
test("T4a: dispatch update ai-provider with valid model (gpt-5.6-sol) returns exitCode 0", async () => {
  const { dir, dbPath } = makeDb();
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4a");

    // Seed via use case directly (PiModelCatalog validates gpt-5.6-terra at create).
    const aipId = await deps.addResource.execute({
      type: "ai_provider",
      projectId: PROJECT,
      name: "gpt",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
    });

    const result = await dispatch(
      ["update", "ai-provider", "--id", aipId, "--model", "gpt-5.6-sol"],
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exitCode 0 for valid model update, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4b: update ai-provider with unknown model → exitCode 1 with 'get models'
// ---------------------------------------------------------------------------
test("T4b: dispatch update ai-provider with unknown model returns exitCode 1 with 'get models' in stderr", async () => {
  const { dir, dbPath } = makeDb();
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4b");

    const aipId = await deps.addResource.execute({
      type: "ai_provider",
      projectId: PROJECT,
      name: "gpt",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
    });

    const result = await dispatch(
      ["update", "ai-provider", "--id", aipId, "--model", "no-such-model-xyz"],
      deps,
    );
    assert.equal(
      result.exitCode,
      1,
      "unknown model update must return exitCode 1",
    );
    // The error must come from model validation (UnknownModelError), NOT from
    // an "unknown command" response. "unknown command" stderr proves the
    // command itself is missing (vacuous pass guard).
    assert.ok(
      !result.stderr.join("").includes("unknown command"),
      `command must exist; got "unknown command" → add 'update ai-provider' to COMMANDS. stderr: ${result.stderr.join("")}`,
    );
    assert.ok(
      result.stderr.join("").toLowerCase().includes("get models"),
      `expected 'get models' from UnknownModelError in stderr, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4c: update credential with --value-file → exitCode 0
// ---------------------------------------------------------------------------
test("T4c: dispatch update credential with --value-file returns exitCode 0", async () => {
  const { dir, dbPath } = makeDb();
  const tmpFile = join(dir, "newval.txt");
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4c");

    const credId = await deps.addResource.execute({
      type: "credential",
      projectId: PROJECT,
      name: "k1",
      provider: "anthropic",
      value: "sk-old",
    });

    await writeFile(tmpFile, "sk-new-value\n");

    const result = await dispatch(
      ["update", "credential", "--id", credId, "--value-file", tmpFile],
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exitCode 0 for credential value-file update, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4d: update credential with --value (old flag removed) → exitCode 1
// ---------------------------------------------------------------------------
test("T4d: dispatch update credential with --value (old flag) returns exitCode 1", async () => {
  const { dir, dbPath } = makeDb();
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4d");

    const credId = await deps.addResource.execute({
      type: "credential",
      projectId: PROJECT,
      name: "k1",
      provider: "anthropic",
      value: "sk-old",
    });

    // --value is not declared in parse config → strict parseArgs rejects it as unknown option.
    // Guard: must be a parse error, not an "unknown command" error (vacuous-pass guard).
    const result = await dispatch(
      ["update", "credential", "--id", credId, "--value", "sk-bad"],
      deps,
    );
    assert.equal(
      result.exitCode,
      1,
      "--value (removed old flag) must return exitCode 1 (unknown option)",
    );
    assert.ok(
      !result.stderr.join("").includes("unknown command"),
      `command must exist; got "unknown command" → add 'update credential' to COMMANDS. stderr: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4e: update ai-provider with --clear-effort → exitCode 0
// ---------------------------------------------------------------------------
test("T4e: dispatch update ai-provider with --clear-effort returns exitCode 0", async () => {
  const { dir, dbPath } = makeDb();
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4e");

    const aipId = await deps.addResource.execute({
      type: "ai_provider",
      projectId: PROJECT,
      name: "gpt",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      effort: "medium",
    });

    const result = await dispatch(
      ["update", "ai-provider", "--id", aipId, "--clear-effort"],
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exitCode 0 for --clear-effort, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4f: update repository when home path exists → exitCode 1 (CacheConflictError)
// ---------------------------------------------------------------------------
test("T4f: dispatch update repository when home path exists returns exitCode 1 (CacheConflictError)", async () => {
  const { dir, dbPath } = makeDb();
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4f");

    // Create a real directory to act as the "cached clone" path.
    const homePath = join(dir, "home-clone");
    mkdirSync(homePath);

    const repoId = await deps.addResource.execute({
      type: "repository",
      projectId: PROJECT,
      name: "home",
      remoteUrl: "https://github.com/o/r.git",
      branch: "main",
      path: homePath,
      auth: { kind: "ambient" },
    });

    // Changing remoteUrl while home path exists (and no --reclone) must fail
    // with CacheConflictError, not with "unknown command".
    const result = await dispatch(
      [
        "update",
        "repository",
        "--id",
        repoId,
        "--remote-url",
        "https://github.com/o/r2.git",
      ],
      deps,
    );
    assert.equal(
      result.exitCode,
      1,
      `expected exitCode 1 (CacheConflictError) when home clone exists, got: ${result.stderr.join("")}`,
    );
    // Vacuous-pass guard: the error must not be "unknown command".
    assert.ok(
      !result.stderr.join("").includes("unknown command"),
      `command must exist; got "unknown command" → add 'update repository' to COMMANDS. stderr: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4g: update repository with --reclone when home path exists → exitCode 0
// ---------------------------------------------------------------------------
test("T4g: dispatch update repository with --reclone when home path exists returns exitCode 0", async () => {
  const { dir, dbPath } = makeDb();
  try {
    const deps = buildDeps(dbPath);
    const PROJECT = await bootstrapProject(deps, "t4g");

    const homePath = join(dir, "home-clone-g");
    mkdirSync(homePath);

    const repoId = await deps.addResource.execute({
      type: "repository",
      projectId: PROJECT,
      name: "home",
      remoteUrl: "https://github.com/o/r.git",
      branch: "main",
      path: homePath,
      auth: { kind: "ambient" },
    });

    // With --reclone, the update must succeed (clears cached path).
    const result = await dispatch(
      [
        "update",
        "repository",
        "--id",
        repoId,
        "--remote-url",
        "https://github.com/o/r2.git",
        "--reclone",
      ],
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exitCode 0 for --reclone update, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
