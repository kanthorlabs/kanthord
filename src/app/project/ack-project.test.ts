// src/app/project/ack-project.test.ts — `AckProject` (016 Story 5).
//
// Pure use-case tests with fakes implementing the structural `AckSource`
// (no SQLite). The use case enforces five pinned rules in this order:
//   1. unknown project  → `UnknownReferenceError("project", id)`
//   2. non-ULID cursor  → `CursorNotUlidError` (rejected BEFORE feed check)
//   3. cursor > latest  → `CursorAheadOfFeedError`
//   4. cursor <= stored → silent no-op (monotonic)
//   5. otherwise        → `setAck(projectId, cursor)` exactly once
//
// Plus a no-op invariant on the "no event yet" project (the project exists
// but has zero events) — the cursor cannot be ahead of an empty feed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AckProject,
  CursorNotUlidError,
  CursorAheadOfFeedError,
} from "./ack-project.ts";
import { UnknownReferenceError } from "../../app/errors.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeSource {
  getAck: (projectId: string) => string | undefined;
  setAck: (projectId: string, cursor: string) => void;
  latestProjectEventId: (projectId: string) => string | undefined;
  setAckCalls: Array<{ projectId: string; cursor: string }>;
}

interface FakeProjects {
  get: (id: string) => { id: string; name: string } | undefined;
}

function makeSource(
  initial: Partial<{
    stored: Map<string, string>;
    latest: Map<string, string>;
  }> = {},
): FakeSource {
  const stored = initial.stored ?? new Map<string, string>();
  const latest = initial.latest ?? new Map<string, string>();
  const setAckCalls: Array<{ projectId: string; cursor: string }> = [];
  return {
    setAckCalls,
    getAck: (projectId) => stored.get(projectId),
    setAck: (projectId, cursor) => {
      setAckCalls.push({ projectId, cursor });
      stored.set(projectId, cursor);
    },
    latestProjectEventId: (projectId) => latest.get(projectId),
  };
}

function makeProjects(present: string[] = ["proj-1"]): FakeProjects {
  return {
    get: (id) => (present.includes(id) ? { id, name: "P" } : undefined),
  };
}

describe("AckProject", () => {
  test("rule 1: unknown project id throws UnknownReferenceError with kind === 'project'", async () => {
    const source = makeSource();
    const projects = makeProjects([]); // no projects
    const useCase = new AckProject(source, projects);

    await assert.rejects(
      useCase.execute({
        projectId: "proj-missing",
        cursor: "01H1234567890ABCDEFGHJKMNP",
      }),
      (err: unknown) => {
        if (!(err instanceof UnknownReferenceError)) return false;
        return err.kind === "project" && err.id === "proj-missing";
      },
    );
    // setAck must NOT be called on the unknown-project path.
    assert.equal(source.setAckCalls.length, 0);
  });

  test("rule 1 runs BEFORE rule 2: an invalid ULID for an unknown project throws UnknownReferenceError, not CursorNotUlidError", async () => {
    const source = makeSource();
    const projects = makeProjects([]);
    const useCase = new AckProject(source, projects);

    await assert.rejects(
      useCase.execute({ projectId: "proj-missing", cursor: "not-a-ulid" }),
      (err: unknown) => err instanceof UnknownReferenceError,
    );
  });

  test("rule 2: 25-char cursor throws CursorNotUlidError with the cursor in the message", async () => {
    const source = makeSource({
      latest: new Map([["proj-1", "01HZZZZZZZZZZZZZZZZZZZZZZZ"]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const tooShort = "01H1234567890ABCDEFGHJKMN"; // 25 chars
    assert.equal(tooShort.length, 25);

    await assert.rejects(
      useCase.execute({ projectId: "proj-1", cursor: tooShort }),
      (err: unknown): boolean => {
        if (!(err instanceof CursorNotUlidError)) return false;
        const e: CursorNotUlidError = err;
        return (
          e.cursor === tooShort &&
          e.message === `cursor is not a ULID: ${tooShort}`
        );
      },
    );
  });

  test("rule 2: 27-char cursor throws CursorNotUlidError", async () => {
    const source = makeSource({
      latest: new Map([["proj-1", "01HZZZZZZZZZZZZZZZZZZZZZZZ"]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const tooLong = "01H1234567890ABCDEFGHJKMNPR"; // 27 chars
    assert.equal(tooLong.length, 27);

    await assert.rejects(
      useCase.execute({ projectId: "proj-1", cursor: tooLong }),
      (err: unknown) => err instanceof CursorNotUlidError,
    );
  });

  test("rule 2: a lowercase cursor throws CursorNotUlidError (ULIDs are uppercase Crockford)", async () => {
    const source = makeSource({
      latest: new Map([["proj-1", "01HZZZZZZZZZZZZZZZZZZZZZZZ"]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const lower = "01h1234567890abcdefghjkmnp"; // 26 chars but lowercase
    assert.equal(lower.length, 26);

    await assert.rejects(
      useCase.execute({ projectId: "proj-1", cursor: lower }),
      (err: unknown) => err instanceof CursorNotUlidError,
    );
  });

  test("rule 2: each forbidden letter (I, L, O, U) in a 26-char cursor throws CursorNotUlidError", async () => {
    const source = makeSource({
      latest: new Map([["proj-1", "01HZZZZZZZZZZZZZZZZZZZZZZZ"]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    for (const bad of ["I", "L", "O", "U"]) {
      // Replace one char in a known-good ULID with a forbidden one.
      const cursor = "01H1234567890ABCDEFGHJKMNP".split("") as string[];
      cursor[10] = bad; // any position — the regex is per-char.
      const badCursor = cursor.join("");
      assert.equal(badCursor.length, 26, "still 26 chars long");

      await assert.rejects(
        useCase.execute({ projectId: "proj-1", cursor: badCursor }),
        (err: unknown) =>
          err instanceof CursorNotUlidError &&
          (err as CursorNotUlidError).cursor === badCursor,
        `forbidden letter ${bad} must throw CursorNotUlidError`,
      );
    }
  });

  test("rule 2: a valid 26-char uppercase Crockford ULID does NOT throw CursorNotUlidError", async () => {
    const source = makeSource({
      latest: new Map([["proj-1", "01HZZZZZZZZZZZZZZZZZZZZZZZ"]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const valid = "01H1234567890ABCDEFGHJKMNP"; // 26 chars, all legal
    assert.equal(valid.length, 26);
    // No throw — proceeds to rule 3.
    await useCase.execute({ projectId: "proj-1", cursor: valid });
    assert.equal(source.setAckCalls.length, 1);
  });

  test("rule 3: latestProjectEventId returning undefined throws CursorAheadOfFeedError (empty feed)", async () => {
    // No entry in `latest` for proj-1: the project has zero events.
    const source = makeSource();
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const cursor = "01H1234567890ABCDEFGHJKMNP";

    await assert.rejects(
      useCase.execute({ projectId: "proj-1", cursor }),
      (err: unknown): boolean => {
        if (!(err instanceof CursorAheadOfFeedError)) return false;
        const e: CursorAheadOfFeedError = err;
        return (
          e.cursor === cursor &&
          e.latest === null &&
          e.message ===
            `cursor ${cursor} is ahead of the project feed (latest: none)`
        );
      },
    );
    // setAck must NOT be called when the feed is empty.
    assert.equal(source.setAckCalls.length, 0);
  });

  test("rule 3: a cursor greater than latest throws CursorAheadOfFeedError", async () => {
    // latest is the ULID `01H00000000000000000000010`; cursor is the larger
    // `01H00000000000000000000011` (lexicographic > latest).
    const latest = "01H00000000000000000000010";
    const cursor = "01H00000000000000000000011";
    const source = makeSource({ latest: new Map([["proj-1", latest]]) });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    await assert.rejects(
      useCase.execute({ projectId: "proj-1", cursor }),
      (err: unknown) =>
        err instanceof CursorAheadOfFeedError &&
        (err as CursorAheadOfFeedError).cursor === cursor &&
        (err as CursorAheadOfFeedError).latest === latest,
    );
    assert.equal(source.setAckCalls.length, 0);
  });

  test("rule 3: a cursor exactly equal to latest is accepted and written", async () => {
    const latest = "01H00000000000000000000010";
    const source = makeSource({ latest: new Map([["proj-1", latest]]) });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    await useCase.execute({ projectId: "proj-1", cursor: latest });
    assert.equal(source.setAckCalls.length, 1);
    assert.equal(source.setAckCalls[0]!.cursor, latest);
    assert.equal(source.getAck("proj-1"), latest);
  });

  test("rule 4 (monotonic): ack B, then ack A where A < B — setAck is NOT called a second time, getAck still reports B", async () => {
    const a = "01H00000000000000000000001";
    const b = "01H00000000000000000000002";
    // Use a latest cursor that is >= b, so both calls are feed-valid.
    const latest = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
    // Stored starts at A so the first ack of B is a real forward write.
    const source = makeSource({
      stored: new Map([["proj-1", a]]),
      latest: new Map([["proj-1", latest]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    // Forward ack B first (sanity).
    await useCase.execute({ projectId: "proj-1", cursor: b });
    assert.equal(source.setAckCalls.length, 1, "first forward ack writes");

    // Backwards ack A — must be a silent no-op.
    await useCase.execute({ projectId: "proj-1", cursor: a });
    assert.equal(
      source.setAckCalls.length,
      1,
      "setAck must not be called a second time on a backwards ack",
    );
    assert.equal(
      source.getAck("proj-1"),
      b,
      "stored cursor must remain at the maximum (B), never move to A",
    );
  });

  test("rule 4 (idempotent): acking the same cursor twice calls setAck at most once for the second call", async () => {
    const latest = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
    const cursor = "01H00000000000000000000010";
    const source = makeSource({
      stored: new Map([["proj-1", cursor]]), // already at the cursor
      latest: new Map([["proj-1", latest]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    await useCase.execute({ projectId: "proj-1", cursor });
    assert.equal(
      source.setAckCalls.length,
      0,
      "re-ack of the exact stored cursor must not call setAck",
    );
    assert.equal(source.getAck("proj-1"), cursor);
  });

  test("rule 5: a forward ack of a new cursor calls setAck once and the stored value moves", async () => {
    const latest = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
    const a = "01H00000000000000000000001";
    const b = "01H00000000000000000000002";
    const source = makeSource({
      stored: new Map([["proj-1", a]]),
      latest: new Map([["proj-1", latest]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    await useCase.execute({ projectId: "proj-1", cursor: b });
    assert.equal(source.setAckCalls.length, 1);
    assert.deepEqual(source.setAckCalls[0], { projectId: "proj-1", cursor: b });
    assert.equal(source.getAck("proj-1"), b);
  });

  // AMENDED 2026-07-28 (Story 5 §D rules 4/5): `execute` returns the cursor
  // now in effect, not the raw input — a caller must be able to report what
  // is actually stored.
  test("AMENDED: an advancing ack returns { cursor } equal to the new stored cursor", async () => {
    const latest = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
    const a = "01H00000000000000000000001";
    const b = "01H00000000000000000000002";
    const source = makeSource({
      stored: new Map([["proj-1", a]]),
      latest: new Map([["proj-1", latest]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const result = await useCase.execute({ projectId: "proj-1", cursor: b });
    assert.deepEqual(result, { cursor: b });
  });

  // AMENDED 2026-07-28: rule 4's no-op path must still report the truth —
  // the STORED (higher) cursor, never the backwards input that was rejected.
  test("AMENDED: a backwards ack returns { cursor } equal to the STORED (higher) cursor, not the input", async () => {
    const latest = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
    const a = "01H00000000000000000000001"; // backwards input
    const b = "01H00000000000000000000002"; // already stored, higher
    const source = makeSource({
      stored: new Map([["proj-1", b]]),
      latest: new Map([["proj-1", latest]]),
    });
    const projects = makeProjects();
    const useCase = new AckProject(source, projects);

    const result = await useCase.execute({ projectId: "proj-1", cursor: a });
    assert.deepEqual(
      result,
      { cursor: b },
      "must echo the stored cursor B, never the rejected backwards input A",
    );
    assert.equal(source.setAckCalls.length, 0, "still a silent no-op write");
  });
});
