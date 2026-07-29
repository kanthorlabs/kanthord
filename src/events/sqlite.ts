import type { DatabaseSync } from "node:sqlite";
import type { Event } from "../domain/event.ts";
import type { EventFeed } from "./port.ts";

export class SqliteEventFeed implements EventFeed {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  append(event: Event): void {
    const payload =
      event.payload !== undefined ? JSON.stringify(event.payload) : null;
    this.#db
      .prepare(
        "INSERT INTO events(id, type, taskId, payload, objectiveId, initiativeId, repositoryId, projectId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.id,
        event.type,
        event.taskId ?? null,
        payload,
        event.objectiveId ?? null,
        event.initiativeId ?? null,
        event.repositoryId ?? null,
        this.#resolveProjectId(event),
      );
  }

  // EPIC 011 Story 3 — derive the owning projectId from the event's existing
  // owner fields, in precedence taskId → objectiveId → initiativeId →
  // repositoryId (same precedence the CLI's scopeId resolver encodes at
  // src/apps/cli/events.ts:110-114). Returns null when the owner row is
  // absent (never guesses, never throws) so the storage-internal column
  // stays NULL rather than failing the insert.
  #resolveProjectId(event: Event): string | null {
    const one = (sql: string, id: string): string | null => {
      const row = this.#db.prepare(sql).get(id) as
        { projectId: string } | undefined;
      return row?.projectId ?? null;
    };
    if (event.taskId !== undefined)
      return one(
        "SELECT i.projectId AS projectId FROM tasks t JOIN objectives o ON t.objectiveId = o.id JOIN initiatives i ON o.initiativeId = i.id WHERE t.id = ?",
        event.taskId,
      );
    if (event.objectiveId !== undefined)
      return one(
        "SELECT i.projectId AS projectId FROM objectives o JOIN initiatives i ON o.initiativeId = i.id WHERE o.id = ?",
        event.objectiveId,
      );
    if (event.initiativeId !== undefined)
      return one(
        "SELECT projectId AS projectId FROM initiatives WHERE id = ?",
        event.initiativeId,
      );
    if (event.repositoryId !== undefined)
      return one(
        "SELECT projectId AS projectId FROM resources WHERE id = ?",
        event.repositoryId,
      );
    return null;
  }

  readAfter(cursor: string, limit?: number, projectId?: string): Event[] {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }

    const effectiveLimit = limit ?? 100;

    // EPIC 011 Story 4 — project-scoped read. When `projectId` is set, the
    // SQL adds a `projectId = ?` predicate so the filter happens at the
    // storage layer (never fetch-then-filter). Rows with `projectId IS NULL`
    // match no scope (`= ?` is never true for NULL) — that is the
    // "an event with no project is in no project feed" rule, for free.
    // The `events_project_cursor` index (Story 3) serves the scoped read.
    const rows =
      projectId === undefined
        ? (this.#db
            .prepare(
              "SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId FROM events WHERE id > ? ORDER BY id ASC LIMIT ?",
            )
            .all(cursor, effectiveLimit) as Array<{
            id: string;
            type: string;
            taskId: string | null;
            payload: string | null;
            objectiveId: string | null;
            initiativeId: string | null;
            repositoryId: string | null;
          }>)
        : (this.#db
            .prepare(
              "SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId FROM events WHERE id > ? AND projectId = ? ORDER BY id ASC LIMIT ?",
            )
            .all(cursor, projectId, effectiveLimit) as Array<{
            id: string;
            type: string;
            taskId: string | null;
            payload: string | null;
            objectiveId: string | null;
            initiativeId: string | null;
            repositoryId: string | null;
          }>);

    return rows.map((r) => this.#mapEventRow(r));
  }

  // EPIC 016 Story 3 — adapter-only reader. Returns the latest event id per
  // task id, for the given task ids. Missing tasks (no events) are absent
  // from the returned Map. Empty input short-circuits with a new Map() and
  // does NOT touch the database. NOT added to the `EventFeed` port — this is
  // a use-case-local read consumed through a structural interface in
  // `src/app/initiative/get-initiative-graph.ts`.
  latestEventIdByTask(taskIds: readonly string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (taskIds.length === 0) {
      return out;
    }
    const placeholders = taskIds.map(() => "?").join(",");
    const rows = this.#db
      .prepare(
        `SELECT taskId, MAX(id) AS latest FROM events WHERE taskId IN (${placeholders}) GROUP BY taskId`,
      )
      .all(...taskIds) as Array<{ taskId: string; latest: string }>;
    for (const r of rows) {
      out.set(r.taskId, r.latest);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // EPIC 016 Story 6 — three more adapter-only readers backing
  // `GetProjectOverview`. NOT on the `EventFeed` port; the use case declares
  // a structural source that consumes these methods.
  // ---------------------------------------------------------------------------

  /**
   * Aggregate over all events for `projectId` strictly after `after`
   * (exclusive; `null` = from the start). `byType` keys are inserted in
   * ascending type order — that is the SQL `ORDER BY type ASC` guarantee,
   * not a JS object key iteration quirk. `totalCount` is the sum of the
   * per-type counts.
   */
  countProjectEventsAfter(
    projectId: string,
    after: string | null,
  ): { totalCount: number; byType: Record<string, number> } {
    const rows = this.#db
      .prepare(
        "SELECT type, COUNT(*) AS c FROM events WHERE projectId = ? AND (? IS NULL OR id > ?) GROUP BY type ORDER BY type ASC",
      )
      .all(projectId, after, after) as Array<{ type: string; c: number }>;
    const byType: Record<string, number> = {};
    let totalCount = 0;
    for (const r of rows) {
      byType[r.type] = r.c;
      totalCount += r.c;
    }
    return { totalCount, byType };
  }

  /**
   * One capped page of the same rows, ascending by id. `limit` must be a
   * positive integer — mirrors the `readAfter` contract.
   */
  readProjectEventsAfter(
    projectId: string,
    after: string | null,
    limit: number,
  ): Event[] {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    const rows = this.#db
      .prepare(
        "SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId FROM events WHERE projectId = ? AND (? IS NULL OR id > ?) ORDER BY id ASC LIMIT ?",
      )
      .all(projectId, after, after, limit) as Array<{
      id: string;
      type: string;
      taskId: string | null;
      payload: string | null;
      objectiveId: string | null;
      initiativeId: string | null;
      repositoryId: string | null;
    }>;
    return rows.map((r) => this.#mapEventRow(r));
  }

  /**
   * Latest event id per `(type, entity)` pair for the four actionable types
   * in the closed `Actionable` vocabulary, scoped to one initiative. Key
   * format: `<type>:<taskId|objectiveId>`. Rows with both `taskId` and
   * `objectiveId` NULL (should not occur for the four types, but defensive)
   * are skipped. Absent `(type, entity)` pairs are absent from the Map.
   */
  latestActionableEventIds(initiativeId: string): Map<string, string>;
  /**
   * EPIC 017 Story 6 §B — the unscoped-by-element overload backing
   * `GetDecisionQueue`'s `QueueActivitySource`. Returns the max event id per
   * element id (never per `type:entity`) across a five-type actionable list
   * that additionally includes `initiative.landed` (keyed by `initiativeId`).
   * Empty input touches nothing and returns an empty map; an id with no
   * matching row is absent from the map, not present with `undefined`. This
   * overload never scopes by initiative — `elementIds` may mix task,
   * objective, and initiative ids from any initiative/project.
   */
  latestActionableEventIds(elementIds: readonly string[]): Map<string, string>;
  latestActionableEventIds(
    scope: string | readonly string[],
  ): Map<string, string> {
    if (typeof scope === "string") {
      return this.#latestActionableEventIdsByInitiative(scope);
    }
    return this.#latestActionableEventIdsByElement(scope);
  }

  #latestActionableEventIdsByInitiative(
    initiativeId: string,
  ): Map<string, string> {
    const rows = this.#db
      .prepare(
        `SELECT type, taskId, objectiveId, MAX(id) AS latest
           FROM events
          WHERE type IN ('task.failed','task.escalated','objective.awaiting_confirmation','objective.conflict')
            AND initiativeId = ?
          GROUP BY type, taskId, objectiveId`,
      )
      .all(initiativeId) as Array<{
      type: string;
      taskId: string | null;
      objectiveId: string | null;
      latest: string;
    }>;
    const out = new Map<string, string>();
    for (const r of rows) {
      const entity = r.taskId ?? r.objectiveId;
      if (entity === null) continue;
      out.set(`${r.type}:${entity}`, r.latest);
    }
    return out;
  }

  #latestActionableEventIdsByElement(
    elementIds: readonly string[],
  ): Map<string, string> {
    const out = new Map<string, string>();
    if (elementIds.length === 0) {
      return out;
    }
    const placeholders = elementIds.map(() => "?").join(",");
    const rows = this.#db
      .prepare(
        `SELECT COALESCE(taskId, objectiveId, initiativeId) AS entity, MAX(id) AS latest
           FROM events
          WHERE type IN ('task.failed','task.escalated','objective.awaiting_confirmation','objective.conflict','initiative.landed')
            AND COALESCE(taskId, objectiveId, initiativeId) IN (${placeholders})
          GROUP BY entity`,
      )
      .all(...elementIds) as Array<{ entity: string | null; latest: string }>;
    for (const r of rows) {
      if (r.entity === null) continue;
      out.set(r.entity, r.latest);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Row → `Event` mapping shared by `readAfter` and `readProjectEventsAfter`
   * so the payload-decode and nullable-field-set logic lives in exactly one
   * place. The `events.projectId` column is storage-internal and is NEVER
   * surfaced on the `Event` interface.
   */
  #mapEventRow(r: {
    id: string;
    type: string;
    taskId: string | null;
    payload: string | null;
    objectiveId: string | null;
    initiativeId: string | null;
    repositoryId: string | null;
  }): Event {
    const event: Event = {
      id: r.id,
      type: r.type as Event["type"],
    };
    if (r.taskId !== null) {
      event.taskId = r.taskId;
    }
    if (r.objectiveId !== null) {
      event.objectiveId = r.objectiveId;
    }
    if (r.initiativeId !== null) {
      event.initiativeId = r.initiativeId;
    }
    if (r.repositoryId !== null) {
      event.repositoryId = r.repositoryId;
    }
    if (r.payload !== null) {
      event.payload = JSON.parse(r.payload) as Record<string, string>;
    }
    return event;
  }
}
