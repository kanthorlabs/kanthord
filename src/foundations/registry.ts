import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Thrown when a registry file cannot be parsed as valid YAML.
 * The message always includes the file path so callers can surface it.
 */
export class RegistryParseError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(
      `Failed to parse registry file ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "RegistryParseError";
  }
}

/**
 * Thrown when a required key is absent from a parsed registry entry.
 * The message names both the file path and the missing key.
 */
export class RegistryValidationError extends Error {
  readonly filePath: string;
  readonly missingKey: string;

  constructor(filePath: string, missingKey: string) {
    super(
      `Registry file ${filePath} is missing required key "${missingKey}"`,
    );
    this.name = "RegistryValidationError";
    this.filePath = filePath;
    this.missingKey = missingKey;
  }
}

/**
 * Load a YAML registry file and return the parsed object.
 *
 * `requiredKeys` is reserved for Story T3 validation (a missing key will
 * surface as a typed `RegistryValidationError`).  In T1 it is accepted but
 * not yet validated (Task spec: only parse failure is in scope here).
 *
 * Throws `RegistryParseError` (message includes `path`) if the YAML is
 * malformed or the file cannot be read.
 */
export async function loadRegistryFile(
  path: string,
  requiredKeys: string[],
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new RegistryParseError(path, err);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new RegistryParseError(path, err);
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new RegistryParseError(
      path,
      `expected a YAML mapping, got ${parsed === null ? "null" : typeof parsed}`,
    );
  }

  const result = parsed as Record<string, unknown>;

  for (const key of requiredKeys) {
    if (!(key in result)) {
      throw new RegistryValidationError(path, key);
    }
  }

  return result;
}

/**
 * Load all YAML files in a directory and return a record keyed by the value
 * of `keyField` inside each parsed entry.  The filename is never used as the
 * key — the identity comes from inside the document, matching the Story 004
 * T2 acceptance criterion.
 *
 * Throws `RegistryParseError` (forwarded from `loadRegistryFile`) for any
 * file that cannot be read or is malformed YAML.
 */
export async function loadRegistryDir(
  dir: string,
  keyField: string,
  requiredKeys: string[],
): Promise<Record<string, Record<string, unknown>>> {
  const files = await readdir(dir);
  const result: Record<string, Record<string, unknown>> = {};

  for (const file of files) {
    const filePath = join(dir, file);
    const entry = await loadRegistryFile(filePath, requiredKeys);
    const key = String(entry[keyField]);
    result[key] = entry;
  }

  return result;
}
