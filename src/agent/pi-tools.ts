/**
 * src/agent/pi-tools.ts
 *
 * Canonical pi tool taxonomy — single source of truth for pi's seven built-in
 * tool names and their read/write/exec class.
 *
 * pi ships exactly: read, bash, edit, write, grep, find, ls
 *   - read-only  : read, grep, find, ls
 *   - file-mutating: edit, write
 *   - exec class : bash (PI_EXEC_TOOLS — the single exec/deny source)
 *
 * Deny policy: exec tools are expressed through PI_EXEC_TOOLS (bash only).
 * The spawn caller supplies the manifest; PI_DEFAULT_ALLOWED_MANIFEST already
 * excludes bash so a session built from it never exposes exec tools.
 *
 * Story: 019.1 / 001-pi-tool-classification, Task T1; BLOCKER-019.1
 */

/** The four pi read-only tools that carry no side-effects on the file system. */
export const PI_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
]);

/** The two pi file-mutating tools that modify file content. */
export const PI_FILE_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
]);

/**
 * The default allowed manifest — the six non-exec pi tools (`bash` excluded).
 * Derived from the union of `PI_READ_ONLY_TOOLS` and `PI_FILE_MUTATING_TOOLS`.
 * This is the single source of truth for what the pi session manifest should
 * contain when spawning an agent.
 */
export const PI_DEFAULT_ALLOWED_MANIFEST: ReadonlySet<string> = new Set([
  ...PI_READ_ONLY_TOOLS,
  ...PI_FILE_MUTATING_TOOLS,
]);

/**
 * Classify a pi built-in tool name.
 *
 * Returns `"read"` for read-only tools, `"write"` for file-mutating tools, and
 * `undefined` for names not in either set (including `bash` and any unknown
 * name — callers fall back to their own heuristic).
 */
export function classifyPiTool(name: string): "read" | "write" | undefined {
  if (PI_READ_ONLY_TOOLS.has(name)) return "read";
  if (PI_FILE_MUTATING_TOOLS.has(name)) return "write";
  return undefined;
}

/**
 * The exec-class tools in pi's built-in surface.
 *
 * `bash` is pi's only exec built-in and is the single deny source for the
 * `beforeToolCall` ring-1 hook seam (Epic 015 decision).  The spawn caller
 * supplies the manifest; allow/deny is expressed through the hook, not through
 * a spawn-layer manifest filter.
 */
export const PI_EXEC_TOOLS: ReadonlySet<string> = new Set(["bash"]);
