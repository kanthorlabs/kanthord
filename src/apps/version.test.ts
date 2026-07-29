/**
 * Story 01 — one version constant.
 *
 * `packageVersion` (src/apps/version.ts) must equal the `version` field read
 * directly from package.json, and must look like a semver string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { packageVersion } from "./version.ts";

test("packageVersion equals the version field in package.json", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(packageVersion, pkg.version);
});

test("packageVersion matches semver shape", () => {
  assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
});
