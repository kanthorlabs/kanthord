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

  // --json emits exactly one envelope document on stdout (Story C)
  const jsonOut = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );
  assert.equal(jsonOut.exitCode, 0);
  assert.equal(jsonOut.stdout.length, 1, "exactly one JSON document on stdout");
  const envelope = JSON.parse(jsonOut.stdout[0]!);
  assert.deepEqual(envelope.events, [E1, E2, E3]);
  assert.equal(
    envelope.nextCursor,
    "",
    "no next page -> nextCursor is empty string",
  );
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

// S2: non-follow auto-drain is REMOVED. Non-follow returns ONE page; a
// truncated page signals the next cursor. Tests below replace the old
// "three immediate reads" test (known rewrite per Story 02 contract).

test("StoryC: non-follow --limit 2 --json over 5 events emits one envelope with 2 events and nextCursor 'B'", async () => {
  const events: Event[] = [
    { id: "A", type: "task.ready", taskId: "T1" },
    { id: "B", type: "task.ready", taskId: "T2" },
    { id: "C", type: "task.started", taskId: "T1" },
    { id: "D", type: "task.started", taskId: "T2" },
    { id: "E", type: "task.completed", taskId: "T1" },
  ];
  const feed = new FakeListEvents(events);

  const result = await runEvents(
    { after: "0", limit: 2, json: true },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    1,
    "exactly one JSON document (envelope) on stdout",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.deepEqual(envelope.events, [events[0], events[1]]);
  assert.equal(
    envelope.nextCursor,
    "B",
    "nextCursor equals id of last returned event when truncated",
  );
});

test("S2: non-follow --limit 2 (human) over 5 events emits 2 lines then more-available hint", async () => {
  const events: Event[] = [
    { id: "A", type: "task.ready", taskId: "T1" },
    { id: "B", type: "task.ready", taskId: "T2" },
    { id: "C", type: "task.started", taskId: "T1" },
    { id: "D", type: "task.started", taskId: "T2" },
    { id: "E", type: "task.completed", taskId: "T1" },
  ];
  const feed = new FakeListEvents(events);

  const result = await runEvents(
    { after: "0", limit: 2 },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  // 2 event lines + 1 "more available" hint = 3 stderr lines
  assert.equal(result.stderr.length, 3, "2 event lines + 1 hint on stderr");
  assert.ok(result.stderr[0]!.includes("A"), "first event line contains id A");
  assert.ok(result.stderr[1]!.includes("B"), "second event line contains id B");
  assert.ok(
    result.stderr[2]!.includes("more available"),
    "hint line includes 'more available'",
  );
  assert.ok(
    result.stderr[2]!.includes("--after B"),
    "hint line names the resumable cursor",
  );
});

test("StoryC: non-follow --limit 10 --json covers all 5 events emits one envelope with nextCursor ''", async () => {
  const events: Event[] = [
    { id: "A", type: "task.ready", taskId: "T1" },
    { id: "B", type: "task.ready", taskId: "T2" },
    { id: "C", type: "task.started", taskId: "T1" },
    { id: "D", type: "task.started", taskId: "T2" },
    { id: "E", type: "task.completed", taskId: "T1" },
  ];
  const feed = new FakeListEvents(events);

  const result = await runEvents(
    { after: "0", limit: 10, json: true },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    1,
    "exactly one JSON document (envelope) on stdout",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.equal(envelope.events.length, 5, "all 5 events present");
  assert.equal(
    envelope.nextCursor,
    "",
    "no next page -> nextCursor is empty string",
  );
});

test("StoryC: non-follow --after last event id (--json) emits one envelope with empty events and nextCursor ''", async () => {
  const events: Event[] = [
    { id: "A", type: "task.ready", taskId: "T1" },
    { id: "B", type: "task.ready", taskId: "T2" },
    { id: "C", type: "task.started", taskId: "T1" },
    { id: "D", type: "task.started", taskId: "T2" },
    { id: "E", type: "task.completed", taskId: "T1" },
  ];
  const feed = new FakeListEvents(events);

  const result = await runEvents(
    { after: "E", limit: 10, json: true },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    1,
    "exactly one JSON document (envelope), even for an empty page",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.deepEqual(envelope.events, [], "no events on an empty page");
  assert.equal(
    envelope.nextCursor,
    "",
    "empty page has no last-event id to derive a cursor from",
  );
  assert.equal(result.stderr.length, 0, "no hint emitted");
});

test("StoryC: non-follow default page size is 10 — 12 events emit one envelope with 10 events and nextCursor 'E10'", async () => {
  const events: Event[] = Array.from({ length: 12 }, (_, i) => ({
    id: `E${String(i + 1).padStart(2, "0")}`,
    type: "task.ready",
    taskId: "T1",
  }));
  const feed = new FakeListEvents(events);

  // No --limit given → default page size 10.
  const result = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    1,
    "exactly one JSON document (envelope) on stdout",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.deepEqual(envelope.events[0], events[0]);
  assert.deepEqual(
    envelope.events[9],
    events[9],
    "10th shown row is the 10th event (probe row E11 is dropped)",
  );
  assert.equal(envelope.events.length, 10, "exactly 10 events in the page");
  assert.equal(
    envelope.nextCursor,
    "E10",
    "nextCursor = id of the 10th (last shown) event",
  );
});

test("StoryC: non-follow default page — 3 events (< 10) emit one envelope with nextCursor ''", async () => {
  const events: Event[] = [
    { id: "A", type: "task.ready", taskId: "T1" },
    { id: "B", type: "task.started", taskId: "T1" },
    { id: "C", type: "task.completed", taskId: "T1" },
  ];
  const feed = new FakeListEvents(events);

  const result = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    1,
    "exactly one JSON document (envelope) on stdout",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.deepEqual(envelope.events, events);
  assert.equal(
    envelope.nextCursor,
    "",
    "no next page -> nextCursor is empty string",
  );
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

test("(human-review blocker) --follow --json: an empty poll page pushes NO stdout envelope", async () => {
  const feed = new FakeListEvents([]);

  const ac = new AbortController();
  let sleepCalls = 0;
  const mockSleep = async (_ms: number) => {
    sleepCalls++;
    if (sleepCalls === 1) {
      // abort after the first idle poll so the loop exits after one empty cycle
      ac.abort();
    }
  };

  const result = await runEvents(
    { after: "0", follow: true, json: true, "poll-interval": "50" },
    feed,
    mockSleep,
    ac.signal,
  );

  assert.equal(result.exitCode, 0, "exits 0 on clean abort");
  assert.equal(
    result.stdout.length,
    0,
    `follow --json must push no stdout document for an empty poll; got: ${JSON.stringify(result.stdout)}`,
  );
});

test('(human-review blocker regression) non-follow --json: an empty page still emits exactly one {events:[],nextCursor:""} envelope', async () => {
  const feed = new FakeListEvents([]);

  const result = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.length,
    1,
    "non-follow empty page must still emit exactly one JSON envelope",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.deepEqual(envelope, { events: [], nextCursor: "" });
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
    1,
    "exactly one JSON document (envelope) on stdout",
  );
  const envelope = JSON.parse(result.stdout[0]!);
  assert.equal(
    envelope.events.length,
    3,
    `json mode: all agent.progress events emitted regardless of display throttle; got ${envelope.events.length}`,
  );
});

// ── objective-scoped events, no taskId (007.12 Story D) ─────────────────────

test("human + --json: an objective-scoped event with no taskId round-trips (line includes objectiveId, envelope preserves the event)", async () => {
  const objEvent: Event = {
    id: "OBJ1",
    type: "objective.integrated",
    objectiveId: "some-objective-id",
  };
  const feed = new FakeListEvents([objEvent]);

  const human = await runEvents({ after: "0" }, feed, noopSleep, neverAbort);
  assert.equal(human.exitCode, 0);
  assert.equal(human.stderr.length, 1, "one human line for the one event");
  assert.ok(human.stderr[0]!.includes("OBJ1"), "line contains id");
  assert.ok(
    human.stderr[0]!.includes("objective.integrated"),
    "line contains type",
  );
  assert.ok(
    human.stderr[0]!.includes("some-objective-id"),
    "line contains objectiveId when taskId is absent",
  );

  const jsonOut = await runEvents(
    { after: "0", json: true },
    feed,
    noopSleep,
    neverAbort,
  );
  assert.equal(jsonOut.exitCode, 0);
  assert.equal(jsonOut.stdout.length, 1);
  const envelope = JSON.parse(jsonOut.stdout[0]!);
  assert.deepEqual(envelope.events, [objEvent]);
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
