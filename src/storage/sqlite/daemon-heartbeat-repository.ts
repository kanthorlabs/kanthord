// src/storage/sqlite/daemon-heartbeat-repository.ts — EPIC 014 Story 3
// SQLite adapter for the `daemon_heartbeats` table. Mirrors the
// constructor + prepared-statement style of
// `src/storage/sqlite/ai-provider-registry.ts`. One prepared statement
// per method, reused across calls; the upsert is `ON CONFLICT(instanceId)
// DO UPDATE SET lastBeatMs = excluded.lastBeatMs` so a re-beat from the
// same daemon never throws and never grows the row count.

import type { DatabaseSync } from "node:sqlite";

import type { DaemonHeartbeatRepository, DaemonHeartbeatRow } from "../port.ts";

export class SqliteDaemonHeartbeatRepository implements DaemonHeartbeatRepository {
  readonly #beatStmt: ReturnType<DatabaseSync["prepare"]>;
  readonly #listStmt: ReturnType<DatabaseSync["prepare"]>;

  constructor(db: DatabaseSync) {
    this.#beatStmt = db.prepare(
      `INSERT INTO daemon_heartbeats (instanceId, pid, startedAtMs, lastBeatMs)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(instanceId) DO UPDATE SET lastBeatMs = excluded.lastBeatMs`,
    );
    this.#listStmt = db.prepare(
      `SELECT instanceId, pid, startedAtMs, lastBeatMs
       FROM daemon_heartbeats
       ORDER BY instanceId ASC`,
    );
  }

  beat(input: {
    instanceId: string;
    pid: number;
    startedAtMs: number;
    atMs: number;
  }): void {
    this.#beatStmt.run(
      input.instanceId,
      input.pid,
      input.startedAtMs,
      input.atMs,
    );
  }

  list(): DaemonHeartbeatRow[] {
    return this.#listStmt.all() as unknown as DaemonHeartbeatRow[];
  }
}
