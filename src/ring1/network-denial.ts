/**
 * Ring-1 network denial registry and manifest filter.
 *
 * Loads a YAML registry that declares which tools are allowlisted for use by
 * agents.  Network-capable and exec/shell-class tools can never appear in the
 * allowlist; attempting to do so rejects with `NetworkDenialError`.
 *
 * `filterToolManifest` enforces deny-by-default: a tool is kept only if it is
 * in the registry allowlist OR is declared pure-classified in the registry.
 * All other tools are dropped and journaled in the result's `.dropped` set.
 *
 * The module imports no model seam — enforcement is purely deterministic (PRD §4).
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Permanent blocked sets (network-capable + exec/shell-class)
// A tool name in either set can never appear in the allowlist.
// ---------------------------------------------------------------------------

const NETWORK_CAPABLE_TOOLS = new Set([
  "fetch",
  "http_get",
  "http_post",
  "http_request",
  "curl",
  "wget",
  "request",
  "axios_get",
  "axios_post",
]);

const EXEC_SHELL_CLASS_TOOLS = new Set([
  "bash",
  "sh",
  "exec",
  "exec_command",
  "shell_run",
  "shell",
  "run_command",
  "execute",
  "spawn",
  "subprocess",
]);

function isPermanentlyBlocked(name: string): boolean {
  return NETWORK_CAPABLE_TOOLS.has(name) || EXEC_SHELL_CLASS_TOOLS.has(name);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
  name: string;
}

export interface AllowlistEntry {
  name: string;
  pure: boolean;
}

export interface NetworkDenialRegistry {
  allowlist: AllowlistEntry[];
  pureClassified: string[];
}

export interface ManifestFilterResult {
  allowed: ToolDescriptor[];
  dropped: ToolDescriptor[];
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class NetworkDenialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkDenialError";
  }
}

/**
 * Explicitly declared trusted effectful tool names (e.g. broker-submit, gated
 * file tools).  Supplied to `loadNetworkDenialRegistry`; any allowlist entry
 * with `pure: false` whose name is NOT in this set is rejected unconditionally.
 */
export interface TrustedEffectfulConfig {
  names: Set<string>;
}

/**
 * Built-in default trusted effectful set.  Covers standard gated file-operation
 * tool names.  Callers may override by passing an explicit `TrustedEffectfulConfig`.
 */
export const DEFAULT_TRUSTED_EFFECTFUL: TrustedEffectfulConfig = {
  names: new Set([
    "write_file",
    "create_file",
    "edit_file",
    "delete_file",
    "rename_file",
    "copy_file",
    "broker_submit",
  ]),
};

// ---------------------------------------------------------------------------
// Registry loader
// ---------------------------------------------------------------------------

/**
 * Load a YAML network-denial registry from the given file path.
 *
 * Rejects with `NetworkDenialError` if:
 * - the file cannot be parsed as YAML
 * - the top-level structure is not an object with `allowlist` array and
 *   `pureClassified` array
 * - any allowlist entry names a permanently-blocked tool (network-capable or
 *   exec/shell-class)
 * - any allowlist entry has `pure: false` whose name is not in `trustedEffectful.names`
 *   (enforced unconditionally — use `DEFAULT_TRUSTED_EFFECTFUL` or supply an explicit set)
 */
export async function loadNetworkDenialRegistry(
  filePath: string,
  trustedEffectful: TrustedEffectfulConfig = DEFAULT_TRUSTED_EFFECTFUL,
): Promise<NetworkDenialRegistry> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new NetworkDenialError(
      `NetworkDenialError: cannot read registry file "${filePath}": ${String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new NetworkDenialError(
      `NetworkDenialError: YAML parse failure in "${filePath}": ${String(err)}`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new NetworkDenialError(
      `NetworkDenialError: registry "${filePath}" must be a YAML object`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj["allowlist"])) {
    throw new NetworkDenialError(
      `NetworkDenialError: registry "${filePath}" must have an "allowlist" array`,
    );
  }

  if (!Array.isArray(obj["pureClassified"])) {
    throw new NetworkDenialError(
      `NetworkDenialError: registry "${filePath}" must have a "pureClassified" array`,
    );
  }

  const allowlist: AllowlistEntry[] = [];
  for (const entry of obj["allowlist"] as unknown[]) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      throw new NetworkDenialError(
        `NetworkDenialError: each allowlist entry in "${filePath}" must be an object with "name" and "pure"`,
      );
    }
    const e = entry as Record<string, unknown>;
    if (typeof e["name"] !== "string" || typeof e["pure"] !== "boolean") {
      throw new NetworkDenialError(
        `NetworkDenialError: allowlist entry in "${filePath}" missing string "name" or boolean "pure"`,
      );
    }
    const toolName = e["name"];
    if (isPermanentlyBlocked(toolName)) {
      throw new NetworkDenialError(
        `NetworkDenialError: allowlist in "${filePath}" contains permanently-blocked tool "${toolName}"`,
      );
    }
    if (e["pure"] === false && !trustedEffectful.names.has(toolName)) {
      throw new NetworkDenialError(
        `NetworkDenialError: allowlist entry "${toolName}" in "${filePath}" is pure:false but not in the trusted effectful set`,
      );
    }
    allowlist.push({ name: toolName, pure: e["pure"] });
  }

  const pureClassified: string[] = [];
  for (const item of obj["pureClassified"] as unknown[]) {
    if (typeof item !== "string") {
      throw new NetworkDenialError(
        `NetworkDenialError: pureClassified entries in "${filePath}" must be strings`,
      );
    }
    if (isPermanentlyBlocked(item)) {
      throw new NetworkDenialError(
        `NetworkDenialError: pureClassified in "${filePath}" contains permanently-blocked tool "${item}"`,
      );
    }
    pureClassified.push(item);
  }

  return { allowlist, pureClassified };
}

// ---------------------------------------------------------------------------
// Manifest filter
// ---------------------------------------------------------------------------

/**
 * Filter a session tool manifest against the network-denial registry.
 *
 * Deny-by-default: a tool is kept only if:
 *   (a) its name appears in `registry.allowlist`, OR
 *   (b) its name appears in `registry.pureClassified`.
 *
 * All other tools (including permanently-blocked network/exec-class tools) are
 * dropped and journaled in the result's `.dropped` array.
 */
export function filterToolManifest(
  candidates: ToolDescriptor[],
  registry: NetworkDenialRegistry,
): ManifestFilterResult {
  const allowedNames = new Set(registry.allowlist.map((e) => e.name));
  const pureNames = new Set(registry.pureClassified);

  const allowed: ToolDescriptor[] = [];
  const dropped: ToolDescriptor[] = [];

  for (const candidate of candidates) {
    if (allowedNames.has(candidate.name) || pureNames.has(candidate.name)) {
      allowed.push(candidate);
    } else {
      dropped.push(candidate);
    }
  }

  return { allowed, dropped };
}

// ---------------------------------------------------------------------------
// Spawn environment builder
// ---------------------------------------------------------------------------

/**
 * Allowlist of environment variable names that are safe to pass to a spawned
 * agent process.  Only keys explicitly listed here are forwarded; everything
 * else — including credential material (`*_API_KEY`, `SSH_AUTH_SOCK`,
 * `AWS_*`, `GITHUB_*`, `NPM_TOKEN`, etc.) — is silently omitted.
 */
export interface SpawnEnvAllowlist {
  allow: string[];
}

/**
 * Build a sanitized spawn environment from an inherited env object.
 *
 * Returns a new plain `Record<string, string>` containing only the keys that
 * are present in both `inherited` and `allowlist.allow`.  Keys listed in the
 * allowlist but absent from `inherited` are silently omitted.  No pattern
 * matching or inference — pure allowlist-only selection.
 */
export function buildSpawnEnv(
  inherited: Record<string, string>,
  allowlist: SpawnEnvAllowlist,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of allowlist.allow) {
    const val = inherited[key];
    if (Object.prototype.hasOwnProperty.call(inherited, key) && val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}
