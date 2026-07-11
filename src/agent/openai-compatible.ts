/**
 * src/agent/openai-compatible.ts
 *
 * Config store for OpenAI-compatible provider accounts. Persists endpoint
 * metadata (baseUrl / api / models[]) to <dataRoot>/openai-compatible-configs.json.
 * Api-keys live in the ProviderCredentialStore (custody), not in this file.
 *
 * Exports:
 *   OpenAICompatibleConfig      — endpoint metadata shape
 *   OpenAICompatibleConfigStore — interface
 *   createOpenAICompatibleConfigStore(opts) — factory
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Endpoint metadata for an openai-compatible account. */
export interface OpenAICompatibleConfig {
  baseUrl: string;
  api: "openai-completions" | "openai-responses";
  /** Model ids served by this endpoint. */
  models: string[];
}

/** Store for per-account openai-compatible endpoint configs. */
export interface OpenAICompatibleConfigStore {
  save(accountId: string, config: OpenAICompatibleConfig): Promise<void>;
  load(accountId: string): Promise<OpenAICompatibleConfig | undefined>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ConfigFile = Record<string, OpenAICompatibleConfig>;

class FileOpenAICompatibleConfigStore implements OpenAICompatibleConfigStore {
  private readonly filePath: string;
  /** Serializes concurrent writes through a promise chain. */
  private chain: Promise<void> = Promise.resolve();

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, "openai-compatible-configs.json");
  }

  private async loadAll(): Promise<ConfigFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    return JSON.parse(raw) as ConfigFile;
  }

  private async saveAll(data: ConfigFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
    });
  }

  save(accountId: string, config: OpenAICompatibleConfig): Promise<void> {
    const run = async (): Promise<void> => {
      const data = await this.loadAll();
      data[accountId] = config;
      await this.saveAll(data);
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  async load(accountId: string): Promise<OpenAICompatibleConfig | undefined> {
    const data = await this.loadAll();
    return data[accountId];
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createOpenAICompatibleConfigStore(opts: {
  dataRoot: string;
}): OpenAICompatibleConfigStore {
  return new FileOpenAICompatibleConfigStore(opts.dataRoot);
}
