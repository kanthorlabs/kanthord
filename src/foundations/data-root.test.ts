import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { statSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { resolveDataRoot, ensureDataRoot } from "./data-root.ts";

describe("src/foundations/data-root.ts", () => {
  describe("resolveDataRoot", () => {
    it("returns process.env.KANTHORD_DATA when set to a non-empty string", () => {
      const saved = process.env["KANTHORD_DATA"];
      try {
        process.env["KANTHORD_DATA"] = "/custom/data/path";
        assert.equal(resolveDataRoot(), "/custom/data/path");
      } finally {
        if (saved === undefined) {
          delete process.env["KANTHORD_DATA"];
        } else {
          process.env["KANTHORD_DATA"] = saved;
        }
      }
    });

    it("returns a path ending in '.kanthord' under homedir when KANTHORD_DATA is unset", () => {
      const saved = process.env["KANTHORD_DATA"];
      try {
        delete process.env["KANTHORD_DATA"];
        const result = resolveDataRoot();
        assert.equal(result, join(homedir(), ".kanthord"));
      } finally {
        if (saved === undefined) {
          delete process.env["KANTHORD_DATA"];
        } else {
          process.env["KANTHORD_DATA"] = saved;
        }
      }
    });
  });

  describe("ensureDataRoot", () => {
    const base = join(tmpdir(), `data-root-test-${Date.now()}`);

    before(() => {
      mkdirSync(base, { recursive: true });
    });

    after(() => {
      rmSync(base, { recursive: true, force: true });
    });

    it("creates the directory with mode 0700 and returns the path", async () => {
      const target = join(base, "fresh-root");
      const result = await ensureDataRoot(target);
      assert.equal(result, target);
      const mode = statSync(target).mode & 0o777;
      assert.equal(mode, 0o700);
    });

    it("is idempotent — second call succeeds without error and returns the path", async () => {
      const target = join(base, "idempotent-root");
      await ensureDataRoot(target);
      const result = await ensureDataRoot(target);
      assert.equal(result, target);
    });
  });
});
