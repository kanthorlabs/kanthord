import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FindObjective } from "./find-objective.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";
import type { InitiativeRepository } from "../../storage/port.ts";

const INITIATIVE_ID = "01JXTEST00000000000000000I";
const ULID_A = "01JXTEST00000000000000000A";
const ULID_B = "01JXTEST00000000000000000B";

describe("FindObjective", () => {
  test("FindObjective one match returns the ULID", async () => {
    const repo = {
      resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
        return [ULID_A];
      },
    } as unknown as InitiativeRepository;
    const uc = new FindObjective(repo);
    const id = await uc.execute({
      initiativeId: INITIATIVE_ID,
      name: "backend",
    });
    assert.equal(id, ULID_A);
  });

  test("FindObjective no match throws UnknownReferenceError", async () => {
    const repo = {
      resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
        return [];
      },
    } as unknown as InitiativeRepository;
    const uc = new FindObjective(repo);
    await assert.rejects(
      () => uc.execute({ initiativeId: INITIATIVE_ID, name: "ghost" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "objective");
        assert.ok(err.message.includes("ghost"));
        return true;
      },
    );
  });

  test("FindObjective two matches throws AmbiguousNameError with both ids", async () => {
    const IDS = [ULID_A, ULID_B];
    const repo = {
      resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
        return IDS;
      },
    } as unknown as InitiativeRepository;
    const uc = new FindObjective(repo);
    await assert.rejects(
      () => uc.execute({ initiativeId: INITIATIVE_ID, name: "backend" }),
      (err: unknown) => {
        assert.ok(err instanceof AmbiguousNameError);
        assert.deepEqual(err.ids, IDS);
        return true;
      },
    );
  });
});
