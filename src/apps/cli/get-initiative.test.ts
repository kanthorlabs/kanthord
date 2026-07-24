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
      status: "awaiting_pr",
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
      status: "awaiting_pr",
      workspace: "/tmp/kanthord-init-clone",
    });
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
