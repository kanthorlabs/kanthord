import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Proves the import-boundary rules actually fire (a rule that never fires is
// worthless). Lints a known-illegal fixture (app/ importing a concrete adapter)
// with --no-ignore and asserts eslint fails with the boundary rule id.
const root = join(import.meta.dirname, "..", "..", "..");
const eslintBin = join(root, "node_modules", "eslint", "bin", "eslint.js");
const fixture = "src/app/status/__fixtures__/bad-app-imports-adapter.ts";

test("boundary rule fires on a forbidden app -> adapter import", () => {
  const res = spawnSync(process.execPath, [eslintBin, "--no-ignore", fixture], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(res.status, 0, "eslint must exit non-zero on the illegal import");
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.match(output, /boundaries\/dependencies/, "boundary rule id must appear");
});
