import type { DatabaseSync } from "node:sqlite";
import { newId } from "../../domain/entity.ts";

/**
 * SQLite adapter for the ObservabilityRefs port used by DiagnosticsExport.
 * Stores opaque random refs (ULIDs) keyed by (kind, entity_id) in the
 * `observability_refs` table added in migration 7. Refs are minted once and
 * reused on subsequent lookups — stable, never derived from the real id.
 */
export class SqliteObservabilityRefs {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  getOrCreateTaskRef(taskId: string): string {
    return this.#getOrCreate("task", taskId);
  }

  getOrCreateInitiativeRef(initiativeId: string): string {
    return this.#getOrCreate("initiative", initiativeId);
  }

  getOrCreateSessionRef(runKey: string): string {
    return this.#getOrCreate("session", runKey);
  }

  #getOrCreate(kind: string, entityId: string): string {
    const candidate = newId();
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO observability_refs (kind, entity_id, ref) VALUES (?, ?, ?)",
      )
      .run(kind, entityId, candidate);
    const row = this.#db
      .prepare(
        "SELECT ref FROM observability_refs WHERE kind = ? AND entity_id = ?",
      )
      .get(kind, entityId) as { ref: string } | undefined;
    if (row === undefined) {
      throw new Error(
        `observability_refs: missing row for kind='${kind}' entity_id='${entityId}'`,
      );
    }
    return row.ref;
  }
}
