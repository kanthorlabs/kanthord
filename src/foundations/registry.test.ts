import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistryFile, loadRegistryDir, RegistryParseError, RegistryValidationError } from "./registry.ts";

const TEMP_DIR = join(tmpdir(), `registry-test-${process.pid}`);

describe("src/foundations/registry.ts", () => {
  before(async () => {
    await mkdir(TEMP_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEMP_DIR, { recursive: true, force: true });
  });

  describe("loadRegistryDir — directory keyed by id field", () => {
    it("loads two verb yaml files from a dir and returns both entries keyed by their verb field", async () => {
      const dir = join(TEMP_DIR, "dir-test");
      await mkdir(dir, { recursive: true });

      await writeFile(
        join(dir, "compile.yaml"),
        "verb: compile\ntier: 1\ntimeout: 30000\n",
        "utf8",
      );
      await writeFile(
        join(dir, "deploy.yaml"),
        "verb: deploy\ntier: 2\ntimeout: 60000\n",
        "utf8",
      );

      const result = await loadRegistryDir(dir, "verb", []);

      assert.ok("compile" in result, "result must have a 'compile' key");
      assert.ok("deploy" in result, "result must have a 'deploy' key");
      assert.strictEqual(result["compile"]?.["verb"], "compile");
      assert.strictEqual(result["compile"]?.["tier"], 1);
      assert.strictEqual(result["deploy"]?.["verb"], "deploy");
      assert.strictEqual(result["deploy"]?.["tier"], 2);
    });
  });

  describe("loadRegistryFile — missing required key", () => {
    it("throws a RegistryValidationError naming the file and missing key when a required key is absent", async () => {
      const yamlContent = "verb: compile\ntimeout: 30000\n";
      const filePath = join(TEMP_DIR, "missing-key.yaml");
      await writeFile(filePath, yamlContent, "utf8");

      await assert.rejects(
        () => loadRegistryFile(filePath, ["tier"]),
        (err: unknown) => {
          assert.ok(err instanceof RegistryValidationError, "error must be a RegistryValidationError");
          assert.ok(err.message.includes(filePath), "error message must name the file path");
          assert.ok(err.message.includes("tier"), "error message must name the missing key");
          return true;
        },
      );
    });
  });

  describe("loadRegistryFile — malformed YAML is a RegistryParseError (B1 regression)", () => {
    it("rejects with a RegistryParseError whose message names the file path when YAML is malformed", async () => {
      // Characterization test: registry.ts already implements this correctly.
      // Sensitivity: asserts both instanceof RegistryParseError (would fail if a
      // plain Error were thrown) and path substring (would fail if path were dropped
      // from the message).
      const filePath = join(TEMP_DIR, "malformed.yaml");
      await writeFile(filePath, ": bad: [yaml", "utf8");

      await assert.rejects(
        () => loadRegistryFile(filePath, []),
        (err: unknown) => {
          assert.ok(
            err instanceof RegistryParseError,
            "error must be a RegistryParseError, not a plain Error",
          );
          assert.ok(
            err.message.includes(filePath),
            "error message must name the file path",
          );
          return true;
        },
      );
    });
  });

  describe("loadRegistryFile — null/scalar YAML is a RegistryParseError (S2 regression)", () => {
    it("rejects with a RegistryParseError (not a TypeError) when the YAML file is scalar or empty", async () => {
      // Regression for S2: before the SE's null-guard, parseYaml("~") returned null
      // and the requiredKeys `in` check threw an untyped TypeError. The guard now
      // catches null/scalar results and throws RegistryParseError instead.
      const filePath = join(TEMP_DIR, "scalar.yaml");
      await writeFile(filePath, "~", "utf8");

      await assert.rejects(
        () => loadRegistryFile(filePath, ["verb"]),
        (err: unknown) => {
          assert.ok(
            err instanceof RegistryParseError,
            "error must be a RegistryParseError, not an untyped TypeError",
          );
          assert.ok(
            err.message.includes(filePath),
            "error message must name the file path",
          );
          return true;
        },
      );
    });
  });

  describe("loadRegistryFile — well-formed registry", () => {
    it("loads a verb-registry yaml and returns typed fields with correct values", async () => {
      const yamlContent =
        "verb: compile\n" +
        "tier: 1\n" +
        "timeout: 30000\n" +
        "idempotency: at-least-once\n" +
        "retry:\n" +
        "  max: 3\n" +
        "  backoff: exponential\n";

      const filePath = join(TEMP_DIR, "compile.yaml");
      await writeFile(filePath, yamlContent, "utf8");

      const entry = await loadRegistryFile(filePath, []);

      assert.strictEqual(entry["verb"], "compile");
      assert.strictEqual(entry["tier"], 1);
      assert.strictEqual(entry["timeout"], 30000);
      assert.strictEqual(entry["idempotency"], "at-least-once");
      const retry = entry["retry"] as Record<string, unknown>;
      assert.ok(retry !== undefined && retry !== null, "retry field must be present");
      assert.strictEqual(retry["max"], 3);
      assert.strictEqual(retry["backoff"], "exponential");
    });
  });
});
