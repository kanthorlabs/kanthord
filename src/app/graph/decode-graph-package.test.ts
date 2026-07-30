// src/app/graph/decode-graph-package.test.ts — Story S3: validating an
// already-parsed JSON graph package (NOT markdown), the trust-boundary
// closer for CreateGraph/ApplyGraph over HTTP.
//
// Moved from graph-codec.document.test.ts (review blocker A3): the server
// validator now lives in its own module, decode-graph-package.ts, not in
// graph-codec.ts (the client-side markdown codec).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGraphPackageDocument,
  GraphPackageDocumentError,
} from "./decode-graph-package.ts";

function validPkg(): Record<string, unknown> {
  return {
    packageId: "PKG1",
    formatVersion: 1,
    initiative: {
      ref: "init",
      name: "Initiative",
      sourcePath: "init.md",
      id: "INIT_ID",
      after: ["x"],
      bindings: { source: "repo-alias" },
    },
    objectives: [
      {
        ref: "obj1",
        initiativeRef: "init",
        name: "Objective",
        sourcePath: "obj1/obj1.md",
        id: "OBJ_ID",
        after: ["y"],
        context: { key: "value" },
      },
    ],
    tasks: [
      {
        ref: "task1",
        objectiveRef: "obj1",
        title: "Do it",
        instructions: "instructions",
        agent: "generic@1",
        sourcePath: "obj1/do-it.md",
        ac: ["ok"],
        dependencies: [],
        id: "TASK_ID",
        verification: ["cmd"],
        context: { key: "value" },
      },
    ],
    manifest: {
      initiativeId: "INIT_ID",
      packageId: "PKG1",
      formatVersion: 1,
      digestAlgorithm: "sha256",
      nodes: { INIT_ID: "sha" },
      refToId: { objectives: { obj1: "OBJ_ID" }, tasks: { task1: "TASK_ID" } },
      files: ["INIT_ID"],
      objectiveIds: ["OBJ_ID"],
    },
  };
}

test("021 S3: a full valid package round-trips — same object reference is returned", () => {
  const pkg = validPkg();
  const out = parseGraphPackageDocument(pkg);
  assert.equal(
    out,
    pkg,
    "the validator returns the SAME object, not a rebuild",
  );
});

test("021 S3: a minimal valid package (empty objectives/tasks, no manifest) passes", () => {
  const pkg: Record<string, unknown> = {
    packageId: "PKG1",
    formatVersion: 1,
    initiative: { ref: "init", name: "Initiative", sourcePath: "init.md" },
    objectives: [],
    tasks: [],
  };
  const out = parseGraphPackageDocument(pkg);
  assert.equal(out, pkg);
});

function rejects(value: unknown, expectedField: string) {
  assert.throws(
    () => parseGraphPackageDocument(value),
    (err: unknown) => {
      if (!(err instanceof GraphPackageDocumentError)) {
        return false;
      }
      assert.equal(err.field, expectedField);
      return true;
    },
  );
}

test("021 S3: {} rejects at field 'pkg'", () => {
  rejects({}, "pkg");
});

test("021 S3: null rejects at field 'pkg'", () => {
  rejects(null, "pkg");
});

test("021 S3: an array rejects at field 'pkg'", () => {
  rejects([], "pkg");
});

test("021 review-blocker S1: a missing packageId is optional and passes unmodified", () => {
  // Review blocker S1: project.graph.create mints its own packageId via
  // deps.newId() and discards the client's, and the CLI parser
  // (import-graph.ts) emits packageId: "" for create-mode packages that have
  // no .kanthord-export.json yet. The document validator must not require a
  // non-empty packageId — it is optional (ApplyGraph reads the manifest, not
  // the top-level packageId, for anything load-bearing).
  const pkg = validPkg();
  delete pkg["packageId"];
  const out = parseGraphPackageDocument(pkg);
  assert.equal(
    out,
    pkg,
    "the validator returns the SAME object, not a rebuild",
  );
});

test("021 review-blocker S1: an empty-string packageId (the CLI's create-mode output) passes unmodified", () => {
  const pkg = validPkg();
  pkg["packageId"] = "";
  const out = parseGraphPackageDocument(pkg);
  assert.equal(out, pkg);
});

test("021 review-blocker S1: a non-string packageId still rejects at field 'packageId'", () => {
  const pkg = validPkg();
  pkg["packageId"] = 12345;
  rejects(pkg, "packageId");
});

test("021 S3: a string formatVersion rejects at field 'formatVersion'", () => {
  const pkg = validPkg();
  pkg["formatVersion"] = "1";
  rejects(pkg, "formatVersion");
});

test("021 S3: a missing initiative rejects at field 'initiative'", () => {
  const pkg = validPkg();
  delete pkg["initiative"];
  rejects(pkg, "initiative");
});

test("021 S3: initiative.ref === '' rejects at field 'initiative.ref'", () => {
  const pkg = validPkg();
  (pkg["initiative"] as Record<string, unknown>)["ref"] = "";
  rejects(pkg, "initiative.ref");
});

test("021 S3: objectives a string rejects at field 'objectives'", () => {
  const pkg = validPkg();
  pkg["objectives"] = "nope";
  rejects(pkg, "objectives");
});

test("021 S3: objectives[0] a number rejects at field 'objectives[0]'", () => {
  const pkg = validPkg();
  pkg["objectives"] = [42];
  rejects(pkg, "objectives[0]");
});

test("021 S3: tasks[1].title missing rejects at field 'tasks[1].title'", () => {
  const pkg = validPkg();
  const task0 = (pkg["tasks"] as Record<string, unknown>[])[0]!;
  const task1: Record<string, unknown> = { ...task0 };
  delete task1["title"];
  pkg["tasks"] = [task0, task1];
  rejects(pkg, "tasks[1].title");
});

test("021 S3: tasks[0].ac a string rejects at field 'tasks[0].ac'", () => {
  const pkg = validPkg();
  (pkg["tasks"] as Record<string, unknown>[])[0]!["ac"] = "nope";
  rejects(pkg, "tasks[0].ac");
});

test("021 S3: tasks[0].dependencies missing rejects at field 'tasks[0].dependencies'", () => {
  const pkg = validPkg();
  delete (pkg["tasks"] as Record<string, unknown>[])[0]!["dependencies"];
  rejects(pkg, "tasks[0].dependencies");
});

test("021 S3: tasks[0].after is not a validated field and is ignored", () => {
  const pkg = validPkg();
  (pkg["tasks"] as Record<string, unknown>[])[0]!["after"] = 12345; // garbage, not validated
  const out = parseGraphPackageDocument(pkg);
  assert.equal(out, pkg);
});

test("021 S3: manifest.digestAlgorithm === 'md5' rejects at field 'manifest.digestAlgorithm'", () => {
  const pkg = validPkg();
  (pkg["manifest"] as Record<string, unknown>)["digestAlgorithm"] = "md5";
  rejects(pkg, "manifest.digestAlgorithm");
});

test("021 S3: manifest.refToId missing a tasks key rejects at field 'manifest.refToId'", () => {
  const pkg = validPkg();
  const manifest = pkg["manifest"] as Record<string, unknown>;
  manifest["refToId"] = { objectives: {} };
  rejects(pkg, "manifest.refToId");
});

test("021 S3: tasks[0].verification absent, null, and an array all pass; a scalar is rejected", () => {
  const absentPkg = validPkg();
  delete (absentPkg["tasks"] as Record<string, unknown>[])[0]!["verification"];
  assert.equal(parseGraphPackageDocument(absentPkg), absentPkg);

  const nullPkg = validPkg();
  (nullPkg["tasks"] as Record<string, unknown>[])[0]!["verification"] = null;
  assert.equal(parseGraphPackageDocument(nullPkg), nullPkg);

  const arrayPkg = validPkg();
  (arrayPkg["tasks"] as Record<string, unknown>[])[0]!["verification"] = [
    "cmd",
  ];
  assert.equal(parseGraphPackageDocument(arrayPkg), arrayPkg);

  const scalarPkg = validPkg();
  (scalarPkg["tasks"] as Record<string, unknown>[])[0]!["verification"] = "cmd";
  rejects(scalarPkg, "tasks[0].verification");
});

test("021 S3: an unknown extra top-level field passes and survives on the returned object", () => {
  // Review blocker S4b narrows parseGraphPackageDocument's return type to
  // plain GraphPackage (no index signature), so this no longer casts the
  // RETURN value to read the unrecognised key. It instead proves identity
  // (out === pkg, the SAME object) and then reads "extra" off the original
  // `pkg` reference, whose static type is Record<string, unknown> — the
  // input, not the narrowed return type, carries the index signature.
  const pkg = validPkg();
  pkg["extra"] = "unrecognised-but-fine";
  const out = parseGraphPackageDocument(pkg);
  assert.equal(out, pkg);
  assert.equal(pkg["extra"], "unrecognised-but-fine");
});

test("021 review-blocker S4b: parseGraphPackageDocument's return type is narrowed to GraphPackage — no bare index access", () => {
  // Review blocker S4: the declared return type must narrow from
  // `GraphPackage & Record<string, unknown>` back to plain `GraphPackage`
  // (Story S3 §3). `GraphPackage` (src/app/graph/graph-package.ts) carries no
  // index signature, so accessing an unrecognised key without a cast must be
  // a TYPE ERROR once narrowed — today the `& Record<string, unknown>` still
  // allows it, so the `@ts-expect-error` below is unused (a tsc failure).
  const pkg = validPkg();
  pkg["extra"] = "unrecognised-but-fine";
  const out = parseGraphPackageDocument(pkg);
  // @ts-expect-error "extra" is not a key of GraphPackage — this directive is
  // unused (and so a tsc error) until S4b narrows the return type.
  const extra = out.extra;
  assert.equal(extra, "unrecognised-but-fine");
});

test("021 review-blocker S4a: a document missing exactly one of the five required top-level keys reports that key's own field name, never 'pkg'", () => {
  // Review blocker S4: the `.some(...)` pre-check is being replaced by "a
  // direct shape gate over the five required top-level keys" — this must NOT
  // regress the pre-existing contract that a document missing exactly one
  // required field reports THAT field's own name (only a document shaped
  // like nothing at all — {}, null, [], or an object with none of the five
  // keys — reports "pkg"). Characterizes already-shipped behavior (passes
  // today) as a guard against an over-eager "require all five up front"
  // refactor, which would wrongly report "pkg" for each of these.
  // `packageId` is excluded — review blocker S1 makes it optional, so its own
  // "missing" case no longer rejects at all (covered by a dedicated S1 test).
  for (const key of ["formatVersion", "initiative", "objectives", "tasks"]) {
    const pkg = validPkg();
    delete pkg[key];
    rejects(pkg, key);
  }
});

test("021 review-blocker S4a: an object with none of the five recognised top-level keys reports field 'pkg'", () => {
  rejects({ foo: "bar", baz: 1 }, "pkg");
});
