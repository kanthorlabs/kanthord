/**
 * Story 05 T1 (l) — renderTaskPrompt renderer tests
 *
 * Pure, vendor-neutral renderer over Task spec:
 *   - includes title, instructions, each ac item
 *   - with verification field → includes ## Verification section + each command
 *   - without verification field → no ## Verification section
 * No pi imports, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTaskPrompt } from "./task-prompt.ts";
import type { Task } from "../domain/task.ts";

const BASE_TASK: Task = {
  id: "task-001",
  objectiveId: "obj-001",
  title: "Add a feature",
  status: "pending",
  dependencies: [],
  agent: "generic@1",
  instructions: "Implement the feature carefully and write tests",
  ac: ["Feature works end to end", "All tests pass"],
};

test("renderTaskPrompt includes title, instructions, and each ac item", () => {
  const result = renderTaskPrompt(BASE_TASK);
  assert.ok(result.includes("Add a feature"), "title present");
  assert.ok(
    result.includes("Implement the feature carefully and write tests"),
    "instructions present",
  );
  assert.ok(
    result.includes("Feature works end to end"),
    "first ac item present",
  );
  assert.ok(result.includes("All tests pass"), "second ac item present");
});

test("renderTaskPrompt with verification includes ## Verification section listing each command", () => {
  const task: Task = {
    ...BASE_TASK,
    verification: ["npm test", "npm run lint"],
  };
  const result = renderTaskPrompt(task);
  assert.ok(result.includes("## Verification"), "Verification section present");
  assert.ok(result.includes("npm test"), "first verification command present");
  assert.ok(
    result.includes("npm run lint"),
    "second verification command present",
  );
});

test("renderTaskPrompt without verification has no ## Verification section", () => {
  const result = renderTaskPrompt(BASE_TASK);
  assert.ok(
    !result.includes("## Verification"),
    "no Verification section when absent",
  );
});
