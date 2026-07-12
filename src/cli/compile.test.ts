/**
 * src/cli/compile — compile CLI test (Story 002 T1)
 *
 * Drives runCompileCommand({ featureDir, store, opts, out }) against a temp
 * checkout; asserts store population + summary output + exit codes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { runCompileCommand } from "./compile.ts";

const featureId = "feat-cli-compile";

const epicMd = [
  "---",
  `id: ${featureId}`,
  "---",
  "",
  "## Acceptance",
  "",
  "Feature complete.",
].join("\n");

const taskMd = [
  "---",
  "id: task-cli-compile",
  "workflow: tdd@1",
  "ticket_system: github",
  "ticket: CLI-1",
  "write_scope:",
  "  - src/",
  "---",
  "",
  "## Prerequisites",
  "",
  "None.",
  "",
  "## Inputs",
  "",
  "Input.",
  "",
  "## Outputs",
  "",
  "Output.",
  "",
  "## Tests",
  "",
  "Tests.",
].join("\n");

describe("src/cli/compile", () => {
  let tempDir = "";
  let featureDir = "";

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cli-compile-"));
    const kanthordDir = join(tempDir, ".kanthord");
    featureDir = join(kanthordDir, "features");
    await mkdir(join(featureDir, "001-story"), { recursive: true });
    await writeFile(join(featureDir, "epic.md"), epicMd, "utf8");
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await writeFile(join(featureDir, "001-story", "INDEX.md"), "# Story\n", "utf8");
    await writeFile(join(featureDir, "001-story", "001-task-cli-compile.md"), taskMd, "utf8");
  });

  after(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("compiles a valid feature into the store, reports feature id + task count, exits 0", async () => {
    const dbPath = join(tempDir, "db.sqlite");
    const store = openStore(dbPath, { busyTimeout: 5000 });
    initSchema(store);
    const lines: string[] = [];
    const out = (l: string): void => {
      lines.push(l);
    };
    try {
      const code = await runCompileCommand({ featureDir, store, opts: {}, out });
      assert.strictEqual(code, 0, "must return exit code 0 on success");
      const rows = store.all<{ feature_id: string }>(
        "SELECT DISTINCT feature_id FROM plan_generation",
      );
      assert.ok(
        rows.some((r) => r.feature_id === featureId),
        `plan_generation must contain "${featureId}" after runCompileCommand`,
      );
      const summary = lines.join(" ");
      assert.ok(
        summary.includes(featureId),
        `summary must mention feature id "${featureId}"; got: ${summary}`,
      );
      assert.ok(
        /[1-9]\d* task/.test(summary),
        `summary must mention a task count ≥1; got: ${summary}`,
      );
    } finally {
      store.close();
    }
  });

  it("returns non-zero and writes error to out when feature markdown is invalid; no dispatchable plan", async () => {
    const badDir = await mkdtemp(join(tmpdir(), "cli-compile-bad-"));
    try {
      // Task file missing required sections — shapeLint throws
      const badTaskMd = [
        "---",
        "id: task-bad",
        "workflow: tdd@1",
        "ticket_system: github",
        "ticket: BAD-1",
        "write_scope:",
        "  - src/",
        "---",
        "",
        "No required sections here.",
      ].join("\n");
      const badEpicMd = [
        "---",
        "id: feat-bad",
        "---",
        "",
        "## Acceptance",
        "",
        "Bad feature.",
      ].join("\n");
      await mkdir(join(badDir, "001-bad-story"), { recursive: true });
      await writeFile(join(badDir, "epic.md"), badEpicMd, "utf8");
      await writeFile(join(badDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
      await writeFile(join(badDir, "001-bad-story", "INDEX.md"), "# Story\n", "utf8");
      await writeFile(join(badDir, "001-bad-story", "001-task-bad.md"), badTaskMd, "utf8");

      const badDbPath = join(badDir, "db.sqlite");
      const badStore = openStore(badDbPath, { busyTimeout: 5000 });
      initSchema(badStore);
      const errLines: string[] = [];
      const errOut = (l: string): void => {
        errLines.push(l);
      };
      try {
        const code = await runCompileCommand({ featureDir: badDir, store: badStore, opts: {}, out: errOut });
        assert.notStrictEqual(code, 0, "must return non-zero exit code on compile error");
        const errSummary = errLines.join(" ");
        assert.ok(errSummary.length > 0, "error output must be non-empty");
        // plan_generation may or may not exist; if it does, feat-bad must have no rows
        try {
          const rows = badStore.all<{ feature_id: string }>(
            "SELECT DISTINCT feature_id FROM plan_generation WHERE feature_id = 'feat-bad'",
          );
          assert.strictEqual(
            rows.length,
            0,
            "no plan_generation rows must exist for invalid feature",
          );
        } catch (e) {
          // table absent = no dispatchable plan; that satisfies the assertion
          if (!(e instanceof Error && e.message.includes("no such table"))) throw e;
        }
      } finally {
        badStore.close();
      }
    } finally {
      await rm(badDir, { recursive: true, force: true });
    }
  });
});
