import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlLog, JsonlParseError } from "./jsonl.ts";

describe("src/foundations/jsonl.ts", () => {
  describe("JsonlLog — append and read", () => {
    let tmpDir!: string;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "jsonl-t1-"));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("appends three records and readAll returns them in append order with three newline-terminated lines", async () => {
      const logPath = join(tmpDir, "events.jsonl");
      const log = new JsonlLog(logPath);
      await log.append({ id: 1, kind: "alpha" });
      await log.append({ id: 2, kind: "beta" });
      await log.append({ id: 3, kind: "gamma" });

      const result = await log.readAll();
      assert.deepEqual(result, [
        { id: 1, kind: "alpha" },
        { id: 2, kind: "beta" },
        { id: 3, kind: "gamma" },
      ]);

      const raw = await readFile(logPath, "utf8");
      assert.ok(raw.endsWith("\n"), "file must end with a newline");
      assert.equal(
        (raw.match(/\n/g) ?? []).length,
        3,
        "exactly three newline characters (one per record)",
      );
    });
  });

  describe("JsonlLog — missing file and embedded newline", () => {
    let tmpDir!: string;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "jsonl-t2-"));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("readAll on a non-existent path returns an empty array", async () => {
      const log = new JsonlLog(join(tmpDir, "nonexistent.jsonl"));
      const result = await log.readAll();
      assert.deepEqual(result, []);
    });

    it("appending a record with an embedded newline produces exactly one line and reads back equal", async () => {
      const logPath = join(tmpDir, "embedded.jsonl");
      const log = new JsonlLog(logPath);
      const record = { msg: "line one\nline two", tag: "multi" };
      await log.append(record);

      const raw = await readFile(logPath, "utf8");
      assert.equal(
        (raw.match(/\n/g) ?? []).length,
        1,
        "exactly one newline character — embedded \\n must be JSON-escaped, not raw",
      );

      const result = await log.readAll();
      assert.equal(result.length, 1);
      assert.deepEqual(result[0], record);
    });
  });

  describe("JsonlLog — malformed line", () => {
    let tmpDir!: string;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "jsonl-t3-"));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("throws a JsonlParseError naming the 1-based line number of the corrupt line", async () => {
      const logPath = join(tmpDir, "corrupt.jsonl");
      // Line 1: valid JSON; line 2: invalid JSON
      await writeFile(logPath, '{"id":1,"kind":"valid"}\nNOT_JSON\n', "utf8");

      const log = new JsonlLog(logPath);
      await assert.rejects(
        () => log.readAll(),
        (err: unknown) => {
          assert.ok(err instanceof JsonlParseError, "must be a JsonlParseError");
          assert.equal(
            (err as JsonlParseError).lineNumber,
            2,
            "lineNumber must be the 1-based index of the corrupt line",
          );
          return true;
        },
      );
    });
  });
});
