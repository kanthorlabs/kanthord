import type { DatabaseSync } from "node:sqlite";

import type { ProjectRepository } from "../port.ts";
import type { Project } from "../../domain/project.ts";
import type { Resource } from "../../domain/resource.ts";

/** `node:sqlite` adapter for the `ProjectRepository` port. */
export class SqliteProjectRepository implements ProjectRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  save(project: Project): void {
    this.#db
      .prepare("INSERT INTO projects (id, name) VALUES (?, ?)")
      .run(project.id, project.name);
  }

  get(id: string): Project | undefined {
    const row = this.#db
      .prepare("SELECT id, name FROM projects WHERE id = ?")
      .get(id) as { id: string; name: string } | undefined;
    if (row === undefined) return undefined;
    return { id: row.id, name: row.name };
  }

  addResource(projectId: string, resource: Resource): void {
    // Separate the fixed columns from the type-specific vendor fields.
    const { id, type, name, ...rest } = resource;
    const attributes = JSON.stringify(rest);
    this.#db
      .prepare(
        "INSERT INTO resources (id, projectId, type, name, attributes) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, projectId, type, name, attributes);
  }

  listResources(projectId: string): Resource[] {
    const rows = this.#db
      .prepare(
        "SELECT id, type, name, attributes FROM resources WHERE projectId = ?",
      )
      .all(projectId) as Array<{
      id: string;
      type: string;
      name: string;
      attributes: string;
    }>;
    return rows.map((r) => {
      const extra = JSON.parse(r.attributes) as Record<string, unknown>;
      return { id: r.id, type: r.type, name: r.name, ...extra } as Resource;
    });
  }
}
