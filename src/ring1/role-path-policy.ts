/**
 * Ring-1 role-path policy registry and evaluation.
 *
 * Loads a YAML registry that declares, per agent role, separate read and write
 * allow/deny path glob dimensions.  `evaluatePathPolicy` enforces deny-wins
 * semantics on canonicalized paths; blocked operations emit an escalation event
 * shaped after Epic 007 conventions.  The module imports no model seam —
 * enforcement is purely deterministic (PRD §4).
 */

import { readFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RoleDimension {
  allow: string[];
  deny: string[];
}

export interface RoleEntry {
  read: RoleDimension;
  write: RoleDimension;
}

export interface RolePathRegistry {
  roles: Record<string, RoleEntry>;
}

export interface PathPolicyEscalation {
  role: string;
  rule: string;
  path: string;
}

export type PathPolicyDecision = "allow" | "block";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class RolePathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RolePathPolicyError";
  }
}

// ---------------------------------------------------------------------------
// Minimal glob matcher
//
// Supports the subset of glob syntax used in path policies:
//   `**`  — matches zero or more path segments (any character sequence)
//   `*`   — matches any characters within a single segment (no `/`)
// Matching is case-sensitive (Linux/macOS paths under /workspace are case-
// sensitive; macOS case-insensitivity is a filesystem concern handled upstream
// by callers that resolve real paths before calling evaluatePathPolicy).
// ---------------------------------------------------------------------------

function globToRegex(glob: string): RegExp {
  // Escape all regex meta-characters except * which we handle specially
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === undefined) break;
    if (ch === "*" && glob[i + 1] === "*") {
      // `**` — match anything including path separators
      re += ".*";
      i += 2;
      // Skip an optional trailing `/` that follows `**/` so `**/foo` works
      if (glob[i] === "/") {
        re += "/?";
        i += 1;
      }
    } else if (ch === "*") {
      // `*` — match anything except `/`
      re += "[^/]*";
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += "\\" + ch;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesGlob(path: string, glob: string): boolean {
  return globToRegex(glob).test(path);
}

function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Path canonicalization
//
// Collapses `..` segments and makes the path absolute; does NOT perform
// filesystem I/O (symlink resolution must be done by the caller who supplies
// `canonicalPath`).
// ---------------------------------------------------------------------------

function canonicalize(rawPath: string, worktree?: string): string {
  // normalize() collapses `..` and multiple slashes; resolve() makes absolute.
  // When `worktree` is provided, relative paths are resolved against it
  // (not process.cwd()), so relative paths are anchored to the agent worktree.
  if (rawPath.startsWith("/")) {
    return normalize(rawPath);
  }
  if (worktree !== undefined) {
    return normalize(resolve(worktree, rawPath));
  }
  return resolve(rawPath);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
}

function validateGlob(glob: string, file: string, where: string): void {
  // Detect unclosed brace — a `{` with no matching `}` is a malformed pattern
  let depth = 0;
  for (const ch of glob) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  if (depth !== 0) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${file}: ${where} contains a malformed glob pattern (unclosed brace): ${glob}`,
    );
  }
}

function parseDimension(raw: unknown, file: string, where: string): RoleDimension {
  if (typeof raw !== "object" || raw === null) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${file}: ${where} must be an object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  // Reject any key other than "allow" and "deny" — unknown fields are a typed error
  const knownKeys = new Set(["allow", "deny"]);
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      throw new RolePathPolicyError(
        `Invalid role-path registry at ${file}: ${where} contains unknown field "${key}"`,
      );
    }
  }
  const allow = "allow" in obj ? obj["allow"] : [];
  const deny = "deny" in obj ? obj["deny"] : [];
  if (!isStringArray(allow)) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${file}: ${where}.allow must be an array of strings`,
    );
  }
  if (!isStringArray(deny)) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${file}: ${where}.deny must be an array of strings`,
    );
  }
  // Validate glob syntax for all patterns
  for (const g of allow) {
    validateGlob(g, file, `${where}.allow`);
  }
  for (const g of deny) {
    validateGlob(g, file, `${where}.deny`);
  }
  return { allow, deny };
}

function parseRoleEntry(raw: unknown, file: string, role: string): RoleEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${file}: role "${role}" must be an object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const ALLOWED_ROLE_KEYS = new Set(["read", "write"]);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_ROLE_KEYS.has(key)) {
      throw new RolePathPolicyError(
        `Invalid role-path registry at ${file}: role "${role}" has unknown field "${key}"`,
      );
    }
  }
  const read = parseDimension(
    "read" in obj ? obj["read"] : {},
    file,
    `roles.${role}.read`,
  );
  const write = parseDimension(
    "write" in obj ? obj["write"] : {},
    file,
    `roles.${role}.write`,
  );
  return { read, write };
}

// ---------------------------------------------------------------------------
// Registry loader
// ---------------------------------------------------------------------------

/**
 * Reads a YAML file from `filePath` and returns a validated `RolePathRegistry`.
 * Rejects with `RolePathPolicyError` on parse failure or structural mismatch,
 * always including `filePath` in the error message.
 */
export async function loadRolePathRegistry(
  filePath: string,
): Promise<RolePathRegistry> {
  let raw: unknown;
  try {
    const text = await readFile(filePath, "utf8");
    raw = parseYaml(text);
  } catch (err) {
    if (err instanceof RolePathPolicyError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new RolePathPolicyError(
      `Failed to load role-path registry at ${filePath}: ${msg}`,
    );
  }

  if (typeof raw !== "object" || raw === null) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${filePath}: top-level must be a YAML mapping`,
    );
  }

  const top = raw as Record<string, unknown>;
  if (!("roles" in top)) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${filePath}: missing "roles" key`,
    );
  }

  const rolesRaw = top["roles"];
  if (typeof rolesRaw !== "object" || rolesRaw === null || Array.isArray(rolesRaw)) {
    throw new RolePathPolicyError(
      `Invalid role-path registry at ${filePath}: "roles" must be a mapping`,
    );
  }

  const rolesMap = rolesRaw as Record<string, unknown>;
  const roles: Record<string, RoleEntry> = {};
  for (const roleName of Object.keys(rolesMap)) {
    roles[roleName] = parseRoleEntry(rolesMap[roleName], filePath, roleName);
  }

  return { roles };
}

// ---------------------------------------------------------------------------
// Policy evaluator
// ---------------------------------------------------------------------------

export interface PathPolicyOptions {
  registry: RolePathRegistry;
  role: string;
  operation: "read" | "write";
  path: string;
  writeScope: string[];
  onEscalate: (e: PathPolicyEscalation) => void;
  /** For rename/copy: the second path involved in the operation. */
  secondaryPath?: string;
  /** Pre-resolved canonical path (e.g. symlink target). When provided, policy
   *  evaluation uses this instead of canonicalizing `path`. */
  canonicalPath?: string;
  /** Pre-resolved canonical path for the secondary path (e.g. rename/copy
   *  destination symlink target). When provided, policy evaluation uses this
   *  instead of canonicalizing `secondaryPath`. */
  secondaryCanonicalPath?: string;
  /** Agent worktree root. When provided, relative `path`/`secondaryPath` values
   *  are resolved against this directory (not `process.cwd()`). */
  worktree?: string;
}

/**
 * Evaluates whether the requested `operation` on `path` (and optionally
 * `secondaryPath`) is permitted by the registry for `role`.
 *
 * Rules (in order):
 * 1. If a deny glob matches ⇒ block + escalate.
 * 2. If no allow glob matches ⇒ block + escalate (allowlist boundary).
 * 3. Otherwise ⇒ allow.
 *
 * When `canonicalPath` is provided it overrides `path` for evaluation
 * (symlink resolution).  `secondaryPath` is evaluated independently; if it
 * blocks the whole call is blocked.
 */
export function evaluatePathPolicy(opts: PathPolicyOptions): PathPolicyDecision {
  const { registry, role, operation, writeScope, onEscalate } = opts;

  const entry = registry.roles[role];
  // Unknown role → deny-by-default (fail-closed)
  if (entry === undefined) {
    onEscalate({ role, rule: "unknown-role", path: opts.path });
    return "block";
  }

  const dim: RoleDimension = operation === "read" ? entry.read : entry.write;

  // Determine the effective path for policy evaluation
  const effectivePath = opts.canonicalPath !== undefined
    ? canonicalize(opts.canonicalPath, opts.worktree)
    : canonicalize(opts.path, opts.worktree);

  const primaryResult = evalOnePath(effectivePath, dim, role, onEscalate);
  if (primaryResult === "block") return "block";

  // Secondary path check (rename/copy destination)
  if (opts.secondaryPath !== undefined) {
    const secondaryCanon = opts.secondaryCanonicalPath !== undefined
      ? canonicalize(opts.secondaryCanonicalPath, opts.worktree)
      : canonicalize(opts.secondaryPath, opts.worktree);
    const secondaryResult = evalOnePath(secondaryCanon, dim, role, onEscalate);
    if (secondaryResult === "block") return "block";
  }

  return "allow";
}

function evalOnePath(
  path: string,
  dim: RoleDimension,
  role: string,
  onEscalate: (e: PathPolicyEscalation) => void,
): PathPolicyDecision {
  // Deny wins
  for (const denyGlob of dim.deny) {
    if (matchesGlob(path, denyGlob)) {
      onEscalate({ role, rule: denyGlob, path });
      return "block";
    }
  }

  // Allowlist boundary — empty allow array means no path is permitted (closed boundary)
  if (!matchesAnyGlob(path, dim.allow)) {
    onEscalate({ role, rule: "not-in-allowlist", path });
    return "block";
  }

  return "allow";
}

// ---------------------------------------------------------------------------
// Policy chain — composes role policy → write-scope check
//
// This is the single seam Epic 016 wires into `beforeToolCall` sessions.
// Role policy is evaluated first; a blocked call never reaches writeScopeCheck.
// ---------------------------------------------------------------------------

export interface Ring1PolicyCall {
  role: string;
  operation: "read" | "write";
  path: string;
  writeScope: string[];
  /** For rename/copy: the second path involved in the operation. */
  secondaryPath?: string;
  /** Pre-resolved canonical path (e.g. symlink target). */
  canonicalPath?: string;
  /** Pre-resolved canonical path for the secondary path (e.g. rename/copy
   *  destination symlink target). */
  secondaryCanonicalPath?: string;
  /** Agent worktree root for relative-path resolution. */
  worktree?: string;
}

export interface Ring1PolicyChainResult {
  decision: "allow" | "block";
}

/**
 * Composes the role-path policy check (this module) ahead of an injected
 * `writeScopeCheck`.  If the role policy blocks, `writeScopeCheck` is never
 * called and the chain returns `{ decision: "block" }`.  If the role policy
 * allows, `writeScopeCheck` is called with the canonical path and its result
 * is returned.
 */
export function ring1PolicyChain(opts: {
  registry: RolePathRegistry;
  call: Ring1PolicyCall;
  onEscalate: (e: PathPolicyEscalation) => void;
  writeScopeCheck: (path: string) => "allow" | "block";
}): Ring1PolicyChainResult {
  const { registry, call, onEscalate, writeScopeCheck } = opts;

  const roleDecision = evaluatePathPolicy({
    registry,
    role: call.role,
    operation: call.operation,
    path: call.path,
    writeScope: call.writeScope,
    onEscalate,
    secondaryPath: call.secondaryPath,
    canonicalPath: call.canonicalPath,
    secondaryCanonicalPath: call.secondaryCanonicalPath,
    worktree: call.worktree,
  });

  if (roleDecision === "block") {
    return { decision: "block" };
  }

  // Write-scope check is only relevant for write operations; reads are gated
  // solely by the role read policy above.
  if (call.operation === "write") {
    // Determine the canonical path to pass to the write-scope check (mirrors
    // the canonicalization done inside evaluatePathPolicy).
    const effectivePath = call.canonicalPath !== undefined
      ? canonicalize(call.canonicalPath, call.worktree)
      : canonicalize(call.path, call.worktree);

    const scopeDecision = writeScopeCheck(effectivePath);
    if (scopeDecision === "block") {
      return { decision: "block" };
    }

    // Secondary path write-scope check (rename/copy destination).
    // Role policy already approved the secondary path above; now check scope.
    if (call.secondaryPath !== undefined) {
      const secondaryCanon = call.secondaryCanonicalPath !== undefined
        ? canonicalize(call.secondaryCanonicalPath, call.worktree)
        : canonicalize(call.secondaryPath, call.worktree);
      const secondaryScopeDecision = writeScopeCheck(secondaryCanon);
      if (secondaryScopeDecision === "block") {
        return { decision: "block" };
      }
    }
  }

  return { decision: "allow" };
}
