import type { DatabaseSync } from "node:sqlite";
import type { Event } from "../domain/event.ts";
import type { EventFeed } from "./port.ts";

export class SqliteEventFeed implements EventFeed {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  append(event: Event): void {
    this.#db
      .prepare("INSERT INTO events(id, type, taskId) VALUES(?, ?, ?)")
      .run(event.id, event.type, event.taskId);
  }

  readAfter(cursor: string, limit?: number): Event[] {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }

    const effectiveLimit = limit ?? 100;

    const rows = this.#db
      .prepare(
        "SELECT id, type, taskId FROM events WHERE id > ? ORDER BY id ASC LIMIT ?",
      )
      .all(cursor, effectiveLimit) as Array<{
      id: string;
      type: string;
      taskId: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      type: r.type as Event["type"],
      taskId: r.taskId,
    }));
  }
}
