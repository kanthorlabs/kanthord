import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { compile } from "../compiler/compile.ts";
import { runDeployNode } from "./chain.ts";
import type { HandlerMap } from "./chain.ts";

// ---------------------------------------------------------------------------
// Minimal compilable plan — only needed to seed the plan_deploy_stage DDL.
// The ghost node used in the test is never in this plan's deploy_chain.
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-s3
repo: backend
deploy_chain:
  - stage: staging
    handlers:
      - observer: smoke-check
    success_criteria: "smoke-check:healthy"
    soak_duration: "0s"
---

## Acceptance

S3 regression plan.
`;

const TASK_MD = `---
id: task-s3
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S3
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

// ---------------------------------------------------------------------------
// Suite: S3 regression — runDeployNode must NOT return pass on a missing row
// ---------------------------------------------------------------------------

describe("src/deploy/chain S3 regression — missing plan_deploy_stage row", () => {
  describe("S3 — runDeployNode errors when plan_deploy_stage row is missing for nodeId", () => {
    let featDir = "";
    let testDir = "";
    let store: Store;

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-chain-s3-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-s3.md"), TASK_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-chain-s3-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      await compile(featDir, store, { repoRegistry: ["backend"] });
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("runDeployNode rejects (not pass) when no plan_deploy_stage row exists for nodeId", async () => {
      // "ghost-node-id" was never compiled — it has no row in plan_deploy_stage.
      // A missing row is a data-integrity bug, not a "pass" condition.
      const emptyHandlers: HandlerMap = new Map();
      await assert.rejects(
        () => runDeployNode(store, "ghost-node-id", emptyHandlers, new FakeClock(0)),
        (err: unknown) =>
          err instanceof Error && /ghost-node-id/.test(err.message),
        "runDeployNode must reject with an Error identifying the missing nodeId, not silently return pass",
      );
    });
  });
});
