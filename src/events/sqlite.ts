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
        "INSERT INTO events(id, type, taskId, payload) VALUES(?, ?, ?, ?)",
      )
      .run(event.id, event.type, event.taskId, payload);
  }

  readAfter(cursor: string, limit?: number): Event[] {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }

    const effectiveLimit = limit ?? 100;

    const rows = this.#db
      .prepare(
        "SELECT id, type, taskId, payload FROM events WHERE id > ? ORDER BY id ASC LIMIT ?",
      )
      .all(cursor, effectiveLimit) as Array<{
      id: string;
      type: string;
      taskId: string;
      payload: string | null;
    }>;

    return rows.map((r) => {
      const event: Event = {
        id: r.id,
        type: r.type as Event["type"],
        taskId: r.taskId,
      };
      if (r.payload !== null) {
        event.payload = JSON.parse(r.payload) as Record<string, string>;
      }
      return event;
    });
  }
}
