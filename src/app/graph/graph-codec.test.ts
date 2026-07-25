/**
 * RF1 — `parseTask(content, sourcePath?)` unit tests.
 *
 * Asserts that the core codec can parse a single task markdown string to a
 * PkgTask WITHOUT any fs I/O and WITHOUT requiring an initiative file.
 *
 * Also covers `parseGraphPackage(files[])` (pure — no dir walk) and
 * `serializeNode` at the core-codec level.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseTask, parseGraphPackage, serializeNode } from "./graph-codec.ts";
import { GRAPH_FORMAT_VERSION } from "./format.ts";
import type { PkgInitiative, PkgObjective, PkgTask } from "./graph-package.ts";
import { MalformedReferenceError } from "./refs.ts";

// ---------------------------------------------------------------------------
// parseTask — RF1 (single task, string → value)
// ---------------------------------------------------------------------------

describe("src/app/graph/graph-codec.ts — parseTask (RF1)", () => {
  const FULL_TASK_MD = [
    "---",
    "kind: task",
    "ref: my-task",
    "objective: backend",
    "title: implement api",
    "agent: tdd@1",
    "---",
    "# Instructions",
    "Implement POST /oauth/token.",
    "Second instruction line.",
    "# Acceptance Criteria",
    "- [ ] returns 200 for valid creds",
    "- [ ] rejects bad creds with 401",
    "# Verification",
    "```sh",
    "npm test",
    "npm run lint",
    "```",
    "",
  ].join("\n");

  test("parseTask: title field maps correctly from frontmatter", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.strictEqual(task.title, "implement api");
  });

  test("parseTask: agent field maps correctly from frontmatter", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.strictEqual(task.agent, "tdd@1");
  });

  test("parseTask: instructions are extracted from # Instructions body section", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.ok(
      task.instructions.includes("Implement POST /oauth/token."),
      `instructions must include first line; got: ${task.instructions}`,
    );
    assert.ok(
      task.instructions.includes("Second instruction line."),
      `instructions must include second line; got: ${task.instructions}`,
    );
  });

  test("parseTask: ac items extracted from # Acceptance Criteria section", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.deepEqual(task.ac, [
      "returns 200 for valid creds",
      "rejects bad creds with 401",
    ]);
  });

  test("parseTask: verification commands extracted from ```sh fence", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.deepEqual(task.verification, ["npm test", "npm run lint"]);
  });

  test("parseTask: ref field maps correctly from frontmatter", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.strictEqual(task.ref, "my-task");
    assert.strictEqual(task.id, undefined);
  });

  test("parseTask: objectiveRef maps correctly from frontmatter", () => {
    const task = parseTask(FULL_TASK_MD);
    assert.strictEqual(task.objectiveRef, "backend");
  });

  test("parseTask: works with no sourcePath argument (standalone use, no initiative required)", () => {
    // Must not throw; sourcePath should default to empty string or similar
    const task = parseTask(FULL_TASK_MD);
    assert.ok(typeof task.sourcePath === "string");
  });

  test("parseTask: sourcePath argument is stored on the returned PkgTask", () => {
    const task = parseTask(FULL_TASK_MD, "some/path/task.md");
    assert.strictEqual(task.sourcePath, "some/path/task.md");
  });

  test("parseTask: absent # Verification section → verification is undefined", () => {
    const noVerify = [
      "---",
      "kind: task",
      "ref: no-verify",
      "objective: backend",
      "title: no verify task",
      "---",
      "# Instructions",
      "Do something.",
      "# Acceptance Criteria",
      "- [ ] done",
      "",
    ].join("\n");
    const task = parseTask(noVerify);
    assert.strictEqual(task.verification, undefined);
  });

  test("parseTask: agent defaults to generic@1 when absent from frontmatter", () => {
    const noAgent = [
      "---",
      "kind: task",
      "ref: no-agent",
      "objective: backend",
      "title: no agent task",
      "---",
      "",
    ].join("\n");
    const task = parseTask(noAgent);
    assert.strictEqual(task.agent, "generic@1");
  });

  test("parseTask: malformed content (no frontmatter) throws an Error", () => {
    const malformed = "# No frontmatter here\nJust some markdown text.\n";
    assert.throws(
      () => parseTask(malformed),
      Error,
      "content without frontmatter must throw an Error",
    );
  });

  test("parseTask: malformed content with sourcePath cites path in error message", () => {
    const malformed = "# No frontmatter\n";
    let caught: Error | undefined;
    try {
      parseTask(malformed, "bad/task.md");
    } catch (e) {
      caught = e as Error;
    }
    assert.ok(caught, "must throw");
    assert.ok(
      caught.message.includes("bad/task.md"),
      `error message must cite sourcePath; got: ${caught.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// parseGraphPackage — pure files[] variant (RF2)
// ---------------------------------------------------------------------------

describe("src/app/graph/graph-codec.ts — parseGraphPackage (RF2, pure files[])", () => {
  const INIT_MD = [
    "---",
    "kind: initiative",
    "ref: oauth",
    "name: OAuth",
    "---",
    "",
  ].join("\n");

  const OBJ_MD = [
    "---",
    "kind: objective",
    "ref: backend",
    "initiative: oauth",
    "name: Backend",
    "---",
    "",
  ].join("\n");

  const TASK_MD = [
    "---",
    "kind: task",
    "ref: my-task",
    "objective: backend",
    "title: implement api",
    "agent: generic@1",
    "---",
    "# Instructions",
    "Do the work.",
    "# Acceptance Criteria",
    "- [ ] done",
    "",
  ].join("\n");

  test("parseGraphPackage(files[]): parses initiative + objective + task without any fs I/O", () => {
    const pkg = parseGraphPackage([
      { sourcePath: "init.md", content: INIT_MD },
      { sourcePath: "backend/obj.md", content: OBJ_MD },
      { sourcePath: "backend/task.md", content: TASK_MD },
    ]);
    assert.strictEqual(pkg.initiative.ref, "oauth");
    assert.strictEqual(pkg.objectives.length, 1);
    assert.strictEqual(pkg.tasks.length, 1);
    assert.strictEqual(pkg.tasks[0]?.ref, "my-task");
  });

  test("parseGraphPackage(files[]): throws when no initiative file is present", () => {
    assert.throws(
      () =>
        parseGraphPackage([{ sourcePath: "backend/obj.md", content: OBJ_MD }]),
      Error,
      "must throw when no initiative file is found",
    );
  });
});

// ---------------------------------------------------------------------------
// serializeNode — core codec (moved from CLI layer)
// ---------------------------------------------------------------------------

describe("src/app/graph/graph-codec.ts — serializeNode", () => {
  test("serializeNode(initiative) produces canonical frontmatter", () => {
    const out = serializeNode({
      ref: "oauth",
      name: "OAuth",
      sourcePath: "init.md",
      after: [],
    });
    assert.ok(
      out.includes("kind: initiative"),
      "must include kind: initiative",
    );
    assert.ok(out.includes("ref: oauth"), "must include ref: oauth");
    assert.ok(out.includes("name: OAuth"), "must include name");
  });

  test("serializeNode(task) round-trips through parseTask", () => {
    const original = [
      "---",
      "kind: task",
      "ref: rt-task",
      "objective: obj",
      "title: round trip",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Do something.",
      "# Acceptance Criteria",
      "- [ ] done",
      "",
    ].join("\n");
    const task = parseTask(original);
    const serialized = serializeNode(task);
    assert.strictEqual(
      serialized,
      original,
      "round-trip must be byte-identical",
    );
  });
});

// ---------------------------------------------------------------------------
// Story 10 T2 — codec: parse and serialize bindings/context fields (round-trip)
// ---------------------------------------------------------------------------

describe("src/app/graph/graph-codec.ts — Story 10 T2: bindings/context codec round-trip", () => {
  const INIT_WITH_BINDINGS_MD = [
    "---",
    "kind: initiative",
    "ref: todo",
    "name: Todo",
    "bindings:",
    "  source: repository",
    "  model: ai_provider",
    "---",
    "",
  ].join("\n");

  const OBJ_WITH_CONTEXT_MD = [
    "---",
    "kind: objective",
    "ref: api",
    "initiative: todo",
    "name: API",
    "context:",
    "  source: source",
    "  model: model",
    "---",
    "",
  ].join("\n");

  const TASK_WITH_CONTEXT_MD = [
    "---",
    "kind: task",
    "ref: impl",
    "objective: api",
    "title: implement api",
    "agent: generic@1",
    "context:",
    "  model: model",
    "---",
    "# Instructions",
    "Build endpoints.",
    "# Acceptance Criteria",
    "- [ ] endpoints work",
    "",
  ].join("\n");

  const FORMAT1_INIT_MD = [
    "---",
    "kind: initiative",
    "ref: legacy",
    "name: Legacy",
    "---",
    "",
  ].join("\n");

  const FORMAT1_OBJ_MD = [
    "---",
    "kind: objective",
    "ref: obj",
    "initiative: legacy",
    "name: Obj",
    "---",
    "",
  ].join("\n");

  test("(a) parseGraphPackage: initiative bindings field parsed from frontmatter", () => {
    const pkg = parseGraphPackage([
      { sourcePath: "todo.md", content: INIT_WITH_BINDINGS_MD },
      { sourcePath: "api/api.md", content: OBJ_WITH_CONTEXT_MD },
      { sourcePath: "api/impl.md", content: TASK_WITH_CONTEXT_MD },
    ]);
    assert.deepEqual(
      pkg.initiative.bindings,
      { source: "repository", model: "ai_provider" },
      "initiative.bindings must equal parsed frontmatter bindings map",
    );
  });

  test("(b) parseGraphPackage: objective context field parsed from frontmatter", () => {
    const pkg = parseGraphPackage([
      { sourcePath: "todo.md", content: INIT_WITH_BINDINGS_MD },
      { sourcePath: "api/api.md", content: OBJ_WITH_CONTEXT_MD },
      { sourcePath: "api/impl.md", content: TASK_WITH_CONTEXT_MD },
    ]);
    assert.deepEqual(
      pkg.objectives[0]?.context,
      { source: "source", model: "model" },
      "objective.context must equal parsed frontmatter context map",
    );
  });

  test("(c) parseGraphPackage: task context field parsed from frontmatter", () => {
    const pkg = parseGraphPackage([
      { sourcePath: "todo.md", content: INIT_WITH_BINDINGS_MD },
      { sourcePath: "api/api.md", content: OBJ_WITH_CONTEXT_MD },
      { sourcePath: "api/impl.md", content: TASK_WITH_CONTEXT_MD },
    ]);
    assert.deepEqual(
      pkg.tasks[0]?.context,
      { model: "model" },
      "task.context must equal parsed frontmatter context map",
    );
  });

  test("(d) serializeNode: initiative bindings round-trips back through parseGraphPackage without data loss", () => {
    const initiative: PkgInitiative = {
      ref: "todo",
      name: "Todo",
      sourcePath: "todo.md",
      after: [],
      bindings: { source: "repository" },
    };
    const serialized = serializeNode(initiative);
    assert.ok(
      serialized.includes("bindings:"),
      `serialized initiative must include 'bindings:' block; got:\n${serialized}`,
    );
    const reparsed = parseGraphPackage([
      { sourcePath: "todo.md", content: serialized },
    ]);
    assert.deepEqual(
      reparsed.initiative.bindings,
      { source: "repository" },
      "bindings must survive a serialize→parse round-trip without data loss",
    );
  });

  test("(e) format-1 package: initiative.bindings and objective.context are undefined (no regression)", () => {
    // Characterization: format-1 packages land without bindings/context — no regression.
    const pkg = parseGraphPackage([
      { sourcePath: "init.md", content: FORMAT1_INIT_MD },
      { sourcePath: "obj/obj.md", content: FORMAT1_OBJ_MD },
    ]);
    assert.strictEqual(
      pkg.initiative.bindings,
      undefined,
      "format-1 initiative must have bindings === undefined",
    );
    assert.strictEqual(
      pkg.objectives[0]?.context,
      undefined,
      "format-1 objective must have context === undefined",
    );
  });
});

// ---------------------------------------------------------------------------
// Story 10 T1 — GraphPackage DTO bindings/context fields + format version constants
// ---------------------------------------------------------------------------

describe("src/app/graph/graph-codec.ts — Story 10 T1: GraphPackage bindings + format version", () => {
  test("GRAPH_FORMAT_VERSION === 2 (bumped for C1 bindings + context)", () => {
    assert.strictEqual(GRAPH_FORMAT_VERSION, 2);
  });

  test("PkgInitiative accepts bindings field (compile + runtime: field present on object)", () => {
    // TS2353 fires today (bindings absent from PkgInitiative); GREEN once added.
    const _a: PkgInitiative = {
      ref: "test",
      name: "Test",
      sourcePath: "p.md",
      after: [],
      bindings: { source: "repository" },
    };
    assert.deepEqual(_a.bindings, { source: "repository" });
  });

  test("PkgObjective accepts context field (compile + runtime: field present on object)", () => {
    // TS2353 fires today (context absent from PkgObjective); GREEN once added.
    const _b: PkgObjective = {
      ref: "obj",
      initiativeRef: "init",
      name: "Obj",
      sourcePath: "obj.md",
      after: [],
      context: { source: "source" },
    };
    assert.deepEqual(_b.context, { source: "source" });
  });

  test("PkgTask accepts context field (compile + runtime: field present on object)", () => {
    // TS2353 fires today (context absent from PkgTask); GREEN once added.
    const _c: PkgTask = {
      ref: "tsk",
      objectiveRef: "obj",
      title: "T",
      instructions: "",
      ac: [],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "tsk.md",
      context: { model: "model" },
    };
    assert.deepEqual(_c.context, { model: "model" });
  });
});

// ---------------------------------------------------------------------------
// Story 5a — after: in the graph codec (types, parse, serialize)
// ---------------------------------------------------------------------------

describe("src/app/graph/graph-codec.ts — Story 5a: after codec", () => {
  const ULID_A = "01JQVBZ3MHKP4FTGWR5XYSRZ04";
  const ULID_B = "01JQVBZ3MHKP4FTGWR5XYSRZ05";

  test("(1) initiative.md with after: [B, A] parses to after deep-equal ascending-sorted [A, B]", () => {
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      `after: [${ULID_B}, ${ULID_A}]`,
      "---",
      "",
    ].join("\n");
    const pkg = parseGraphPackage([{ sourcePath: "init.md", content: initMd }]);
    assert.deepEqual(pkg.initiative.after, [ULID_A, ULID_B]);
  });

  test("(2) objective.md with block form (after: / - obj-1) parses to ['obj-1']", () => {
    const objMd = [
      "---",
      "kind: objective",
      "ref: obj1",
      "initiative: test",
      "name: Obj1",
      "after:",
      "  - obj-1",
      "---",
      "",
    ].join("\n");
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      "---",
      "",
    ].join("\n");
    const pkg = parseGraphPackage([
      { sourcePath: "init.md", content: initMd },
      { sourcePath: "obj1.md", content: objMd },
    ]);
    const obj = pkg.objectives[0];
    assert.ok(obj, "objective must be parsed");
    assert.deepEqual(obj.after, ["obj-1"]);
  });

  test("(3) initiative.md with no after: key parses to after: []", () => {
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      "---",
      "",
    ].join("\n");
    const pkg = parseGraphPackage([{ sourcePath: "init.md", content: initMd }]);
    assert.deepEqual(pkg.initiative.after, []);
  });

  test("(3b) objective.md with no after: key parses to after: []", () => {
    const objMd = [
      "---",
      "kind: objective",
      "ref: obj1",
      "initiative: test",
      "name: Obj1",
      "---",
      "",
    ].join("\n");
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      "---",
      "",
    ].join("\n");
    const pkg = parseGraphPackage([
      { sourcePath: "init.md", content: initMd },
      { sourcePath: "obj1.md", content: objMd },
    ]);
    assert.deepEqual(pkg.objectives[0]!.after, []);
  });

  test("(4) after: ['  BAD VALUE  '] throws MalformedReferenceError", () => {
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      "after: ['  BAD VALUE  ']",
      "---",
      "",
    ].join("\n");
    assert.throws(
      () => parseGraphPackage([{ sourcePath: "init.md", content: initMd }]),
      MalformedReferenceError,
    );
  });

  test("(5) duplicate entries parse to deduped array", () => {
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      "after: [a, a]",
      "---",
      "",
    ].join("\n");
    const pkg = parseGraphPackage([{ sourcePath: "init.md", content: initMd }]);
    assert.deepEqual(pkg.initiative.after, ["a"]);
  });

  test("(6) serializeInitiative: after: [b,a] emits after: [a, b] after name: and before bindings:", () => {
    const initiative: PkgInitiative = {
      ref: "test",
      name: "Test",
      sourcePath: "init.md",
      bindings: { source: "repo" },
      after: ["b", "a"],
    };
    const out = serializeNode(initiative);
    const nameIdx = out.indexOf("name: Test");
    const afterIdx = out.indexOf("after: [a, b]");
    const bindingsIdx = out.indexOf("bindings:");
    assert.ok(nameIdx >= 0, "name: must be present");
    assert.ok(afterIdx >= 0, "after: line must be present");
    assert.ok(bindingsIdx >= 0, "bindings: must be present");
    assert.ok(afterIdx > nameIdx, "after: must appear after name:");
    assert.ok(bindingsIdx > afterIdx, "bindings: must appear after after:");
  });

  test("(6b) serializeInitiative with after: [] emits no after: line", () => {
    const initiative: PkgInitiative = {
      ref: "test",
      name: "Test",
      sourcePath: "init.md",
      after: [],
    };
    const out = serializeNode(initiative);
    assert.ok(
      !out.includes("after:"),
      "empty after must not produce after: line",
    );
  });

  test("(6c) serializeObjective: after: [b,a] emits after: [a, b] after name: and before context:", () => {
    const objective: PkgObjective = {
      ref: "obj1",
      initiativeRef: "test",
      name: "Obj1",
      sourcePath: "obj.md",
      context: { source: "repo" },
      after: ["b", "a"],
    };
    const out = serializeNode(objective);
    const nameIdx = out.indexOf("name: Obj1");
    const afterIdx = out.indexOf("after: [a, b]");
    const contextIdx = out.indexOf("context:");
    assert.ok(nameIdx >= 0, "name: must be present");
    assert.ok(afterIdx >= 0, "after: line must be present");
    assert.ok(contextIdx >= 0, "context: must be present");
    assert.ok(afterIdx > nameIdx, "after: must appear after name:");
    assert.ok(contextIdx > afterIdx, "context: must appear after after:");
  });

  test("(6d) serializeObjective with after: [] emits no after: line", () => {
    const objective: PkgObjective = {
      ref: "obj1",
      initiativeRef: "test",
      name: "Obj1",
      sourcePath: "obj.md",
      after: [],
    };
    const out = serializeNode(objective);
    assert.ok(
      !out.includes("after:"),
      "empty after must not produce after: line",
    );
  });

  test("(7) round trip: parse → serialize → parse yields identical after for both node kinds", () => {
    // Initiative
    const initMd = [
      "---",
      "kind: initiative",
      "ref: test",
      "name: Test",
      "after: [b, a]",
      "---",
      "",
    ].join("\n");
    const pkg1 = parseGraphPackage([
      { sourcePath: "init.md", content: initMd },
    ]);
    const serialized = serializeNode(pkg1.initiative);
    const pkg2 = parseGraphPackage([
      { sourcePath: "init.md", content: serialized },
    ]);
    assert.deepEqual(pkg2.initiative.after, ["a", "b"]);

    // Objective
    const objMd = [
      "---",
      "kind: objective",
      "ref: obj1",
      "initiative: test",
      "name: Obj1",
      "after: [obj-2, obj-1]",
      "---",
      "",
    ].join("\n");
    const pkg3 = parseGraphPackage([
      { sourcePath: "init.md", content: initMd },
      { sourcePath: "obj1.md", content: objMd },
    ]);
    const serialized2 = serializeNode(pkg3.objectives[0]!);
    const pkg4 = parseGraphPackage([
      { sourcePath: "init.md", content: initMd },
      { sourcePath: "obj1.md", content: serialized2 },
    ]);
    assert.deepEqual(pkg4.objectives[0]!.after, ["obj-1", "obj-2"]);
  });

  test("(8) serializeNode dispatches correctly with after present on both kinds", () => {
    const initOut = serializeNode({
      ref: "test",
      name: "Test",
      sourcePath: "init.md",
      after: ["a"],
    });
    assert.ok(
      initOut.includes("kind: initiative"),
      "initiative serializeNode must include kind: initiative",
    );

    const objOut = serializeNode({
      ref: "obj1",
      initiativeRef: "test",
      name: "Obj1",
      sourcePath: "obj.md",
      after: ["a"],
    });
    assert.ok(
      objOut.includes("kind: objective"),
      "objective serializeNode must include kind: objective",
    );
  });
});
