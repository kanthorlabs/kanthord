// src/apps/http/views/readiness.test.ts — Story S8 §3
import { test } from "node:test";
import assert from "node:assert/strict";
import { readinessEntryView, projectReadinessView } from "./readiness.ts";
import type { ReadinessEntry } from "../../../app/graph/check-graph.ts";
import type { ReadinessReport } from "../../../app/project/project-readiness.ts";

test("readinessEntryView gives exactly ['id','state','waiting'], waiting is a copy", () => {
  const input: ReadinessEntry = { id: "n1", state: "ready", waiting: ["a"] };
  const view = readinessEntryView(input);
  assert.deepEqual(Object.keys(view).sort(), ["id", "state", "waiting"]);
  assert.equal(view.id, "n1");
  assert.equal(view.state, "ready");
  assert.deepEqual(view.waiting, ["a"]);
  assert.notEqual(view.waiting, input.waiting);
});

function fullReport(): ReadinessReport & Record<string, unknown> {
  return {
    projectId: "p1",
    configured: true,
    verified: null,
    operational: false,
    ready: false,
    checks: [
      {
        name: "database",
        status: "ok",
        blocking: false,
        detail: "d1",
        probes: [{ resourceId: "r1", status: "ok", detail: "probed" }],
        ageSeconds: null,
      },
      {
        name: "daemon",
        status: "missing",
        blocking: true,
        detail: "d2",
      },
    ],
    next: {
      check: "daemon",
      action: "start daemon",
      requiresInput: ["confirm"],
      command: "kanthord serve",
    },
    extraTopLevel: "drop me",
  } as unknown as ReadinessReport & Record<string, unknown>;
}

test("projectReadinessView top-level key set is exactly the declared list", () => {
  const view = projectReadinessView(fullReport());
  assert.deepEqual(Object.keys(view).sort(), [
    "checks",
    "configured",
    "next",
    "operational",
    "projectId",
    "ready",
    "verified",
  ]);
  assert.equal("extraTopLevel" in view, false);
});

test("projectReadinessView check key sets: one with probes+ageSeconds, one with neither", () => {
  const view = projectReadinessView(fullReport());
  const checks = view.checks as unknown as Array<Record<string, unknown>>;
  assert.equal(checks.length, 2);
  const first = checks[0] as Record<string, unknown>;
  const second = checks[1] as Record<string, unknown>;
  assert.deepEqual(Object.keys(first).sort(), [
    "ageSeconds",
    "blocking",
    "detail",
    "name",
    "probes",
    "status",
  ]);
  assert.deepEqual(Object.keys(second).sort(), [
    "blocking",
    "detail",
    "name",
    "status",
  ]);
  assert.equal("probes" in second, false);
  assert.equal("ageSeconds" in second, false);
});

test("projectReadinessView check probes entries are exactly ['detail','resourceId','status']", () => {
  const view = projectReadinessView(fullReport());
  const checks = view.checks as unknown as Array<Record<string, unknown>>;
  const first = checks[0] as Record<string, unknown>;
  const probes = first.probes as unknown as Array<Record<string, unknown>>;
  const firstProbe = probes[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(firstProbe).sort(), [
    "detail",
    "resourceId",
    "status",
  ]);
});

test("projectReadinessView next is exactly ['action','check','requiresInput'] when command is absent", () => {
  const report = fullReport();
  report.next = { check: "database", action: "fix db", requiresInput: [] };
  const view = projectReadinessView(report);
  const next = view.next as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(next).sort(), [
    "action",
    "check",
    "requiresInput",
  ]);
});

test("projectReadinessView: next null survives as null", () => {
  const report = fullReport();
  report.next = null;
  const view = projectReadinessView(report);
  assert.equal(view.next, null);
});

test("projectReadinessView: verified null survives as null", () => {
  const view = projectReadinessView(fullReport());
  assert.equal(view.verified, null);
});

test("projectReadinessView: ageSeconds null survives as null (checked via !== undefined, not truthiness)", () => {
  const view = projectReadinessView(fullReport());
  const checks = view.checks as unknown as Array<Record<string, unknown>>;
  const first = checks[0] as Record<string, unknown>;
  assert.equal(first.ageSeconds, null);
});
