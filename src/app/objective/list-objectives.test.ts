import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ListObjectives } from "./list-objectives.ts";
import type { InitiativeRepository } from "../../storage/port.ts";
import type { Objective } from "../../domain/initiative.ts";

const INITIATIVE_ID = "init-1";

const objAlpha: Objective = {
  id: "obj-a",
  initiativeId: INITIATIVE_ID,
  name: "alpha",
};

const objBeta: Objective = {
  id: "obj-b",
  initiativeId: INITIATIVE_ID,
  name: "beta",
};

function makeFakeRepo(call: {
  received?: string;
  results: Objective[];
}): InitiativeRepository {
  return {
    listObjectives(initiativeId: string) {
      call.received = initiativeId;
      return call.results;
    },
  } as unknown as InitiativeRepository;
}

describe("src/app/objective/list-objectives.ts", () => {
  test("execute({ initiativeId }) forwards the scope to InitiativeRepository.listObjectives", () => {
    const call: { received?: string; results: Objective[] } = {
      results: [objAlpha, objBeta],
    };
    const uc = new ListObjectives(makeFakeRepo(call));
    uc.execute({ initiativeId: INITIATIVE_ID });
    assert.equal(call.received, INITIATIVE_ID);
  });

  test("execute({ initiativeId }) with no name returns all rows", () => {
    const call: { results: Objective[] } = { results: [objAlpha, objBeta] };
    const uc = new ListObjectives(makeFakeRepo(call));
    const result = uc.execute({ initiativeId: INITIATIVE_ID });
    assert.deepEqual(result, [objAlpha, objBeta]);
  });

  test("execute({ initiativeId, name: 'alpha' }) returns only the exact match", () => {
    const call: { results: Objective[] } = { results: [objAlpha, objBeta] };
    const uc = new ListObjectives(makeFakeRepo(call));
    const result = uc.execute({ initiativeId: INITIATIVE_ID, name: "alpha" });
    assert.deepEqual(result, [objAlpha]);
  });

  test("execute({ initiativeId, name: 'nope' }) returns [] on a miss", () => {
    const call: { results: Objective[] } = { results: [objAlpha, objBeta] };
    const uc = new ListObjectives(makeFakeRepo(call));
    const result = uc.execute({ initiativeId: INITIATIVE_ID, name: "nope" });
    assert.deepEqual(result, []);
  });
});
