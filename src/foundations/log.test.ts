import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, errMessage } from "./log.ts";

/** A capturing pino destination: collects each written JSON line. */
function capture(): { stream: { write(s: string): void }; records: () => Array<Record<string, unknown>> } {
  const lines: string[] = [];
  return {
    stream: { write: (s: string): void => { lines.push(s); } },
    records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

test("logger emits one structured line per call with the event attribute + fields", () => {
  const cap = capture();
  const log = createLogger({ level: "debug" }, cap.stream);
  log.debug("probe-event", { path: "/tmp/x", count: 2 });
  log.warn("anomaly-event");
  const recs = cap.records();
  assert.equal(recs.length, 2);
  assert.equal(recs[0]!["event"], "probe-event");
  assert.equal(recs[0]!["path"], "/tmp/x");
  assert.equal(recs[0]!["count"], 2);
  assert.equal(recs[1]!["event"], "anomaly-event");
});

test("level threshold suppresses below the configured level (warn default hides debug)", () => {
  const cap = capture();
  const log = createLogger({ level: "warn" }, cap.stream);
  log.debug("hidden-breadcrumb");
  log.warn("shown-anomaly");
  const events = cap.records().map((r) => r["event"]);
  assert.ok(!events.includes("hidden-breadcrumb"), "debug must be suppressed at warn level");
  assert.ok(events.includes("shown-anomaly"), "warn must be emitted at warn level");
});

test("errMessage normalizes Error and non-Error values", () => {
  assert.equal(errMessage(new Error("boom")), "boom");
  assert.equal(errMessage("plain string"), "plain string");
  assert.equal(errMessage(42), "42");
});
