import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ListInitiatives } from "./list-initiatives.ts";
import type { InitiativeRepository } from "../../storage/port.ts";
import type { Initiative } from "../../domain/initiative.ts";

const PROJECT_ID = "proj-1";

const initAlpha: Initiative = {
  id: "init-a",
  projectId: PROJECT_ID,
  name: "alpha",
  paused: false,
};

const initBeta: Initiative = {
  id: "init-b",
  projectId: PROJECT_ID,
  name: "beta",
  paused: false,
};

function makeFakeRepo(call: {
  received?: string;
  results: Initiative[];
}): InitiativeRepository {
  return {
    listInitiatives(projectId: string) {
      call.received = projectId;
      return call.results;
    },
  } as unknown as InitiativeRepository;
}

describe("src/app/initiative/list-initiatives.ts", () => {
  test("execute({ projectId }) forwards the scope to InitiativeRepository.listInitiatives", () => {
    const call: { received?: string; results: Initiative[] } = {
      results: [initAlpha, initBeta],
    };
    const uc = new ListInitiatives(makeFakeRepo(call));
    uc.execute({ projectId: PROJECT_ID });
    assert.equal(call.received, PROJECT_ID);
  });

  test("execute({ projectId }) with no name returns all rows", () => {
    const call: { results: Initiative[] } = { results: [initAlpha, initBeta] };
    const uc = new ListInitiatives(makeFakeRepo(call));
    const result = uc.execute({ projectId: PROJECT_ID });
    assert.deepEqual(result, [initAlpha, initBeta]);
  });

  test("execute({ projectId, name: 'alpha' }) returns only the exact match", () => {
    const call: { results: Initiative[] } = { results: [initAlpha, initBeta] };
    const uc = new ListInitiatives(makeFakeRepo(call));
    const result = uc.execute({ projectId: PROJECT_ID, name: "alpha" });
    assert.deepEqual(result, [initAlpha]);
  });

  test("execute({ projectId, name: 'nope' }) returns [] on a miss", () => {
    const call: { results: Initiative[] } = { results: [initAlpha, initBeta] };
    const uc = new ListInitiatives(makeFakeRepo(call));
    const result = uc.execute({ projectId: PROJECT_ID, name: "nope" });
    assert.deepEqual(result, []);
  });
});
