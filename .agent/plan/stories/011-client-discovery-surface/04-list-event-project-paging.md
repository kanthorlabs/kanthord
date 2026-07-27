# Story 4 — `list event --project <id>` with correct cursor paging

Epic: `.agent/plan/epics/011-client-discovery-surface.md`
Depends on: Story 3 (the `events.projectId` column) and Story 6 (a
`task.created` producer, so the Proof's Phase D has events to page).

## Change

1. **Port** `src/events/port.ts:10-13` — widen the read half:

   ```ts
   readAfter(cursor: string, limit?: number, projectId?: string): Event[];
   ```

   `append` is unchanged.

2. **Adapter** `src/events/sqlite.ts:30-73` — `readAfter(cursor, limit, projectId)`.
   Keep the existing `RangeError` guard (`sqlite.ts:31-33`) and the default
   limit of 100 (`sqlite.ts:35`) exactly as they are. Two prepared statements,
   selected by whether `projectId` is `undefined`:

   - unscoped (today's SQL, unchanged):
     `… FROM events WHERE id > ? ORDER BY id ASC LIMIT ?`
   - scoped:
     `… FROM events WHERE id > ? AND projectId = ? ORDER BY id ASC LIMIT ?`

   The filter is in SQL, so a scoped page is `limit` **matching** rows; the
   `events_project_cursor` index from Story 3 serves it. Rows with
   `projectId IS NULL` match no scope (`= ?` is never true for NULL) — that is
   the "an event with no project is in no project feed" rule, for free.

3. **Use case** `src/app/task/list-events.ts` — widen the structural interface
   (`list-events.ts:4-6`) and `execute` (`list-events.ts:19-21`):

   ```ts
   interface ReadableEventFeed {
     readAfter(cursor: string, limit?: number, projectId?: string): Event[];
   }
   …
   execute({
     after,
     limit,
     projectId,
   }: {
     after: string;
     limit?: number;
     projectId?: string;
   }): Event[] {
     return this.#feed.readAfter(after, limit, projectId);
   }
   ```

4. **CLI handler** `src/apps/cli/events.ts` — three edits:

   a. Widen the injected shape at `events.ts:37` to
   `listEvents: { execute(p: { after: string; limit?: number; projectId?: string }): CliEvent[] }`.

   b. Read the flag next to `after`/`follow`/`json` (`events.ts:41-43`):
   `const project = args["project"] as string | undefined;`
   and pass it on **every** read at `events.ts:79`:

   ```ts
   batch = listEvents.execute({
     after: cursor,
     limit: fetchLimit,
     ...(project !== undefined ? { projectId: project } : {}),
   });
   ```

   Passing it inside the loop is what makes `--project` compose with
   `--follow`.

   c. **`nextCursor` becomes the last scanned row** — replace
   `events.ts:135`:

   ```ts
   nextCursor: hasMore ? cursor : "",
   ```

   with

   ```ts
   nextCursor: cursor,
   ```

   `cursor` is advanced only when `visible.length > 0` (`events.ts:124-126`),
   so this yields exactly the epic's two rules: a non-empty page always
   carries the id of its last shown event, and an empty (terminal) page
   carries the caller's `--after` value unchanged — an empty page with a
   stable cursor. The `hasMore` variable stays: it still drives the human-mode
   `more available — pass --after …` hint at `events.ts:143-145`.

   d. Rewrite the doc comment at `events.ts:18-29` to state the new contract:
   the envelope's `nextCursor` is always the last **scanned** row id — the
   last shown event's id for a non-empty page, and the input cursor for an
   empty page. Delete the sentence "A page that reaches the tail leaves
   `nextCursor` as `""`".

5. **CLI leaf** `src/apps/cli/commands/list/event.ts` — add
   `.option("--project <id>", "only events belonging to this project")`
   immediately after `.requiredOption("--after <cursor>", …)`
   (`event.ts:12`), add `project?: string` to the `opts` type
   (`event.ts:25-31`), and forward it in the `runEvents` args object
   (`event.ts:38-46`) with the same conditional-spread style already used
   there: `...(opts.project ? { project: opts.project } : {})`.

6. **No change to `scripts/e2e/drive-run.sh`.** Its loop terminates on
   `[ "$next" != "$cursor" ]` (`drive-run.sh:79-80`); with the new stable
   cursor an empty page returns `next == cursor`, so it still stops — verified
   as part of this story's Verify list.

## Constraints

- The cursor stays the **global ULID** in both scopes: no project-relative
  cursor, no change to the `"0"` start sentinel.
- Filtering is in SQL only. Never fetch-then-filter in `events.ts` or in
  `ListEvents` — an in-memory filter is what would stall a page behind foreign
  events.
- `--project` is optional; omitting it must produce byte-identical SQL and
  output to today's unscoped path.
- Do not add `projectId` to the returned event objects.
- `--limit` validation behaviour (RangeError → exit 1 with
  `error: limit must be a positive integer, got …`) is unchanged.

## Verify

- `node --test src/events/sqlite.test.ts` — new cases on the existing
  real-sqlite temp-dir harness, with a **second** project chain inserted
  (project B → initiative → objective → task):
  - `readAfter("0", undefined, projectA)` returns only project A's events, in
    ascending id order; `readAfter("0", undefined, projectB)` returns only B's;
    the two id sets are disjoint and both are subsets of
    `readAfter("0", undefined)`;
  - an event appended with an unresolvable `repositoryId`
    (`projectId` NULL) appears in the unscoped feed and in **neither** scope;
  - **no stall**: with an interleaved A,B,A,B,A,B history,
    `readAfter("0", 1, projectA)` returns A's 1st event and
    `readAfter(<that id>, 1, projectA)` returns A's 2nd — the scoped read steps
    over B's rows;
  - **ownership is stored, not joined**: after appending an event for project
    A's task, raw-SQL `UPDATE initiatives SET projectId = <B> WHERE id = <A's initiative>`;
    the event must still appear in A's feed and not in B's;
  - **owner deletion**: after appending an event for project A's task, raw-SQL
    `PRAGMA foreign_keys=OFF; DELETE FROM tasks WHERE id = <taskId>;` — the
    event still appears in A's feed.
- `node --test src/app/task/list-events.test.ts` — the local `FakeEventFeed`
  (`list-events.test.ts:6-18`) gains the third parameter; new case: `execute({after, limit, projectId})`
  forwards all three positionally to `readAfter`, and `execute({after})`
  forwards `projectId` as `undefined`.
- `node --test src/apps/cli/events.test.ts` — update `FakeListEvents`
  (`events.test.ts:7-22`) to record `projectId`, then:
  - **updated** `nextCursor` expectations, from `""` to the last scanned id.
    Exact values (and rename each test title that still says `nextCursor ''`):
    - `:66-68` (`after: "0"`, events `[E1, E2, E3]`) → `E3.id`
    - `:177-179` (`after: "0"`, `limit: 10`, events `A..E`) → `"E"`
    - `:209` (`after: "E"`, `limit: 10`, events `A..E`, empty page) → `"E"`
    - `:277-279` (`after: "0"`, events `A,B,C`) → `"C"`
    - `:367` (`after: "0"`, empty feed) →
      `assert.deepEqual(envelope, { events: [], nextCursor: "0" });`
      `events.test.ts:113-115` and `:247-249` already assert the last shown id and
      are unchanged.
  - new: `--project p1 --after 0 --limit 2 --json` → the fake receives
    `{ after: "0", limit: 3, projectId: "p1" }` (page size + 1 probe row).
  - new: no `--project` → the recorded input has **no** `projectId` key.
  - new: `--project p1 --follow --limit 1 --poll-interval 1` → every recorded
    read carries `projectId: "p1"`.
  - new regression: a non-empty terminal page (fake holds exactly 2 events,
    `--limit 2`) emits `nextCursor` equal to the 2nd event's id, **not** `""`.
- `node --test src/apps/cli/index.test.ts` — `index.test.ts:207` becomes
  `assert.deepEqual(cap.out, ["[]\n", '{"events":[],"nextCursor":"0"}\n']);`
- `node --test src/apps/cli/commands/read.test.ts` — `read.test.ts:485` becomes
  `'{"events":[{"id":"event-1","type":"task.ready","taskId":"task-1"}],"nextCursor":"event-1"}\n'`;
  plus a new test that `list event --project p1 --after 0 --json` forwards
  `projectId: "p1"` to the use case.
- `node --test src/apps/cli/agent-smoke.test.ts` — must still pass; its helper
  comment at `agent-smoke.test.ts:37` describes the envelope, so update the
  comment only if its stated behaviour is now wrong.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/client-discovery-proof.sh` Phase **D** — the
  `D ok: events are project-scoped server-side, ordered, disjoint, and page past foreign events`
  line (`client-discovery-proof.sh:68-132`), including the
  `--limit 1` paging loop at `:114-131`, which fails on any page that returns a
  falsy `nextCursor`.
