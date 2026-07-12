/**
 * Ring-1 hook adapter — binds `ring1PolicyChain` and write-scope enforcement
 * to the SU3-documented `beforeToolCall` hook signature.
 *
 * `makeRing1HookAdapter` returns an async function shaped exactly as pi's
 * `beforeToolCall` hook: `(ctx, signal?) => Promise<BeforeToolCallResult | undefined>`.
 * A return of `undefined` means "pass-through" (pi executes the tool).
 * A return of `{ block: true, reason }` means pi should suppress the tool call.
 *
 * Decision order (all deterministic, no model input — PRD §4):
 *   1. If the tool name is in `unknownEffectfulToolNames` → block fail-closed.
 *   2. If the tool call carries a `path` arg → run `ring1PolicyChain`.
 *   3. Otherwise → pass-through (pure/pathless tool).
 */

import { ring1PolicyChain } from "./role-path-policy.ts";
import type {
  RolePathRegistry,
  PathPolicyEscalation,
} from "./role-path-policy.ts";
import type { EscalationEvent } from "./write-scope.ts";
import { classifyPiTool } from "../agent/pi-tools.ts";

// ---------------------------------------------------------------------------
// SU3 hook shape types
// ---------------------------------------------------------------------------

export interface BeforeToolCallContext {
  assistantMessage: { role: "assistant"; content: unknown[] };
  toolCall: { id: string; name: string; input: Record<string, unknown> };
  /** Convenience alias for toolCall.input provided by pi. */
  args: Record<string, unknown>;
  context: {
    systemPrompt: string;
    messages: unknown[];
    tools: unknown[];
  };
}

export interface BeforeToolCallResult {
  block: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface Ring1HookAdapterOpts {
  registry: RolePathRegistry;
  role: string;
  writeScope: string[];
  onEscalate: (e: EscalationEvent & Record<string, unknown>) => void;
  /**
   * Tool names that have no path arg but are known to produce external effects
   * (e.g. exec/shell-class tools).  A call whose name is in this set is blocked
   * fail-closed regardless of args — exec/shell tools are permanently
   * un-allowlistable (Epic 015 decision).
   *
   * REQUIRED: callers must supply an explicit set (may be empty for a pure-tools-only
   * session).  If the field is absent at runtime (e.g. bypassed via a type cast),
   * the adapter treats every pathless tool as effectful and blocks fail-closed —
   * an absent declaration is not a safe declaration.
   */
  unknownEffectfulToolNames: Set<string>;
  /**
   * Agent worktree root directory.  When provided, relative `path` and
   * `destination` args in tool calls are resolved against this directory
   * instead of `process.cwd()` before policy evaluation.
   */
  worktree?: string;
}

// ---------------------------------------------------------------------------
// Read-tool classification
//
// Maps a tool name to "read" or "write" based on naming convention.
// Tools whose names begin with a read-class prefix (read_, get_, list_,
// view_, show_, inspect_, peek_, check_, stat_) are classified as read
// operations; everything else is classified as write.
// ---------------------------------------------------------------------------

const READ_PREFIXES = [
  "read_", "get_", "list_", "view_", "show_",
  "inspect_", "peek_", "check_", "stat_",
] as const;

function classifyOperation(toolName: string): "read" | "write" {
  // Consult the canonical pi taxonomy first; if the tool is a known pi built-in,
  // use its classification directly.  bash and unknown names return undefined and
  // fall through to the prefix heuristic below.
  const piClass = classifyPiTool(toolName);
  if (piClass !== undefined) return piClass;

  const lower = toolName.toLowerCase();
  for (const prefix of READ_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return "read";
    }
  }
  return "write";
}

// ---------------------------------------------------------------------------
// Write-scope check adapter
//
// Converts the `ring1PolicyChain` callback signature into the Epic 007 write-
// scope logic: a path is in-scope when it falls inside any entry in writeScope.
// ---------------------------------------------------------------------------

function normalizeScopePath(p: string): string {
  return p.replace(/\/\*\*$/, "").replace(/\/+$/, "");
}

function isPathInScope(filePath: string, scopes: readonly string[]): boolean {
  for (const scope of scopes) {
    const ns = normalizeScopePath(scope);
    // A scope that normalizes to "**" is the whole-repo sentinel — allow any path.
    if (ns === "**") {
      return true;
    }
    if (filePath === ns || filePath.startsWith(ns + "/")) {
      return true;
    }
  }
  return false;
}

function makeWriteScopeCallback(
  writeScope: string[],
  onEscalate: (e: EscalationEvent & Record<string, unknown>) => void,
): (path: string) => "allow" | "block" {
  return function writeScopeCheck(path: string): "allow" | "block" {
    if (isPathInScope(path, writeScope)) {
      return "allow";
    }
    onEscalate({ tag: "re-planning-signal", path });
    return "block";
  };
}

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

/**
 * Returns a `beforeToolCall`-compatible hook that enforces ring-1 policy for
 * the given agent role/write-scope configuration.
 */
export function makeRing1HookAdapter(
  opts: Ring1HookAdapterOpts,
): (ctx: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined> {
  const { registry, role, writeScope, onEscalate, unknownEffectfulToolNames, worktree } = opts;

  // Pre-build the write-scope callback so it is not recreated per call.
  const writeScopeCheck = makeWriteScopeCallback(writeScope, onEscalate);

  return async function ring1HookAdapter(
    ctx: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const toolName = ctx.toolCall.name;
    const args = ctx.args;

    // -----------------------------------------------------------------------
    // Step 1 — path-bearing tools → ring1PolicyChain (role policy + write-scope)
    // -----------------------------------------------------------------------
    const rawPath = args["path"];
    if (typeof rawPath === "string") {
      // Extract an optional secondary path (e.g. rename/copy destination).
      const rawDestination = args["destination"];
      const secondaryPath = typeof rawDestination === "string" ? rawDestination : undefined;

      // Extract an optional pre-resolved canonical path for the secondary path.
      // When the caller supplies `args["destination_canonical_path"]`, it has
      // already resolved any symlinks on the destination; forwarding it to
      // ring1PolicyChain ensures policy evaluates on the real target.
      const rawDestinationCanonicalPath = args["destination_canonical_path"];
      const secondaryCanonicalPath = typeof rawDestinationCanonicalPath === "string" ? rawDestinationCanonicalPath : undefined;

      // Extract an optional pre-resolved canonical path (symlink target).
      // When the caller supplies `args["canonical_path"]`, it has already resolved
      // any symlinks; forwarding it to ring1PolicyChain ensures policy evaluates
      // on the real target rather than the apparent path.
      const rawCanonicalPath = args["canonical_path"];
      const canonicalPath = typeof rawCanonicalPath === "string" ? rawCanonicalPath : undefined;

      // Collect escalations from the role-policy layer; they are forwarded to
      // the outer onEscalate with the re-planning tag added.
      const policyEscalations: PathPolicyEscalation[] = [];
      const result = ring1PolicyChain({
        registry,
        call: {
          role,
          operation: classifyOperation(toolName),
          path: rawPath,
          writeScope,
          worktree,
          secondaryPath,
          secondaryCanonicalPath,
          canonicalPath,
        },
        onEscalate: (e) => policyEscalations.push(e),
        writeScopeCheck,
      });

      if (result.decision === "block") {
        // Forward all policy-layer escalations, adding the re-planning tag.
        for (const e of policyEscalations) {
          onEscalate({ tag: "re-planning-signal", ...e });
        }
        // If no role-layer escalation fired (write-scope blocked), onEscalate
        // was already called inside writeScopeCheck above; ensure at least one
        // escalation is emitted so callers always see exactly one on block.
        if (policyEscalations.length === 0) {
          // writeScopeCheck already emitted; nothing more to do here.
        }
        return {
          block: true,
          reason: `Path "${rawPath}" is blocked by ring-1 policy for role "${role}"`,
        };
      }

      // Allowed — pass-through.
      return undefined;
    }

    // -----------------------------------------------------------------------
    // Step 2 — pathless tools: fail-closed for effectful tools.
    // If unknownEffectfulToolNames is in the set, block.
    // If unknownEffectfulToolNames is absent at runtime (cast bypass of required
    // field), block fail-closed — an absent declaration is not a safe declaration.
    // A tool NOT in the set (and field is present) is treated as pure → pass-through.
    // -----------------------------------------------------------------------
    if (!(unknownEffectfulToolNames instanceof Set) || unknownEffectfulToolNames.has(toolName)) {
      onEscalate({ tag: "re-planning-signal", toolName });
      return { block: true, reason: `Tool "${toolName}" is classified as effectful and is not allowlisted` };
    }

    // -----------------------------------------------------------------------
    // Step 3 — pathless, pure-computation tool (not in effectful set) → pass-through
    // -----------------------------------------------------------------------
    return undefined;
  };
}
