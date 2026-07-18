/**
 * Story 05 T1 (l) — renderTaskPrompt
 *
 * Pure renderer: converts a Task spec into a user-prompt string.
 * No pi imports, no I/O. Title, instructions, and each ac item are always
 * included; a ## Verification section is appended only when task.verification
 * is present and non-empty.
 */
import type { Task } from "../domain/task.ts";

export function renderTaskPrompt(task: Task): string {
  const lines: string[] = [];

  lines.push(`# Task: ${task.title}`);
  lines.push("");

  if (task.instructions) {
    lines.push("## Instructions");
    lines.push(task.instructions);
    lines.push("");
  }

  if (task.ac && task.ac.length > 0) {
    lines.push("## Acceptance Criteria");
    for (const item of task.ac) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (task.verification && task.verification.length > 0) {
    lines.push("## Verification");
    for (const cmd of task.verification) {
      lines.push(`- ${cmd}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
