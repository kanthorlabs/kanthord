import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publishArtifact, consumeArtifact } from "./artifact-gates.ts";
import type { ArtifactRegistry } from "./artifact-gates.ts";

// ---------------------------------------------------------------------------
// suite: src/workflow/artifact-gates
// ---------------------------------------------------------------------------

describe("src/workflow/artifact-gates", () => {
  describe("artifact-gates — publisher records artifact with content hash", () => {
    test("publishArtifact records the artifact with a content hash in the registry", () => {
      const content = "the compiled schema output";
      const expectedHash = createHash("sha256")
        .update(content, "utf8")
        .digest("hex");

      const published: Array<{ artifactId: string; contentHash: string }> = [];
      const registry: Pick<ArtifactRegistry, "publish"> = {
        publish(artifactId: string, contentHash: string) {
          published.push({ artifactId, contentHash });
        },
      };

      const sink = { record(_phase: string, _outcome: string) {} };

      publishArtifact({
        taskId: "publisher-task-1",
        artifactId: "artifact-a",
        content,
        registry,
        sink,
      });

      assert.equal(published.length, 1, "one artifact entry published");
      const entry = published[0];
      assert.ok(entry !== undefined, "publish entry must exist");
      assert.equal(entry.artifactId, "artifact-a", "artifact ID matches");
      assert.equal(
        entry.contentHash,
        expectedHash,
        "content hash is SHA-256 of artifact content",
      );
    });
  });

  describe("artifact-gates — publisher exit gate passed to sink", () => {
    test("publishArtifact writes the artifact published exit gate as passed to the gate-result sink", () => {
      const registry: Pick<ArtifactRegistry, "publish"> = {
        publish() {},
      };

      const records: Array<[string, string]> = [];
      const sink = {
        record(phase: string, outcome: string) {
          records.push([phase, outcome]);
        },
      };

      publishArtifact({
        taskId: "publisher-task-2",
        artifactId: "artifact-b",
        content: "artifact content data",
        registry,
        sink,
      });

      assert.equal(records.length, 1, "one gate result recorded");
      const rec = records[0];
      assert.ok(rec !== undefined, "gate record must exist");
      assert.equal(rec[0], "artifact published", "gate name is 'artifact published'");
      assert.equal(rec[1], "pass", "gate outcome is pass on successful publication");
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Consumer entry gate: consumed only on hash match (frozen / draft_ok)
  // ---------------------------------------------------------------------------

  describe("artifact-gates — frozen consumer entry gate", () => {
    test("frozen consumer entry gate does not pass when artifact is not yet published", () => {
      const registry: ArtifactRegistry = {
        publish() {},
        lookup(_id: string) {
          return undefined;
        },
      };
      const records: Array<[string, string]> = [];
      const sink = {
        record(p: string, o: string) {
          records.push([p, o]);
        },
      };

      consumeArtifact({
        taskId: "consumer-task-1",
        artifactId: "artifact-a",
        expectedHash: "some-hash",
        edgeKind: "frozen",
        registry,
        sink,
      });

      const rec = records[0];
      assert.ok(rec !== undefined, "sink must receive an entry gate record");
      assert.equal(rec[0], "artifact consumed", "gate name is 'artifact consumed'");
      assert.equal(rec[1], "fail", "entry gate does not pass when artifact is absent");
    });

    test("frozen consumer entry gate does not pass when published artifact hash mismatches", () => {
      const registry: ArtifactRegistry = {
        publish() {},
        lookup(_id: string) {
          return { contentHash: "wrong-hash", status: "published" as const };
        },
      };
      const records: Array<[string, string]> = [];
      const sink = {
        record(p: string, o: string) {
          records.push([p, o]);
        },
      };

      consumeArtifact({
        taskId: "consumer-task-2",
        artifactId: "artifact-b",
        expectedHash: "expected-hash",
        edgeKind: "frozen",
        registry,
        sink,
      });

      const rec = records[0];
      assert.ok(rec !== undefined, "sink must receive an entry gate record");
      assert.equal(rec[1], "fail", "entry gate does not pass when hash mismatches");
    });

    test("frozen consumer entry gate passes when artifact is published and hash matches", () => {
      const expectedHash = "correct-hash-abc";
      const registry: ArtifactRegistry = {
        publish() {},
        lookup(_id: string) {
          return { contentHash: expectedHash, status: "published" as const };
        },
      };
      const records: Array<[string, string]> = [];
      const sink = {
        record(p: string, o: string) {
          records.push([p, o]);
        },
      };

      consumeArtifact({
        taskId: "consumer-task-3",
        artifactId: "artifact-c",
        expectedHash,
        edgeKind: "frozen",
        registry,
        sink,
      });

      const rec = records[0];
      assert.ok(rec !== undefined, "sink must receive an entry gate record");
      assert.equal(rec[0], "artifact consumed", "gate name is 'artifact consumed'");
      assert.equal(rec[1], "pass", "entry gate passes when artifact is published and hash matches");
    });
  });

  describe("artifact-gates — draft_ok consumer entry gate", () => {
    test("draft_ok consumer entry gate passes against a draft artifact with matching hash", () => {
      const expectedHash = "draft-hash-xyz";
      const registry: ArtifactRegistry = {
        publish() {},
        lookup(_id: string) {
          return { contentHash: expectedHash, status: "draft" as const };
        },
      };
      const records: Array<[string, string]> = [];
      const sink = {
        record(p: string, o: string) {
          records.push([p, o]);
        },
      };

      consumeArtifact({
        taskId: "consumer-task-4",
        artifactId: "artifact-d",
        expectedHash,
        edgeKind: "draft_ok",
        registry,
        sink,
      });

      const rec = records[0];
      assert.ok(rec !== undefined, "sink must receive an entry gate record");
      assert.equal(rec[0], "artifact consumed", "gate name is 'artifact consumed'");
      assert.equal(rec[1], "pass", "draft_ok consumer passes against a draft artifact with correct hash");
    });
  });

  describe("artifact-gates — scheduler dispatches consumer only after entry gate passes", () => {
    test("scheduler sink receives fail then pass as artifact progresses from absent to published", () => {
      let published = false;
      const contentHash = "artifact-hash-v1";
      const registry: ArtifactRegistry = {
        publish(_id: string, _hash: string) {
          published = true;
        },
        lookup(_id: string) {
          if (!published) return undefined;
          return { contentHash, status: "published" as const };
        },
      };
      const records: Array<[string, string]> = [];
      const sink = {
        record(p: string, o: string) {
          records.push([p, o]);
        },
      };

      // First call: artifact not yet published — scheduler cannot dispatch (fail)
      consumeArtifact({
        taskId: "consumer-task-5",
        artifactId: "art-e",
        expectedHash: contentHash,
        edgeKind: "frozen",
        registry,
        sink,
      });
      const firstRec = records[0];
      assert.ok(firstRec !== undefined, "first sink record must exist");
      assert.equal(
        firstRec[1],
        "fail",
        "scheduler does not dispatch before artifact is published",
      );

      // Artifact is now published by the publisher
      registry.publish("art-e", contentHash);

      // Second call: artifact published with matching hash — scheduler dispatches (pass)
      consumeArtifact({
        taskId: "consumer-task-5",
        artifactId: "art-e",
        expectedHash: contentHash,
        edgeKind: "frozen",
        registry,
        sink,
      });
      const secondRec = records[1];
      assert.ok(secondRec !== undefined, "second sink record must exist");
      assert.equal(
        secondRec[1],
        "pass",
        "scheduler dispatches after artifact is published with matching hash",
      );
    });
  });

  // -------------------------------------------------------------------------
  // S3 regression: publishArtifact and consumeArtifact must await the sink's
  // record() return value when it is async (void | Promise<void>).
  // setTimeout-delayed Promise ensures macrotask-level delay — cannot accidentally
  // pass because of microtask ordering.
  // -------------------------------------------------------------------------

  describe("artifact-gates — publishArtifact awaits async sink (S3 regression)", () => {
    test("publishArtifact awaits async record — result is present after publishArtifact resolves", async () => {
      const registry: Pick<ArtifactRegistry, "publish"> = { publish() {} };
      const records: Array<[string, string]> = [];
      const asyncSink = {
        record(phase: string, outcome: string): Promise<void> {
          return new Promise<void>(resolve => {
            setTimeout(() => {
              records.push([phase, outcome]);
              resolve();
            }, 0);
          });
        },
      };

      await publishArtifact({
        taskId: "pub-async-s3",
        artifactId: "art-s3-pub",
        content: "data",
        registry,
        sink: asyncSink,
      });

      assert.equal(
        records.length,
        1,
        "publishArtifact must await async sink — fails if publishArtifact does not await record()",
      );
    });
  });

  describe("artifact-gates — consumeArtifact awaits async sink (S3 regression)", () => {
    test("consumeArtifact awaits async record — result is present after consumeArtifact resolves", async () => {
      const expectedHash = "s3-hash-con-abc";
      const registry: ArtifactRegistry = {
        publish() {},
        lookup() {
          return { contentHash: expectedHash, status: "published" as const };
        },
      };
      const records: Array<[string, string]> = [];
      const asyncSink = {
        record(phase: string, outcome: string): Promise<void> {
          return new Promise<void>(resolve => {
            setTimeout(() => {
              records.push([phase, outcome]);
              resolve();
            }, 0);
          });
        },
      };

      await consumeArtifact({
        taskId: "con-async-s3",
        artifactId: "art-s3-con",
        expectedHash,
        edgeKind: "frozen",
        registry,
        sink: asyncSink,
      });

      assert.equal(
        records.length,
        1,
        "consumeArtifact must await async sink — fails if consumeArtifact does not await record()",
      );
    });
  });

  // -------------------------------------------------------------------------
  // S4 regression: consumeArtifact must require a registry with lookup so that
  // passing a publish-only registry is a compile-time type error, not a silent
  // runtime always-fail.
  //
  // The @ts-expect-error below is currently UNUSED (lookup is optional →
  // { publish() {} } satisfies ArtifactRegistry today) which is itself a
  // typecheck error: "Unused '@ts-expect-error' directive." → RED via typecheck.
  // Once lookup is required for consume, the expected error is consumed → GREEN.
  // -------------------------------------------------------------------------

  describe("artifact-gates — consumeArtifact requires registry with lookup (S4 regression)", () => {
    test("passing a publish-only registry (no lookup) to consumeArtifact is a type error", async () => {
      // This test is a compile-time assertion only; at runtime consumeArtifact rejects
      // because lookup is absent — await the rejection to prevent unhandledRejection noise.
      await consumeArtifact({
        taskId: "s4-type-check",
        artifactId: "s4-art",
        expectedHash: "s4-hash",
        edgeKind: "frozen" as const,
        // @ts-expect-error — registry without lookup must be rejected by consumeArtifact's type
        registry: { publish(_id: string, _hash: string) {} },
        sink: { record(_p: string, _o: string) {} },
      }).catch(() => {});
    });
  });
});
