/**
 * src/agent/provider-account-registry.ts
 *
 * ProviderAccount registry backed by a JSON file at <dataRoot>/accounts.json.
 * Full CRUD (add/get/list/update/remove); two accounts of the same providerKind
 * coexist under distinct ids. remove() also calls store.delete(id) to clean up
 * the credential. Unknown-id operations throw a typed Error naming the id.
 *
 * Exports:
 *   ProviderKind              — union of supported provider kinds
 *   ProviderAccount           — domain type
 *   ProviderAccountRegistry   — interface
 *   ProviderAccountRegistryOpts — factory options
 *   createProviderAccountRegistry(opts) — factory
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newId, ID_PREFIX } from "../foundations/id.ts";
import type { ProviderCredentialStore } from "./provider-credential-store.ts";

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

/** Supported provider kinds. */
export type ProviderKind =
  | "openai-codex"
  | "github-copilot"
  | "openai-compatible";

/**
 * A registered provider account. Multiple accounts of the same providerKind
 * are supported (e.g. ten openai-codex subscriptions).
 */
export interface ProviderAccount {
  /** Stable opaque account id (e.g. acc_<26-char ULID>). */
  id: string;
  /** Provider kind — never used as a compound key with the label. */
  providerKind: ProviderKind;
  /** Human-readable label (e.g. "work", "repo-a-1"). */
  label: string;
  /** Key used in the credential store (equals id for kanthord accounts). */
  credentialKey: string;
  /** Optional preferred model for this account. */
  defaultModel?: string | undefined;
}

/** CRUD interface for the ProviderAccount registry. */
export interface ProviderAccountRegistry {
  add(input: {
    providerKind: ProviderKind;
    label: string;
    defaultModel?: string | undefined;
  }): Promise<ProviderAccount>;
  get(id: string): Promise<ProviderAccount>;
  list(opts?: { kind?: ProviderKind | undefined }): Promise<ProviderAccount[]>;
  update(
    id: string,
    changes: { label?: string | undefined; defaultModel?: string | undefined },
  ): Promise<ProviderAccount>;
  remove(id: string): Promise<void>;
}

/** Options passed to createProviderAccountRegistry. */
export interface ProviderAccountRegistryOpts {
  /** Directory where accounts.json is stored. Must already exist. */
  dataRoot: string;
  /** Injected credential store — remove() calls store.delete(id). */
  store: ProviderCredentialStore;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Serialized file format: JSON object keyed by account id. */
type RegistryFile = Record<string, ProviderAccount>;

class FileProviderAccountRegistry implements ProviderAccountRegistry {
  private readonly filePath: string;
  private readonly store: ProviderCredentialStore;

  constructor(dataRoot: string, store: ProviderCredentialStore) {
    this.filePath = join(dataRoot, "accounts.json");
    this.store = store;
  }

  private async loadAll(): Promise<RegistryFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    return JSON.parse(raw) as RegistryFile;
  }

  private async saveAll(data: RegistryFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
    });
  }

  async add(input: {
    providerKind: ProviderKind;
    label: string;
    defaultModel?: string | undefined;
  }): Promise<ProviderAccount> {
    const id = newId(ID_PREFIX.account);
    const account: ProviderAccount = {
      id,
      providerKind: input.providerKind,
      label: input.label,
      credentialKey: id,
    };
    if (input.defaultModel !== undefined) {
      account.defaultModel = input.defaultModel;
    }
    const data = await this.loadAll();
    data[id] = account;
    await this.saveAll(data);
    return account;
  }

  async get(id: string): Promise<ProviderAccount> {
    const data = await this.loadAll();
    const account = data[id];
    if (account === undefined) {
      throw new Error(`provider account not found: "${id}"`);
    }
    return account;
  }

  async list(opts?: {
    kind?: ProviderKind | undefined;
  }): Promise<ProviderAccount[]> {
    const data = await this.loadAll();
    const all = Object.values(data);
    const kind = opts?.kind;
    if (kind !== undefined) {
      return all.filter((a) => a.providerKind === kind);
    }
    return all;
  }

  async update(
    id: string,
    changes: {
      label?: string | undefined;
      defaultModel?: string | undefined;
    },
  ): Promise<ProviderAccount> {
    const data = await this.loadAll();
    const existing = data[id];
    if (existing === undefined) {
      throw new Error(`provider account not found: "${id}"`);
    }
    const updated: ProviderAccount = { ...existing };
    if (changes.label !== undefined) {
      updated.label = changes.label;
    }
    if (changes.defaultModel !== undefined) {
      updated.defaultModel = changes.defaultModel;
    }
    data[id] = updated;
    await this.saveAll(data);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const data = await this.loadAll();
    if (data[id] === undefined) {
      throw new Error(`provider account not found: "${id}"`);
    }
    const updated: RegistryFile = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== id) {
        updated[k] = v;
      }
    }
    await this.saveAll(updated);
    await this.store.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a file-backed ProviderAccountRegistry.
 *
 * Accounts are persisted in <dataRoot>/accounts.json.
 * Removing an account also calls store.delete(id) to clean the credential.
 * Operations on unknown ids throw an Error with the id in the message.
 */
export function createProviderAccountRegistry(
  opts: ProviderAccountRegistryOpts,
): ProviderAccountRegistry {
  return new FileProviderAccountRegistry(opts.dataRoot, opts.store);
}
