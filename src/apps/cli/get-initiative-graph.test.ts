/**
 * Story 4 — `runGetInitiativeGraph` handler
 *
 * Unit tests for `runGetInitiativeGraph`: human-readable output (initiative
 * header, paused, critical path, group lines, node lines, blocked-forever
 * lines), `--json` envelope, and the unknown-id error path.
 *
 * The use case is faked directly — the handler is the seam under test, and
 * Story 3 has already pinned the use-case contract.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGetInitiativeGraph } from "./initiative.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { GetInitiativeGraphOutput } from "../../app/initiative/get-initiative-graph.ts";
import type { GetInitiativeGraph } from "../../app/initiative/get-initiative-graph.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZGR1";
const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPR1";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";

/**
 * Build a fake `GetInitiativeGraph` from a static output. The handler
 * only calls `execute({ id })`, so the fake is a thin wrapper. The cast
 * is the same pattern used by every other CLI test (e.g.
 * `src/apps/cli/commands/read.test.ts:50-58`): the handler's parameter
 * is the class-typed `GetInitiativeGraph` with private fields, and a
 * structural fake cannot satisfy that class type without `unknown`.
 */
function makeGetInitiativeGraph(
  output: GetInitiativeGraphOutput | "throw-unknown",
): GetInitiativeGraph {
  return {
    execute: async () => {
      if (output === "throw-unknown") {
        throw new UnknownReferenceError("initiative", "no-such-id");
      }
      return output;
    },
  } as unknown as GetInitiativeGraph;
}

const SAMPLE_OUTPUT: GetInitiativeGraphOutput = {
  projectId: PROJ_ID,
  initiative: {
    id: INIT_ID,
    name: "oauth-rollout",
    status: "building",
    paused: false,
    branch: `kanthord/init/${INIT_ID}`,
    action: null,
  },
  groups: [
    {
      id: OBJ_ID,
      name: "auth",
      status: "building",
      repositories: ["repo-a"],
      commitOid: null,
      conflictReason: null,
      after: [],
      waiting: [],
      action: null,
    },
  ],
  nodes: [
    {
      id: "t-root",
      groupId: OBJ_ID,
      title: "root",
      status: "pending",
      dependencyState: "ready",
      executionState: "runnable",
      dependencies: [],
      waiting: [],
      blockedForever: false,
      downstream: 1,
      lastEventId: null,
      lastEventAtMs: null,
      agent: null,
      instructions: null,
      ac: [],
      verificationRequested: [],
      verificationResults: [],
      failureReason: null,
      rejection: null,
      produced: null,
      note: null,
      candidate: null,
      action: null,
    },
    {
      id: "t-blocked",
      groupId: OBJ_ID,
      title: "blocked",
      status: "pending",
      dependencyState: "blocked",
      executionState: "runnable",
      dependencies: ["t-root"],
      waiting: [{ id: "t-root", neverSatisfies: false }],
      blockedForever: false,
      downstream: 0,
      lastEventId: null,
      lastEventAtMs: null,
      agent: null,
      instructions: null,
      ac: [],
      verificationRequested: [],
      verificationResults: [],
      failureReason: null,
      rejection: null,
      produced: null,
      note: null,
      candidate: null,
      action: null,
    },
  ],
  edges: [{ from: "t-root", to: "t-blocked" }],
  criticalPath: {
    metric: "remaining-node-count",
    nodeIds: ["t-root"],
    length: 1,
  },
  counts: {
    pending: 2,
    running: 0,
    completed: 0,
    failed: 0,
    awaiting_confirmation: 0,
    discarded: 0,
    blocked: 1,
    blockedForever: 0,
    actionable: 0,
  },
};

describe("runGetInitiativeGraph", () => {
  test("--json: prints the GetInitiativeGraphOutput verbatim as one JSON line", async () => {
    const useCase = makeGetInitiativeGraph(SAMPLE_OUTPUT);
    const r: HandlerResult = await runGetInitiativeGraph(
      { initiative: INIT_ID, json: true },
      useCase,
    );

    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json prints exactly one line");
    assert.deepEqual(JSON.parse(r.stdout[0]!), SAMPLE_OUTPUT);
    assert.deepEqual(r.stderr, []);
  });

  test("text mode: prints the initiative: line first, one group: line per group and one node: line per node, in source order", async () => {
    const useCase = makeGetInitiativeGraph(SAMPLE_OUTPUT);
    const r: HandlerResult = await runGetInitiativeGraph(
      { initiative: INIT_ID },
      useCase,
    );

    assert.equal(r.exitCode, 0);
    // The first line is the initiative: header.
    const first = r.stdout[0]!;
    assert.ok(
      first.startsWith("initiative:") && first.includes(INIT_ID),
      `first line must start with 'initiative:' and include the id; got: ${first}`,
    );
    // Then a paused: line.
    const pausedIdx = r.stdout.findIndex((l) => l.startsWith("paused:"));
    assert.ok(pausedIdx >= 0, "stdout must have a paused: line");
    assert.equal(pausedIdx, 1, "paused: must be the second line");
    // Then the critical path: line, length present.
    const cpIdx = r.stdout.findIndex((l) => l.startsWith("critical path:"));
    assert.ok(cpIdx >= 0, "stdout must have a critical path: line");
    assert.ok(
      r.stdout[cpIdx]!.includes("1 node"),
      `critical path line must include the count; got: ${r.stdout[cpIdx]}`,
    );
    // One group line per group, in `groups` order.
    const groupIdxs = r.stdout
      .map((l, i) => (l.startsWith("group ") ? i : -1))
      .filter((i) => i >= 0);
    assert.equal(groupIdxs.length, 1, "exactly one group: line");
    // One node line per node, in `nodes` order.
    const nodeIdxs = r.stdout
      .map((l, i) => (l.startsWith("node ") ? i : -1))
      .filter((i) => i >= 0);
    assert.equal(nodeIdxs.length, 2, "exactly two node: lines");
    // group line must come before the first node line.
    assert.ok(
      groupIdxs[0]! < nodeIdxs[0]!,
      "group: lines must come before node: lines",
    );
    // Source order of nodes: t-root then t-blocked.
    assert.ok(r.stdout[nodeIdxs[0]!]!.includes("t-root"));
    assert.ok(r.stdout[nodeIdxs[1]!]!.includes("t-blocked"));
  });

  test("text mode: prints a `blocked forever:` line naming the dead dependency for a blockedForever node", async () => {
    const output: GetInitiativeGraphOutput = {
      ...SAMPLE_OUTPUT,
      nodes: [
        SAMPLE_OUTPUT.nodes[0]!,
        {
          ...SAMPLE_OUTPUT.nodes[1]!,
          id: "t-perm",
          dependencies: ["t-dead"],
          waiting: [{ id: "t-dead", neverSatisfies: true }],
          blockedForever: true,
          action: {
            kind: "remove-dependency",
            target: { type: "task", id: "t-perm" },
            targetDependencyId: "t-dead",
            requiresInput: [],
          },
        },
      ],
      edges: [{ from: "t-dead", to: "t-perm" }],
      criticalPath: {
        metric: "remaining-node-count",
        nodeIds: ["t-dead"],
        length: 1,
      },
      counts: { ...SAMPLE_OUTPUT.counts, blockedForever: 1, blocked: 1 },
    };
    const useCase = makeGetInitiativeGraph(output);
    const r: HandlerResult = await runGetInitiativeGraph(
      { initiative: INIT_ID },
      useCase,
    );

    assert.equal(r.exitCode, 0);
    const blocked = r.stdout.filter((l) => l.startsWith("blocked forever:"));
    assert.equal(blocked.length, 1, "exactly one blocked forever: line");
    assert.ok(
      blocked[0]!.includes("t-perm") && blocked[0]!.includes("t-dead"),
      `blocked forever: line must name the node and the dead dep; got: ${blocked[0]}`,
    );
  });

  test("text mode: prints no `blocked forever:` line when no node is permanently blocked", async () => {
    const useCase = makeGetInitiativeGraph(SAMPLE_OUTPUT);
    const r: HandlerResult = await runGetInitiativeGraph(
      { initiative: INIT_ID },
      useCase,
    );
    assert.equal(r.exitCode, 0);
    const blocked = r.stdout.filter((l) => l.startsWith("blocked forever:"));
    assert.equal(blocked.length, 0, "no blocked forever: line");
  });

  test("text mode: omits the `critical path:` line when criticalPath.length === 0", async () => {
    const output: GetInitiativeGraphOutput = {
      ...SAMPLE_OUTPUT,
      nodes: [],
      edges: [],
      criticalPath: { metric: "remaining-node-count", nodeIds: [], length: 0 },
      counts: {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        awaiting_confirmation: 0,
        discarded: 0,
        blocked: 0,
        blockedForever: 0,
        actionable: 0,
      },
    };
    const useCase = makeGetInitiativeGraph(output);
    const r: HandlerResult = await runGetInitiativeGraph(
      { initiative: INIT_ID },
      useCase,
    );

    assert.equal(r.exitCode, 0);
    const cpLines = r.stdout.filter((l) => l.startsWith("critical path:"));
    assert.equal(cpLines.length, 0, "no critical path: line when length is 0");
  });

  test("returns exitCode 1 with `no initiative with id` in stderr and empty stdout for an unknown id", async () => {
    const useCase = makeGetInitiativeGraph("throw-unknown");
    const r: HandlerResult = await runGetInitiativeGraph(
      { initiative: "no-such-id" },
      useCase,
    );

    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.stdout, []);
    assert.ok(
      r.stderr[0]!.includes("no initiative with id"),
      `stderr[0] must include 'no initiative with id'; got: ${r.stderr[0]}`,
    );
  });
});
