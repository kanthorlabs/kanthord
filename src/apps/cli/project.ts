import type { ProjectRepository } from "../../storage/port.ts";
import { CreateProject } from "../../app/project/create-project.ts";
import { RenameProject } from "../../app/project/rename-project.ts";
import { toResult } from "./error-map.ts";

export interface ProjectDeps {
  projectRepository: ProjectRepository;
}

export async function runCreateProject(
  args: Record<string, unknown>,
  deps: ProjectDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const name = args["name"] as string;
  const uc = new CreateProject(deps.projectRepository);
  try {
    const id = await uc.execute({ name });
    return { exitCode: 0, stdout: [id], stderr: [`project created: ${name}`] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runRenameProject(
  args: Record<string, unknown>,
  deps: ProjectDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  const uc = new RenameProject(deps.projectRepository);
  try {
    await uc.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
