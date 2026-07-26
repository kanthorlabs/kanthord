import type { AddInitiativeDependency } from "../../app/initiative/add-initiative-dependency.ts";
import type { RemoveInitiativeDependency } from "../../app/initiative/remove-initiative-dependency.ts";
import type { AddObjectiveDependency } from "../../app/objective/add-objective-dependency.ts";
import type { RemoveObjectiveDependency } from "../../app/objective/remove-objective-dependency.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

export async function runAddInitiativeDependency(
  args: Record<string, unknown>,
  useCase: AddInitiativeDependency,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const initiativeId = args["initiative"];
  if (typeof initiativeId !== "string" || initiativeId === "") {
    const err = new MissingFlagError("--initiative");
    return { ...toResult(err), stdout: [] };
  }

  const dependencyId = args["after"];
  if (typeof dependencyId !== "string" || dependencyId === "") {
    const err = new MissingFlagError("--after");
    return { ...toResult(err), stdout: [] };
  }

  try {
    await useCase.execute({ initiativeId, dependencyId });
    return {
      exitCode: 0,
      stdout: [],
      stderr: [
        `initiative dependency added: ${initiativeId} after ${dependencyId}`,
      ],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRemoveInitiativeDependency(
  args: Record<string, unknown>,
  useCase: RemoveInitiativeDependency,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const initiativeId = args["initiative"];
  if (typeof initiativeId !== "string" || initiativeId === "") {
    const err = new MissingFlagError("--initiative");
    return { ...toResult(err), stdout: [] };
  }

  const dependencyId = args["after"];
  if (typeof dependencyId !== "string" || dependencyId === "") {
    const err = new MissingFlagError("--after");
    return { ...toResult(err), stdout: [] };
  }

  try {
    await useCase.execute({ initiativeId, dependencyId });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runAddObjectiveDependency(
  args: Record<string, unknown>,
  useCase: AddObjectiveDependency,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const objectiveId = args["objective"];
  if (typeof objectiveId !== "string" || objectiveId === "") {
    const err = new MissingFlagError("--objective");
    return { ...toResult(err), stdout: [] };
  }

  const dependencyId = args["after"];
  if (typeof dependencyId !== "string" || dependencyId === "") {
    const err = new MissingFlagError("--after");
    return { ...toResult(err), stdout: [] };
  }

  try {
    await useCase.execute({ objectiveId, dependencyId });
    return {
      exitCode: 0,
      stdout: [],
      stderr: [
        `objective dependency added: ${objectiveId} after ${dependencyId}`,
      ],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRemoveObjectiveDependency(
  args: Record<string, unknown>,
  useCase: RemoveObjectiveDependency,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const objectiveId = args["objective"];
  if (typeof objectiveId !== "string" || objectiveId === "") {
    const err = new MissingFlagError("--objective");
    return { ...toResult(err), stdout: [] };
  }

  const dependencyId = args["after"];
  if (typeof dependencyId !== "string" || dependencyId === "") {
    const err = new MissingFlagError("--after");
    return { ...toResult(err), stdout: [] };
  }

  try {
    await useCase.execute({ objectiveId, dependencyId });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
