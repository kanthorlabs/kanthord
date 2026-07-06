/**
 * Tests for src/ring1/role-path-policy
 * Story 015/001 — Role Path Policy
 * Task T1 — Registry + evaluation
 * Task T2 — Ordering ahead of write-scope
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadRolePathRegistry,
  evaluatePathPolicy,
  ring1PolicyChain,
  RolePathPolicyError,
} from "./role-path-policy.ts";
import type {
  RolePathRegistry,
  PathPolicyDecision,
  PathPolicyEscalation,
  Ring1PolicyCall,
  Ring1PolicyChainResult,
} from "./role-path-policy.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ring1-role-path-policy-"));
}

async function rmDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Task T1(a) — Registry loading
// ---------------------------------------------------------------------------

describe("src/ring1/role-path-policy.ts", () => {
  test("T1(a): valid registry loads roles with separate read and write allow/deny globs", async () => {
    const dir = await makeTmpDir();
    try {
      const yamlContent = `
roles:
  coding:
    read:
      allow:
        - /workspace/**
      deny:
        - /workspace/.ssh/**
    write:
      allow:
        - /workspace/src/**
      deny:
        - /workspace/.ssh/**
  reviewer:
    read:
      allow:
        - /workspace/**
      deny: []
    write:
      allow: []
      deny:
        - /workspace/**
`;
      const filePath = join(dir, "path-policy.yaml");
      await writeFile(filePath, yamlContent, "utf8");

      const registry: RolePathRegistry = await loadRolePathRegistry(filePath);

      // Check coding role has read and write dimensions
      assert.ok(registry.roles["coding"] !== undefined, "coding role present");
      assert.ok(
        Array.isArray(registry.roles["coding"]?.read.allow),
        "coding read.allow is array",
      );
      assert.ok(
        Array.isArray(registry.roles["coding"]?.write.deny),
        "coding write.deny is array",
      );
      // Check reviewer role
      assert.ok(
        registry.roles["reviewer"] !== undefined,
        "reviewer role present",
      );
    } finally {
      await rmDir(dir);
    }
  });

  test("T1(a): loading a registry with malformed YAML is a typed error naming the file", async () => {
    const dir = await makeTmpDir();
    try {
      const filePath = join(dir, "bad-policy.yaml");
      await writeFile(filePath, "roles: [unclosed bracket\n", "utf8");

      await assert.rejects(
        () => loadRolePathRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof RolePathPolicyError, "is RolePathPolicyError");
          assert.ok(
            (err as RolePathPolicyError).message.includes(filePath),
            `error message includes file path; got: ${(err as RolePathPolicyError).message}`,
          );
          return true;
        },
      );
    } finally {
      await rmDir(dir);
    }
  });

  test("T1(a): loading a registry with an unknown role field structure is a typed error naming the file", async () => {
    const dir = await makeTmpDir();
    try {
      // 'roles' is a scalar, not a mapping
      const filePath = join(dir, "bad-roles.yaml");
      await writeFile(filePath, "roles: not-a-mapping\n", "utf8");

      await assert.rejects(
        () => loadRolePathRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof RolePathPolicyError, "is RolePathPolicyError");
          assert.ok(
            (err as RolePathPolicyError).message.includes(filePath),
            `error includes path; got: ${(err as RolePathPolicyError).message}`,
          );
          return true;
        },
      );
    } finally {
      await rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // Task T1(b) — Denied write path blocked + escalated even inside write_scope
  // -------------------------------------------------------------------------

  test("T1(b): write to denied path is blocked and escalated with role, rule, and path", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision: PathPolicyDecision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      // path is inside write_scope AND inside denied glob
      path: "/workspace/.ssh/id_rsa",
      writeScope: ["/workspace/.ssh/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(decision, "block", "denied path must be blocked");
    assert.equal(escalations.length, 1, "one escalation emitted");
    const esc = escalations[0];
    assert.ok(esc !== undefined, "escalation exists");
    assert.equal(esc.role, "coding", "escalation names the role");
    assert.ok(
      typeof esc.rule === "string" && esc.rule.length > 0,
      "escalation names the rule",
    );
    assert.equal(esc.path, "/workspace/.ssh/id_rsa", "escalation names the path");
  });

  // -------------------------------------------------------------------------
  // Task T1(c) — Path outside all allows is blocked
  // -------------------------------------------------------------------------

  test("T1(c): write to path outside all allows is blocked", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: [],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      path: "/etc/passwd",
      writeScope: ["/etc/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(decision, "block", "out-of-allows path blocked");
    assert.equal(escalations.length, 1, "escalation emitted");
  });

  // -------------------------------------------------------------------------
  // Task T1(d) — Allowed path passes
  // -------------------------------------------------------------------------

  test("T1(d): write to an allowed, non-denied path returns allow", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      path: "/workspace/src/ring1/new-file.ts",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(decision, "allow", "allowed path passes");
    assert.equal(escalations.length, 0, "no escalation for allowed path");
  });

  // -------------------------------------------------------------------------
  // Task T1(e) — Denied-path read blocked; write-denied but read-allowed
  // -------------------------------------------------------------------------

  test("T1(e): denied-path read is blocked while a write-deny rule does not block reads", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: {
            allow: ["/workspace/**"],
            // .ssh is denied for reads too
            deny: ["/workspace/.ssh/**"],
          },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    const readEscalations: PathPolicyEscalation[] = [];
    const readDecision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "read",
      path: "/workspace/.ssh/id_rsa",
      writeScope: [],
      onEscalate: (e) => readEscalations.push(e),
    });
    assert.equal(readDecision, "block", "denied read is blocked");

    // Now a registry where .ssh is write-denied but NOT read-denied
    const registry2: RolePathRegistry = {
      roles: {
        coding: {
          read: {
            allow: ["/workspace/**"],
            deny: [], // not denied for reads
          },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    const readEscalations2: PathPolicyEscalation[] = [];
    const readDecision2 = evaluatePathPolicy({
      registry: registry2,
      role: "coding",
      operation: "read",
      path: "/workspace/.ssh/id_rsa",
      writeScope: [],
      onEscalate: (e) => readEscalations2.push(e),
    });
    assert.equal(
      readDecision2,
      "allow",
      "read-allowed path passes even when write-denied",
    );
    assert.equal(readEscalations2.length, 0, "no escalation for allowed read");
  });

  // -------------------------------------------------------------------------
  // Task T1(f) — Canonicalization: symlink, ../.. escape, rename dual-path
  // -------------------------------------------------------------------------

  test("T1(f): a path using ../.. to escape an allowed dir is blocked", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: [],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    // /workspace/src/../../etc/passwd canonicalizes to /etc/passwd (outside allow)
    const decision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      path: "/workspace/src/../../etc/passwd",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(decision, "block", "path escape via ../.. is blocked");
    assert.equal(escalations.length, 1, "escalation emitted for escape attempt");
  });

  test("T1(f): rename/copy with one denied side is blocked", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    // source is allowed, destination is denied — both must be checked
    const decision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      path: "/workspace/src/file.ts",
      secondaryPath: "/workspace/.ssh/file.ts",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(decision, "block", "rename with denied destination is blocked");
    assert.equal(escalations.length, 1, "escalation emitted");
    const esc = escalations[0];
    assert.ok(esc !== undefined);
    assert.equal(esc.path, "/workspace/.ssh/file.ts", "escalation names the denied path");
  });

  test("T1(f): canonicalized symlink path pointing to denied target is blocked", () => {
    // We test canonicalization by supplying a pre-resolved absolute path that
    // points inside the denied zone — the evaluator must check the canonical path
    // (resolving ../ components), not the raw input.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    // simulated: symlink /workspace/src/link -> /workspace/.ssh/id_rsa
    // after resolution the canonical path is /workspace/.ssh/id_rsa
    const decision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      // canonicalPath is the resolved symlink destination
      path: "/workspace/src/link",
      canonicalPath: "/workspace/.ssh/id_rsa",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(
      decision,
      "block",
      "symlink pointing to denied target is blocked",
    );
    assert.equal(escalations.length, 1, "escalation emitted for symlink bypass");
  });

  // -------------------------------------------------------------------------
  // Task T2 — Ordering ahead of write-scope
  // -------------------------------------------------------------------------

  test("T2: role-denied call is blocked before the write-scope check is reached", () => {
    // Arrange: coding role denies writes to /workspace/.ssh/**
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: ["/workspace/.ssh/**"],
          },
        },
      },
    };

    // Instrumented write-scope check — records every invocation
    const writeScopeCallPaths: string[] = [];
    function instrumentedWriteScope(path: string): "allow" | "block" {
      writeScopeCallPaths.push(path);
      return "allow"; // always would-allow, so it cannot be the source of blocking
    }

    const escalations: PathPolicyEscalation[] = [];
    const call: Ring1PolicyCall = {
      role: "coding",
      operation: "write",
      path: "/workspace/.ssh/id_rsa",
      writeScope: ["/workspace/.ssh/**"], // write_scope includes the path
    };

    const result: Ring1PolicyChainResult = ring1PolicyChain({
      registry,
      call,
      onEscalate: (e) => escalations.push(e),
      writeScopeCheck: instrumentedWriteScope,
    });

    assert.equal(result.decision, "block", "chain must block the denied call");
    assert.equal(
      writeScopeCallPaths.length,
      0,
      "write-scope check must NOT be invoked when role policy blocks",
    );
    assert.equal(escalations.length, 1, "one escalation emitted by role policy");
  });

  test("T2: role-allowed call reaches the write-scope check", () => {
    // Arrange: coding role allows writes to /workspace/src/**
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: [],
          },
        },
      },
    };

    const writeScopeCallPaths: string[] = [];
    function instrumentedWriteScope(path: string): "allow" | "block" {
      writeScopeCallPaths.push(path);
      return "allow";
    }

    const escalations: PathPolicyEscalation[] = [];
    const call: Ring1PolicyCall = {
      role: "coding",
      operation: "write",
      path: "/workspace/src/app.ts",
      writeScope: ["/workspace/src/**"],
    };

    const result: Ring1PolicyChainResult = ring1PolicyChain({
      registry,
      call,
      onEscalate: (e) => escalations.push(e),
      writeScopeCheck: instrumentedWriteScope,
    });

    assert.equal(result.decision, "allow", "allowed call passes the chain");
    assert.equal(
      writeScopeCallPaths.length,
      1,
      "write-scope check IS invoked for role-allowed calls",
    );
    assert.equal(
      writeScopeCallPaths[0],
      "/workspace/src/app.ts",
      "write-scope check receives the canonical path",
    );
    assert.equal(escalations.length, 0, "no escalation for allowed call");
  });

  // -------------------------------------------------------------------------
  // B1 — empty allowlist is a closed boundary (fail-closed)
  //
  // Story 001 AC: "A write outside every allowed glob for the role is blocked
  // the same way (allowlist is the boundary, not just the denylist)."
  // An empty allow[] means NO paths are permitted — the role has no write
  // surface.  Currently the evaluator skips the allow-check when the list is
  // empty, so any non-denied path passes.  This test RED-pins the required
  // fail-closed behaviour.
  // -------------------------------------------------------------------------

  test("B1: empty allowlist blocks all paths (allowlist is the closed boundary)", () => {
    // reviewer role: write.allow is [] — no write surface at all
    const registry: RolePathRegistry = {
      roles: {
        reviewer: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: { allow: [], deny: [] }, // explicitly empty — closed boundary
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision: PathPolicyDecision = evaluatePathPolicy({
      registry,
      role: "reviewer",
      operation: "write",
      path: "/workspace/src/readme.md",
      writeScope: ["/workspace/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(
      decision,
      "block",
      "empty allowlist must block: no allowed surface means all writes are denied",
    );
    assert.equal(escalations.length, 1, "escalation emitted for out-of-allowlist path");
  });

  test("B1: empty allowlist on read dimension blocks reads", () => {
    const registry: RolePathRegistry = {
      roles: {
        isolated: {
          read: { allow: [], deny: [] }, // no read surface
          write: { allow: ["/workspace/**"], deny: [] },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision: PathPolicyDecision = evaluatePathPolicy({
      registry,
      role: "isolated",
      operation: "read",
      path: "/workspace/src/file.ts",
      writeScope: [],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(
      decision,
      "block",
      "empty read allowlist must block all reads",
    );
    assert.equal(escalations.length, 1, "escalation emitted");
  });

  // -------------------------------------------------------------------------
  // B2 — canonicalization uses worktree for relative path resolution
  //
  // Story 001 AC: "relative paths made absolute against the worktree"
  // Current `canonicalize()` calls `resolve(rawPath)` which uses process.cwd()
  // as the base.  When a worktree differs from cwd (e.g. /workspace vs /tmp),
  // a relative path "src/file.ts" is resolved incorrectly.  The evaluator must
  // accept a `worktree` option and resolve relative paths against it.
  // -------------------------------------------------------------------------

  test("B2: relative path resolved against worktree, not process.cwd()", () => {
    // Relative path "src/../../etc/passwd" resolved against worktree=/workspace
    // yields /etc/passwd, which is outside /workspace/src/** and must be blocked.
    // If resolved against process.cwd() instead, the result may differ and the
    // test would catch the wrong cwd-based resolution.
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: [],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision: PathPolicyDecision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      // relative path: when joined to worktree=/workspace it yields /etc/passwd
      path: "src/../../etc/passwd",
      worktree: "/workspace",
      writeScope: [],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(
      decision,
      "block",
      "relative path escape resolved against worktree must be blocked",
    );
    assert.equal(escalations.length, 1, "escalation emitted for worktree-relative escape");
  });

  test("B2: relative path inside worktree is allowed when within allowlist", () => {
    const registry: RolePathRegistry = {
      roles: {
        coding: {
          read: { allow: ["/workspace/**"], deny: [] },
          write: {
            allow: ["/workspace/src/**"],
            deny: [],
          },
        },
      },
    };

    const escalations: PathPolicyEscalation[] = [];
    const decision: PathPolicyDecision = evaluatePathPolicy({
      registry,
      role: "coding",
      operation: "write",
      // relative "src/ring1/new-file.ts" + worktree="/workspace" → "/workspace/src/ring1/new-file.ts"
      path: "src/ring1/new-file.ts",
      worktree: "/workspace",
      writeScope: ["/workspace/src/**"],
      onEscalate: (e) => escalations.push(e),
    });

    assert.equal(
      decision,
      "allow",
      "relative path inside worktree allowlist must be allowed",
    );
    assert.equal(escalations.length, 0, "no escalation for valid worktree-relative path");
  });

  // -------------------------------------------------------------------------
  // BLOCKER B1 (second review) — role-entry-unknown-fields
  // A role object with an unknown key (not "read" or "write") must raise a
  // typed error naming the file (Story 001:13-17; parseRoleEntry:192).
  // -------------------------------------------------------------------------

  test("B1-role-entry: role entry with an unknown field is a typed error naming the file", async () => {
    const dir = await makeTmpDir();
    try {
      const yaml = `
roles:
  coding:
    read:
      allow:
        - /workspace/**
      deny: []
    write:
      allow:
        - /workspace/src/**
      deny: []
    unexpected_key: surprise
`;
      const filePath = join(dir, "role-unknown-field.yaml");
      await writeFile(filePath, yaml, "utf8");

      await assert.rejects(
        () => loadRolePathRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof RolePathPolicyError, "is RolePathPolicyError");
          assert.ok(
            (err as RolePathPolicyError).message.includes(filePath),
            `error message must include file path; got: ${(err as RolePathPolicyError).message}`,
          );
          return true;
        },
      );
    } finally {
      await rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // BLOCKER B3 — registry-validation-gaps
  // Unknown role/dimension fields and malformed globs must raise a typed error
  // naming the file (Story 001:13-17).
  // -------------------------------------------------------------------------

  test("B3: dimension with an unrecognised field is a typed error naming the file", async () => {
    const dir = await makeTmpDir();
    try {
      const yaml = `
roles:
  coding:
    read:
      allow:
        - /workspace/**
      deny: []
      unknown_field: surprise
    write:
      allow:
        - /workspace/src/**
      deny: []
`;
      const filePath = join(dir, "unknown-field.yaml");
      await writeFile(filePath, yaml, "utf8");

      await assert.rejects(
        () => loadRolePathRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof RolePathPolicyError, "is RolePathPolicyError");
          assert.ok(
            (err as RolePathPolicyError).message.includes(filePath),
            `error message must include file path; got: ${(err as RolePathPolicyError).message}`,
          );
          return true;
        },
      );
    } finally {
      await rmDir(dir);
    }
  });

  test("B3: dimension with a malformed glob pattern is a typed error naming the file", async () => {
    const dir = await makeTmpDir();
    try {
      // An unclosed brace `{` is an unsupported/malformed glob expression
      const yaml = `
roles:
  coding:
    read:
      allow:
        - /workspace/{src/**
      deny: []
    write:
      allow:
        - /workspace/src/**
      deny: []
`;
      const filePath = join(dir, "bad-glob.yaml");
      await writeFile(filePath, yaml, "utf8");

      await assert.rejects(
        () => loadRolePathRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof RolePathPolicyError, "is RolePathPolicyError");
          assert.ok(
            (err as RolePathPolicyError).message.includes(filePath),
            `error message must include file path; got: ${(err as RolePathPolicyError).message}`,
          );
          return true;
        },
      );
    } finally {
      await rmDir(dir);
    }
  });
});
