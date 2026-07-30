// src/apps/http/views/graph-package.test.ts — Story S7: the graph-package
// view (`graphPackageView`) round-trips every field a client needs to POST
// the same document back to `POST /api/initiative/:id/graph`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphPackageView } from "./graph-package.ts";
import type { GraphPackage } from "../../../app/graph/graph-package.ts";

function fixture(): GraphPackage {
  return {
    packageId: "pkg-1",
    formatVersion: 3,
    initiative: {
      id: "i1",
      ref: "init-ref",
      name: "Initiative",
      sourcePath: "initiative.md",
      after: ["a1", "a2"],
      bindings: { source: "r1" },
    },
    objectives: [
      {
        id: "o1",
        ref: "obj-ref",
        initiativeRef: "init-ref",
        name: "Objective",
        sourcePath: "objective.md",
        after: ["b1"],
        context: { source: "r1" },
      },
    ],
    tasks: [
      {
        id: "t1",
        ref: "task-ref",
        objectiveRef: "obj-ref",
        title: "Task",
        instructions: "do it",
        ac: ["ac1"],
        agent: "generic@1",
        verification: ["v1"],
        dependencies: ["t0"],
        sourcePath: "task.md",
        context: { source: "r1" },
      },
    ],
    manifest: {
      initiativeId: "i1",
      packageId: "pkg-1",
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: { i1: "sha-i1" },
      files: ["initiative.md"],
      objectiveIds: ["o1"],
      refToId: { objectives: { "obj-ref": "o1" }, tasks: { "task-ref": "t1" } },
    },
  };
}

test("graphPackageView top-level key set is exactly the declared list, extra field dropped", () => {
  const withExtra = { ...fixture(), extra: "nope" } as unknown as GraphPackage;
  const view = graphPackageView(withExtra);
  assert.deepEqual(Object.keys(view).sort(), [
    "formatVersion",
    "initiative",
    "manifest",
    "objectives",
    "packageId",
    "tasks",
  ]);
});

test("graphPackageView with manifest absent omits the manifest key entirely", () => {
  const pkg = fixture();
  delete pkg.manifest;
  const view = graphPackageView(pkg);
  assert.deepEqual(Object.keys(view).sort(), [
    "formatVersion",
    "initiative",
    "objectives",
    "packageId",
    "tasks",
  ]);
  assert.ok(!("manifest" in view));
});

test("pkgInitiativeView key set is exactly the declared list, extra field dropped", () => {
  const pkg = fixture();
  pkg.initiative = {
    ...pkg.initiative,
    extra: "nope",
  } as unknown as typeof pkg.initiative;
  const view = graphPackageView(pkg);
  assert.deepEqual(Object.keys(view.initiative).sort(), [
    "after",
    "bindings",
    "id",
    "name",
    "ref",
    "sourcePath",
  ]);
  assert.deepEqual(view.initiative.after, ["a1", "a2"]);
  assert.notEqual(view.initiative.after, pkg.initiative.after);
  assert.deepEqual(view.initiative.bindings, { source: "r1" });
});

test("pkgObjectiveView key set is exactly the declared list, extra field dropped", () => {
  const pkg = fixture();
  pkg.objectives = [
    {
      ...pkg.objectives[0]!,
      extra: "nope",
    } as unknown as (typeof pkg.objectives)[0],
  ];
  const view = graphPackageView(pkg);
  assert.deepEqual(Object.keys(view.objectives[0]!).sort(), [
    "after",
    "context",
    "id",
    "initiativeRef",
    "name",
    "ref",
    "sourcePath",
  ]);
  assert.deepEqual(view.objectives[0]!.after, ["b1"]);
  assert.notEqual(view.objectives[0]!.after, pkg.objectives[0]!.after);
});

test("pkgTaskView key set is exactly the declared list, extra field dropped", () => {
  const pkg = fixture();
  pkg.tasks = [
    { ...pkg.tasks[0]!, extra: "nope" } as unknown as (typeof pkg.tasks)[0],
  ];
  const view = graphPackageView(pkg);
  assert.deepEqual(Object.keys(view.tasks[0]!).sort(), [
    "ac",
    "agent",
    "context",
    "dependencies",
    "id",
    "instructions",
    "objectiveRef",
    "ref",
    "sourcePath",
    "title",
    "verification",
  ]);
  assert.deepEqual(view.tasks[0]!.ac, ["ac1"]);
  assert.notEqual(view.tasks[0]!.ac, pkg.tasks[0]!.ac);
  assert.deepEqual(view.tasks[0]!.dependencies, ["t0"]);
  assert.notEqual(view.tasks[0]!.dependencies, pkg.tasks[0]!.dependencies);
});

test("exportManifestView key set is exactly the declared list, extra field dropped", () => {
  const pkg = fixture();
  pkg.manifest = {
    ...pkg.manifest!,
    extra: "nope",
  } as unknown as typeof pkg.manifest;
  const view = graphPackageView(pkg);
  assert.deepEqual(Object.keys(view.manifest!).sort(), [
    "digestAlgorithm",
    "files",
    "formatVersion",
    "initiativeId",
    "nodes",
    "objectiveIds",
    "packageId",
    "refToId",
  ]);
  assert.deepEqual(Object.keys(view.manifest!.refToId).sort(), [
    "objectives",
    "tasks",
  ]);
  assert.notEqual(view.manifest!.nodes, pkg.manifest!.nodes);
  assert.notEqual(view.manifest!.files, pkg.manifest!.files);
  assert.notEqual(view.manifest!.objectiveIds, pkg.manifest!.objectiveIds);
});

test("verification: undefined stays undefined and disappears through JSON round trip", () => {
  const pkg = fixture();
  pkg.tasks[0]!.verification = undefined;
  const view = graphPackageView(pkg);
  assert.ok("verification" in view.tasks[0]!);
  assert.equal(view.tasks[0]!.verification, undefined);
  const roundTripped = JSON.parse(JSON.stringify(view));
  assert.equal(roundTripped.tasks[0].verification, undefined);
  assert.ok(!("verification" in roundTripped.tasks[0]));
});

test("verification: null survives as null", () => {
  const pkg = fixture();
  pkg.tasks[0]!.verification = null;
  const view = graphPackageView(pkg);
  assert.equal(view.tasks[0]!.verification, null);
});

test("verification: [] survives as an empty array, a different reference", () => {
  const pkg = fixture();
  const original: string[] = [];
  pkg.tasks[0]!.verification = original;
  const view = graphPackageView(pkg);
  assert.deepEqual(view.tasks[0]!.verification, []);
  assert.notEqual(view.tasks[0]!.verification, original);
});
