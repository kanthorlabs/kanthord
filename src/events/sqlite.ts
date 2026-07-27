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

    return rows.map((r) => {
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
    });
  }
}
