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
 */

import { readFile, stat } from "node:fs/promises";

// ---------------------------------------------------------------------------
// IdentityLoadError
// ---------------------------------------------------------------------------

export type IdentityLoadErrorCode =
  | "insecure-file-mode"
  | "missing-env-token"
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

async function loadFromFile(
  name: string,
  filePath: string,
  log: ((msg: string) => void) | undefined,
): Promise<Identity> {
  const info = await stat(filePath);

  // Check file permission bits. Mode & 0o777 gives the permission octal.
  // Only 0o600 (owner read+write, no group/other bits) is allowed.
  const modeBits = info.mode & 0o777;
  if (modeBits !== 0o600) {
    throw new IdentityLoadError(
      "insecure-file-mode",
      `identity file "${filePath}" has mode ${(modeBits).toString(8).padStart(4, "0")} — must be exactly 0600`,
    );
  }

  // Check file owner matches the effective UID (skip on platforms without getuid).
  if (typeof process.getuid === "function") {
    const euid = process.getuid();
    if (info.uid !== euid) {
      throw new IdentityLoadError(
        "wrong-owner",
        `identity file "${filePath}" is owned by uid ${info.uid} but process euid is ${euid}`,
      );
    }
  }

  const raw = await readFile(filePath, "utf8");
  // Trim newlines / whitespace (token files conventionally end with \n)
  const token = raw.trim();

  if (log !== undefined) {
    // Log that identity was loaded — never include the raw token value.
    log(`identity "${name}" loaded from file (length=${token.length})`);
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
