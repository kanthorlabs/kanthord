/**
 * Story F — `get initiative` CLI handler
 *
 * Unit tests for `runGetInitiative`: human-readable output (id/name/status,
 * workspace only when provisioned), `--json` envelope, and the unknown-id
 * error path.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGetInitiative } from "./initiative.ts";
import { GetInitiative } from "../../app/initiative/get-initiative.ts";
import type { Initiative } from "../../domain/initiative.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI1";

interface FakeInitiativeSource {
  get(id: string): Initiative | undefined;
}

class MemInitiativeSource implements FakeInitiativeSource {
  readonly #initiatives: Map<string, Initiative>;
  constructor(initiatives: Initiative[]) {
    this.#initiatives = new Map(initiatives.map((i) => [i.id, i]));
  }
  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }
}

function makeGetInitiative(initiative: Initiative | undefined): GetInitiative {
  return new GetInitiative(
    new MemInitiativeSource(initiative !== undefined ? [initiative] : []),
  );
}

describe("runGetInitiative", () => {
  test("human output: prints id, name, status, and workspace lines for a provisioned initiative", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "proj-1",
      name: "oauth-rollout",
      paused: false,
      status: "building",
      workspace: "/tmp/kanthord-init-clone",
    };
    const getInitiative = makeGetInitiative(initiative);

    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID },
      getInitiative,
    );

    assert.equal(r.exitCode, 0, "exit 0 on success");
    assert.ok(
      r.stdout.some((l) => l.startsWith("id:") && l.includes(INIT_ID)),
      "stdout must have id: line",
    );
    assert.ok(
      r.stdout.some(
        (l) => l.startsWith("name:") && l.includes("oauth-rollout"),
      ),
      "stdout must have name: line",
    );
    assert.ok(
      r.stdout.some((l) => l.startsWith("status:") && l.includes("building")),
      "stdout must have status: line",
    );
    assert.ok(
      r.stdout.some(
        (l) =>
          l.startsWith("branch:") && l.includes(`kanthord/init/${INIT_ID}`),
      ),
      "stdout must have branch: line with the publishable init branch",
    );
    assert.ok(
      r.stdout.some(
        (l) =>
          l.startsWith("workspace:") && l.includes("/tmp/kanthord-init-clone"),
      ),
      "stdout must have workspace: line with the clone dir",
    );
  });

  test("human output: omits the workspace line for an unprovisioned initiative", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "proj-1",
      name: "not-yet-provisioned",
      paused: false,
      status: "building",
    };
    const getInitiative = makeGetInitiative(initiative);

    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID },
      getInitiative,
    );

    assert.equal(r.exitCode, 0);
    assert.ok(
      !r.stdout.some((l) => l.startsWith("workspace:")),
      "no workspace: line when the initiative was never provisioned",
    );
  });

  test("--json: prints the GetInitiativeOutput verbatim as one JSON line", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "proj-1",
      name: "oauth-rollout",
      paused: false,
      status: "building",
      workspace: "/tmp/kanthord-init-clone",
    };
    const getInitiative = makeGetInitiative(initiative);

    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID, json: true },
      getInitiative,
    );

    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json prints exactly one line");
    const parsed = JSON.parse(r.stdout[0]!);
    assert.deepEqual(parsed, {
      id: INIT_ID,
      name: "oauth-rollout",
      status: "building",
      paused: false,
      branch: `kanthord/init/${INIT_ID}`,
      workspace: "/tmp/kanthord-init-clone",
      after: [],
      waiting: [],
    });
  });

  test("(S2-3) --json: paused initiative reports paused: true with status 'building' (two axes independent)", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "proj-1",
      name: "deferred",
      paused: true,
      status: "building",
    };
    const getInitiative = makeGetInitiative(initiative);

    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID, json: true },
      getInitiative,
    );

    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1);
    const parsed = JSON.parse(r.stdout[0]!);
    assert.equal(parsed.paused, true, "JSON must include paused: true");
    assert.equal(
      parsed.status,
      "building",
      "status stays orthogonal to paused",
    );
  });

  test("(S2-4) --json: unpaused initiative reports paused: false with status 'building'", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "proj-1",
      name: "active",
      paused: false,
      status: "building",
    };
    const getInitiative = makeGetInitiative(initiative);

    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID, json: true },
      getInitiative,
    );

    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.stdout[0]!);
    assert.equal(parsed.paused, false, "JSON must include paused: false");
    assert.equal(parsed.status, "building");
  });

  test("(S2-5) human output: line list is byte-identical regardless of paused (JSON only — paused does not add a human line)", async () => {
    const base: Omit<Initiative, "paused"> = {
      id: INIT_ID,
      projectId: "proj-1",
      name: "test",
      status: "building",
    };
    const active: Initiative = { ...base, paused: false };
    const paused: Initiative = { ...base, paused: true };

    const rActive = await runGetInitiative(
      { id: INIT_ID },
      makeGetInitiative(active),
    );
    const rPaused = await runGetInitiative(
      { id: INIT_ID },
      makeGetInitiative(paused),
    );

    assert.deepEqual(
      rActive.stdout,
      rPaused.stdout,
      "human stdout must be identical — paused does not render a line",
    );
    assert.equal(rActive.exitCode, 0);
    assert.equal(rPaused.exitCode, 0);
  });

  test("returns exitCode 1 with an error line for an unknown id", async () => {
    const getInitiative = makeGetInitiative(undefined);

    const r: HandlerResult = await runGetInitiative(
      { id: "no-such-id" },
      getInitiative,
    );

    assert.equal(r.exitCode, 1);
    assert.equal(r.stdout.length, 0);
    assert.ok(
      r.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${r.stderr[0]}`,
    );
  });
});

// Story 6 — after / waiting rendering
const S6_X = "01JZZZZZZZZZZZZZZZZZZZX001";
const S6_Y = "01JZZZZZZZZZZZZZZZZZZZY002";

describe("runGetInitiative Story 6 — after/waiting rendering", () => {
  test("(S6-6) after: [] → no after: or waiting on: line", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "p1",
      name: "test",
      paused: false,
      status: "building",
    };
    const getInitiative = makeGetInitiative(initiative);
    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID },
      getInitiative,
    );
    assert.equal(r.exitCode, 0);
    assert.ok(
      !r.stdout.some((l) => l.startsWith("after:")),
      "no after: line when empty",
    );
    assert.ok(
      !r.stdout.some((l) => l.startsWith("waiting on:")),
      "no waiting on: line when empty",
    );
  });

  test("(S6-7) after: [X] with X building → stdout has after: X and waiting on: X before branch:", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "p1",
      name: "test",
      paused: false,
      status: "building",
    };
    const other: Initiative = {
      id: S6_X,
      projectId: "p1",
      name: "other",
      paused: false,
      status: "building",
    };
    const source = new MemInitiativeSource([initiative, other]);
    const sequencing = { listInitiativeAfter: () => [S6_X] };
    const getInitiative = new GetInitiative(source, sequencing);
    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID },
      getInitiative,
    );
    assert.equal(r.exitCode, 0);
    const afterIdx = r.stdout.findIndex((l) => l.startsWith("after:"));
    const waitIdx = r.stdout.findIndex((l) => l.startsWith("waiting on:"));
    const branchIdx = r.stdout.findIndex((l) => l.startsWith("branch:"));
    assert.ok(afterIdx >= 0, "stdout must have after: line");
    assert.ok(waitIdx >= 0, "stdout must have waiting on: line");
    assert.ok(afterIdx < branchIdx, "after: must appear before branch:");
  });

  test("(S6-8) after: [X] with X discarded → stdout has waiting on: X (discarded — will never satisfy)", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "p1",
      name: "test",
      paused: false,
      status: "building",
    };
    const other: Initiative = {
      id: S6_X,
      projectId: "p1",
      name: "other",
      paused: false,
      status: "discarded",
    };
    const source = new MemInitiativeSource([initiative, other]);
    const sequencing = { listInitiativeAfter: () => [S6_X] };
    const getInitiative = new GetInitiative(source, sequencing);
    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID },
      getInitiative,
    );
    assert.equal(r.exitCode, 0);
    assert.ok(
      r.stdout.some((l) => l.includes("(discarded — will never satisfy)")),
      "discarded warning must be in output",
    );
  });

  test("(S6-9) after: [A, B] → stdout has after: A B (space-joined)", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "p1",
      name: "test",
      paused: false,
      status: "building",
    };
    const a: Initiative = {
      id: S6_Y,
      projectId: "p1",
      name: "A",
      paused: false,
      status: "landed",
    };
    const b: Initiative = {
      id: S6_X,
      projectId: "p1",
      name: "B",
      paused: false,
      status: "landed",
    };
    const source = new MemInitiativeSource([initiative, a, b]);
    const sequencing = { listInitiativeAfter: () => [S6_Y, S6_X] };
    const getInitiative = new GetInitiative(source, sequencing);
    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID },
      getInitiative,
    );
    assert.equal(r.exitCode, 0);
    assert.ok(
      r.stdout.some(
        (l) => l.startsWith("after:") && l.includes(S6_Y) && l.includes(S6_X),
      ),
      "after: line must contain both ids space-joined",
    );
  });

  test("(S6-10) --json: parsed stdout has after and waiting matching the DTO", async () => {
    const initiative: Initiative = {
      id: INIT_ID,
      projectId: "p1",
      name: "test",
      paused: false,
      status: "building",
    };
    const other: Initiative = {
      id: S6_X,
      projectId: "p1",
      name: "other",
      paused: false,
      status: "building",
    };
    const source = new MemInitiativeSource([initiative, other]);
    const sequencing = { listInitiativeAfter: () => [S6_X] };
    const getInitiative = new GetInitiative(source, sequencing);
    const r: HandlerResult = await runGetInitiative(
      { id: INIT_ID, json: true },
      getInitiative,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json prints exactly one line");
    const parsed = JSON.parse(r.stdout[0]!);
    assert.deepEqual(parsed.after, [S6_X]);
    assert.deepEqual(parsed.waiting, [{ id: S6_X, neverSatisfies: false }]);
  });
});
