// src/storage/sqlite/project-ack.ts — SQLite adapter for ProjectAckRepository
// (016 Story 5: per-project last-acknowledged event cursor).
//
// The cursor is a ULID (lexicographically sortable by time, see
// `src/domain/entity.ts:1-14`). `latestProjectEventId` reads the
// `events.projectId` column introduced in EPIC 011 Story 3.

import type { DatabaseSync } from "node:sqlite";
import type { ProjectAckRepository } from "../port.ts";

type AckRow = { cursor: string };
type MaxRow = { m: string | null };

export class SqliteProjectAckRepository implements ProjectAckRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  getAck(projectId: string): string | undefined {
    const row = this.#db
      .prepare(`SELECT cursor FROM project_acks WHERE projectId = ?`)
      .get(projectId) as AckRow | undefined;
    return row?.cursor;
  }

  setAck(projectId: string, cursor: string): void {
    this.#db
      .prepare(
        `INSERT INTO project_acks (projectId, cursor) VALUES (?, ?)
         ON CONFLICT(projectId) DO UPDATE SET cursor = excluded.cursor`,
      )
      .run(projectId, cursor);
  }

  latestProjectEventId(projectId: string): string | undefined {
    const row = this.#db
      .prepare(`SELECT MAX(id) AS m FROM events WHERE projectId = ?`)
      .get(projectId) as MaxRow | undefined;
    if (row === undefined || row.m === null) return undefined;
    return row.m;
  }
}
