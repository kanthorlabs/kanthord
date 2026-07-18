/**
 * Story 05 T1 (i) — SDK-goal check for generic@1 profile
 *
 * Asserts that generic@1's createTools output names deep-equal the names
 * returned by createCodingTools() from @earendil-works/pi-coding-agent.
 * No runner needed — tests the profile directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { genericProfile } from "./pi-profile.ts";
import { createCodingTools } from "@earendil-works/pi-coding-agent";

test("generic@1 createTools tool names deep-equal createCodingTools output names (no kanthord-authored tools)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-profile-sdk-"));
  try {
    const fakeWorkspace = {
      dir,
      branch: "kanthord/test",
      baseCommit: "abc123",
    };
    const profileTools = genericProfile.createTools({
      workspace: fakeWorkspace,
    });
    const sdkTools = createCodingTools(dir);

    const profileNames = profileTools.map((t) => t.name).sort();
    const sdkNames = sdkTools.map((t) => t.name).sort();

    assert.deepEqual(
      profileNames,
      sdkNames,
      `generic@1 profile tool names (${profileNames.join(",")}) must deep-equal createCodingTools names (${sdkNames.join(",")})`,
    );
    assert.equal(
      profileTools.length,
      sdkTools.length,
      "same number of tools — no kanthord-authored tools mixed in",
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
