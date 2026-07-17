/** Shared formatting helpers for CLI handlers. */

/**
 * Formats a human-readable table line for a task row.
 * Blocked tasks show "blocked (waiting: <title1>, <title2>)".
 * Ready tasks show "ready".
 */
export function formatTaskLine(
  title: string,
  state: "ready" | "blocked",
  waitingTitles: string[],
): string {
  if (state === "blocked" && waitingTitles.length > 0) {
    return `${title}  blocked (waiting: ${waitingTitles.join(", ")})`;
  }
  return `${title}  ready`;
}
