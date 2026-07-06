/**
 * Ring-1 write-scope enforcement seam.
 *
 * `makeWriteScopeHook` returns a `BeforeToolCallHook`-compatible function that
 * checks every write-tool call against the task's declared `write_scope`.
 * Calls whose path falls outside every scope entry are blocked and trigger an
 * escalation tagged as a re-planning signal.  No model parameter exists on the
 * public surface — enforcement is model-independent by construction.
 */

/** Minimal structural type that satisfies ring-1 write-scope checking.
 *  Intentionally inlined here — ring-1 must not import from session/. */
interface ToolCall {
  name: string;
  args: unknown;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EscalationEvent {
  tag: "re-planning-signal";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Path normalization (mirrors src/scheduler/leases.ts normalizeScope)
//
// Strips a trailing `/**` glob suffix and any remaining trailing slashes so
// that `src/ring1/**`, `src/ring1/`, and `src/ring1` all collapse to
// `"src/ring1"`.
// ---------------------------------------------------------------------------

function normalizeScopePath(path: string): string {
  return path.replace(/\/\*\*$/, "").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Scope membership check
//
// A file path is "in scope" when it equals a normalized scope entry exactly
// OR starts with that entry followed by `/`.  The `/` boundary prevents
// `src/ring1` from accidentally matching `src/ring1extra`.
// ---------------------------------------------------------------------------

function isPathInScope(filePath: string, scopes: readonly string[]): boolean {
  for (const scope of scopes) {
    const ns = normalizeScopePath(scope);
    if (filePath === ns || filePath.startsWith(ns + "/")) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Write-tool name registry
//
// Only calls whose name is in this set are subject to scope enforcement.
// All other tool calls (reads, shell commands, etc.) pass through unchanged.
//
// Phase 1 (Epic 007) enforces write-scope against the fake `write_file` tool
// only — the sole write verb the Phase-1 fake tool surface exposes.  Additional
// write verbs (e.g. edit, patch, move) are intentionally deferred to Phase 2
// when real tools land (see Epic 007 Non-Goals).
// ---------------------------------------------------------------------------

const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(["write_file"]);

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

/**
 * Returns a `beforeToolCall` hook that enforces `writeScope` on every
 * write-file tool call.
 *
 * - In-scope writes → `"allow"`, no side effect.
 * - Out-of-scope writes → `"block"` + `onEscalate({ tag: "re-planning-signal" })`.
 * - Non-write calls → `"allow"` unconditionally.
 */
export function makeWriteScopeHook(
  writeScope: string[],
  onEscalate: (event: EscalationEvent) => void,
): (call: ToolCall) => "allow" | "block" {
  return function writeScopeHook(call: ToolCall): "allow" | "block" {
    if (!WRITE_TOOL_NAMES.has(call.name)) {
      return "allow";
    }

    const rawArgs = call.args as Record<string, unknown>;
    const filePath =
      typeof rawArgs["path"] === "string" ? rawArgs["path"] : "";

    if (isPathInScope(filePath, writeScope)) {
      return "allow";
    }

    onEscalate({ tag: "re-planning-signal" });
    return "block";
  };
}
