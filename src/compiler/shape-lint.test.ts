import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { shapeLint } from "./shape-lint.ts";

function fullSections(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    Prerequisites: "some prereqs",
    Inputs: "some inputs",
    Outputs: "some outputs",
    Tests: "some tests",
  };
  return { ...base, ...overrides };
}

describe("src/compiler/shape-lint", () => {
  describe("shapeLint — required body sections", () => {
    test("task missing required body section ## Tests → error naming task and section", () => {
      const sections = fullSections();
      delete (sections as Record<string, string>)["Tests"];
      const result = shapeLint({
        epic: { id: "001-my-epic", sections: { Acceptance: "non-empty" } },
        stories: [
          {
            id: "001-story-a",
            tasks: [
              {
                id: "001-task-a",
                workflow: "tdd@1",
                sections,
              },
            ],
          },
        ],
      });
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find(
        (e) => e.message.includes("001-task-a") && e.message.includes("Tests"),
      );
      assert.ok(
        match !== undefined,
        `expected an error naming "001-task-a" and "Tests", got: ${JSON.stringify(errors)}`,
      );
    });

    test("task with empty required body section ## Inputs → error naming task and section", () => {
      const result = shapeLint({
        epic: { id: "001-my-epic", sections: { Acceptance: "non-empty" } },
        stories: [
          {
            id: "001-story-a",
            tasks: [
              {
                id: "001-task-b",
                workflow: "tdd@1",
                sections: fullSections({ Inputs: "" }),
              },
            ],
          },
        ],
      });
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find(
        (e) => e.message.includes("001-task-b") && e.message.includes("Inputs"),
      );
      assert.ok(
        match !== undefined,
        `expected an error naming "001-task-b" and "Inputs", got: ${JSON.stringify(errors)}`,
      );
    });
  });

  describe("shapeLint — workflow pin", () => {
    test("task workflow: custom@1 → error naming task", () => {
      const result = shapeLint({
        epic: { id: "001-my-epic", sections: { Acceptance: "non-empty" } },
        stories: [
          {
            id: "001-story-a",
            tasks: [
              {
                id: "001-task-c",
                workflow: "custom@1",
                sections: fullSections(),
              },
            ],
          },
        ],
      });
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find((e) => e.message.includes("001-task-c"));
      assert.ok(
        match !== undefined,
        `expected an error naming "001-task-c", got: ${JSON.stringify(errors)}`,
      );
    });
  });

  describe("shapeLint — epic Acceptance section", () => {
    test("epic missing ## Acceptance section → error naming the epic", () => {
      const result = shapeLint({
        epic: { id: "001-my-epic", sections: {} },
        stories: [
          {
            id: "001-story-a",
            tasks: [
              {
                id: "001-task-d",
                workflow: "tdd@1",
                sections: fullSections(),
              },
            ],
          },
        ],
      });
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find((e) => e.message.includes("001-my-epic"));
      assert.ok(
        match !== undefined,
        `expected an error naming "001-my-epic", got: ${JSON.stringify(errors)}`,
      );
    });
  });

  describe("shapeLint — lane disjointness", () => {
    test("two 003.1/003.2 tasks with overlapping write_scope → error naming both lanes and the path", () => {
      // Casts through unknown: major, lane, write_scope are new fields the SE will add.
      const result = shapeLint({
        epic: { id: "003-my-epic", sections: { Acceptance: "non-empty" } },
        stories: [
          {
            id: "003.1-story-alpha",
            major: 3,
            lane: 1,
            tasks: [
              {
                id: "003.1-task-foo",
                workflow: "tdd@1",
                sections: fullSections(),
                write_scope: ["lib/shared/"],
              },
            ],
          },
          {
            id: "003.2-story-beta",
            major: 3,
            lane: 2,
            tasks: [
              {
                id: "003.2-task-bar",
                workflow: "tdd@1",
                sections: fullSections(),
                write_scope: ["lib/shared/utils/"],
              },
            ],
          },
        ],
      } as unknown as Parameters<typeof shapeLint>[0]);
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find(
        (e) =>
          e.message.includes("003.1") &&
          e.message.includes("003.2") &&
          e.message.includes("lib/shared"),
      );
      assert.ok(
        match !== undefined,
        `expected an error naming "003.1", "003.2", and "lib/shared", got: ${JSON.stringify(errors)}`,
      );
    });
  });

  describe("shapeLint — orphan artifact warning", () => {
    test("artifact output never consumed and not pr/deploy → warning, not error", () => {
      // Casts through unknown: artifacts_out and consumed_artifact_ids are new fields the SE will add.
      const result = shapeLint({
        epic: { id: "001-my-epic", sections: { Acceptance: "non-empty" } },
        stories: [
          {
            id: "001-story-a",
            major: 1,
            tasks: [
              {
                id: "001-task-a",
                workflow: "tdd@1",
                sections: fullSections(),
                artifacts_out: [{ id: "patch-v1", kind: "patch" }],
              },
            ],
          },
        ],
        consumed_artifact_ids: [],
      } as unknown as Parameters<typeof shapeLint>[0]);
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      const warnings = result.diagnostics.filter((d) => d.kind === "warning");
      assert.strictEqual(errors.length, 0, `expected no errors, got: ${JSON.stringify(errors)}`);
      assert.ok(warnings.length > 0, "expected at least one warning diagnostic");
      const match = warnings.find((w) => w.message.includes("patch-v1"));
      assert.ok(
        match !== undefined,
        `expected a warning naming "patch-v1", got: ${JSON.stringify(warnings)}`,
      );
    });
  });

  describe("shapeLint — minimum structure", () => {
    test("story with no tasks → error naming the story", () => {
      // Casts through unknown: major is a new field the SE will add.
      const result = shapeLint({
        epic: { id: "001-my-epic", sections: { Acceptance: "non-empty" } },
        stories: [
          {
            id: "001-story-empty",
            major: 1,
            tasks: [],
          },
        ],
      } as unknown as Parameters<typeof shapeLint>[0]);
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find((e) => e.message.includes("001-story-empty"));
      assert.ok(
        match !== undefined,
        `expected an error naming "001-story-empty", got: ${JSON.stringify(errors)}`,
      );
    });
  });

  // S2 — characterization test: empty-string Acceptance is already guarded in code;
  // this test pins that the "" case (not just missing key) produces an error.
  describe("shapeLint — epic Acceptance section (empty string)", () => {
    test("epic with sections: { Acceptance: '' } → error naming the epic", () => {
      const result = shapeLint({
        epic: { id: "s2-my-epic", sections: { Acceptance: "" } },
        stories: [
          {
            id: "s2-story-a",
            tasks: [{ id: "s2-task-a", workflow: "tdd@1", sections: fullSections() }],
          },
        ],
      });
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(errors.length > 0, "expected at least one error diagnostic");
      const match = errors.find((e) => e.message.includes("s2-my-epic"));
      assert.ok(
        match !== undefined,
        `expected error naming "s2-my-epic", got: ${JSON.stringify(errors)}`,
      );
    });
  });

  // B6 — stories: [] must be a lint error; current code has no guard for zero stories.
  describe("shapeLint — minimum structure (zero stories)", () => {
    test("stories: [] → error for feature with no stories", () => {
      const result = shapeLint({
        epic: { id: "b6-epic", sections: { Acceptance: "all done" } },
        stories: [],
      });
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(
        errors.length > 0,
        `expected at least one error for zero stories, got: ${JSON.stringify(result.diagnostics)}`,
      );
      // Error should identify the feature (epic or vocabulary about zero stories)
      const match = errors.find(
        (e) => e.message.includes("b6-epic") || e.message.toLowerCase().includes("stor"),
      );
      assert.ok(
        match !== undefined,
        `expected error about zero stories, got: ${JSON.stringify(errors)}`,
      );
    });
  });

  // B7 — parallel-lane handoff (dependency path connecting two same-major parallel lanes).
  // ShapeNodeTree.edges does not exist yet; this test writes against the intended API.
  describe("shapeLint — lane disjointness (dependency path via edges)", () => {
    test("same-major parallel-lane handoff edge → error naming both lane labels", () => {
      const result = shapeLint({
        epic: { id: "b7-epic", sections: { Acceptance: "all done" } },
        stories: [
          {
            id: "007.1-story-p1",
            major: 7,
            lane: 1,
            tasks: [
              { id: "007.1-task-p1", workflow: "tdd@1", sections: fullSections() },
            ],
          },
          {
            id: "007.2-story-p2",
            major: 7,
            lane: 2,
            tasks: [
              { id: "007.2-task-p2", workflow: "tdd@1", sections: fullSections() },
            ],
          },
        ],
        // edges field does not exist on ShapeNodeTree yet — SE adds it when fixing B7
        edges: [{ from: "007.1-task-p1", to: "007.2-task-p2" }],
      } as unknown as Parameters<typeof shapeLint>[0]);
      const errors = result.diagnostics.filter((d) => d.kind === "error");
      assert.ok(
        errors.length > 0,
        `expected at least one error for cross-lane dependency, got: ${JSON.stringify(result.diagnostics)}`,
      );
      const match = errors.find(
        (e) => e.message.includes("007.1") && e.message.includes("007.2"),
      );
      assert.ok(
        match !== undefined,
        `expected error naming both lane labels "007.1" and "007.2", got: ${JSON.stringify(errors)}`,
      );
    });
  });
});

