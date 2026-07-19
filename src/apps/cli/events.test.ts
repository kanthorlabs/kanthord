import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event } from "../../domain/event.ts";
import { runEvents } from "./events.ts";

/** Fake `ListEvents` backed by a mutable in-process array. */
class FakeListEvents {
  readonly events: Event[];

  constructor(events: Event[]) {
    this.events = events;
  }

  execute({ after, limit }: { after: string; limit?: number }): Event[] {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    const filtered = this.events.filter((e) => e.id > after);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }
}

// Utility: no-op sleep and a never-aborting signal.
const noopSleep = (): Promise<void> => Promise.resolve();
const neverAbort = new AbortController().signal;

const E1: Event = { id: "A1", type: "task.ready", taskId: "T1" };
const E2: Event = { id: "B2", type: "task.started", taskId: "T1" };
const E3: Event = {
  id: "C3",
  type: "task.completed",
  taskId: "T1",
  payload: { reason: "done" },
};

test("events --after 0 prints all events as human lines and --json produces ndjson with payload", async () => {
  const feed = new FakeListEvents([E1, E2, E3]);

  // Human output (no --json)
  const human = await runEvents({ after: "0" }, feed, noopSleep, neverAbort);
  assert.equal(human.exitCode, 0);
  assert.equal(human.stderr.length, 3, "three human lines on stderr");
  // Each line: "<id> <type> <taskId>" [+ " <payload JSON>"]
  assert.ok(human.stderr[0]!.includes("A1"), "line 0 contains id");
  assert.ok(human.stderr[0]!.includes("task.ready"), "line 0 contains type");
  assert.ok(human.stderr[0]!.includes("T1"), "line 0 contains taskId");
  // E3 has a payload — it must appear in the line
  assert.ok(
    human.stderr[2]!.includes('"reason"'),
    "E3 line includes payload JSON",
  );

  // --json ndjson on stdout
  const jsonOut = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );
  assert.equal(jsonOut.exitCode, 0);
  assert.equal(jsonOut.stdout.length, 3, "three ndjson lines on stdout");
  const parsed = jsonOut.stdout.map((l) => JSON.parse(l));
  assert.deepEqual(parsed[0], E1);
  assert.deepEqual(parsed[2], E3);
});

test("events --after <mid-cursor> prints only newer events", async () => {
  const feed = new FakeListEvents([E1, E2, E3]);

  const result = await runEvents({ after: "A1" }, feed, noopSleep, neverAbort);
  assert.equal(result.exitCode, 0);
  // Only E2 and E3 come after cursor "A1"
  assert.equal(result.stderr.length, 2, "only 2 events after mid-cursor");
  assert.ok(result.stderr[0]!.includes("B2"));
  assert.ok(result.stderr[1]!.includes("C3"));
});

test("events --limit 2 makes three immediate reads for 5 events with no sleep between full pages", async () => {
  const events: Event[] = [
    { id: "A", type: "task.ready", taskId: "T1" },
    { id: "B", type: "task.ready", taskId: "T2" },
    { id: "C", type: "task.started", taskId: "T1" },
    { id: "D", type: "task.started", taskId: "T2" },
    { id: "E", type: "task.completed", taskId: "T1" },
  ];
  const feed = new FakeListEvents(events);

  let sleepCalls = 0;
  const trackSleep = async (_ms: number) => {
    sleepCalls++;
  };

  const result = await runEvents(
    { after: "0", limit: 2 },
    feed,
    trackSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.length, 5, "all 5 events printed exactly once");
  assert.equal(sleepCalls, 0, "sleep never called between full pages");
});

test("events --follow with injected sleep: two polls with an append between print every event exactly once then abort exits 0", async () => {
  // Start with E1, E2
  const events: Event[] = [
    { id: "A1", type: "task.ready", taskId: "T1" },
    { id: "B2", type: "task.started", taskId: "T1" },
  ];
  const E3: Event = { id: "C3", type: "task.completed", taskId: "T1" };

  const feed = new FakeListEvents(events);

  const ac = new AbortController();
  let sleepCalls = 0;
  const mockSleep = async (_ms: number) => {
    sleepCalls++;
    if (sleepCalls === 1) {
      // append E3 between poll 1 and poll 2
      events.push(E3);
    }
    if (sleepCalls === 2) {
      // abort before poll 3 so the loop exits
      ac.abort();
    }
  };

  const result = await runEvents(
    { after: "0", follow: true, "poll-interval": "50" },
    feed,
    mockSleep,
    ac.signal,
  );

  assert.equal(result.exitCode, 0, "exits 0 on clean abort");
  // E1, E2 from poll 1; E3 from poll 2 — each exactly once
  assert.equal(result.stderr.length, 3, "all 3 events printed exactly once");
  assert.ok(result.stderr[0]!.includes("A1"));
  assert.ok(result.stderr[1]!.includes("B2"));
  assert.ok(result.stderr[2]!.includes("C3"));
});

// (A3) Display throttle: human mode throttles agent.progress per taskId; json emits all

test("(A3 display throttle) human mode: 3 consecutive agent.progress for same taskId produce 1 stderr line", async () => {
  const prog1: Event = {
    id: "P1",
    type: "agent.progress",
    taskId: "T1",
    payload: { tool: "read", summary: "read /a" },
  };
  const prog2: Event = {
    id: "P2",
    type: "agent.progress",
    taskId: "T1",
    payload: { tool: "read", summary: "read /b" },
  };
  const prog3: Event = {
    id: "P3",
    type: "agent.progress",
    taskId: "T1",
    payload: { tool: "read", summary: "read /c" },
  };
  const feed = new FakeListEvents([prog1, prog2, prog3]);

  const result = await runEvents({ after: "0" }, feed, noopSleep, neverAbort);
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stderr.length,
    1,
    `human mode: only first agent.progress for taskId shown within 5 s window; got ${result.stderr.length}`,
  );
  assert.ok(result.stderr[0]!.includes("P1"), "first event id in output");
});

test("(A3 display throttle) json mode: 3 consecutive agent.progress for same taskId all emit to stdout", async () => {
  const prog1: Event = {
    id: "P1",
    type: "agent.progress",
    taskId: "T1",
    payload: { tool: "read", summary: "read /a" },
  };
  const prog2: Event = {
    id: "P2",
    type: "agent.progress",
    taskId: "T1",
    payload: { tool: "read", summary: "read /b" },
  };
  const prog3: Event = {
    id: "P3",
    type: "agent.progress",
    taskId: "T1",
    payload: { tool: "read", summary: "read /c" },
  };
  const feed = new FakeListEvents([prog1, prog2, prog3]);

  const result = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    3,
    `json mode: all agent.progress events emitted regardless of display throttle; got ${result.stdout.length}`,
  );
});

test("events --limit 0 exits 1 with a one-line error", async () => {
  const feed = new FakeListEvents([E1]);

  const result = await runEvents(
    { after: "0", limit: 0 },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1, "exactly one error line");
  assert.ok(
    result.stderr[0]!.startsWith("error:"),
    "error line starts with 'error:'",
  );
});

// S4 coverage: --limit abc → parseInt("abc") = NaN → RangeError → exit 1
// NOTE: this test passes immediately; behavior already implemented correctly.
test("events --limit abc (non-integer string) exits 1 with a one-line error", async () => {
  const feed = new FakeListEvents([E1]);

  const result = await runEvents(
    { after: "0", limit: "abc" },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1, "exactly one error line");
  assert.ok(
    result.stderr[0]!.startsWith("error:"),
    "error line starts with 'error:'",
  );
});
