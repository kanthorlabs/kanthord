/**
 * src/agent/provider-credential-store.ts
 *
 * Account-keyed credential store backed by a 0600 JSON file at
 * <dataRoot>/credentials.json. Implements pi-ai CredentialStore keyed by
 * kanthord account id (opaque string). Custody mirrors src/git/keyring.ts:
 * mode 0600, value-redacted logs, typed errors.
 *
 * Exports:
 *   ProviderCredentialStore            — type alias for pi-ai CredentialStore
 *   ProviderCredentialStoreOpts        — factory options
 *   createProviderCredentialStore(opts) — factory
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { IdentityLoadError } from "../git/keyring.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** pi-ai CredentialStore keyed by kanthord account id. */
export type ProviderCredentialStore = CredentialStore;

export interface ProviderCredentialStoreOpts {
  /** Directory under which credentials.json is stored. Must already exist. */
  dataRoot: string;
  /**
   * Optional log callback. Called on read/modify/delete.
   * Never receives raw access, refresh, or api-key values.
   */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Serialized file format: JSON object keyed by account id. */
type StoreFile = Record<string, Credential>;

/** Produce a log-safe string for a credential: only the type tag. */
function redactedTag(cred: Credential): string {
  return `{type:${cred.type}}`;
}

/**
 * File-backed implementation of ProviderCredentialStore.
 * Per-account serialized reads/writes via a promise chain map.
 */
class FileProviderCredentialStore implements CredentialStore {
  private readonly filePath: string;
  private readonly logFn: ((msg: string) => void) | undefined;
  /** Per-account serialization chain — prevents lost-update on same account. */
  private readonly chains: Map<string, Promise<unknown>>;

  constructor(dataRoot: string, log?: (msg: string) => void) {
    this.filePath = join(dataRoot, "credentials.json");
    this.logFn = log;
    this.chains = new Map();
  }

  /**
   * Enqueue a task on the per-account chain.
   * If the previous task failed, the new task still runs (error recovery).
   */
  private enqueue<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(accountId) ?? Promise.resolve();
    // Run task even if prev rejected, so the chain is never permanently blocked.
    const next = prev.then(task, () => task());
    this.chains.set(accountId, next);
    return next;
  }

  /**
   * Check the backing file's mode bits.
   * Throws { code: "insecure-file-mode" } if the file exists and mode > 0600.
   * Silently passes if the file does not exist yet (ENOENT).
   */
  private async checkMode(): Promise<void> {
    let statResult;
    try {
      statResult = await stat(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const modeBits = statResult.mode & 0o777;
    if (modeBits !== 0o600) {
      throw new IdentityLoadError(
        "insecure-file-mode",
        `credential store file "${this.filePath}" has mode ${modeBits.toString(8).padStart(4, "0")} — must be exactly 0600`,
      );
    }
    if (typeof process.getuid === "function") {
      const euid = process.getuid();
      if (statResult.uid !== euid) {
        throw new IdentityLoadError(
          "wrong-owner",
          `credential store file "${this.filePath}" is owned by uid ${statResult.uid} but process euid is ${euid}`,
        );
      }
    }
  }

  /** Load the full JSON file. Returns an empty object if file does not exist. */
  private async loadAll(): Promise<StoreFile> {
    await this.checkMode();
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    return JSON.parse(raw) as StoreFile;
  }

  /**
   * Persist the full data object with mode 0600.
   * The mode option creates the file at 0600 on first write; subsequent writes
   * leave the mode unchanged (already 0600 from the first write).
   */
  private async saveAll(data: StoreFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  // -------------------------------------------------------------------------
  // CredentialStore interface
  // -------------------------------------------------------------------------

  async read(accountId: string): Promise<Credential | undefined> {
    return this.enqueue(accountId, async () => {
      const data = await this.loadAll();
      const cred = data[accountId];
      if (this.logFn !== undefined) {
        this.logFn(
          `credential-store read accountId="${accountId}" found=${cred !== undefined}`,
        );
      }
      return cred;
    });
  }

  async modify(
    accountId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(accountId, async () => {
      const data = await this.loadAll();
      const current = data[accountId];
      const next = await fn(current);
      if (next !== undefined) {
        data[accountId] = next;
        await this.saveAll(data);
        if (this.logFn !== undefined) {
          // Never log raw token values — only the type tag.
          this.logFn(
            `credential-store modify accountId="${accountId}" cred=${redactedTag(next)}`,
          );
        }
        return next;
      }
      // fn returned undefined → no-op; leave existing credential unchanged.
      if (this.logFn !== undefined) {
        this.logFn(`credential-store modify accountId="${accountId}" no-op`);
      }
      return current;
    });
  }

  async delete(accountId: string): Promise<void> {
    return this.enqueue(accountId, async () => {
      const data = await this.loadAll();
      // Rebuild without the target account id to avoid delete-operator typing issues.
      const updated: StoreFile = {};
      for (const [k, v] of Object.entries(data)) {
        if (k !== accountId) {
          updated[k] = v;
        }
      }
      await this.saveAll(updated);
      if (this.logFn !== undefined) {
        this.logFn(`credential-store delete accountId="${accountId}"`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a file-backed ProviderCredentialStore.
 *
 * The backing file lives at <dataRoot>/credentials.json.
 * - Created at mode 0600 on first write.
 * - A pre-existing file with mode wider than 0600 causes reads/writes to
 *   throw an Error with code "insecure-file-mode".
 * - The log callback (if provided) never receives raw access, refresh, or
 *   api-key values.
 */
export function createProviderCredentialStore(
  opts: ProviderCredentialStoreOpts,
): ProviderCredentialStore {
  return new FileProviderCredentialStore(opts.dataRoot, opts.log);
}
