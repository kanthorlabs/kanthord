/**
 * Tests for src/ring1/network-denial
 * Story 015/003 — Agent Network Denial
 * Task T1 — Manifest filter + registry guard
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadNetworkDenialRegistry,
  filterToolManifest,
  NetworkDenialError,
  buildSpawnEnv,
} from "./network-denial.ts";
import type {
  NetworkDenialRegistry,
  ToolDescriptor,
  ManifestFilterResult,
  SpawnEnvAllowlist,
  TrustedEffectfulConfig,
} from "./network-denial.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tool(name: string): ToolDescriptor {
  return { name };
}

// ---------------------------------------------------------------------------
// T1(a) — Candidate list with fetch-like AND exec/shell-class tools filters
//          down to allowlisted-only; dropped set is journaled.
// ---------------------------------------------------------------------------

describe("src/ring1/network-denial.ts", () => {
  let tmpDir: string;

  // We can't use before/after hooks in node:test without async context; use
  // mkdtemp inline per test instead.

  test("T1(a): manifest filtered to allowlisted-only; dropped set journaled", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      // Registry allows only two safe tools
      const registryYaml = `
allowlist:
  - name: read_file
    pure: true
  - name: write_file
    pure: false
pureClassified:
  - calculate_hash
`;
      const regPath = join(tmpDir, "network-denial.yaml");
      await writeFile(regPath, registryYaml, "utf8");

      const registry: NetworkDenialRegistry = await loadNetworkDenialRegistry(regPath);

      const candidates: ToolDescriptor[] = [
        tool("read_file"),       // allowlisted
        tool("write_file"),      // allowlisted
        tool("fetch"),           // network-capable — must be dropped
        tool("bash"),            // exec/shell-class — must be dropped
        tool("exec_command"),    // exec/shell-class — must be dropped
        tool("calculate_hash"),  // unknown but registry-classified pure — allowed through
        tool("mystery_tool"),    // unknown, not pure-classified — must be dropped
      ];

      const result: ManifestFilterResult = filterToolManifest(candidates, registry);

      // Only allowlisted + pure-classified tools survive
      const keptNames = result.allowed.map((t) => t.name).sort();
      assert.deepEqual(
        keptNames,
        ["calculate_hash", "read_file", "write_file"].sort(),
        "only allowlisted + pure-classified tools are kept",
      );

      // Dropped set is journaled (non-empty, includes the network-capable tools)
      const droppedNames = result.dropped.map((t) => t.name).sort();
      assert.deepEqual(
        droppedNames,
        ["bash", "exec_command", "fetch", "mystery_tool"].sort(),
        "fetch, bash, exec_command, mystery_tool are dropped",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1(b) — Unknown tool is dropped unless registry-classified pure
  // -------------------------------------------------------------------------

  test("T1(b): unknown tool dropped; pure-classified unknown tool allowed", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const registryYaml = `
allowlist:
  - name: read_file
    pure: true
pureClassified:
  - safe_helper
`;
      const regPath = join(tmpDir, "network-denial.yaml");
      await writeFile(regPath, registryYaml, "utf8");

      const registry: NetworkDenialRegistry = await loadNetworkDenialRegistry(regPath);

      const candidates: ToolDescriptor[] = [
        tool("read_file"),     // allowlisted
        tool("safe_helper"),   // unknown to allowlist but declared pure in registry
        tool("mystery_tool"),  // unknown, not pure — dropped
      ];

      const result: ManifestFilterResult = filterToolManifest(candidates, registry);

      const keptNames = result.allowed.map((t) => t.name).sort();
      assert.deepEqual(
        keptNames,
        ["read_file", "safe_helper"].sort(),
        "pure-classified unknown tool is kept; unclassified unknown is dropped",
      );

      const droppedNames = result.dropped.map((t) => t.name);
      assert.deepEqual(droppedNames, ["mystery_tool"], "mystery_tool is dropped");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1(c) — Registry that tries to allowlist a network-capable or exec-class
  //          tool fails to load, naming the offending tool
  // -------------------------------------------------------------------------

  test("T1(c): registry allowing network-capable tool fails to load naming the tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const badRegistryYaml = `
allowlist:
  - name: read_file
    pure: true
  - name: fetch
    pure: false
pureClassified: []
`;
      const regPath = join(tmpDir, "network-denial-bad.yaml");
      await writeFile(regPath, badRegistryYaml, "utf8");

      await assert.rejects(
        () => loadNetworkDenialRegistry(regPath),
        (err: unknown) => {
          assert.ok(err instanceof NetworkDenialError, "rejects with NetworkDenialError");
          assert.ok(
            (err as NetworkDenialError).message.includes("fetch"),
            "error message names the offending tool",
          );
          return true;
        },
        "registry allowing network-capable tool must fail to load",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("T1(c): registry allowing exec-class tool fails to load naming the tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const badRegistryYaml = `
allowlist:
  - name: bash
    pure: false
pureClassified: []
`;
      const regPath = join(tmpDir, "network-denial-bad2.yaml");
      await writeFile(regPath, badRegistryYaml, "utf8");

      await assert.rejects(
        () => loadNetworkDenialRegistry(regPath),
        (err: unknown) => {
          assert.ok(err instanceof NetworkDenialError, "rejects with NetworkDenialError");
          assert.ok(
            (err as NetworkDenialError).message.includes("bash"),
            "error message names the offending exec-class tool",
          );
          return true;
        },
        "registry allowing exec-class tool must fail to load",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 — Credential-free spawn environment
  // -------------------------------------------------------------------------

  test("T2: spawn-env builder strips hostile env; only allowlisted safe vars survive", () => {
    const allowlist: SpawnEnvAllowlist = {
      allow: ["HOME", "PATH", "LANG"],
    };

    // Hostile inherited environment (SU4 credential values + credential-adjacent)
    const hostile: Record<string, string> = {
      HOME: "/home/agent",
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      // SU4 credential values
      OPENAI_API_KEY: "sk-secret-openai",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      // credential-adjacent
      SSH_AUTH_SOCK: "/tmp/ssh-agent.socket",
      AWS_ACCESS_KEY_ID: "AKIA_FAKE",
      AWS_SECRET_ACCESS_KEY: "aws_secret",
      AWS_SESSION_TOKEN: "aws_session",
      GITHUB_TOKEN: "ghp_fake_token",
      GITHUB_API_TOKEN: "ghp_other_token",
      NPM_TOKEN: "npm_fake_token",
      // extra unknown vars
      SOME_OTHER_VAR: "value",
      DATABASE_URL: "postgres://secret@host/db",
    };

    const result = buildSpawnEnv(hostile, allowlist);

    // Only explicitly allowlisted vars survive
    assert.deepEqual(
      Object.keys(result).sort(),
      ["HOME", "LANG", "PATH"].sort(),
      "output contains only allowlisted variables",
    );
    assert.equal(result["HOME"], "/home/agent", "HOME value preserved");
    assert.equal(result["PATH"], "/usr/bin:/bin", "PATH value preserved");
    assert.equal(result["LANG"], "en_US.UTF-8", "LANG value preserved");

    // None of the credential or credential-adjacent vars survive
    const credentialKeys = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "SSH_AUTH_SOCK",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "GITHUB_TOKEN",
      "GITHUB_API_TOKEN",
      "NPM_TOKEN",
      "SOME_OTHER_VAR",
      "DATABASE_URL",
    ];
    for (const key of credentialKeys) {
      assert.equal(
        key in result,
        false,
        `credential/adjacent var ${key} must not appear in spawn env`,
      );
    }
  });

  test("T2: spawn-env builder with empty allowlist produces empty env", () => {
    const allowlist: SpawnEnvAllowlist = { allow: [] };
    const hostile: Record<string, string> = {
      SECRET: "value",
      ANOTHER: "thing",
    };
    const result = buildSpawnEnv(hostile, allowlist);
    assert.deepEqual(result, {}, "empty allowlist produces empty spawn env");
  });

  test("T2: spawn-env builder skips allowlisted keys absent from inherited env", () => {
    const allowlist: SpawnEnvAllowlist = { allow: ["HOME", "PATH", "MISSING_KEY"] };
    const inherited: Record<string, string> = {
      HOME: "/home/agent",
      PATH: "/usr/bin",
      // MISSING_KEY not present
    };
    const result = buildSpawnEnv(inherited, allowlist);
    assert.deepEqual(
      Object.keys(result).sort(),
      ["HOME", "PATH"].sort(),
      "absent allowlisted key is silently omitted",
    );
  });

  // -------------------------------------------------------------------------
  // B5 — pureClassified entries checked against permanent network/exec deny set
  // -------------------------------------------------------------------------

  test("B5: pureClassified entry naming a network-capable tool fails to load naming the tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const badRegistryYaml = `
allowlist:
  - name: read_file
    pure: true
pureClassified:
  - fetch
`;
      const regPath = join(tmpDir, "network-denial-b5a.yaml");
      await writeFile(regPath, badRegistryYaml, "utf8");

      await assert.rejects(
        () => loadNetworkDenialRegistry(regPath),
        (err: unknown) => {
          assert.ok(err instanceof NetworkDenialError, "rejects with NetworkDenialError");
          assert.ok(
            (err as NetworkDenialError).message.includes("fetch"),
            "error message names the offending pureClassified tool",
          );
          return true;
        },
        "pureClassified entry for a network-capable tool must fail to load",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("B5: pureClassified entry naming an exec-class tool fails to load naming the tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const badRegistryYaml = `
allowlist:
  - name: read_file
    pure: true
pureClassified:
  - bash
`;
      const regPath = join(tmpDir, "network-denial-b5b.yaml");
      await writeFile(regPath, badRegistryYaml, "utf8");

      await assert.rejects(
        () => loadNetworkDenialRegistry(regPath),
        (err: unknown) => {
          assert.ok(err instanceof NetworkDenialError, "rejects with NetworkDenialError");
          assert.ok(
            (err as NetworkDenialError).message.includes("bash"),
            "error message names the offending pureClassified exec-class tool",
          );
          return true;
        },
        "pureClassified entry for an exec-class tool must fail to load",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // effectful-seam — trusted effectful name/config seam
  // An allowlist entry with pure:false must be in the trusted effectful set;
  // an arbitrary effectful tool not declared there is a load error.
  // -------------------------------------------------------------------------

  test("effectful-seam: pure:false tool NOT in trusted effectful set fails to load naming the tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const registryYaml = `
allowlist:
  - name: send_email
    pure: false
pureClassified: []
`;
      const regPath = join(tmpDir, "network-denial-eff1.yaml");
      await writeFile(regPath, registryYaml, "utf8");

      const trusted: TrustedEffectfulConfig = {
        names: new Set(["broker_submit", "write_file"]),
      };

      await assert.rejects(
        () => loadNetworkDenialRegistry(regPath, trusted),
        (err: unknown) => {
          assert.ok(err instanceof NetworkDenialError, "rejects with NetworkDenialError");
          assert.ok(
            (err as NetworkDenialError).message.includes("send_email"),
            "error message names the untrusted effectful tool",
          );
          return true;
        },
        "pure:false tool outside trusted effectful set must fail registry load",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("effectful-seam: pure:false tool IN trusted effectful set loads successfully", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const registryYaml = `
allowlist:
  - name: broker_submit
    pure: false
  - name: write_file
    pure: false
  - name: read_file
    pure: true
pureClassified: []
`;
      const regPath = join(tmpDir, "network-denial-eff2.yaml");
      await writeFile(regPath, registryYaml, "utf8");

      const trusted: TrustedEffectfulConfig = {
        names: new Set(["broker_submit", "write_file"]),
      };

      const registry = await loadNetworkDenialRegistry(regPath, trusted);
      const names = registry.allowlist.map((e) => e.name).sort();
      assert.deepEqual(
        names,
        ["broker_submit", "read_file", "write_file"],
        "trusted effectful tools and pure tools load without error",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("effectful-seam: pure:true allowlist entry always loads regardless of trusted effectful set", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const registryYaml = `
allowlist:
  - name: arbitrary_pure_tool
    pure: true
pureClassified: []
`;
      const regPath = join(tmpDir, "network-denial-eff3.yaml");
      await writeFile(regPath, registryYaml, "utf8");

      // Trusted set does NOT contain arbitrary_pure_tool, but it's pure:true
      const trusted: TrustedEffectfulConfig = {
        names: new Set(["broker_submit"]),
      };

      const registry = await loadNetworkDenialRegistry(regPath, trusted);
      assert.equal(
        registry.allowlist.length,
        1,
        "pure:true tool loads without effectful-set check",
      );
      assert.equal(registry.allowlist[0]?.name, "arbitrary_pure_tool");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // effectful-fail-closed — trustedEffectful must be required, not optional
  // A pure:false allowlist entry must ALWAYS be gated — even when the caller
  // omits trustedEffectful — because the optional form is fail-open.
  // Story 003 requires effectful availability to be broker-submit plus gated
  // file tools with no arbitrary escape hatch.
  // -------------------------------------------------------------------------

  test("effectful-fail-closed: pure:false entry fails to load even when trustedEffectful is omitted", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nd-test-"));
    try {
      const registryYaml = `
allowlist:
  - name: arbitrary_effectful_tool
    pure: false
pureClassified: []
`;
      const regPath = join(tmpDir, "network-denial-fc1.yaml");
      await writeFile(regPath, registryYaml, "utf8");

      // No trustedEffectful arg — the seam must still refuse a pure:false entry.
      await assert.rejects(
        () => loadNetworkDenialRegistry(regPath),
        (err: unknown) => {
          assert.ok(err instanceof NetworkDenialError, "rejects with NetworkDenialError");
          assert.ok(
            (err as NetworkDenialError).message.includes("arbitrary_effectful_tool"),
            "error message names the untrusted effectful tool",
          );
          return true;
        },
        "pure:false entry must be rejected even when trustedEffectful is omitted (fail-closed)",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
