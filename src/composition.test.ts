import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps, buildEmitCallback } from "./composition.ts";
import type { Event } from "./domain/event.ts";
import type { Logger } from "./logger/port.ts";
import { runCli as dispatch } from "./apps/cli/commands/run-cli.ts";

// Story 03 T3 — get resource via dispatch: credential value absent from stdout (D6 + composition wiring)
// Characterization test: the SE implemented the composition.ts wiring in T2's GREEN phase.
// Sensitivity: if 'getResource' is removed from buildDeps or the dispatch handler breaks,
// exitCode would be non-zero and/or the credential value would appear in stdout.
test("T3: dispatch get resource returns credential view with canary value absent from stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t3-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);

    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    const rp = await dispatch(["create", "project", "--name", "t3demo"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    // Use the use case directly (CLI create credential requires --value-file; bypass for smoke).
    const CANARY = "CANARY_SECRET_VALUE";
    const credId = await deps.addResource.execute({
      type: "credential",
      projectId: PROJECT,
      name: "k1",
      provider: "anthropic",
      value: CANARY,
    });

    const rg = await dispatch(["get", "resource", "--id", credId], deps);
    assert.equal(rg.exitCode, 0, "get resource exits 0");
    assert.ok(
      !rg.stdout.join("").includes(CANARY),
      "canary credential value is absent from get resource stdout (D6 structural omission)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 04 T4 — CLI: remove --allow-unknown-model / --base-url; surface
// UnknownModelError as exitCode 1 with "list model" in stderr.
// ---------------------------------------------------------------------------

// T4a: PRIMARY RED test.
// UnknownModelError from PiModelCatalog (via buildDeps) must be handled by
// toResult → exitCode 1 with "list model" in stderr.
// FAILS today: UnknownModelError is not in toResult's guard, so it re-throws;
// dispatch propagates the exception instead of returning { exitCode: 1, ... }.
test("T4a: dispatch create ai-provider with unknown model returns exitCode 1 with 'list model' in stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4a-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    await dispatch(["db", "migrate"], deps);
    const rp = await dispatch(["create", "project", "--name", "t4demo"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    const result = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "bad",
        "--provider",
        "openai-codex",
        "--model",
        "no-such-model-xyz",
      ],
      deps,
    );

    assert.equal(result.exitCode, 1, "unknown model must return exitCode 1");
    assert.ok(
      result.stderr.join("").toLowerCase().includes("list model"),
      `expected 'list model' in stderr, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T4b: Characterization — --allow-unknown-model was never in the parse config;
// strict mode already rejects it. This pinned the pre-existing behavior.
test("T4b: dispatch create ai-provider with --allow-unknown-model returns exitCode 1 (unknown option)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4b-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    await dispatch(["db", "migrate"], deps);
    const rp = await dispatch(["create", "project", "--name", "t4bdemo"], deps);
    const PROJECT = rp.stdout[0]!;

    const result = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "x",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
        "--allow-unknown-model",
      ],
      deps,
    );

    assert.equal(
      result.exitCode,
      1,
      "--allow-unknown-model (unknown flag) must return exitCode 1 from strict parse",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T4c: Characterization — valid pair succeeds end-to-end with real PiModelCatalog.
test("T4c: dispatch create ai-provider with valid pair (openai-codex/gpt-5.6-terra) returns exitCode 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4c-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    await dispatch(["db", "migrate"], deps);
    const rp = await dispatch(["create", "project", "--name", "t4cdemo"], deps);
    const PROJECT = rp.stdout[0]!;

    const result = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "gpt",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
      ],
      deps,
    );

    assert.equal(result.exitCode, 0, "valid model must succeed");
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDeps returns a RouterDeps bundle with all registered capabilities", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-test-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    assert.ok(
      typeof deps === "object" && deps !== null,
      "buildDeps returns an object",
    );
    assert.ok("migrateDb" in deps, "deps.migrateDb present");
    assert.ok("getDbStatus" in deps, "deps.getDbStatus present");
    assert.ok("createProject" in deps, "deps.createProject present");
    assert.ok("renameProject" in deps, "deps.renameProject present");
    assert.ok("getProject" in deps, "deps.getProject present");
    assert.ok("findProject" in deps, "deps.findProject present");
    assert.ok("createInitiative" in deps, "deps.createInitiative present");
    assert.ok("renameInitiative" in deps, "deps.renameInitiative present");
    assert.ok("findInitiative" in deps, "deps.findInitiative present");
    assert.ok("createObjective" in deps, "deps.createObjective present");
    assert.ok("renameObjective" in deps, "deps.renameObjective present");
    assert.ok("findObjective" in deps, "deps.findObjective present");
    assert.ok("addResource" in deps, "deps.addResource present");
    assert.ok("findResource" in deps, "deps.findResource present");
    assert.ok("createTask" in deps, "deps.createTask present");
    assert.ok("addDependency" in deps, "deps.addDependency present");
    assert.ok("removeDependency" in deps, "deps.removeDependency present");
    assert.ok("listTasks" in deps, "deps.listTasks present");
    assert.ok("getResource" in deps, "deps.getResource present");
    // Story 05 T5 characterization: all five update use cases wired by SE in T4 GREEN
    assert.ok("updateAiProvider" in deps, "deps.updateAiProvider present");
    assert.ok("updateCredential" in deps, "deps.updateCredential present");
    assert.ok("updateRepository" in deps, "deps.updateRepository present");
    assert.ok("updateNotification" in deps, "deps.updateNotification present");
    assert.ok("updateFilesystem" in deps, "deps.updateFilesystem present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 02 T1 (F2) — daemon accounting stdout line for agent.finished
// Focused test of the emit callback (the seam buildDaemon wires into the runner).
// Fails today: there is no exported buildEmitCallback, and the inline callback
// has no agent.finished branch, so no `agent finished:` line is emitted.
// ---------------------------------------------------------------------------
test("T1: emit callback prints `agent finished:` line with turns/tokensIn/tokensOut and still appends the event", () => {
  const lines: string[] = [];
  const logger: Logger = {
    info: (m: string) => lines.push(m),
    warn: () => {},
    error: () => {},
  };
  const appended: Event[] = [];
  const events = {
    append: (e: Event) => {
      appended.push(e);
    },
  };

  const emit = buildEmitCallback(logger, events);
  emit("t1", "agent.finished", {
    outcome: "completed",
    turns: "8",
    tokensIn: "1234",
    tokensOut: "567",
  });

  assert.ok(
    lines.includes(
      "task t1: agent finished: turns=8 tokensIn=1234 tokensOut=567",
    ),
    `expected the agent finished line; got: ${JSON.stringify(lines)}`,
  );
  // The event must still be appended to the feed (decoupled from the line).
  assert.equal(appended.length, 1, "exactly one event appended to the feed");
  assert.equal(appended[0]!.type, "agent.finished");
  assert.equal(appended[0]!.taskId, "t1");
});
