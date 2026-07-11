/**
 * src/agent/account-binding.ts
 *
 * Durable per-task account binding — persists task→{accountId, modelId}
 * records to a JSON file so a task keeps running on the same account across
 * respawn and daemon restart (Story 003 T3).
 *
 * The binding lives in run/task metadata (not STATE.md). Epic 043 will update
 * the binding when switching accounts; this module only reads and writes it.
 *
 * Exports:
 *   AccountBinding              — the record shape
 *   AccountBindingStore         — interface
 *   createAccountBindingStore   — factory (backed by account-bindings.json)
 *   resolveOrBindAccount        — resolver: returns existing binding or selects
 *                                 and persists a new one from the given sources
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AccountBinding {
  accountId: string;
  modelId: string;
  boundAt: string;
}

export interface AccountBindingStore {
  read(taskId: string): Promise<AccountBinding | undefined>;
  write(taskId: string, binding: AccountBinding): Promise<void>;
}

export interface ResolveOrBindAccountOpts {
  taskId: string;
  store: AccountBindingStore;
  slotAccountId?: string | undefined;
  defaultAccountId?: string | undefined;
  modelId: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Serialized file format: JSON object keyed by taskId. */
type BindingFile = Record<string, AccountBinding>;

/**
 * File-backed AccountBindingStore.
 * All reads and writes are serialized through a single promise chain so
 * concurrent callers never produce a torn write.
 */
class FileAccountBindingStore implements AccountBindingStore {
  private readonly filePath: string;
  /**
   * Global serialization chain — ensures reads and writes to the shared JSON
   * file are sequential even if callers do not await.
   */
  private chain: Promise<unknown>;

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, "account-bindings.json");
    this.chain = Promise.resolve();
  }

  /**
   * Enqueue a task on the global chain.
   * The chain itself never rejects (errors absorbed by the void tail), so
   * future tasks always run regardless of whether a previous task failed.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.chain.then(() => task());
    // Absorb errors on the chain so subsequent enqueues still fire.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Load the full JSON file. Returns an empty object when file does not exist. */
  private async loadAll(): Promise<BindingFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    return JSON.parse(raw) as BindingFile;
  }

  /** Persist the full data object. */
  private async saveAll(data: BindingFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
    });
  }

  async read(taskId: string): Promise<AccountBinding | undefined> {
    return this.enqueue(async () => {
      const data = await this.loadAll();
      return data[taskId];
    });
  }

  async write(taskId: string, binding: AccountBinding): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.loadAll();
      data[taskId] = binding;
      await this.saveAll(data);
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a file-backed AccountBindingStore.
 *
 * Bindings are persisted to `<dataRoot>/account-bindings.json`.
 * - An absent file is treated as an empty store (all reads return `undefined`).
 * - The file is created on first write (no pre-creation needed).
 */
export function createAccountBindingStore(opts: {
  dataRoot: string;
}): AccountBindingStore {
  return new FileAccountBindingStore(opts.dataRoot);
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Return the durable account binding for a task, creating and persisting one
 * if none exists yet.
 *
 * Precedence (once a binding is written it is authoritative):
 *   existing binding > slotAccountId > defaultAccountId
 *
 * Throws an Error (message contains "no account") when no source is available.
 */
export async function resolveOrBindAccount(
  opts: ResolveOrBindAccountOpts,
): Promise<AccountBinding> {
  const { taskId, store, slotAccountId, defaultAccountId, modelId } = opts;

  const existing = await store.read(taskId);
  if (existing !== undefined) {
    return existing;
  }

  const accountId = slotAccountId ?? defaultAccountId;
  if (accountId === undefined) {
    throw new Error(
      `resolveOrBindAccount: no account available for task "${taskId}" — provide slotAccountId or defaultAccountId`,
    );
  }

  const binding: AccountBinding = {
    accountId,
    modelId,
    boundAt: new Date().toISOString(),
  };
  await store.write(taskId, binding);
  return binding;
}
