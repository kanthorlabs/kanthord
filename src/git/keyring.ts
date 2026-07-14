/**
 * src/git/keyring — Credential keyring + identity custody (Story 000 / Task T2)
 *
 * Exports:
 *   - IdentityLoadError — typed error for all credential load failures
 *   - Identity           — { name, token }
 *   - LoadIdentityOpts   — discriminated union: load from file or from env
 *   - loadIdentity       — loads from file (mode+owner checks) or from env
 *   - injectToken        — creates a per-invocation child env with GH_TOKEN set
 *
 * Security invariants:
 *   - Raw token values are never passed to the log callback.
 *   - File-sourced tokens require mode exactly 0600; any broader permission
 *     throws with code "insecure-file-mode".
 *   - File ownership must match the effective UID; mismatch throws with code
 *     "wrong-owner".
 *   - Missing env var throws with code "missing-env-token".
 *   - injectToken never mutates process.env or the baseEnv reference.
 *
 * Credential file format:
 *   The credential file is env-style flat `KEY=VALUE`, one per line (blank lines
 *   and `#` comments ignored). A single file holds every credential the daemon
 *   custodies (identity PATs keyed `KANTHOR_IDENTITY_<NAME>_TOKEN`, plus other
 *   service keys). `loadCredentialsFile` parses it into an in-memory map after
 *   the mode/owner checks; values are never dumped into `process.env`.
 */

import { readFile, stat } from "node:fs/promises";

// ---------------------------------------------------------------------------
// IdentityLoadError
// ---------------------------------------------------------------------------

export type IdentityLoadErrorCode =
  | "insecure-file-mode"
  | "malformed-credentials"
  | "missing-env-token"
  | "missing-file-token"
  | "wrong-owner";

export class IdentityLoadError extends Error {
  code: IdentityLoadErrorCode;

  constructor(code: IdentityLoadErrorCode, message: string) {
    super(message);
    this.name = "IdentityLoadError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type Identity = {
  name: string;
  token: string;
};

// ---------------------------------------------------------------------------
// LoadIdentityOpts — discriminated union
// ---------------------------------------------------------------------------

export type LoadIdentityOpts = { name: string; log?: (msg: string) => void } & (
  | { file: string; env?: never }
  | { env: true; file?: never }
);

// ---------------------------------------------------------------------------
// loadIdentity
// ---------------------------------------------------------------------------

/**
 * Load a named identity token from either a file or an environment variable.
 *
 * File mode:
 *   - Reads the file and trims trailing whitespace from the token.
 *   - Throws IdentityLoadError("insecure-file-mode") if mode is anything
 *     other than 0600 (i.e. any bit beyond owner-read+write is set).
 *   - Throws IdentityLoadError("wrong-owner") if the file's uid does not
 *     match process.getuid().
 *
 * Env mode:
 *   - Reads KANTHOR_IDENTITY_<NAME_UPPERCASED>_TOKEN from process.env.
 *   - Throws IdentityLoadError("missing-env-token") if absent.
 *
 * The log callback (if provided) never receives the raw token value.
 */
export async function loadIdentity(opts: LoadIdentityOpts): Promise<Identity> {
  const { name, log } = opts;

  if ("file" in opts && opts.file !== undefined) {
    return loadFromFile(name, opts.file, log);
  }

  // env: true branch
  return loadFromEnv(name, log);
}

/**
 * Enforce the custody file invariants: mode exactly 0600 and owner == effective
 * UID. Throws IdentityLoadError("insecure-file-mode" | "wrong-owner").
 */
async function assertSecureFile(filePath: string): Promise<void> {
  const info = await stat(filePath);

  // Check file permission bits. Mode & 0o777 gives the permission octal.
  // Only 0o600 (owner read+write, no group/other bits) is allowed.
  const modeBits = info.mode & 0o777;
  if (modeBits !== 0o600) {
    throw new IdentityLoadError(
      "insecure-file-mode",
      `credential file "${filePath}" has mode ${(modeBits).toString(8).padStart(4, "0")} — must be exactly 0600`,
    );
  }

  // Check file owner matches the effective UID (skip on platforms without getuid).
  if (typeof process.getuid === "function") {
    const euid = process.getuid();
    if (info.uid !== euid) {
      throw new IdentityLoadError(
        "wrong-owner",
        `credential file "${filePath}" is owned by uid ${info.uid} but process euid is ${euid}`,
      );
    }
  }
}

/**
 * Parse an env-style flat `KEY=VALUE` credential file into an in-memory map,
 * after enforcing the mode/owner custody invariants.
 *
 *   - Blank lines and lines starting with `#` are ignored.
 *   - Each remaining line must contain `=`; the first `=` splits key/value,
 *     both trimmed. Empty values are allowed (the key is present but unset).
 *   - A non-comment line with no `=` throws IdentityLoadError
 *     ("malformed-credentials"), reporting the line NUMBER only — never the
 *     content, which may hold a secret.
 *
 * The log callback (if provided) receives only the key count, never any value.
 */
export async function loadCredentialsFile(
  filePath: string,
  log?: (msg: string) => void,
): Promise<Record<string, string>> {
  await assertSecureFile(filePath);

  const raw = await readFile(filePath, "utf8");
  const secrets: Record<string, string> = {};
  for (const [i, line] of raw.split("\n").entries()) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) {
      throw new IdentityLoadError(
        "malformed-credentials",
        `credential file "${filePath}" line ${i + 1} is not KEY=VALUE`,
      );
    }
    secrets[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }

  if (log !== undefined) {
    log(`credential file "${filePath}" loaded (${Object.keys(secrets).length} keys)`);
  }

  return secrets;
}

async function loadFromFile(
  name: string,
  filePath: string,
  log: ((msg: string) => void) | undefined,
): Promise<Identity> {
  const secrets = await loadCredentialsFile(filePath, log);
  const envKey = `KANTHOR_IDENTITY_${name.toUpperCase()}_TOKEN`;
  const token = secrets[envKey];

  // Key absent → genuine misconfiguration (throw). Key present but empty value
  // is allowed: it surfaces downstream as a blocked/failing preflight, never a
  // crash (preserves the "operator left the token blank" path).
  if (token === undefined) {
    throw new IdentityLoadError(
      "missing-file-token",
      `credential file "${filePath}" has no key "${envKey}" for identity "${name}"`,
    );
  }

  if (log !== undefined) {
    // Log that identity was loaded — never include the raw token value.
    log(`identity "${name}" loaded from file key "${envKey}" (length=${token.length})`);
  }

  return { name, token };
}

function loadFromEnv(
  name: string,
  log: ((msg: string) => void) | undefined,
): Promise<Identity> {
  const envKey = `KANTHOR_IDENTITY_${name.toUpperCase()}_TOKEN`;
  const token = process.env[envKey];

  if (token === undefined || token === "") {
    throw new IdentityLoadError(
      "missing-env-token",
      `environment variable "${envKey}" is not set`,
    );
  }

  if (log !== undefined) {
    // Never include the raw token value in the log message.
    log(`identity "${name}" loaded from env key "${envKey}" (length=${token.length})`);
  }

  return Promise.resolve({ name, token });
}

// ---------------------------------------------------------------------------
// injectToken
// ---------------------------------------------------------------------------

/**
 * Return a new child-env record with GH_TOKEN set from the identity.
 *
 * - Never mutates baseEnv.
 * - Never mutates process.env.
 * - The returned record is a shallow copy of baseEnv plus GH_TOKEN.
 */
export function injectToken(
  identity: Identity,
  baseEnv: Record<string, string>,
): Record<string, string> {
  return { ...baseEnv, GH_TOKEN: identity.token };
}
