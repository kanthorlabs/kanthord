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

// ---------------------------------------------------------------------------
// Story 03 T2 (F3) — executor-neutral no-change verdict
//
// `genericProfile.verify()` with `finalDiff.hasChanges === false` must no longer
// return the `rejected` / `NO_CHANGES` verdict that the runner maps to `failed`.
// A verified no-change is a legitimate completion, so the profile must surface a
// non-rejected verdict the runner consumes to pick `completed`. (The runner's
// changed/no-change branch is pinned separately in pi.test.ts F3 T2 (b)/(c).)
// ---------------------------------------------------------------------------

test("(F3 T2) genericProfile.verify: no-change is NOT a rejected verdict (NO_CHANGES must not map the runner to failed)", async () => {
  const changed = await genericProfile.verify({
    baseCommit: "baseSHA",
    finalDiff: { files: ["src/x.ts"], hasChanges: true },
    finalResponse: "did work",
  });
  const noChange = await genericProfile.verify({
    baseCommit: "baseSHA",
    finalDiff: { files: [], hasChanges: false },
    finalResponse: "no changes",
  });

  assert.equal(changed.verdict, "accepted", "changed work is accepted");
  assert.notEqual(
    noChange.verdict,
    "rejected",
    "verified no-change must NOT be a rejected verdict (NO_CHANGES currently makes the runner return failed); it must be the accepted/no-change verdict the runner consumes to pick completed",
  );
});
