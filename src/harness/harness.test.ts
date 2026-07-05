/**
 * Tests for src/harness/harness
 * Story 001 — Harness Kit & Golden Scenario
 * Task T1 — Harness kit + no-network guard
 */

// MUST be the first import — installs the suite-level no-network + credential
// guard before any SUT module is loaded (Story 001 AC, PRD §7.7).
import "./no-network-guard.ts";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as tls from "node:tls";
import * as dns from "node:dns";
import * as dgram from "node:dgram";
import * as http from "node:http";
import * as https from "node:https";
import * as http2 from "node:http2";

import { harness } from "./harness.ts";

// ---------------------------------------------------------------------------
// Guard test helper — call fn; if guard throws: assert message; else destroy
// any returned resource (prevents open-handle hangs in RED phase) and fail.
// ---------------------------------------------------------------------------

function assertNetworkBlocked(
  fn: () => { destroy?: (() => void) | undefined; close?: (() => void) | undefined } | void,
  primitive: string,
): void {
  let resource:
    | { destroy?: (() => void) | undefined; close?: (() => void) | undefined }
    | undefined;
  try {
    const r = fn();
    if (r != null) resource = r;
  } catch (err) {
    assert.match(String(err), /no external network/, `${primitive}: guard message`);
    return;
  } finally {
    resource?.destroy?.();
    resource?.close?.();
  }
  assert.fail(`guard did not block ${primitive}`);
}

// ---------------------------------------------------------------------------
// Harness fixture
// ---------------------------------------------------------------------------

describe("src/harness/harness", () => {
  test("harness() returns fixture with clock, broker, store, gitRepo, and boot", async () => {
    const h = await harness();
    assert.ok(h.clock !== undefined, "clock present");
    assert.ok(h.broker !== undefined, "broker present");
    assert.ok(h.store !== undefined, "store present");
    assert.ok(h.gitRepo !== undefined, "gitRepo present");
    assert.ok(
      typeof h.gitRepo.dir === "string" && h.gitRepo.dir.length > 0,
      "gitRepo.dir is a non-empty string",
    );
    assert.ok(h.boot !== undefined, "boot present");
    await h[Symbol.asyncDispose]();
  });

  test("temp git repo is real: rev-parse resolves and one commit lands", async () => {
    const h = await harness();
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: h.gitRepo.dir,
      encoding: "utf-8",
    });
    assert.ok(gitDir.trim().length > 0, "git rev-parse --git-dir resolves");
    const log = execFileSync("git", ["log", "--oneline"], {
      cwd: h.gitRepo.dir,
      encoding: "utf-8",
    });
    assert.ok(log.trim().length > 0, "at least one commit in git log");
    await h[Symbol.asyncDispose]();
  });

  // -------------------------------------------------------------------------
  // Suite-level no-network guard — each covered primitive must throw
  // -------------------------------------------------------------------------

  describe("no-network guard: network primitives blocked (non-loopback)", () => {
    test("net.createConnection to non-loopback throws", () => {
      assertNetworkBlocked(
        () => net.createConnection(443, "8.8.8.8"),
        "net.createConnection",
      );
    });

    test("tls.connect to non-loopback throws", () => {
      assertNetworkBlocked(
        () => tls.connect(443, "example.com"),
        "tls.connect",
      );
    });

    test("dns.promises.resolve4 to external hostname throws", () => {
      // dns.promises returns a Promise (no sync throw in RED); suppress rejection.
      assert.throws(
        () => {
          const p = dns.promises.resolve4("example.com");
          void p.catch(() => {}); // suppress rejection in RED phase
        },
        /no external network/,
      );
    });

    test("dgram.createSocket throws", () => {
      assertNetworkBlocked(
        () => dgram.createSocket("udp4"),
        "dgram.createSocket",
      );
    });

    test("http.request to non-loopback throws", () => {
      assertNetworkBlocked(
        () => http.request("http://example.com"),
        "http.request",
      );
    });

    test("https.request to non-loopback throws", () => {
      assertNetworkBlocked(
        () => https.request("https://example.com"),
        "https.request",
      );
    });

    test("http2.connect to non-loopback throws", () => {
      assertNetworkBlocked(
        () => http2.connect("https://example.com"),
        "http2.connect",
      );
    });

    test("global fetch to non-loopback throws", () => {
      // fetch returns a Promise (no sync throw in RED); suppress rejection.
      assert.throws(
        () => {
          const p = fetch("https://example.com");
          void p.catch(() => {}); // suppress rejection in RED phase
        },
        /no external network/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Credential guard — env vars and provider-credential file paths blocked
  // -------------------------------------------------------------------------

  describe("no-network guard: credential access blocked", () => {
    test("reading a credential-shaped env var (*_TOKEN) throws", () => {
      assert.throws(
        () => {
          void process.env["TEST_API_TOKEN"];
        },
        /no external credentials/,
      );
    });

    test("reading a provider-credential file path throws", () => {
      assert.throws(
        () => readFileSync(join(homedir(), ".aws", "credentials")),
        /no external credentials/,
      );
    });
  });
});
