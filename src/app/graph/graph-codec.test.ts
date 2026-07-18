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
