// Story 06 — the field contract for task creation.
// Pure module: no React, no fetch, no hooks.

import type { TaskCreateBody } from "./api-client";

export interface TaskDraft {
  readonly title: string;
  readonly instructions: string;
  readonly ac: readonly string[];
  readonly verification: readonly string[];
  readonly agent: string;
  readonly dependencies: readonly string[];
  readonly context: readonly { readonly key: string; readonly value: string }[];
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  title: "",
  instructions: "",
  ac: [],
  verification: [],
  agent: "",
  dependencies: [],
  context: [],
};

/**
 * Maps a `TaskDraft` to a `TaskCreateBody` for the API.
 *
 * Pinned rules (decision 9):
 * - `title` is trimmed and always present;
 * - a key is omitted when the field collected nothing (blank / empty array);
 * - `ac` / `verification` preserve the operator's order;
 * - `context` folds rows in order; a blank key is dropped;
 * - `paused` and `after` are never produced.
 */
export function taskCreateBody(draft: TaskDraft): TaskCreateBody {
  const title = draft.title.trim();

  const ac = draft.ac.map((s) => s.trim()).filter((s) => s !== "");

  const verification = draft.verification
    .map((s) => s.trim())
    .filter((s) => s !== "");

  const dependencies = draft.dependencies
    .map((s) => s.trim())
    .filter((s) => s !== "");

  const contextEntries = draft.context.reduce(
    (acc, row) => {
      const key = row.key.trim();
      if (key === "") return acc;
      return { ...acc, [key]: row.value };
    },
    {} as Record<string, string>,
  );

  return {
    title,
    ...(draft.instructions.trim() !== ""
      ? { instructions: draft.instructions.trim() }
      : {}),
    ...(ac.length > 0 ? { ac } : {}),
    ...(verification.length > 0 ? { verification } : {}),
    ...(draft.agent.trim() !== "" ? { agent: draft.agent.trim() } : {}),
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(Object.keys(contextEntries).length > 0
      ? { context: contextEntries }
      : {}),
  };
}
