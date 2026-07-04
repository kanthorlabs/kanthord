import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { crossCheck, CrossCheckError } from "./crosscheck.ts";

describe("src/compiler/crosscheck", () => {
  describe("crossCheck — unique ids", () => {
    test("duplicate id → CrossCheckError naming both files and the id", () => {
      assert.throws(
        () =>
          crossCheck([
            {
              id: "t-payment",
              file: "001-payment.md",
              outputs: ["payment-api"],
              depends_on: [],
            },
            {
              id: "t-payment",
              file: "002-payment-copy.md",
              outputs: [],
              depends_on: [],
            },
          ]),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("t-payment"),
            `expected message to name the id "t-payment", got: ${msg}`,
          );
          assert.ok(
            msg.includes("001-payment.md"),
            `expected message to name "001-payment.md", got: ${msg}`,
          );
          assert.ok(
            msg.includes("002-payment-copy.md"),
            `expected message to name "002-payment-copy.md", got: ${msg}`,
          );
          return true;
        },
      );
    });
  });

  describe("crossCheck — depends_on resolution", () => {
    test("depends_on references a non-existent task → CrossCheckError naming consumer file and missing task id", () => {
      assert.throws(
        () =>
          crossCheck([
            {
              id: "t-consumer",
              file: "002-consumer.md",
              outputs: [],
              depends_on: [
                { task: "t-missing", output: "api", semantics: "frozen" },
              ],
            },
          ]),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("002-consumer.md"),
            `expected message to name "002-consumer.md", got: ${msg}`,
          );
          assert.ok(
            msg.includes("t-missing"),
            `expected message to name "t-missing", got: ${msg}`,
          );
          return true;
        },
      );
    });

    test("depends_on references existing task lacking the named output → CrossCheckError naming consumer file and missing output", () => {
      assert.throws(
        () =>
          crossCheck([
            {
              id: "t-producer",
              file: "001-producer.md",
              outputs: ["db-schema"],
              depends_on: [],
            },
            {
              id: "t-consumer",
              file: "002-consumer.md",
              outputs: [],
              depends_on: [
                {
                  task: "t-producer",
                  output: "payment-api",
                  semantics: "frozen",
                },
              ],
            },
          ]),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("002-consumer.md"),
            `expected message to name "002-consumer.md", got: ${msg}`,
          );
          assert.ok(
            msg.includes("payment-api"),
            `expected message to name "payment-api", got: ${msg}`,
          );
          return true;
        },
      );
    });
  });

  describe("crossCheck — structural docs", () => {
    test("story dir without INDEX.md → CrossCheckError naming the dir", () => {
      assert.throws(
        () =>
          crossCheck([], {
            storyDirs: [{ name: "001-story-alpha", hasIndex: false }],
            hasRunbook: true,
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("001-story-alpha"),
            `expected dir name in message, got: ${msg}`,
          );
          return true;
        },
      );
    });

    test("feature without RUNBOOK.md → CrossCheckError naming the doc", () => {
      assert.throws(
        () =>
          crossCheck([], {
            storyDirs: [],
            hasRunbook: false,
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("RUNBOOK.md"),
            `expected "RUNBOOK.md" in message, got: ${msg}`,
          );
          return true;
        },
      );
    });
  });

  describe("crossCheck — body/frontmatter cross-check", () => {
    test("frontmatter output id with no matching body section → CrossCheckError naming file and output id", () => {
      assert.throws(
        () =>
          crossCheck(
            [
              {
                id: "t-payment",
                file: "001-payment.md",
                outputs: ["payment-api"],
                bodySectionIds: [],
                depends_on: [],
              },
            ],
            { storyDirs: [], hasRunbook: true },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("001-payment.md"),
            `expected file in message, got: ${msg}`,
          );
          assert.ok(
            msg.includes("payment-api"),
            `expected output id in message, got: ${msg}`,
          );
          return true;
        },
      );
    });

    test("body section id not declared in frontmatter → CrossCheckError naming file and section id", () => {
      assert.throws(
        () =>
          crossCheck(
            [
              {
                id: "t-payment",
                file: "001-payment.md",
                outputs: [],
                bodySectionIds: ["undeclared-section"],
                depends_on: [],
              },
            ],
            { storyDirs: [], hasRunbook: true },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("001-payment.md"),
            `expected file in message, got: ${msg}`,
          );
          assert.ok(
            msg.includes("undeclared-section"),
            `expected section id in message, got: ${msg}`,
          );
          return true;
        },
      );
    });
  });

  describe("crossCheck — depends_on semantics validation", () => {
    test("depends_on.semantics 'maybe' → CrossCheckError naming consumer file and bad value", () => {
      assert.throws(
        () =>
          crossCheck(
            [
              {
                id: "t-producer",
                file: "001-producer.md",
                outputs: ["api"],
                bodySectionIds: ["api"],
                depends_on: [],
              },
              {
                id: "t-consumer",
                file: "002-consumer.md",
                outputs: [],
                bodySectionIds: [],
                depends_on: [
                  { task: "t-producer", output: "api", semantics: "maybe" },
                ],
              },
            ],
            { storyDirs: [], hasRunbook: true },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof CrossCheckError,
            `expected CrossCheckError, got ${String(err)}`,
          );
          const msg = (err as CrossCheckError).message;
          assert.ok(
            msg.includes("002-consumer.md"),
            `expected consumer file in message, got: ${msg}`,
          );
          assert.ok(
            msg.includes("maybe"),
            `expected bad value in message, got: ${msg}`,
          );
          return true;
        },
      );
    });
  });
});
