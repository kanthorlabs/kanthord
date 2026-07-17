import type { FindProject } from "../../app/project/find-project.ts";
import type { FindInitiative } from "../../app/initiative/find-initiative.ts";
import type { FindObjective } from "../../app/objective/find-objective.ts";
import type { FindResource } from "../../app/resource/find-resource.ts";
import { toResult } from "./error-map.ts";

interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runFindProject(
  args: Record<string, unknown>,
  findProject: FindProject,
): Promise<HandlerResult> {
  const name = args["name"] as string;
  try {
    const id = await findProject.execute({ name });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runFindInitiative(
  args: Record<string, unknown>,
  findInitiative: FindInitiative,
): Promise<HandlerResult> {
  const projectId = args["project"] as string;
  const name = args["name"] as string;
  try {
    const id = await findInitiative.execute({ projectId, name });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runFindObjective(
  args: Record<string, unknown>,
  findObjective: FindObjective,
): Promise<HandlerResult> {
  const initiativeId = args["initiative"] as string;
  const name = args["name"] as string;
  try {
    const id = await findObjective.execute({ initiativeId, name });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runFindResource(
  args: Record<string, unknown>,
  findResource: FindResource,
): Promise<HandlerResult> {
  const projectId = args["project"] as string;
  const name = args["name"] as string;
  try {
    const id = await findResource.execute({ projectId, name });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
