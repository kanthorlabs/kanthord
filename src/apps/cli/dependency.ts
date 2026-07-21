import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

export async function runAddDependency(
  args: Record<string, unknown>,
  addDependency: AddDependency,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const taskId = args["task"];
  if (typeof taskId !== "string" || taskId === "") {
    const err = new MissingFlagError("--task");
    return { ...toResult(err), stdout: [] };
  }

  const dependencyId = args["dependency"];
  if (typeof dependencyId !== "string" || dependencyId === "") {
    const err = new MissingFlagError("--dependency");
    return { ...toResult(err), stdout: [] };
  }

  try {
    await addDependency.execute({ taskId, dependencyId });
    return {
      exitCode: 0,
      stdout: [],
      stderr: [`dependency added: ${taskId} → ${dependencyId}`],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRemoveDependency(
  args: Record<string, unknown>,
  removeDependency: RemoveDependency,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const taskId = args["task"];
  if (typeof taskId !== "string" || taskId === "") {
    const err = new MissingFlagError("--task");
    return { ...toResult(err), stdout: [] };
  }

  const dependencyId = args["dependency"];
  if (typeof dependencyId !== "string" || dependencyId === "") {
    const err = new MissingFlagError("--dependency");
    return { ...toResult(err), stdout: [] };
  }

  try {
    await removeDependency.execute({ taskId, dependencyId });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
