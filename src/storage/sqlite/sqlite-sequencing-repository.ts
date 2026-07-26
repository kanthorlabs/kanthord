import type { DatabaseSync } from "node:sqlite";
import type { SequencingRepository } from "../port.ts";
import {
  sha256Hex,
  canonicalInitiative,
  canonicalObjective,
} from "./node-sha.ts";

// Re-export for backward compatibility — existing app/ imports reference this path.
export type { SequencingRepository } from "../port.ts";

/** `node:sqlite` adapter for the `SequencingRepository` port. */
export class SqliteSequencingRepository implements SequencingRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  listInitiativeAfter(initiativeId: string): string[] {
    const rows = this.#db
      .prepare(
        "SELECT dependency FROM initiative_dependencies WHERE initiativeId = ? ORDER BY dependency",
      )
      .all(initiativeId) as Array<{ dependency: string }>;
    return rows.map((r) => r.dependency);
  }

  listObjectiveAfter(objectiveId: string): string[] {
    const rows = this.#db
      .prepare(
        "SELECT dependency FROM objective_dependencies WHERE objectiveId = ? ORDER BY dependency",
      )
      .all(objectiveId) as Array<{ dependency: string }>;
    return rows.map((r) => r.dependency);
  }

  addInitiativeAfter(initiativeId: string, dependencyId: string): void {
    this.#db
      .prepare(
        "INSERT INTO initiative_dependencies (initiativeId, dependency) VALUES (?, ?)",
      )
      .run(initiativeId, dependencyId);
  }

  removeInitiativeAfter(initiativeId: string, dependencyId: string): void {
    this.#db
      .prepare(
        "DELETE FROM initiative_dependencies WHERE initiativeId = ? AND dependency = ?",
      )
      .run(initiativeId, dependencyId);
  }

  listInitiativeDag(
    projectId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    const initiatives = this.#db
      .prepare("SELECT id FROM initiatives WHERE projectId = ?")
      .all(projectId) as Array<{ id: string }>;
    const edges = this.#db
      .prepare(
        "SELECT initiativeId, dependency FROM initiative_dependencies WHERE initiativeId IN (SELECT id FROM initiatives WHERE projectId = ?) ORDER BY initiativeId, dependency",
      )
      .all(projectId) as Array<{ initiativeId: string; dependency: string }>;

    const depMap = new Map<string, string[]>();
    for (const row of edges) {
      const list = depMap.get(row.initiativeId) ?? [];
      list.push(row.dependency);
      depMap.set(row.initiativeId, list);
    }

    return initiatives.map((i) => ({
      id: i.id,
      dependencies: depMap.get(i.id) ?? [],
    }));
  }

  listObjectiveDag(
    initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    const objectives = this.#db
      .prepare("SELECT id FROM objectives WHERE initiativeId = ?")
      .all(initiativeId) as Array<{ id: string }>;
    const edges = this.#db
      .prepare(
        "SELECT objectiveId, dependency FROM objective_dependencies WHERE objectiveId IN (SELECT id FROM objectives WHERE initiativeId = ?) ORDER BY objectiveId, dependency",
      )
      .all(initiativeId) as Array<{ objectiveId: string; dependency: string }>;

    const depMap = new Map<string, string[]>();
    for (const row of edges) {
      const list = depMap.get(row.objectiveId) ?? [];
      list.push(row.dependency);
      depMap.set(row.objectiveId, list);
    }

    return objectives.map((o) => ({
      id: o.id,
      dependencies: depMap.get(o.id) ?? [],
    }));
  }

  addObjectiveAfter(objectiveId: string, dependencyId: string): void {
    this.#db
      .prepare(
        "INSERT INTO objective_dependencies (objectiveId, dependency) VALUES (?, ?)",
      )
      .run(objectiveId, dependencyId);
  }

  removeObjectiveAfter(objectiveId: string, dependencyId: string): void {
    this.#db
      .prepare(
        "DELETE FROM objective_dependencies WHERE objectiveId = ? AND dependency = ?",
      )
      .run(objectiveId, dependencyId);
  }

  setInitiativeAfter(initiativeId: string, after: string[]): void {
    const del = this.#db.prepare(
      "DELETE FROM initiative_dependencies WHERE initiativeId = ?",
    );
    const ins = this.#db.prepare(
      "INSERT INTO initiative_dependencies (initiativeId, dependency) VALUES (?, ?)",
    );
    del.run(initiativeId);
    for (const dep of after) {
      ins.run(initiativeId, dep);
    }
    // Re-stamp initiative sha to include after edges
    const initRow = this.#db
      .prepare("SELECT name, projectId FROM initiatives WHERE id = ?")
      .get(initiativeId) as { name: string; projectId: string } | undefined;
    if (initRow !== undefined) {
      const freshSha = sha256Hex(
        canonicalInitiative({
          name: initRow.name,
          projectId: initRow.projectId,
          after,
        }),
      );
      this.#db
        .prepare("UPDATE initiatives SET sha256 = ? WHERE id = ?")
        .run(freshSha, initiativeId);
    }
  }

  setObjectiveAfter(objectiveId: string, after: string[]): void {
    const del = this.#db.prepare(
      "DELETE FROM objective_dependencies WHERE objectiveId = ?",
    );
    const ins = this.#db.prepare(
      "INSERT INTO objective_dependencies (objectiveId, dependency) VALUES (?, ?)",
    );
    del.run(objectiveId);
    for (const dep of after) {
      ins.run(objectiveId, dep);
    }
    // Re-stamp objective sha to include after edges
    const objRow = this.#db
      .prepare("SELECT name, initiativeId FROM objectives WHERE id = ?")
      .get(objectiveId) as { name: string; initiativeId: string } | undefined;
    if (objRow !== undefined) {
      const freshSha = sha256Hex(
        canonicalObjective({
          name: objRow.name,
          initiativeId: objRow.initiativeId,
          after,
        }),
      );
      this.#db
        .prepare("UPDATE objectives SET sha256 = ? WHERE id = ?")
        .run(freshSha, objectiveId);
    }
  }
}
