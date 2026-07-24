// src/storage/sqlite/publication.ts — SQLite adapter for PublicationRepository.

import type { DatabaseSync } from "node:sqlite";
import type { PublicationRepository, PublicationRecord } from "../port.ts";

type PublicationRow = {
  state: string;
  remote_oid: string | null;
};

export class SqlitePublicationRepository implements PublicationRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  getPublication(
    repoId: string,
    branch: string,
  ): PublicationRecord | undefined {
    const row = this.#db
      .prepare(
        `SELECT state, remote_oid FROM publications WHERE repo_id = ? AND branch = ?`,
      )
      .get(repoId, branch) as PublicationRow | undefined;
    if (row === undefined) return undefined;
    return {
      state: row.state as PublicationRecord["state"],
      remoteOID: row.remote_oid,
    };
  }

  getLatestPublication(repoId: string): PublicationRecord | undefined {
    const row = this.#db
      .prepare(
        `SELECT state, remote_oid FROM publications WHERE repo_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(repoId) as PublicationRow | undefined;
    if (row === undefined) return undefined;
    return {
      state: row.state as PublicationRecord["state"],
      remoteOID: row.remote_oid,
    };
  }

  setPublication(
    repoId: string,
    branch: string,
    record: PublicationRecord,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO publications (repo_id, branch, state, remote_oid)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(repo_id, branch) DO UPDATE SET
           state = excluded.state,
           remote_oid = excluded.remote_oid`,
      )
      .run(repoId, branch, record.state, record.remoteOID);
  }
}
