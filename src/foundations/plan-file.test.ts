import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePlanFile, PlanFileParseError, asTaskFrontmatter, sections, serializeFrontmatter } from "./plan-file.ts";

describe("src/foundations/plan-file.ts", () => {
  describe("parsePlanFile — fence splitting", () => {
    it("splits a fenced document into frontmatter object and exact body string", () => {
      const text = "---\ntitle: hello\n---\nsome body\n";
      const { frontmatter, body } = parsePlanFile("/path/task.md", text);
      assert.deepEqual(frontmatter, { title: "hello" });
      assert.equal(body, "some body\n");
    });

    it("throws a typed PlanFileParseError naming the file path when the opening fence is missing", () => {
      const text = "title: hello\nsome body\n";
      assert.throws(
        () => parsePlanFile("/path/task.md", text),
        (err) => {
          assert.ok(err instanceof PlanFileParseError);
          assert.ok(
            (err as PlanFileParseError).message.includes("/path/task.md"),
          );
          return true;
        },
      );
    });

    it("throws a typed PlanFileParseError naming the file path when the closing fence is missing", () => {
      const text = "---\ntitle: hello\nsome body\n";
      assert.throws(
        () => parsePlanFile("/path/task.md", text),
        (err) => {
          assert.ok(err instanceof PlanFileParseError);
          assert.ok(
            (err as PlanFileParseError).message.includes("/path/task.md"),
          );
          return true;
        },
      );
    });
  });

  describe("sections — body section extraction", () => {
    it("returns each ## heading section keyed by heading text with its content", () => {
      const body =
        "## Prerequisites\nsome prereq\n\n## Inputs\nsome inputs\n\n## Outputs\nsome outputs\n\n## Tests\nsome tests\n";
      const result = sections(body);
      assert.ok("Prerequisites" in result);
      assert.ok("Inputs" in result);
      assert.ok("Outputs" in result);
      assert.ok("Tests" in result);
      assert.ok((result["Prerequisites"] ?? "").includes("some prereq"));
      assert.ok((result["Inputs"] ?? "").includes("some inputs"));
      assert.ok((result["Outputs"] ?? "").includes("some outputs"));
      assert.ok((result["Tests"] ?? "").includes("some tests"));
    });

    it("reports an empty section as empty string, not missing", () => {
      const body = "## Prerequisites\n\n## Inputs\nsome inputs\n";
      const result = sections(body);
      assert.ok("Prerequisites" in result);
      assert.equal((result["Prerequisites"] ?? "non-empty").trim(), "");
      assert.ok((result["Inputs"] ?? "").includes("some inputs"));
    });
  });

  describe("serializeFrontmatter — round-trip", () => {
    it("serializes a frontmatter object with a nested field and re-parses to an equal object", () => {
      const original = {
        ticket: "ELSA-9999",
        write_scope: ["src/foundations/plan-file.ts"],
        compile: { shape: "task-v1", hash: "abc123", at: "2026-07-03T00:00:00Z" },
      };
      const fenced = serializeFrontmatter(original);
      // The output must be a self-contained fenced block; give it a dummy body
      const { frontmatter } = parsePlanFile("/path/task.md", fenced + "body\n");
      assert.deepEqual(frontmatter, original);
    });
  });

  describe("parsePlanFile — nested frontmatter shapes", () => {
    it("parses task frontmatter with nested maps, arrays of maps, and inline objects", () => {
      const text =
        "---\n" +
        "ticket: ELSA-1234\n" +
        "write_scope:\n" +
        "  - src/foundations/plan-file.ts\n" +
        "depends_on:\n" +
        "  - task: T1\n" +
        "    output: plan-file.ts\n" +
        "    semantics: strict\n" +
        "outputs:\n" +
        "  - src/foundations/plan-file.ts\n" +
        "source_of_truth: { system: jira, ref: ELSA-1234 }\n" +
        "---\n" +
        "## Prerequisites\nSome content\n";
      const { frontmatter, body } = parsePlanFile("/path/task.md", text);
      const fm = asTaskFrontmatter(frontmatter);
      assert.equal(fm.ticket, "ELSA-1234");
      assert.deepEqual(fm.write_scope, ["src/foundations/plan-file.ts"]);
      assert.equal(fm.depends_on.length, 1);
      const dep = fm.depends_on[0];
      assert.ok(dep !== undefined);
      assert.equal(dep.task, "T1");
      assert.equal(dep.output, "plan-file.ts");
      assert.equal(dep.semantics, "strict");
      assert.deepEqual(fm.outputs, ["src/foundations/plan-file.ts"]);
      assert.deepEqual(fm.source_of_truth, { system: "jira", ref: "ELSA-1234" });
      assert.ok(body.startsWith("## Prerequisites"));
    });
  });
});
