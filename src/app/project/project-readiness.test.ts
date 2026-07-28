// src/app/project/project-readiness.test.ts — EPIC 014 Story 1
// Pure report function over injected facts. No database, no clock, no git.
//
// Mirrors the hermetic style of `src/domain/resolve-provider-chain.test.ts`
// (literal fact builders, no port fakes) so a missing seam is RED for the
// right reason: the module under test does not yet exist.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildProjectReadiness,
  CONFIG_CHECK_STATUSES,
  DAEMON_STATUSES,
  CHECK_ORDER,
  type DaemonInstanceFact,
  type ProbeRecord,
  type ReadinessFacts,
  type RepositoryFact,
  type InitiativeFact,
} from "./project-readiness.ts";

// ── Literal fact builders ────────────────────────────────────────────────────

const PROJECT_ID = "01J0000000000000000000000A";

function repo(overrides: Partial<RepositoryFact> = {}): RepositoryFact {
  return {
    id: "r1",
    name: "main",
    branch: "main",
    auth: "ambient",
    credentialId: null,
    credentialExists: false,
    credentialIsCredentialType: false,
    ...overrides,
  };
}

function init(overrides: Partial<InitiativeFact> = {}): InitiativeFact {
  return {
    id: "i1",
    name: "default",
    status: "building",
    paused: false,
    incompleteTaskCount: 0,
    ...overrides,
  };
}

function instance(
  overrides: Partial<DaemonInstanceFact> = {},
): DaemonInstanceFact {
  return { instanceId: "1:1000", ageMs: 0, ...overrides };
}

/** Build a facts object with sensible defaults so each test names only what matters. */
function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    projectId: PROJECT_ID,
    database: { schemaVersion: 28, expectedSchemaVersion: 28 },
    repositories: [],
    aiProvider: { resolved: [], assignedCount: 0 },
    initiatives: [],
    daemon: { instances: [], staleMs: 6000 },
    probes: {},
    ...overrides,
  };
}

// ── Vocabulary closure ───────────────────────────────────────────────────────

test("CONFIG_CHECK_STATUSES is the closed seven-status vocabulary in order", () => {
  assert.deepEqual(
    [...CONFIG_CHECK_STATUSES],
    [
      "ok",
      "unverified",
      "missing",
      "paused",
      "blocked",
      "failed",
      "unsupported",
    ],
  );
});

test("DAEMON_STATUSES is exactly [running, stopped, multiple]", () => {
  assert.deepEqual([...DAEMON_STATUSES], ["running", "stopped", "multiple"]);
});

test("CHECK_ORDER is exactly the six check names in order", () => {
  assert.deepEqual(
    [...CHECK_ORDER],
    [
      "database",
      "repository",
      "ai_provider",
      "initiative",
      "notification",
      "daemon",
    ],
  );
});

test("every emitted check status is in the closed vocabulary", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [
        repo({ id: "r1", auth: "https-token", credentialId: "c1" }),
      ],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      probes: {
        repositories: [{ resourceId: "r1", status: "failed", detail: "nope" }],
        provider: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
    }),
  );
  const allowed = new Set<string>([
    ...CONFIG_CHECK_STATUSES,
    ...DAEMON_STATUSES,
  ]);
  for (const c of report.checks) {
    assert.ok(
      allowed.has(c.status),
      `check ${c.name} emitted status ${c.status} not in closed vocabulary`,
    );
  }
});

// ── Shape ────────────────────────────────────────────────────────────────────

test("checks has length 6 in CHECK_ORDER for an empty fact set", () => {
  const report = buildProjectReadiness(facts());
  assert.equal(report.checks.length, 6);
  assert.deepEqual(
    report.checks.map((c) => c.name),
    [...CHECK_ORDER],
  );
});

test("checks has length 6 in CHECK_ORDER for a fully-populated fact set", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo()],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: { instances: [instance()], staleMs: 6000 },
    }),
  );
  assert.equal(report.checks.length, 6);
  assert.deepEqual(
    report.checks.map((c) => c.name),
    [...CHECK_ORDER],
  );
});

// ── database ────────────────────────────────────────────────────────────────

test("database is ok when schemaVersion matches expected", () => {
  const report = buildProjectReadiness(
    facts({ database: { schemaVersion: 28, expectedSchemaVersion: 28 } }),
  );
  const c = report.checks.find((c) => c.name === "database")!;
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("28"));
  assert.equal(c.blocking, true);
  assert.equal(c.probes, undefined);
});

test("database is blocked with a detail naming `db migrate` when schema is behind", () => {
  const report = buildProjectReadiness(
    facts({ database: { schemaVersion: 27, expectedSchemaVersion: 28 } }),
  );
  const c = report.checks.find((c) => c.name === "database")!;
  assert.equal(c.status, "blocked");
  assert.ok(
    c.detail.includes("db migrate"),
    `detail should include "db migrate", got: ${c.detail}`,
  );
  assert.equal(c.blocking, true);
});

// ── repository ──────────────────────────────────────────────────────────────

test("repository is missing for an empty repository list", () => {
  const report = buildProjectReadiness(facts({ repositories: [] }));
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "missing");
  assert.equal(c.detail, "no repository resource in this project");
  assert.equal(c.probes, undefined);
});

test("repository is unverified for one ambient repository with no probe key", () => {
  const report = buildProjectReadiness(
    facts({ repositories: [repo({ id: "r1", auth: "ambient" })] }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "unverified");
  assert.equal(c.probes, undefined);
});

test("repository is blocked for https-token with a missing credential resource", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [
        repo({
          id: "r1",
          auth: "https-token",
          credentialId: "c1",
          credentialExists: false,
          credentialIsCredentialType: false,
        }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "blocked");
  assert.ok(c.detail.includes("c1"));
  assert.ok(c.detail.toLowerCase().includes("credential"));
});

test("repository is blocked for https-token with a wrong-typed credential reference", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [
        repo({
          id: "r1",
          auth: "https-token",
          credentialId: "c1",
          credentialExists: true,
          credentialIsCredentialType: false,
        }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "blocked");
  assert.ok(c.detail.toLowerCase().includes("credential"));
});

test("repository is unverified for ssh-agent auth (no credential required)", () => {
  const report = buildProjectReadiness(
    facts({ repositories: [repo({ id: "r1", auth: "ssh-agent" })] }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "unverified");
});

test("repository is unverified for ambient auth (no credential required)", () => {
  const report = buildProjectReadiness(
    facts({ repositories: [repo({ id: "r1", auth: "ambient" })] }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "unverified");
});

test("repository is ok when probe key is present and all probes are ok", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      probes: {
        repositories: [{ resourceId: "r1", status: "ok", detail: "ok" }],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("1 of 1"));
  assert.deepEqual(c.probes, [
    { resourceId: "r1", status: "ok", detail: "ok" },
  ]);
});

test("repository is failed when one probe is failed", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      probes: {
        repositories: [{ resourceId: "r1", status: "failed", detail: "nope" }],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.status, "failed");
  assert.ok(c.detail.includes("1 of 1"));
});

test("repository.probes is sorted ascending by resourceId when the key is present", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [
        repo({ id: "r1", auth: "ambient" }),
        repo({ id: "r2", auth: "ambient" }),
        repo({ id: "r3", auth: "ambient" }),
      ],
      probes: {
        repositories: [
          { resourceId: "r3", status: "ok", detail: "ok" },
          { resourceId: "r1", status: "ok", detail: "ok" },
          { resourceId: "r2", status: "ok", detail: "ok" },
        ],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.deepEqual(
    c.probes!.map((p) => p.resourceId),
    ["r1", "r2", "r3"],
  );
});

test("repository.probes is absent when the key is absent", () => {
  const report = buildProjectReadiness(
    facts({ repositories: [repo({ id: "r1", auth: "ambient" })] }),
  );
  const c = report.checks.find((c) => c.name === "repository")!;
  assert.equal(c.probes, undefined);
});

// ── ai_provider ─────────────────────────────────────────────────────────────

test("ai_provider is missing with a detail containing `register` for an empty resolved chain and no assignments", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: { resolved: [], assignedCount: 0 },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "missing");
  assert.ok(c.detail.includes("register"));
});

test("ai_provider is blocked with a detail containing `login` for empty chain with one assignment", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: { resolved: [], assignedCount: 1 },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "blocked");
  assert.ok(c.detail.includes("login"));
});

test("ai_provider is unverified for one assigned member with no probe", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "unverified");
  assert.ok(c.detail.includes("1 ai provider(s) resolved"));
  // No default suffix for an assigned source
  assert.ok(!c.detail.toLowerCase().includes("default"));
});

test("ai_provider is ok when the provider probe succeeded", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      probes: {
        provider: [
          {
            resourceId: "p1",
            status: "ok",
            detail: "ai provider probe succeeded",
          },
        ],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("ai provider probe succeeded"));
});

test("ai_provider is failed when the provider probe failed", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      probes: {
        provider: [{ resourceId: "p1", status: "failed", detail: "401" }],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "failed");
  assert.ok(c.detail.includes("ai provider probe failed"));
});

// ── The default fallback is never stricter than the daemon ──────────────────

test("a default-only resolved provider is unverified (NOT missing) and the detail names both `default` and `assign`", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "default" }],
        assignedCount: 0,
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "unverified");
  assert.ok(
    c.detail.includes("default"),
    `detail should contain "default", got: ${c.detail}`,
  );
  assert.ok(
    c.detail.includes("assign"),
    `detail should contain "assign", got: ${c.detail}`,
  );
});

test("default suffix is present on ai_provider when the probe is ok", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "default" }],
        assignedCount: 0,
      },
      probes: {
        provider: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("default"));
  assert.ok(c.detail.includes("assign"));
});

test("default suffix is present on ai_provider when the probe failed", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "default" }],
        assignedCount: 0,
      },
      probes: {
        provider: [{ resourceId: "p1", status: "failed", detail: "401" }],
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  assert.equal(c.status, "failed");
  assert.ok(c.detail.includes("default"));
  assert.ok(c.detail.includes("assign"));
});

test("default suffix is absent when resolved[0].source is assigned", () => {
  const report = buildProjectReadiness(
    facts({
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "ai_provider")!;
  // The "default" substring here would be a false-positive (it appears in the
  // assignedCount label), so we check the literal default-suffix tail:
  assert.ok(
    !c.detail.includes("resolving via the global default"),
    `assigned detail must not carry the default-suffix tail, got: ${c.detail}`,
  );
});

// ── initiative ──────────────────────────────────────────────────────────────

test("initiative is missing for an empty initiative list", () => {
  const report = buildProjectReadiness(facts({ initiatives: [] }));
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "missing");
  assert.ok(c.detail.includes("no building initiative"));
});

test("initiative is missing for a single landed initiative with incomplete tasks", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [
        init({ id: "i1", status: "landed", incompleteTaskCount: 1 }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "missing");
});

test("initiative is blocked for one building, non-paused, zero-incomplete initiative", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [init({ id: "i1", paused: false, incompleteTaskCount: 0 })],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "blocked");
  assert.ok(c.detail.includes("no incomplete task"));
});

test("initiative is paused for one building, paused, one-incomplete initiative", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [init({ id: "i1", paused: true, incompleteTaskCount: 1 })],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "paused");
  assert.ok(c.detail.includes("paused"));
});

test("initiative is ok for one building, non-paused, one-incomplete initiative", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [init({ id: "i1", paused: false, incompleteTaskCount: 1 })],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("1 incomplete task"));
});

test("initiative is blocked for the mixed case: one paused candidate with work + one non-paused candidate with no work", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [
        init({
          id: "i1",
          name: "paused-with-work",
          paused: true,
          incompleteTaskCount: 1,
        }),
        init({
          id: "i2",
          name: "open-no-work",
          paused: false,
          incompleteTaskCount: 0,
        }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "blocked");
  // The blocked detail must name the non-paused candidate (i2) — not the
  // paused one (i1) — because the "no incomplete task" branch always wins
  // for a non-paused candidate. The detail template carries the NAME (Story 1
  // rule 4), so the fixtures get distinct names to identify the selection.
  assert.ok(c.detail.includes("open-no-work"), `detail: ${c.detail}`);
  assert.ok(!c.detail.includes("paused-with-work"), `detail: ${c.detail}`);
});

// ── Lowest-id tie-break ─────────────────────────────────────────────────────

test("initiative tie-break: two ok-qualifying candidates in descending-id input order → detail names the lowest-id one", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [
        init({
          id: "i2",
          name: "later",
          paused: false,
          incompleteTaskCount: 1,
        }),
        init({
          id: "i1",
          name: "earlier",
          paused: false,
          incompleteTaskCount: 2,
        }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("earlier"), `detail: ${c.detail}`);
  assert.ok(c.detail.includes("2 incomplete task"));
});

test("initiative tie-break: paused detail names the lowest-id paused candidate", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [
        init({ id: "i3", name: "third", paused: true, incompleteTaskCount: 1 }),
        init({
          id: "i2",
          name: "second",
          paused: true,
          incompleteTaskCount: 1,
        }),
        init({ id: "i1", name: "first", paused: true, incompleteTaskCount: 1 }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "paused");
  assert.ok(c.detail.includes("first"), `detail: ${c.detail}`);
});

test("initiative tie-break: blocked detail names the lowest-id non-paused candidate with no incomplete task", () => {
  const report = buildProjectReadiness(
    facts({
      initiatives: [
        init({
          id: "i3",
          name: "third",
          paused: false,
          incompleteTaskCount: 0,
        }),
        init({
          id: "i2",
          name: "second",
          paused: false,
          incompleteTaskCount: 0,
        }),
        init({
          id: "i1",
          name: "lowest",
          paused: false,
          incompleteTaskCount: 0,
        }),
      ],
    }),
  );
  const c = report.checks.find((c) => c.name === "initiative")!;
  assert.equal(c.status, "blocked");
  // The detail template carries the NAME (Story 1 rule 4), so the lowest-id
  // candidate is identified by its distinct name.
  assert.ok(c.detail.includes("lowest"), `detail: ${c.detail}`);
});

// ── notification ────────────────────────────────────────────────────────────

test("notification is unsupported, non-blocking, with detail naming `list event --follow`", () => {
  const report = buildProjectReadiness(facts());
  const c = report.checks.find((c) => c.name === "notification")!;
  assert.equal(c.status, "unsupported");
  assert.equal(c.blocking, false);
  assert.ok(c.detail.includes("list event --follow"));
  assert.equal(c.probes, undefined);
});

test("notification does NOT affect configured even when every config check would block", () => {
  const report = buildProjectReadiness(
    facts({
      database: { schemaVersion: 0, expectedSchemaVersion: 28 },
      repositories: [],
      aiProvider: { resolved: [], assignedCount: 0 },
      initiatives: [],
    }),
  );
  // `unsupported` is not in NOT_CONFIGURED_STATUSES so configured flips to
  // false on the three real blockers, not on notification.
  assert.equal(report.configured, false);
  // The check itself remains unsupported; it never inherits a different status.
  const c = report.checks.find((c) => c.name === "notification")!;
  assert.equal(c.status, "unsupported");
});

// ── daemon ──────────────────────────────────────────────────────────────────

test("daemon is stopped with ageSeconds=null for zero instances", () => {
  const report = buildProjectReadiness(
    facts({ daemon: { instances: [], staleMs: 6000 } }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "stopped");
  assert.equal(c.ageSeconds, null);
  assert.equal(c.blocking, true);
});

test("daemon is running with ageSeconds=5 for ageMs=5999 (just below threshold)", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: { instances: [instance({ ageMs: 5999 })], staleMs: 6000 },
    }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "running");
  assert.equal(c.ageSeconds, 5);
});

test("daemon is running at the exact boundary ageMs=6000 (inclusive) with ageSeconds=6", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: { instances: [instance({ ageMs: 6000 })], staleMs: 6000 },
    }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "running");
  assert.equal(c.ageSeconds, 6);
});

test("daemon is stopped for ageMs=6001 (just above threshold)", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: { instances: [instance({ ageMs: 6001 })], staleMs: 6000 },
    }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "stopped");
  assert.equal(c.ageSeconds, null);
});

test("daemon is multiple with both instance ids in the detail and the smaller ageSeconds", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: {
        instances: [
          instance({ instanceId: "z:9", ageMs: 4000 }),
          instance({ instanceId: "a:1", ageMs: 1000 }),
        ],
        staleMs: 6000,
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "multiple");
  assert.equal(c.ageSeconds, 1);
  assert.ok(c.detail.includes("a:1"));
  assert.ok(c.detail.includes("z:9"));
});

test("daemon is running when one instance is live and one is stale", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: {
        instances: [
          instance({ instanceId: "stale:1", ageMs: 7000 }),
          instance({ instanceId: "live:1", ageMs: 1000 }),
        ],
        staleMs: 6000,
      },
    }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "running");
  assert.equal(c.ageSeconds, 1);
});

test("daemon ageSeconds=0 for ageMs=0", () => {
  const report = buildProjectReadiness(
    facts({ daemon: { instances: [instance({ ageMs: 0 })], staleMs: 6000 } }),
  );
  const c = report.checks.find((c) => c.name === "daemon")!;
  assert.equal(c.status, "running");
  assert.equal(c.ageSeconds, 0);
});

// ── Verdicts: configured ────────────────────────────────────────────────────

test("configured is false when any of the four config checks is missing/paused/blocked", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [],
      // ai_provider, initiative stay ok-ish
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
    }),
  );
  assert.equal(report.configured, false);
});

test("configured is true when repository and ai_provider are unverified, initiative is ok, and database is ok", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
    }),
  );
  assert.equal(report.configured, true);
});

test("configured is true even when a repository probe failed (a probe result must not change configured)", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      probes: {
        repositories: [{ resourceId: "r1", status: "failed", detail: "nope" }],
      },
    }),
  );
  assert.equal(report.configured, true);
});

// ── Verdicts: verified ──────────────────────────────────────────────────────

test("verified is null when both probe keys are absent (never true)", () => {
  const report = buildProjectReadiness(facts());
  assert.equal(report.verified, null);
});

test("verified is true when only the repositories probe key is present and all probes are ok", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      probes: {
        repositories: [{ resourceId: "r1", status: "ok", detail: "ok" }],
      },
    }),
  );
  assert.equal(report.verified, true);
});

test("verified is false when one of several probes is failed", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [
        repo({ id: "r1", auth: "ambient" }),
        repo({ id: "r2", auth: "ambient" }),
      ],
      probes: {
        repositories: [
          { resourceId: "r1", status: "ok", detail: "ok" },
          { resourceId: "r2", status: "failed", detail: "nope" },
        ],
      },
    }),
  );
  assert.equal(report.verified, false);
});

// The EPIC's Gate and its Decisions both require `verified` to be `true` ONLY
// when at least one probe ran: "never `true` by vacuous default". A probe key
// present with an empty array means nothing was probed, so the verdict is
// `null` — the same as passing no flag at all.
test("verified is null when a probe key is present but its array is empty (nothing ran)", () => {
  const report = buildProjectReadiness(
    facts({ probes: { repositories: [] satisfies ProbeRecord[] } }),
  );
  assert.equal(report.verified, null);
});

test("verified is null when both probe keys are present but both arrays are empty", () => {
  const report = buildProjectReadiness(
    facts({
      probes: {
        repositories: [] satisfies ProbeRecord[],
        provider: [] satisfies ProbeRecord[],
      },
    }),
  );
  assert.equal(report.verified, null);
});

test("a vacuous verified can never make ready true", () => {
  const report = buildProjectReadiness(
    facts({
      probes: { repositories: [] satisfies ProbeRecord[] },
      daemon: { instances: [{ instanceId: "1:1", ageMs: 0 }], staleMs: 6000 },
    }),
  );
  assert.equal(report.verified, null);
  assert.equal(report.ready, false);
});

// ── Verdicts: operational ──────────────────────────────────────────────────

test("operational is false for a stopped daemon", () => {
  const report = buildProjectReadiness(
    facts({ daemon: { instances: [], staleMs: 6000 } }),
  );
  assert.equal(report.operational, false);
});

test("operational is true for a running daemon", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: { instances: [instance({ ageMs: 100 })], staleMs: 6000 },
    }),
  );
  assert.equal(report.operational, true);
});

test("operational is true for multiple live daemons", () => {
  const report = buildProjectReadiness(
    facts({
      daemon: {
        instances: [
          instance({ instanceId: "a:1", ageMs: 100 }),
          instance({ instanceId: "b:1", ageMs: 100 }),
        ],
        staleMs: 6000,
      },
    }),
  );
  assert.equal(report.operational, true);
});

// ── Verdicts: ready ────────────────────────────────────────────────────────

test("ready is true only when configured && verified === true && operational", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: { instances: [instance({ ageMs: 100 })], staleMs: 6000 },
      probes: {
        repositories: [{ resourceId: "r1", status: "ok", detail: "ok" }],
        provider: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
    }),
  );
  assert.equal(report.configured, true);
  assert.equal(report.verified, true);
  assert.equal(report.operational, true);
  assert.equal(report.ready, true);
});

test("ready is false for a perfect config with a stopped daemon", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: { instances: [], staleMs: 6000 },
    }),
  );
  assert.equal(report.configured, true);
  assert.equal(report.operational, false);
  assert.equal(report.ready, false);
});

test("ready is false when configured && operational but verified is null", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: { instances: [instance({ ageMs: 100 })], staleMs: 6000 },
    }),
  );
  assert.equal(report.configured, true);
  assert.equal(report.verified, null);
  assert.equal(report.operational, true);
  assert.equal(report.ready, false);
});

// ── next is null when nothing is actionable (Story 2) ────────────────────────

test("next is null when every check is not actionable (all green)", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: { instances: [instance({ ageMs: 0 })], staleMs: 6000 },
      probes: {
        repositories: [{ resourceId: "r1", status: "ok", detail: "ok" }],
        provider: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
    }),
  );
  assert.equal(report.next, null);
  assert.equal(report.ready, true);
});

// ── Purity / immutability ───────────────────────────────────────────────────

test("buildProjectReadiness does not mutate the caller's repository or initiative array", () => {
  const r1 = repo({ id: "r3" });
  const r2 = repo({ id: "r2" });
  const r3 = repo({ id: "r1" });
  const repositories = [r1, r2, r3];
  const before = repositories.map((r) => r.id);
  const i1 = init({ id: "i3" });
  const i2 = init({ id: "i2" });
  const i3 = init({ id: "i1" });
  const initiatives = [i1, i2, i3];

  buildProjectReadiness(facts({ repositories, initiatives }));

  assert.deepEqual(
    repositories.map((r) => r.id),
    before,
  );
  assert.deepEqual(
    initiatives.map((i) => i.id),
    ["i3", "i2", "i1"],
  );
});

test("buildProjectReadiness is deterministic: same facts → deeply equal reports", () => {
  const f = facts({
    repositories: [
      repo({ id: "r1", auth: "ambient" }),
      repo({ id: "r2", auth: "ambient" }),
    ],
    aiProvider: {
      resolved: [{ id: "p1", name: "p1", source: "assigned" }],
      assignedCount: 1,
    },
    initiatives: [init({ incompleteTaskCount: 1 })],
    daemon: { instances: [instance({ ageMs: 100 })], staleMs: 6000 },
  });
  const r1 = buildProjectReadiness(f);
  const r2 = buildProjectReadiness(f);
  assert.deepEqual(r1, r2);
});

// ── Zero-import guard ──────────────────────────────────────────────────────

test('project-readiness.ts imports nothing (no `from "` and no `require(`)', () => {
  // Resolve the source file relative to this test file, not via the runtime
  // import — the test runs even if the module is broken.
  const source = readFileSync(
    new URL("./project-readiness.ts", import.meta.url),
    "utf8",
  );
  // Strip line and block comments so a doc comment naming the test's assertion
  // (e.g. "no `from \"`") does not trip the scan. The intent is to forbid
  // import statements and require() calls, not to forbid the literal substrings
  // appearing in prose.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !code.includes('from "'),
    `project-readiness.ts must contain zero imports; found: ${code
      .split("\n")
      .filter((l) => l.includes('from "'))
      .join(", ")}`,
  );
  assert.ok(
    !code.includes("require("),
    "project-readiness.ts must contain no require() call",
  );
});

// ── Story 2 — structured `next` action ───────────────────────────────────────

test("next advances past unverified checks (repository missing wins over initiative missing)", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [],
    }),
  );
  assert.notEqual(report.next, null);
  assert.equal(report.next?.check, "repository");
  assert.equal(report.next?.action, "configure a repository for this project");
  assert.deepEqual(report.next?.requiresInput, [
    "name",
    "remoteUrl",
    "branch",
    "auth",
    "path",
  ]);
  assert.equal("command" in (report.next as object), false);
});

test("next advances past unverified: repository unverified + ai_provider missing → ai_provider", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: { resolved: [], assignedCount: 0 },
      initiatives: [init({ incompleteTaskCount: 1 })],
    }),
  );
  assert.equal(report.next?.check, "ai_provider");
  assert.equal(report.next?.action, "register an ai provider");
});

test("next advances past unverified: both repository and ai_provider unverified → initiative", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [],
    }),
  );
  assert.equal(report.next?.check, "initiative");
  assert.equal(
    report.next?.action,
    "create an initiative with at least one task",
  );
  assert.deepEqual(report.next?.requiresInput, ["name"]);
});

test("a default-resolved provider is not a next: skips to initiative missing", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "default" }],
        assignedCount: 0,
      },
      initiatives: [],
    }),
  );
  // The default-resolved provider is unverified, which is not actionable.
  assert.equal(report.next?.check, "initiative");
  // The ai_provider detail still names both `default` and `assign`.
  const aiProviderCheck = report.checks.find((c) => c.name === "ai_provider");
  assert.equal(aiProviderCheck?.status, "unverified");
  assert.ok(aiProviderCheck?.detail.includes("default"));
  assert.ok(aiProviderCheck?.detail.includes("assign"));
});

test("repository missing: requiresInput names remoteUrl and auth; command is absent", () => {
  const report = buildProjectReadiness(facts({ repositories: [] }));
  assert.equal(report.next?.check, "repository");
  const requires = report.next?.requiresInput ?? [];
  assert.ok(requires.includes("remoteUrl"));
  assert.ok(requires.includes("auth"));
  // `command` must be a property-absent (not just falsy) — JSON.stringify drops it.
  assert.equal("command" in (report.next as object), false);
});

test("repository blocked (dangling credential): requiresInput names credential", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [
        repo({
          id: "r1",
          auth: "https-token",
          credentialId: "cred-x",
          credentialExists: false,
        }),
      ],
    }),
  );
  assert.equal(report.next?.check, "repository");
  assert.equal(
    report.next?.action,
    "point the repository at an existing credential resource",
  );
  assert.deepEqual(report.next?.requiresInput, ["credential"]);
  assert.equal("command" in (report.next as object), false);
});

test("repository failed (probe failure): requiresInput names remoteUrl and auth", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      probes: {
        repositories: [
          { resourceId: "r1", status: "failed", detail: "fatal: not found" },
        ],
      },
    }),
  );
  assert.equal(report.next?.check, "repository");
  assert.equal(
    report.next?.action,
    "fix remote access for the repository that failed its probe",
  );
  assert.deepEqual(report.next?.requiresInput, ["remoteUrl", "auth"]);
  assert.equal("command" in (report.next as object), false);
});

test("ai_provider missing: requiresInput names name, provider, model, valueFile", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: { resolved: [], assignedCount: 0 },
      initiatives: [init({ incompleteTaskCount: 1 })],
    }),
  );
  assert.equal(report.next?.check, "ai_provider");
  const requires = report.next?.requiresInput ?? [];
  assert.ok(requires.includes("name"));
  assert.ok(requires.includes("provider"));
  assert.ok(requires.includes("model"));
  assert.ok(requires.includes("valueFile"));
  assert.equal("command" in (report.next as object), false);
});

test("ai_provider blocked: requiresInput names valueFile", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: { resolved: [], assignedCount: 1 },
      initiatives: [init({ incompleteTaskCount: 1 })],
    }),
  );
  assert.equal(report.next?.check, "ai_provider");
  assert.equal(report.next?.action, "re-authenticate the assigned ai provider");
  assert.deepEqual(report.next?.requiresInput, ["valueFile"]);
});

test("ai_provider failed: requiresInput names valueFile", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      probes: {
        provider: [{ resourceId: "p1", status: "failed", detail: "401" }],
      },
    }),
  );
  assert.equal(report.next?.check, "ai_provider");
  assert.equal(
    report.next?.action,
    "replace the credential of the assigned ai provider",
  );
  assert.deepEqual(report.next?.requiresInput, ["valueFile"]);
});

test("initiative missing: requiresInput names name", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [],
    }),
  );
  assert.equal(report.next?.check, "initiative");
  assert.equal(
    report.next?.action,
    "create an initiative with at least one task",
  );
  assert.deepEqual(report.next?.requiresInput, ["name"]);
  assert.equal("command" in (report.next as object), false);
});

test("initiative paused: command carries the lowest-id paused candidate", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [
        init({
          id: "i9",
          name: "later",
          status: "building",
          paused: true,
          incompleteTaskCount: 1,
        }),
        init({
          id: "i2",
          name: "earlier",
          status: "building",
          paused: true,
          incompleteTaskCount: 1,
        }),
        init({
          id: "i5",
          name: "middle",
          status: "building",
          paused: true,
          incompleteTaskCount: 1,
        }),
      ],
    }),
  );
  assert.equal(report.next?.check, "initiative");
  assert.equal(report.next?.action, "resume the paused initiative");
  assert.equal(report.next?.requiresInput.length, 0);
  assert.equal(report.next?.command, "kanthord resume initiative --id i2");
});

test("initiative blocked: requiresInput names objective, title, instructions, ac", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 0 })],
    }),
  );
  assert.equal(report.next?.check, "initiative");
  assert.equal(report.next?.action, "add a task to the initiative");
  const requires = report.next?.requiresInput ?? [];
  assert.ok(requires.includes("objective"));
  assert.ok(requires.includes("title"));
  assert.ok(requires.includes("instructions"));
  assert.ok(requires.includes("ac"));
  assert.equal("command" in (report.next as object), false);
});

test("daemon stopped with everything else ok/unverified: command is 'kanthord run daemon'", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: { instances: [], staleMs: 6000 },
    }),
  );
  assert.equal(report.next?.check, "daemon");
  assert.equal(report.next?.action, "start the daemon");
  assert.equal(report.next?.requiresInput.length, 0);
  assert.equal(report.next?.command, "kanthord run daemon");
});

test("database blocked wins over everything: command is 'kanthord db migrate'", () => {
  const report = buildProjectReadiness(
    facts({
      database: { schemaVersion: 27, expectedSchemaVersion: 28 },
      repositories: [],
      aiProvider: { resolved: [], assignedCount: 0 },
      initiatives: [],
    }),
  );
  assert.equal(report.next?.check, "database");
  assert.equal(report.next?.action, "apply the pending database migrations");
  assert.equal(report.next?.command, "kanthord db migrate");
});

test("multiple daemon instances is not actionable: next is null", () => {
  const report = buildProjectReadiness(
    facts({
      repositories: [repo({ id: "r1", auth: "ambient" })],
      aiProvider: {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      },
      initiatives: [init({ incompleteTaskCount: 1 })],
      daemon: {
        instances: [
          instance({ instanceId: "1:1000", ageMs: 100 }),
          instance({ instanceId: "2:2000", ageMs: 200 }),
        ],
        staleMs: 6000,
      },
    }),
  );
  assert.equal(report.next, null);
});

test("invariant: command is present exactly when requiresInput is empty", () => {
  // Iterate every fact shape in this story and assert the invariant.
  const cases: Array<{
    label: string;
    report: ReturnType<typeof buildProjectReadiness>;
  }> = [];

  // (1) All green
  cases.push({
    label: "all green",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        },
        initiatives: [init({ incompleteTaskCount: 1 })],
        daemon: { instances: [instance({ ageMs: 0 })], staleMs: 6000 },
        probes: {
          repositories: [{ resourceId: "r1", status: "ok", detail: "ok" }],
          provider: [{ resourceId: "p1", status: "ok", detail: "ok" }],
        },
      }),
    ),
  });
  // (2) Database blocked
  cases.push({
    label: "database blocked",
    report: buildProjectReadiness(
      facts({ database: { schemaVersion: 27, expectedSchemaVersion: 28 } }),
    ),
  });
  // (3) Repository missing
  cases.push({
    label: "repository missing",
    report: buildProjectReadiness(facts({ repositories: [] })),
  });
  // (4) Repository blocked
  cases.push({
    label: "repository blocked",
    report: buildProjectReadiness(
      facts({
        repositories: [
          repo({
            id: "r1",
            auth: "https-token",
            credentialId: "x",
            credentialExists: false,
          }),
        ],
      }),
    ),
  });
  // (5) Repository failed
  cases.push({
    label: "repository failed",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        probes: {
          repositories: [{ resourceId: "r1", status: "failed", detail: "x" }],
        },
      }),
    ),
  });
  // (6) Ai provider missing
  cases.push({
    label: "ai_provider missing",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: { resolved: [], assignedCount: 0 },
        initiatives: [init({ incompleteTaskCount: 1 })],
      }),
    ),
  });
  // (7) Ai provider blocked
  cases.push({
    label: "ai_provider blocked",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: { resolved: [], assignedCount: 1 },
        initiatives: [init({ incompleteTaskCount: 1 })],
      }),
    ),
  });
  // (8) Ai provider failed
  cases.push({
    label: "ai_provider failed",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        },
        initiatives: [init({ incompleteTaskCount: 1 })],
        probes: {
          provider: [{ resourceId: "p1", status: "failed", detail: "x" }],
        },
      }),
    ),
  });
  // (9) Initiative missing
  cases.push({
    label: "initiative missing",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        },
        initiatives: [],
      }),
    ),
  });
  // (10) Initiative paused
  cases.push({
    label: "initiative paused",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        },
        initiatives: [init({ paused: true, incompleteTaskCount: 1 })],
      }),
    ),
  });
  // (11) Initiative blocked
  cases.push({
    label: "initiative blocked",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        },
        initiatives: [init({ incompleteTaskCount: 0 })],
      }),
    ),
  });
  // (12) Daemon stopped
  cases.push({
    label: "daemon stopped",
    report: buildProjectReadiness(
      facts({
        repositories: [repo({ id: "r1", auth: "ambient" })],
        aiProvider: {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        },
        initiatives: [init({ incompleteTaskCount: 1 })],
      }),
    ),
  });

  for (const { label, report } of cases) {
    const next = report.next;
    if (next === null) {
      // null is always a valid `next`; nothing to check.
      continue;
    }
    const hasCommand = "command" in next;
    const requiresEmpty = next.requiresInput.length === 0;
    // XOR: hasCommand is true iff requiresInput is empty.
    assert.equal(
      hasCommand,
      requiresEmpty,
      `invariant broken for "${label}": hasCommand=${hasCommand}, requiresEmpty=${requiresEmpty}, next=${JSON.stringify(next)}`,
    );
  }
});

test("every (check, actionable status) pair the Story 1 rules can emit has a row", () => {
  // Build one fact shape per pair, all in the same order as the Story 2 table.
  // For each, assert the report's `next` is non-null and the check name matches.
  type Pair = {
    check: string;
    status: string;
    expectedAction: string;
    expectedCommand?: string;
  };
  const PAIRS: Pair[] = [
    {
      check: "database",
      status: "blocked",
      expectedAction: "apply the pending database migrations",
      expectedCommand: "kanthord db migrate",
    },
    {
      check: "repository",
      status: "missing",
      expectedAction: "configure a repository for this project",
    },
    {
      check: "repository",
      status: "blocked",
      expectedAction: "point the repository at an existing credential resource",
    },
    {
      check: "repository",
      status: "failed",
      expectedAction:
        "fix remote access for the repository that failed its probe",
    },
    {
      check: "ai_provider",
      status: "missing",
      expectedAction: "register an ai provider",
    },
    {
      check: "ai_provider",
      status: "blocked",
      expectedAction: "re-authenticate the assigned ai provider",
    },
    {
      check: "ai_provider",
      status: "failed",
      expectedAction: "replace the credential of the assigned ai provider",
    },
    {
      check: "initiative",
      status: "missing",
      expectedAction: "create an initiative with at least one task",
    },
    {
      check: "initiative",
      status: "paused",
      expectedAction: "resume the paused initiative",
      expectedCommand: "kanthord resume initiative --id i1",
    },
    {
      check: "initiative",
      status: "blocked",
      expectedAction: "add a task to the initiative",
    },
    {
      check: "daemon",
      status: "stopped",
      expectedAction: "start the daemon",
      expectedCommand: "kanthord run daemon",
    },
  ];

  // For each pair, build a fact shape that produces it as the FIRST actionable
  // check. Anything that came earlier in CHECK_ORDER must be `ok` or
  // `unverified` (or `unsupported` for notification).
  for (const pair of PAIRS) {
    const partial: Partial<Parameters<typeof facts>[0]> = {};

    // The first four checks (database, repository, ai_provider, initiative)
    // are CONFIG_CHECKS. If the target check is one of them, the others must
    // be `ok` or `unverified` so they don't steal the next.
    if (pair.check !== "database") {
      partial.database = { schemaVersion: 28, expectedSchemaVersion: 28 };
    } else {
      partial.database = { schemaVersion: 27, expectedSchemaVersion: 28 };
    }
    if (pair.check !== "repository") {
      partial.repositories = [repo({ id: "r1", auth: "ambient" })];
    } else {
      // Pick the variant the pair needs.
      if (pair.status === "missing") partial.repositories = [];
      else if (pair.status === "blocked")
        partial.repositories = [
          repo({
            id: "r1",
            auth: "https-token",
            credentialId: "x",
            credentialExists: false,
          }),
        ];
      else if (pair.status === "failed") {
        partial.repositories = [repo({ id: "r1", auth: "ambient" })];
        partial.probes = {
          repositories: [{ resourceId: "r1", status: "failed", detail: "x" }],
        };
      }
    }
    if (pair.check !== "ai_provider") {
      partial.aiProvider = {
        resolved: [{ id: "p1", name: "p1", source: "assigned" }],
        assignedCount: 1,
      };
    } else {
      if (pair.status === "missing")
        partial.aiProvider = { resolved: [], assignedCount: 0 };
      else if (pair.status === "blocked")
        partial.aiProvider = { resolved: [], assignedCount: 1 };
      else if (pair.status === "failed") {
        partial.aiProvider = {
          resolved: [{ id: "p1", name: "p1", source: "assigned" }],
          assignedCount: 1,
        };
        partial.probes = {
          provider: [{ resourceId: "p1", status: "failed", detail: "x" }],
        };
      }
    }
    if (pair.check !== "initiative") {
      partial.initiatives = [init({ incompleteTaskCount: 1 })];
    } else {
      if (pair.status === "missing") partial.initiatives = [];
      else if (pair.status === "paused")
        partial.initiatives = [init({ paused: true, incompleteTaskCount: 1 })];
      else if (pair.status === "blocked")
        partial.initiatives = [init({ incompleteTaskCount: 0 })];
    }
    // Daemon: only a target if pair.check === "daemon". Otherwise no instances
    // — but if a non-daemon pair comes AFTER daemon, daemon would be the first
    // actionable. So set daemon to running for non-daemon targets.
    if (pair.check !== "daemon") {
      partial.daemon = { instances: [instance({ ageMs: 0 })], staleMs: 6000 };
    } else {
      partial.daemon = { instances: [], staleMs: 6000 };
    }

    const report = buildProjectReadiness(facts(partial));
    assert.notEqual(
      report.next,
      null,
      `pair ${pair.check}/${pair.status}: expected non-null next`,
    );
    assert.equal(
      report.next?.check,
      pair.check,
      `pair ${pair.check}/${pair.status}: wrong check name`,
    );
    assert.equal(
      report.next?.action,
      pair.expectedAction,
      `pair ${pair.check}/${pair.status}: wrong action`,
    );
    if (pair.expectedCommand !== undefined) {
      assert.equal(
        report.next?.command,
        pair.expectedCommand,
        `pair ${pair.check}/${pair.status}: wrong command`,
      );
    } else {
      assert.equal(
        "command" in (report.next as object),
        false,
        `pair ${pair.check}/${pair.status}: command must be absent`,
      );
    }
  }
});
