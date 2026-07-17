import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runFindProject,
  runFindInitiative,
  runFindObjective,
  runFindResource,
} from "./find.ts";
import type {
  ProjectRepository,
  InitiativeRepository,
} from "../../storage/port.ts";
import { FindProject } from "../../app/project/find-project.ts";
import { FindInitiative } from "../../app/initiative/find-initiative.ts";
import { FindObjective } from "../../app/objective/find-objective.ts";
import { FindResource } from "../../app/resource/find-resource.ts";

const PROJECT_ID = "01JXTEST00000000000000000P";
const INITIATIVE_ID = "01JXTEST00000000000000000I";
const ULID_A = "01JXTEST00000000000000000A";
const ULID_B = "01JXTEST00000000000000000B";

describe("runFindProject", () => {
  test("runFindProject one match returns exitCode 0 stdout [ulid]", async () => {
    const repo = {
      resolveProjectByName(_name: string): string[] {
        return [ULID_A];
      },
    } as unknown as ProjectRepository;
    const result = await runFindProject(
      { name: "demo" },
      new FindProject(repo),
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, [ULID_A]);
    assert.equal(result.stderr.length, 0);
  });

  test("runFindProject ambiguous name returns exit 1 with both ids in error line", async () => {
    const IDS = [ULID_A, ULID_B];
    const repo = {
      resolveProjectByName(_name: string): string[] {
        return IDS;
      },
    } as unknown as ProjectRepository;
    const result = await runFindProject(
      { name: "demo" },
      new FindProject(repo),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected error: prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes(ULID_A),
      `expected ${ULID_A} in error line`,
    );
    assert.ok(
      result.stderr[0]!.includes(ULID_B),
      `expected ${ULID_B} in error line`,
    );
    assert.equal(result.stdout.length, 0);
  });

  test("runFindProject unknown name returns exit 1 with one-line error on stderr", async () => {
    const repo = {
      resolveProjectByName(_name: string): string[] {
        return [];
      },
    } as unknown as ProjectRepository;
    const result = await runFindProject(
      { name: "ghost" },
      new FindProject(repo),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected error: prefix, got: ${result.stderr[0]}`,
    );
    assert.equal(result.stdout.length, 0);
  });
});

describe("runFindInitiative", () => {
  test("runFindInitiative one match with scoped projectId returns exitCode 0 stdout [ulid]", async () => {
    const repo = {
      resolveInitiativeByName(_projectId: string, _name: string): string[] {
        return [ULID_A];
      },
    } as unknown as InitiativeRepository;
    const result = await runFindInitiative(
      { project: PROJECT_ID, name: "oauth" },
      new FindInitiative(repo),
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, [ULID_A]);
    assert.equal(result.stderr.length, 0);
  });
});

describe("runFindObjective", () => {
  test("runFindObjective one match with scoped initiativeId returns exitCode 0 stdout [ulid]", async () => {
    const repo = {
      resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
        return [ULID_A];
      },
    } as unknown as InitiativeRepository;
    const result = await runFindObjective(
      { initiative: INITIATIVE_ID, name: "backend" },
      new FindObjective(repo),
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, [ULID_A]);
    assert.equal(result.stderr.length, 0);
  });
});

describe("runFindResource", () => {
  test("runFindResource one match with scoped projectId returns exitCode 0 stdout [ulid]", async () => {
    const repo = {
      resolveResourceByName(_projectId: string, _name: string): string[] {
        return [ULID_A];
      },
    } as unknown as ProjectRepository;
    const result = await runFindResource(
      { project: PROJECT_ID, name: "backend" },
      new FindResource(repo),
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, [ULID_A]);
    assert.equal(result.stderr.length, 0);
  });
});
