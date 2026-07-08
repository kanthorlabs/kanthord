import { readFile } from "node:fs/promises";
import { parse } from "yaml";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A scan match carries only the pattern class name — never the secret value.
 */
export interface ScanMatch {
  readonly patternClass: string;
}

/**
 * A single pattern entry in the YAML registry.
 */
export interface PatternEntry {
  readonly name: string;
  readonly regex: string;
}

/**
 * The parsed pattern registry. Loaded via `loadPatternRegistry`.
 */
export interface PatternRegistry {
  readonly version: string;
  readonly patterns: ReadonlyArray<PatternEntry>;
}

// ---------------------------------------------------------------------------
// scanPayload
// ---------------------------------------------------------------------------

/**
 * Scan `payload` against every pattern in `registry`.
 * Returns one `ScanMatch` per matching pattern (at most one per pattern, even
 * if the pattern matches multiple times — the class name is the signal).
 * The secret value is never surfaced in the result.
 */
export function scanPayload(
  payload: string,
  registry: PatternRegistry,
): ScanMatch[] {
  const matches: ScanMatch[] = [];
  for (const entry of registry.patterns) {
    const re = new RegExp(entry.regex);
    if (re.test(payload)) {
      matches.push({ patternClass: entry.name });
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// loadPatternRegistry
// ---------------------------------------------------------------------------

/**
 * Load and validate a YAML pattern registry from `filePath`.
 * Rejects with an `Error` whose message includes `filePath` on:
 *   - unreadable / missing file
 *   - unparseable YAML
 *   - missing required fields (`version`, `patterns`)
 */
export async function loadPatternRegistry(
  filePath: string,
): Promise<PatternRegistry> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (cause) {
    throw new Error(
      `Failed to read pattern registry at ${filePath}: ${String(cause)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (cause) {
    throw new Error(
      `Failed to parse pattern registry at ${filePath}: ${String(cause)}`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    !("patterns" in parsed)
  ) {
    throw new Error(
      `Pattern registry at ${filePath} is missing required fields: 'version' and 'patterns'`,
    );
  }

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate["version"] !== "string") {
    throw new Error(
      `Pattern registry at ${filePath}: 'version' must be a string`,
    );
  }

  if (!Array.isArray(candidate["patterns"])) {
    throw new Error(
      `Pattern registry at ${filePath}: 'patterns' must be an array`,
    );
  }

  const version = candidate["version"];
  const patterns: PatternEntry[] = [];

  for (const item of candidate["patterns"] as unknown[]) {
    if (
      item === null ||
      typeof item !== "object" ||
      !("name" in item) ||
      !("regex" in item)
    ) {
      throw new Error(
        `Pattern registry at ${filePath}: each pattern must have 'name' and 'regex' fields`,
      );
    }
    const p = item as Record<string, unknown>;
    if (typeof p["name"] !== "string" || typeof p["regex"] !== "string") {
      throw new Error(
        `Pattern registry at ${filePath}: pattern 'name' and 'regex' must be strings`,
      );
    }
    patterns.push({ name: p["name"], regex: p["regex"] });
  }

  return { version, patterns };
}
