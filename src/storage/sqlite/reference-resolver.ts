import { DatabaseSync } from "node:sqlite";
import type { ReferenceResolver } from "../port.ts";

type AggregateKind =
  "project" | "resource" | "initiative" | "objective" | "task";

const TABLE_MAP: Array<[string, AggregateKind]> = [
  ["projects", "project"],
  ["resources", "resource"],
  ["initiatives", "initiative"],
  ["objectives", "objective"],
  ["tasks", "task"],
];

export class SqliteReferenceResolver implements ReferenceResolver {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  resolveKind(id: string): AggregateKind | undefined {
    for (const [table, kind] of TABLE_MAP) {
      const stmt = this.#db.prepare(
        `SELECT id FROM ${table} WHERE id = ? LIMIT 1`,
      );
      const row = stmt.get(id);
      if (row !== undefined) {
        return kind;
      }
    }
    return undefined;
  }
}
