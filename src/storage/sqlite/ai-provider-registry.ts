// src/storage/sqlite/ai-provider-registry.ts — SQLite adapter for
// AiProviderRegistry (008.1 Story A: global ai_providers store + default pointer).

import type { DatabaseSync } from "node:sqlite";
import type { AiProviderRegistry, GlobalAiProvider } from "../port.ts";
import { DuplicateNameError } from "../../domain/errors.ts";
import { newId } from "../../domain/entity.ts";

type GlobalAiProviderRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  effort: string | null;
  value: string | null;
  state: string;
  credentialVersion: number;
};

function rowToProvider(row: GlobalAiProviderRow): GlobalAiProvider {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    effort: row.effort,
    value: row.value,
    state: row.state as "active" | "logged_out",
    credentialVersion: row.credentialVersion,
  };
}

export class SqliteAiProviderRegistry implements AiProviderRegistry {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  register(input: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    effort?: string;
    value: string;
  }): GlobalAiProvider {
    const existing = this.#getByName(input.name);

    if (existing !== undefined) {
      if (existing.state === "active") {
        throw new DuplicateNameError("ai_provider", "global", input.name);
      }
      // Reactivate logged_out provider: update credential, set state active, bump version.
      const newVersion = existing.credentialVersion + 1;
      this.#db
        .prepare(
          `UPDATE ai_providers SET value = ?, state = 'active', credentialVersion = ? WHERE id = ?`,
        )
        .run(input.value, newVersion, existing.id);
      return this.get(existing.id)!;
    }

    // New provider.
    const id = newId();
    this.#db
      .prepare(
        `INSERT INTO ai_providers (id, name, provider, model, baseUrl, effort, value, state, credentialVersion)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.model,
        input.baseUrl ?? null,
        input.effort ?? null,
        input.value,
      );
    return this.get(id)!;
  }

  get(id: string): GlobalAiProvider | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, name, provider, model, baseUrl, effort, value, state, credentialVersion
         FROM ai_providers WHERE id = ?`,
      )
      .get(id) as GlobalAiProviderRow | undefined;
    if (row === undefined) return undefined;
    return rowToProvider(row);
  }

  #getByName(name: string): GlobalAiProvider | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, name, provider, model, baseUrl, effort, value, state, credentialVersion
         FROM ai_providers WHERE name = ?`,
      )
      .get(name) as GlobalAiProviderRow | undefined;
    if (row === undefined) return undefined;
    return rowToProvider(row);
  }

  list(): GlobalAiProvider[] {
    const rows = this.#db
      .prepare(
        `SELECT id, name, provider, model, baseUrl, effort, value, state, credentialVersion
         FROM ai_providers ORDER BY name`,
      )
      .all() as GlobalAiProviderRow[];
    return rows.map(rowToProvider);
  }

  getDefault(): GlobalAiProvider | undefined {
    const row = this.#db
      .prepare(
        `SELECT p.id, p.name, p.provider, p.model, p.baseUrl, p.effort, p.value, p.state, p.credentialVersion
         FROM ai_provider_default d
         JOIN ai_providers p ON p.id = d.providerId
         WHERE d.id = 1`,
      )
      .get() as GlobalAiProviderRow | undefined;
    if (row === undefined) return undefined;
    return rowToProvider(row);
  }

  setDefault(id: string): void {
    this.#db
      .prepare(
        `INSERT INTO ai_provider_default (id, providerId) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET providerId = excluded.providerId`,
      )
      .run(id);
  }

  clearDefault(): void {
    this.#db.prepare("DELETE FROM ai_provider_default WHERE id = 1").run();
  }

  logout(id: string): void {
    // Idempotent: if already logged_out, just return.
    const existing = this.get(id);
    if (existing === undefined) return;
    if (existing.state === "logged_out") return;

    const newVersion = existing.credentialVersion + 1;
    this.#db
      .prepare(
        "UPDATE ai_providers SET state = 'logged_out', value = NULL, credentialVersion = ? WHERE id = ?",
      )
      .run(newVersion, id);
  }

  remove(id: string): void {
    this.#db
      .prepare("DELETE FROM ai_provider_default WHERE providerId = ?")
      .run(id);
    this.#db.prepare("DELETE FROM ai_providers WHERE id = ?").run(id);
  }
}
