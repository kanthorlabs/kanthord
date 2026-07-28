/**
 * Story 6 (EPIC 016) — `runGetProjectOverview` handler.
 *
 * Unit tests for the handler: human-readable output (project header,
 * since, activity, initiatives, lanes, decisions), `--json` envelope,
 * the `since: never acknowledged` line, and the unknown-project error
 * path.
 *
 * The use case is faked directly — the handler is the seam under test,
 * and Story 6 has already pinned the use-case contract.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runGetProjectOverview } from "./project.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { GetProjectOverviewOutput } from "../../app/project/get-project-overview.ts";
import type { GetProjectOverview } from "../../app/project/get-project-overview.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ1";
const INIT_A = "01JZZZZZZZZZZZZZZZZZZZINA1";

/**
 * Build a fake `GetProjectOverview` from a static output. The handler
 * only calls `execute({ projectId })`, so the fake is a thin wrapper. The
 * `as unknown as` cast mirrors the Story 4 `runGetInitiativeGraph` test
 * pattern: the handler's parameter is the class-typed use case with
 * private fields, and a structural fake cannot satisfy that class type
 * without `unknown`.
 */
function makeGetProjectOverview(
  output: GetProjectOverviewOutput | "throw-unknown",
): GetProjectOverview {
  return {
    execute: async () => {
      if (output === "throw-unknown") {
        throw new UnknownReferenceError("project", "no-such-id");
      }
      return output;
    },
  } as unknown as GetProjectOverview;
}

const SAMPLE_OUTPUT: GetProjectOverviewOutput = {
  projectId: PROJ_ID,
  initiatives: [
    {
      id: INIT_A,
      name: "alpha",
      status: "building",
      paused: false,
      taskCounts: {
        pending: 1,
        running: 0,
        completed: 0,
        failed: 1,
        awaiting_confirmation: 0,
        discarded: 0,
      },
      needsHuman: 1,
      action: null,
    },
  ],
  lanes: [
    {
      repositoryId: "repo-a",
      objectiveIds: ["obj-1"],
      initiativeIds: [INIT_A],
    },
    { repositoryId: null, objectiveIds: ["obj-2"], initiativeIds: [INIT_A] },
  ],
  decisions: [
    {
      action: {
        kind: "retry",
        target: { type: "task", id: "t-failed" },
        requiresInput: [],
        command: "retry task --id t-failed",
      },
      initiativeId: INIT_A,
      objectiveId: "obj-1",
      taskId: "t-failed",
      downstream: 2,
      actionableSince: 1684771312839,
    },
  ],
  digest: {
    since: null,
    latest: "01H1234567890ABCDEFGHJKMNP",
    totalCount: 12,
    byType: { "task.created": 12 },
    events: [],
    hasMore: false,
    pageCursor: null,
  },
};

describe("runGetProjectOverview", () => {
  test("--json: prints the GetProjectOverviewOutput verbatim as one JSON line", async () => {
    const useCase = makeGetProjectOverview(SAMPLE_OUTPUT);
    const r: HandlerResult = await runGetProjectOverview(
      { project: PROJ_ID, json: true },
      useCase,
    );

    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json prints exactly one line");
    assert.deepEqual(JSON.parse(r.stdout[0]!), SAMPLE_OUTPUT);
    assert.deepEqual(r.stderr, []);
  });

  test("text mode: project / since / activity / initiative / lane / decision lines in the pinned order", async () => {
    const useCase = makeGetProjectOverview(SAMPLE_OUTPUT);
    const r: HandlerResult = await runGetProjectOverview(
      { project: PROJ_ID },
      useCase,
    );

    assert.equal(r.exitCode, 0);
    // First line: project header.
    assert.equal(r.stdout[0]!, `project: ${PROJ_ID}`);
    // Second line: since (null → 'never acknowledged').
    assert.equal(r.stdout[1]!, "since: never acknowledged");
    // Third line: activity (totalCount, with hasMore → ' (showing <n>)').
    assert.equal(r.stdout[2]!, "activity: 12 event(s)");
    // Fourth line: initiative.
    assert.equal(
      r.stdout[3]!,
      `initiative ${INIT_A} alpha [building] paused=false needs-human=1`,
    );
    // Fifth + sixth lines: lanes in source order.
    assert.equal(r.stdout[4]!, "lane repo-a objectives=1");
    assert.equal(r.stdout[5]!, "lane - objectives=1");
    // Seventh line: decision.
    assert.equal(r.stdout[6]!, "decision retry task:t-failed down=2");
  });

  test("text mode: activity line shows '(showing <n>)' when hasMore is true", async () => {
    const output: GetProjectOverviewOutput = {
      ...SAMPLE_OUTPUT,
      digest: {
        ...SAMPLE_OUTPUT.digest,
        totalCount: 120,
        events: SAMPLE_OUTPUT.digest.events,
        hasMore: true,
        pageCursor: null,
      },
    };
    const useCase = makeGetProjectOverview(output);
    const r: HandlerResult = await runGetProjectOverview(
      { project: PROJ_ID },
      useCase,
    );
    assert.equal(r.stdout[2]!, "activity: 120 event(s) (showing 0)");
  });

  test("text mode: since echoes the stored ack cursor", async () => {
    const storedAck = "01H0000000000000000000ABCD";
    const output: GetProjectOverviewOutput = {
      ...SAMPLE_OUTPUT,
      digest: { ...SAMPLE_OUTPUT.digest, since: storedAck },
    };
    const useCase = makeGetProjectOverview(output);
    const r: HandlerResult = await runGetProjectOverview(
      { project: PROJ_ID },
      useCase,
    );
    assert.equal(r.stdout[1]!, `since: ${storedAck}`);
  });

  test("returns exitCode 1 with `no project with id` in stderr and empty stdout for an unknown id", async () => {
    const useCase = makeGetProjectOverview("throw-unknown");
    const r: HandlerResult = await runGetProjectOverview(
      { project: "no-such-id" },
      useCase,
    );

    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.stdout, []);
    assert.ok(
      r.stderr[0]!.includes("no project with id"),
      `stderr[0] must include 'no project with id'; got: ${r.stderr[0]}`,
    );
  });
});
