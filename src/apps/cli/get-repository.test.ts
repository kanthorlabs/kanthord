/**
 * `get repository` — convenience alias for `get resource`.
 *
 * Confirms the noun is registered and routes to the resource read, so a
 * repository can be read back by the same noun used to create/publish/land it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { runCli as dispatch } from "./commands/run-cli.ts";

test("get repository reads a repository resource by id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-getrepo-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    assert.equal((await dispatch(["db", "migrate"], deps)).exitCode, 0);

    const project = (
      await dispatch(["create", "project", "--name", "demo"], deps)
    ).stdout[0]!;
    const repo = (
      await dispatch(
        [
          "create",
          "repository",
          "--project",
          project,
          "--name",
          "backend",
          "--remote-url",
          "https://github.com/example/backend.git",
          "--branch",
          "main",
        ],
        deps,
      )
    ).stdout[0]!;

    const got = await dispatch(["get", "repository", "--id", repo], deps);
    assert.equal(
      got.exitCode,
      0,
      `get repository exits 0: ${got.stderr.join("")}`,
    );
    assert.ok(
      got.stdout.some((l) => l === `id: ${repo}`),
      "prints the repository id line",
    );
    assert.ok(
      got.stdout.some((l) => l === "type: repository"),
      "prints type: repository",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
