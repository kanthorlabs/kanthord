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
  api: string | null;
  contextWindow: number | null;
  maxTokens: number | null;
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
    api: row.api as "openai-completions" | "openai-responses" | null,
    contextWindow: row.contextWindow,
    maxTokens: row.maxTokens,
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
    api?: "openai-completions" | "openai-responses";
    contextWindow?: number;
    maxTokens?: number;
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
        `INSERT INTO ai_providers (id, name, provider, model, baseUrl, effort, value, state, credentialVersion, api, contextWindow, maxTokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.model,
        input.baseUrl ?? null,
        input.effort ?? null,
        input.value,
        input.api ?? null,
        input.contextWindow ?? null,
        input.maxTokens ?? null,
      );
    return this.get(id)!;
  }

  get(id: string): GlobalAiProvider | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, name, provider, model, baseUrl, effort, value, state, credentialVersion, api, contextWindow, maxTokens
         FROM ai_providers WHERE id = ?`,
      )
      .get(id) as GlobalAiProviderRow | undefined;
    if (row === undefined) return undefined;
    return rowToProvider(row);
  }

  #getByName(name: string): GlobalAiProvider | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, name, provider, model, baseUrl, effort, value, state, credentialVersion, api, contextWindow, maxTokens
         FROM ai_providers WHERE name = ?`,
      )
      .get(name) as GlobalAiProviderRow | undefined;
    if (row === undefined) return undefined;
    return rowToProvider(row);
  }

  list(): GlobalAiProvider[] {
    const rows = this.#db
      .prepare(
        `SELECT id, name, provider, model, baseUrl, effort, value, state, credentialVersion, api, contextWindow, maxTokens
         FROM ai_providers ORDER BY name`,
      )
      .all() as GlobalAiProviderRow[];
    return rows.map(rowToProvider);
  }

  getDefault(): GlobalAiProvider | undefined {
    const row = this.#db
      .prepare(
        `SELECT p.id, p.name, p.provider, p.model, p.baseUrl, p.effort, p.value, p.state, p.credentialVersion, p.api, p.contextWindow, p.maxTokens
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

  // ── 008.2 Story A — project→provider assignment ──────────────────────────

  assign(projectId: string, providerId: string, rank: number): void {
    this.#db
      .prepare(
        "INSERT INTO project_ai_providers (projectId, providerId, rank) VALUES (?, ?, ?)",
      )
      .run(projectId, providerId, rank);
  }

  unassign(projectId: string, providerId: string): void {
    this.#db
      .prepare(
        "DELETE FROM project_ai_providers WHERE projectId = ? AND providerId = ?",
      )
      .run(projectId, providerId);
  }

  listAssigned(projectId: string): GlobalAiProvider[] {
    const rows = this.#db
      .prepare(
        `SELECT p.id, p.name, p.provider, p.model, p.baseUrl, p.effort, p.value, p.state, p.credentialVersion, p.api, p.contextWindow, p.maxTokens
         FROM ai_providers p
         JOIN project_ai_providers a ON a.providerId = p.id
         WHERE a.projectId = ?
         ORDER BY a.rank ASC`,
      )
      .all(projectId) as GlobalAiProviderRow[];
    return rows.map(rowToProvider);
  }

  maxRank(projectId: string): number | undefined {
    const row = this.#db
      .prepare(
        "SELECT MAX(rank) AS maxRank FROM project_ai_providers WHERE projectId = ?",
      )
      .get(projectId) as { maxRank: number | null } | undefined;
    if (row === undefined || row.maxRank === null) return undefined;
    return row.maxRank;
  }

  shiftRanksFrom(projectId: string, rank: number): void {
    // Two-phase shift to avoid UNIQUE (projectId, rank) constraint collisions:
    // Phase 1 moves affected rows to unique negative values (no overlap with
    // the original positive space), then Phase 2 flips them back positive.
    this.#db
      .prepare(
        "UPDATE project_ai_providers SET rank = -(rank + 1) WHERE projectId = ? AND rank >= ?",
      )
      .run(projectId, rank);
    this.#db
      .prepare(
        "UPDATE project_ai_providers SET rank = -rank WHERE projectId = ? AND rank < 0",
      )
      .run(projectId);
  }

  compactRanks(projectId: string): void {
    const rows = this.#db
      .prepare(
        "SELECT providerId FROM project_ai_providers WHERE projectId = ? ORDER BY rank ASC",
      )
      .all(projectId) as Array<{ providerId: string }>;
    const stmt = this.#db.prepare(
      "UPDATE project_ai_providers SET rank = ? WHERE projectId = ? AND providerId = ?",
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      stmt.run(i, projectId, row.providerId);
    }
  }

  getAssignment(
    projectId: string,
    providerId: string,
  ): { rank: number } | undefined {
    const row = this.#db
      .prepare(
        "SELECT rank FROM project_ai_providers WHERE projectId = ? AND providerId = ?",
      )
      .get(projectId, providerId) as { rank: number } | undefined;
    if (row === undefined) return undefined;
    return { rank: row.rank };
  }

  listProjectsAssigning(providerId: string): string[] {
    const rows = this.#db
      .prepare(
        "SELECT projectId FROM project_ai_providers WHERE providerId = ?",
      )
      .all(providerId) as Array<{ projectId: string }>;
    return rows.map((r) => r.projectId);
  }

  updateCredentialCAS(
    id: string,
    value: string,
    expectedVersion: number,
  ): { applied: true; newVersion: number } | { applied: false } {
    const result = this.#db
      .prepare(
        "UPDATE ai_providers SET value = ?, credentialVersion = credentialVersion + 1 WHERE id = ? AND state = 'active' AND credentialVersion = ?",
      )
      .run(value, id, expectedVersion);
    if (result.changes > 0) {
      return { applied: true, newVersion: expectedVersion + 1 };
    }
    return { applied: false };
  }
}
