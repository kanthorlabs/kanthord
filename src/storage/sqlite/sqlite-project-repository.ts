import type { DatabaseSync } from "node:sqlite";

import type { ProjectRepository } from "../port.ts";
import type { Project } from "../../domain/project.ts";
import {
  isRepository,
  type Resource,
  type ResourceType,
} from "../../domain/resource.ts";

/** `node:sqlite` adapter for the `ProjectRepository` port. */
export class SqliteProjectRepository implements ProjectRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  save(project: Project): void {
    this.#db
      .prepare(
        "INSERT INTO projects (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
      )
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

    // Extract denormalized migration-7 columns for repository resources.
    let remoteUrl: string | null = null;
    let authKind: string | null = null;
    let authCredentialId: string | null = null;
    if (isRepository(resource)) {
      remoteUrl = resource.remoteUrl;
      authKind = resource.auth.kind;
      authCredentialId =
        resource.auth.kind === "https-token"
          ? resource.auth.credentialId
          : null;
    }

    this.#db
      .prepare(
        `INSERT INTO resources (id, projectId, type, name, attributes, remoteUrl, authKind, authCredentialId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           name = excluded.name,
           attributes = excluded.attributes,
           remoteUrl = excluded.remoteUrl,
           authKind = excluded.authKind,
           authCredentialId = excluded.authCredentialId`,
      )
      .run(
        id,
        projectId,
        type,
        name,
        attributes,
        remoteUrl,
        authKind,
        authCredentialId,
      );
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

  listResourcesByProject(projectId: string, type: ResourceType): Resource[] {
    const rows = this.#db
      .prepare(
        "SELECT id, type, name, attributes FROM resources WHERE projectId = ? AND type = ?",
      )
      .all(projectId, type) as Array<{
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

  getResource(id: string): Resource | undefined {
    const row = this.#db
      .prepare("SELECT id, type, name, attributes FROM resources WHERE id = ?")
      .get(id) as
      | { id: string; type: string; name: string; attributes: string }
      | undefined;
    if (row === undefined) return undefined;
    const extra = JSON.parse(row.attributes) as Record<string, unknown>;
    return { id: row.id, type: row.type, name: row.name, ...extra } as Resource;
  }

  listProjects(): Project[] {
    const rows = this.#db
      .prepare("SELECT id, name FROM projects ORDER BY id ASC")
      .all() as Array<{ id: string; name: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  resolveProjectByName(name: string): string[] {
    const rows = this.#db
      .prepare("SELECT id FROM projects WHERE name = ?")
      .all(name) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  resolveResourceByName(projectId: string, name: string): string[] {
    const rows = this.#db
      .prepare("SELECT id FROM resources WHERE projectId = ? AND name = ?")
      .all(projectId, name) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
