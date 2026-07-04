import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEdges, coreLint, CoreLintError } from "./edges.ts";
import type { EdgeInputNode, Edge, LintNode } from "./edges.ts";

describe("src/compiler/edges", () => {
  describe("buildEdges — grammar edges + explicit handoff edges", () => {
    it("grammar edges: group 002 ← group 001 (both lanes), 004 ← 002 (gap skipped); lane siblings no grammar edge; explicit handoff edge with semantics present", () => {
      // Fixture: groups 001 (two parallel lanes), 002, 004 (gap — no 003)
      // Plus one task pair for the explicit handoff edge.
      const nodes: EdgeInputNode[] = [
        { id: "s001-1", major: 1, lane: 1, kind: "story", depends_on: [] },
        { id: "s001-2", major: 1, lane: 2, kind: "story", depends_on: [] },
        { id: "s002",   major: 2, lane: undefined, kind: "story", depends_on: [] },
        { id: "s004",   major: 4, lane: undefined, kind: "story", depends_on: [] },
        { id: "t002a",  major: 2, lane: undefined, kind: "task",  depends_on: [] },
        {
          id: "t004a",
          major: 4,
          lane: undefined,
          kind: "task",
          depends_on: [{ task: "t002a", output: "api-spec", semantics: "frozen" as const }],
        },
      ];

      const edges = buildEdges(nodes);

      // --- Grammar edges (story-level) ---
      const fromTo = (from: string, to: string): boolean =>
        edges.some((e) => e.kind === "grammar" && e.from === from && e.to === to);

      assert.ok(fromTo("s001-1", "s002"), "grammar edge s001-1 → s002 (group 001 → 002)");
      assert.ok(fromTo("s001-2", "s002"), "grammar edge s001-2 → s002 (group 001 → 002)");
      assert.ok(fromTo("s002", "s004"),   "grammar edge s002 → s004 (group 002 → 004, gap skipped)");

      // Lane siblings must NOT have a grammar edge between them
      assert.ok(
        !fromTo("s001-1", "s001-2"),
        "no grammar edge between lane siblings s001-1 and s001-2",
      );
      assert.ok(
        !fromTo("s001-2", "s001-1"),
        "no grammar edge between lane siblings (reverse)",
      );

      // Group 001 must NOT be the direct predecessor of group 004 (gap means only 002 is)
      assert.ok(!fromTo("s001-1", "s004"), "group 001 is not direct predecessor of group 004");
      assert.ok(!fromTo("s001-2", "s004"), "group 001 is not direct predecessor of group 004");

      // --- Explicit handoff edge ---
      const handoffEdge = edges.find(
        (e) => e.kind === "handoff" && e.from === "t002a" && e.to === "t004a",
      );
      assert.ok(handoffEdge !== undefined, "explicit handoff edge t002a → t004a exists");
      assert.equal(handoffEdge.semantics, "frozen");
    });
  });

  describe("coreLint — core lint rules", () => {
    it("cycle → CoreLintError listing task ids on the cycle", () => {
      const nodes: LintNode[] = [
        { id: "t1", major: 1, kind: "task", repo: "main-repo", ticket: "PROJ-1" },
        { id: "t2", major: 1, kind: "task", repo: "main-repo", ticket: "PROJ-2" },
      ];
      const edges: Edge[] = [
        { from: "t2", to: "t1", kind: "handoff", semantics: "frozen" },
        { from: "t1", to: "t2", kind: "handoff", semantics: "frozen" },
      ];
      assert.throws(
        () => coreLint(nodes, edges, ["main-repo"]),
        (err: unknown) => {
          assert.ok(err instanceof CoreLintError, "CoreLintError thrown");
          assert.ok(err.message.includes("t1"), "message names t1");
          assert.ok(err.message.includes("t2"), "message names t2");
          return true;
        },
      );
    });

    it("unregistered repo → CoreLintError naming task and repo", () => {
      const nodes: LintNode[] = [
        { id: "t1", major: 1, kind: "task", repo: "unknown-repo", ticket: "PROJ-1" },
      ];
      assert.throws(
        () => coreLint(nodes, [], ["main-repo"]),
        (err: unknown) => {
          assert.ok(err instanceof CoreLintError, "CoreLintError thrown");
          assert.ok(err.message.includes("t1"), "message names the task");
          assert.ok(err.message.includes("unknown-repo"), "message names the unregistered repo");
          return true;
        },
      );
    });

    it("missing ticket → CoreLintError naming the node", () => {
      const nodes: LintNode[] = [
        { id: "s1", major: 1, kind: "story", repo: "main-repo", ticket: undefined },
      ];
      assert.throws(
        () => coreLint(nodes, [], ["main-repo"]),
        (err: unknown) => {
          assert.ok(err instanceof CoreLintError, "CoreLintError thrown");
          assert.ok(err.message.includes("s1"), "message names the node");
          return true;
        },
      );
    });

    it("forward handoff → CoreLintError in story vocabulary naming the major groups", () => {
      // s1 (major 1) is the consumer; s3 (major 3) is the producer.
      // The handoff edge goes from s3 (producer) to s1 (consumer).
      // major(producer=3) > major(consumer=1) — forward handoff: s1 cannot depend on s3.
      const nodes: LintNode[] = [
        { id: "s1", major: 1, kind: "story", repo: "main-repo", ticket: "PROJ-1" },
        { id: "s3", major: 3, kind: "story", repo: "main-repo", ticket: "PROJ-3" },
      ];
      const edges: Edge[] = [
        { from: "s3", to: "s1", kind: "handoff", semantics: "frozen" },
      ];
      assert.throws(
        () => coreLint(nodes, edges, ["main-repo"]),
        (err: unknown) => {
          assert.ok(err instanceof CoreLintError, "CoreLintError thrown");
          assert.ok(err.message.includes("01"), "message references consumer story major 01");
          assert.ok(err.message.includes("03"), "message references producer story major 03");
          return true;
        },
      );
    });
  });
});
