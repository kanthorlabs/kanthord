import type { DatabaseSync } from "node:sqlite";

import type { InitiativeRepository } from "../port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";

/** `node:sqlite` adapter for the `InitiativeRepository` port. */
export class SqliteInitiativeRepository implements InitiativeRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  save(initiative: Initiative): void {
    this.#db
      .prepare("INSERT INTO initiatives (id, projectId, name) VALUES (?, ?, ?)")
      .run(initiative.id, initiative.projectId, initiative.name);
  }

  get(id: string): Initiative | undefined {
    const row = this.#db
      .prepare("SELECT id, projectId, name FROM initiatives WHERE id = ?")
      .get(id) as { id: string; projectId: string; name: string } | undefined;
    if (row === undefined) return undefined;
    return { id: row.id, projectId: row.projectId, name: row.name };
  }

  saveObjective(objective: Objective): void {
    this.#db
      .prepare(
        "INSERT INTO objectives (id, initiativeId, name) VALUES (?, ?, ?)",
      )
      .run(objective.id, objective.initiativeId, objective.name);
  }

  listObjectives(initiativeId: string): Objective[] {
    const rows = this.#db
      .prepare(
        "SELECT id, initiativeId, name FROM objectives WHERE initiativeId = ? ORDER BY id ASC",
      )
      .all(initiativeId) as Array<{
      id: string;
      initiativeId: string;
      name: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      initiativeId: r.initiativeId,
      name: r.name,
    }));
  }
}
