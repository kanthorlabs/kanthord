import type {
  ProjectRepository,
  InitiativeRepository,
} from "../../storage/port.ts";
import { FindProject } from "../../app/project/find-project.ts";
import { FindInitiative } from "../../app/initiative/find-initiative.ts";
import { FindObjective } from "../../app/objective/find-objective.ts";
import { FindResource } from "../../app/resource/find-resource.ts";
import { toResult } from "./error-map.ts";

interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runFindProject(
  args: Record<string, unknown>,
  deps: { projectRepository: ProjectRepository },
): Promise<HandlerResult> {
  const name = args["name"] as string;
  try {
    const id = await new FindProject(deps.projectRepository).execute({ name });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runFindInitiative(
  args: Record<string, unknown>,
  deps: { initiativeRepository: InitiativeRepository },
): Promise<HandlerResult> {
  const projectId = args["project"] as string;
  const name = args["name"] as string;
  try {
    const id = await new FindInitiative(deps.initiativeRepository).execute({
      projectId,
      name,
    });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runFindObjective(
  args: Record<string, unknown>,
  deps: { initiativeRepository: InitiativeRepository },
): Promise<HandlerResult> {
  const initiativeId = args["initiative"] as string;
  const name = args["name"] as string;
  try {
    const id = await new FindObjective(deps.initiativeRepository).execute({
      initiativeId,
      name,
    });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runFindResource(
  args: Record<string, unknown>,
  deps: { projectRepository: ProjectRepository },
): Promise<HandlerResult> {
  const projectId = args["project"] as string;
  const name = args["name"] as string;
  try {
    const id = await new FindResource(deps.projectRepository).execute({
      projectId,
      name,
    });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
