import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FindInitiative } from "./find-initiative.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";
import type { InitiativeRepository } from "../../storage/port.ts";

const PROJECT_ID = "01JXTEST00000000000000000P";
const ULID_A = "01JXTEST00000000000000000A";
const ULID_B = "01JXTEST00000000000000000B";

describe("FindInitiative", () => {
  test("FindInitiative one match returns the ULID", async () => {
    const repo = {
      resolveInitiativeByName(_projectId: string, _name: string): string[] {
        return [ULID_A];
      },
    } as unknown as InitiativeRepository;
    const uc = new FindInitiative(repo);
    const id = await uc.execute({ projectId: PROJECT_ID, name: "oauth" });
    assert.equal(id, ULID_A);
  });

  test("FindInitiative no match throws UnknownReferenceError", async () => {
    const repo = {
      resolveInitiativeByName(_projectId: string, _name: string): string[] {
        return [];
      },
    } as unknown as InitiativeRepository;
    const uc = new FindInitiative(repo);
    await assert.rejects(
      () => uc.execute({ projectId: PROJECT_ID, name: "ghost" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "initiative");
        assert.ok(err.message.includes("ghost"));
        return true;
      },
    );
  });

  test("FindInitiative two matches throws AmbiguousNameError with both ids", async () => {
    const IDS = [ULID_A, ULID_B];
    const repo = {
      resolveInitiativeByName(_projectId: string, _name: string): string[] {
        return IDS;
      },
    } as unknown as InitiativeRepository;
    const uc = new FindInitiative(repo);
    await assert.rejects(
      () => uc.execute({ projectId: PROJECT_ID, name: "oauth" }),
      (err: unknown) => {
        assert.ok(err instanceof AmbiguousNameError);
        assert.deepEqual(err.ids, IDS);
        return true;
      },
    );
  });
});
