/**
 * Story 10 C1 — BindingResolver: pure helper to resolve and validate context maps.
 * Zero I/O — no imports from apps/ or storage/.
 */

import { UnboundAliasError, ExecutorBindingSetError } from "./import-errors.ts";

export interface ExecutorBindingSpec {
  required: string[];
  forbidden: string[];
}

// Per-executor required/forbidden binding specs (app-layer, not domain).
// Unknown executor → no binding validation (pass through).
export const EXECUTOR_BINDING_SPECS: Record<string, ExecutorBindingSpec> = {
  "generic@1": {
    required: ["repository", "ai_provider", "credential"],
    forbidden: [],
  },
  "tdd@1": {
    required: ["repository", "ai_provider", "credential"],
    forbidden: [],
  },
};

/**
 * Resolves the effective context map (resource_type → resource_id) for one task.
 *
 * @param bindings         Initiative bindings: alias → resource type.
 * @param objectiveContext Objective-level context: slot → alias (package-local default).
 * @param taskContext      Task-level context override: slot → alias (overrides objective).
 * @param bindMap          CLI --bind map: alias → concrete resource id.
 *
 * Returns a map of resource_type → resource_id for use as task_context.
 * Throws UnboundAliasError when a required alias has no entry in bindMap.
 */
export function resolveTaskContext(
  bindings: Record<string, string>,
  objectiveContext: Record<string, string> | undefined,
  taskContext: Record<string, string> | undefined,
  bindMap: Record<string, string>,
): Record<string, string> {
  // Merge: objectiveContext first, then taskContext overrides per slot.
  const mergedContext: Record<string, string> = {
    ...objectiveContext,
    ...taskContext,
  };

  const result: Record<string, string> = {};
  for (const [, alias] of Object.entries(mergedContext)) {
    const resourceId = bindMap[alias];
    if (resourceId === undefined) {
      throw new UnboundAliasError(alias);
    }
    const resourceType = bindings[alias];
    if (resourceType !== undefined) {
      result[resourceType] = resourceId;
    }
  }
  return result;
}

/**
 * Validates the resolved context map for each task against the executor's binding spec.
 * Collects ALL violations before throwing — one complete error report (fail-fast non-interactive).
 * Throws ExecutorBindingSetError if any task violates the spec for its known executor.
 */
export function validateExecutorBindings(
  tasks: Array<{ ref: string; agent: string; context: Record<string, string> }>,
): void {
  const errors: Array<{ taskRef: string; agent: string; missing: string[] }> =
    [];

  for (const task of tasks) {
    const spec = EXECUTOR_BINDING_SPECS[task.agent];
    if (spec === undefined) {
      // Unknown executor → no binding validation (pass through).
      continue;
    }
    const missing = spec.required.filter((r) => !(r in task.context));
    if (missing.length > 0) {
      errors.push({ taskRef: task.ref, agent: task.agent, missing });
    }
  }

  if (errors.length > 0) {
    throw new ExecutorBindingSetError(errors);
  }
}
