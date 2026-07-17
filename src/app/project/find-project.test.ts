import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FindProject } from "./find-project.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";
import type { ProjectRepository } from "../../storage/port.ts";

const ULID_A = "01JXTEST00000000000000000A";
const ULID_B = "01JXTEST00000000000000000B";

describe("FindProject", () => {
  test("FindProject one match returns the ULID", async () => {
    const repo = {
      resolveProjectByName(_name: string): string[] {
        return [ULID_A];
      },
    } as unknown as ProjectRepository;
    const uc = new FindProject(repo);
    const id = await uc.execute({ name: "demo" });
    assert.equal(id, ULID_A);
  });

  test("FindProject no match throws UnknownReferenceError", async () => {
    const repo = {
      resolveProjectByName(_name: string): string[] {
        return [];
      },
    } as unknown as ProjectRepository;
    const uc = new FindProject(repo);
    await assert.rejects(
      () => uc.execute({ name: "ghost" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "project");
        assert.ok(err.message.includes("ghost"));
        return true;
      },
    );
  });

  test("FindProject two matches throws AmbiguousNameError with both ids", async () => {
    const IDS = [ULID_A, ULID_B];
    const repo = {
      resolveProjectByName(_name: string): string[] {
        return IDS;
      },
    } as unknown as ProjectRepository;
    const uc = new FindProject(repo);
    await assert.rejects(
      () => uc.execute({ name: "demo" }),
      (err: unknown) => {
        assert.ok(err instanceof AmbiguousNameError);
        assert.deepEqual(err.ids, IDS);
        return true;
      },
    );
  });
});
