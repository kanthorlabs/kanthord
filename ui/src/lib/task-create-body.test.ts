// Story 06 Verify — taskCreateBody: field contract, paused/after omitted, ac/verification order.
import { describe, expect, test } from "vitest";
import { taskCreateBody, EMPTY_TASK_DRAFT } from "./task-create-body";
import type { TaskDraft } from "./task-create-body";

function draft(partial: Partial<TaskDraft>): TaskDraft {
  return { ...EMPTY_TASK_DRAFT, ...partial };
}

describe("taskCreateBody", () => {
  test("a draft with only a title produces exactly {title}", () => {
    const body = taskCreateBody(draft({ title: "Hello" }));
    expect(Object.keys(body)).toEqual(["title"]);
    expect(body.title).toBe("Hello");
  });

  test("title is trimmed", () => {
    const body = taskCreateBody(draft({ title: "  padded  " }));
    expect(body.title).toBe("padded");
  });

  test("paused and after are never produced", () => {
    const body = taskCreateBody(draft({ title: "test" }));
    expect(body).not.toHaveProperty("paused");
    expect(body).not.toHaveProperty("after");
  });

  test("ac preserves the operator's order", () => {
    const body = taskCreateBody(draft({ title: "t", ac: ["a", "b", "c"] }));
    expect(body.ac).toEqual(["a", "b", "c"]);
  });

  test("ac order is preserved after reordering", () => {
    // Simulates ac-down on index 0: ["a","b","c"] → ["b","a","c"]
    const reordered = ["b", "a", "c"];
    const body = taskCreateBody(draft({ title: "t", ac: reordered }));
    expect(body.ac).toEqual(["b", "a", "c"]);
  });

  test("blank-after-trim entries are dropped from ac", () => {
    const body = taskCreateBody(draft({ title: "t", ac: ["a", "  ", "c"] }));
    expect(body.ac).toEqual(["a", "c"]);
  });

  test("all-blank ac omits the key", () => {
    const body = taskCreateBody(draft({ title: "t", ac: ["", "  ", ""] }));
    expect(body).not.toHaveProperty("ac");
  });

  test("verification preserves order and drops blanks", () => {
    const body = taskCreateBody(
      draft({ title: "t", verification: ["x", "  ", "y"] }),
    );
    expect(body.verification).toEqual(["x", "y"]);
  });

  test("all-blank verification omits the key", () => {
    const body = taskCreateBody(draft({ title: "t", verification: ["", ""] }));
    expect(body).not.toHaveProperty("verification");
  });

  test("dependencies are trimmed and blanks dropped", () => {
    const body = taskCreateBody(
      draft({ title: "t", dependencies: ["d1", "  ", "d2"] }),
    );
    expect(body.dependencies).toEqual(["d1", "d2"]);
  });

  test("all-blank dependencies omits the key", () => {
    const body = taskCreateBody(
      draft({ title: "t", dependencies: ["", "  "] }),
    );
    expect(body).not.toHaveProperty("dependencies");
  });

  test("context folds rows in order; blank key is dropped; later key overwrites", () => {
    const body = taskCreateBody(
      draft({
        title: "t",
        context: [
          { key: "a", value: "1" },
          { key: "", value: "x" },
          { key: "a", value: "2" },
        ],
      }),
    );
    expect(body.context).toEqual({ a: "2" });
  });

  test("no rows with a key produces no context key", () => {
    const body = taskCreateBody(
      draft({
        title: "t",
        context: [{ key: "", value: "x" }],
      }),
    );
    expect(body).not.toHaveProperty("context");
  });

  test("instructions is trimmed and omitted when blank", () => {
    const bodyBlank = taskCreateBody(draft({ title: "t", instructions: "  " }));
    expect(bodyBlank).not.toHaveProperty("instructions");

    const bodyFilled = taskCreateBody(
      draft({ title: "t", instructions: " do it " }),
    );
    expect(bodyFilled.instructions).toBe("do it");
  });

  test("agent is trimmed and omitted when blank", () => {
    const bodyBlank = taskCreateBody(draft({ title: "t", agent: "  " }));
    expect(bodyBlank).not.toHaveProperty("agent");

    const bodyFilled = taskCreateBody(draft({ title: "t", agent: " pi " }));
    expect(bodyFilled.agent).toBe("pi");
  });

  test("empty taskCreateBody only omits blank fields", () => {
    const body = taskCreateBody(EMPTY_TASK_DRAFT);
    // Only title (blank → empty string) is present
    expect(Object.keys(body)).toEqual(["title"]);
    expect(body.title).toBe("");
  });
});
