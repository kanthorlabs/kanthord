/**
 * src/agent/pi-tools.test.ts
 *
 * Verifies the canonical pi tool taxonomy module: exported name sets and
 * the classifyPiTool helper.
 *
 * Story 001-pi-tool-classification, Task T1.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PI_READ_ONLY_TOOLS,
  PI_FILE_MUTATING_TOOLS,
  PI_DEFAULT_ALLOWED_MANIFEST,
  PI_EXEC_TOOLS,
  classifyPiTool,
} from "./pi-tools.ts";
import * as piToolsNS from "./pi-tools.ts";

describe("src/agent/pi-tools.ts", () => {
  describe("PI_READ_ONLY_TOOLS", () => {
    it("contains the four pi read-only tool names", () => {
      assert.ok(PI_READ_ONLY_TOOLS.has("read"), "missing: read");
      assert.ok(PI_READ_ONLY_TOOLS.has("grep"), "missing: grep");
      assert.ok(PI_READ_ONLY_TOOLS.has("find"), "missing: find");
      assert.ok(PI_READ_ONLY_TOOLS.has("ls"), "missing: ls");
    });

    it("does not contain bash", () => {
      assert.ok(!PI_READ_ONLY_TOOLS.has("bash"), "bash must not be in read-only set");
    });

    it("does not contain edit or write", () => {
      assert.ok(!PI_READ_ONLY_TOOLS.has("edit"), "edit must not be in read-only set");
      assert.ok(!PI_READ_ONLY_TOOLS.has("write"), "write must not be in read-only set");
    });
  });

  describe("PI_FILE_MUTATING_TOOLS", () => {
    it("contains edit and write", () => {
      assert.ok(PI_FILE_MUTATING_TOOLS.has("edit"), "missing: edit");
      assert.ok(PI_FILE_MUTATING_TOOLS.has("write"), "missing: write");
    });

    it("does not contain bash", () => {
      assert.ok(!PI_FILE_MUTATING_TOOLS.has("bash"), "bash must not be in file-mutating set");
    });

    it("does not contain read, grep, find, ls", () => {
      for (const name of ["read", "grep", "find", "ls"]) {
        assert.ok(!PI_FILE_MUTATING_TOOLS.has(name), `${name} must not be in file-mutating set`);
      }
    });
  });

  describe("PI_DEFAULT_ALLOWED_MANIFEST — Story 002 T1", () => {
    it("contains exactly the six non-exec pi tools", () => {
      for (const name of ["read", "grep", "find", "ls", "edit", "write"]) {
        assert.ok(PI_DEFAULT_ALLOWED_MANIFEST.has(name), `missing from manifest: ${name}`);
      }
      assert.equal(PI_DEFAULT_ALLOWED_MANIFEST.size, 6, "manifest must have exactly 6 tools");
    });

    it("does not contain bash", () => {
      assert.ok(!PI_DEFAULT_ALLOWED_MANIFEST.has("bash"), "bash must not be in the default allowed manifest");
    });
  });

  describe("classifyPiTool", () => {
    it("returns 'read' for each pi read-only tool", () => {
      for (const name of ["read", "grep", "find", "ls"]) {
        assert.equal(classifyPiTool(name), "read", `expected 'read' for ${name}`);
      }
    });

    it("returns 'write' for pi file-mutating tools", () => {
      assert.equal(classifyPiTool("edit"), "write");
      assert.equal(classifyPiTool("write"), "write");
    });

    it("returns undefined for bash (exec-class, neither read nor write)", () => {
      assert.equal(classifyPiTool("bash"), undefined);
    });

    it("returns undefined for unknown tool names (caller falls back to heuristic)", () => {
      assert.equal(classifyPiTool("read_file"), undefined);
      assert.equal(classifyPiTool("unknown_tool"), undefined);
      assert.equal(classifyPiTool(""), undefined);
    });
  });

  describe("PI_EXEC_TOOLS — BLOCKER-019.1 exec deny source", () => {
    it("is a Set containing exactly bash", () => {
      assert.equal(PI_EXEC_TOOLS.size, 1, "PI_EXEC_TOOLS must have exactly one entry");
      assert.ok(PI_EXEC_TOOLS.has("bash"), "PI_EXEC_TOOLS must contain bash");
    });

    it("PI_BLOCKED_TOOL_NAMES is not exported from pi-tools.ts", () => {
      assert.equal(
        (piToolsNS as Record<string, unknown>)["PI_BLOCKED_TOOL_NAMES"],
        undefined,
        "PI_BLOCKED_TOOL_NAMES must not be exported from pi-tools.ts",
      );
    });
  });
});
