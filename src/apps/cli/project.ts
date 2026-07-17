import type { CreateProject } from "../../app/project/create-project.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import { toResult } from "./error-map.ts";

export async function runCreateProject(
  args: Record<string, unknown>,
  createProject: CreateProject,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const name = args["name"] as string;
  try {
    const id = await createProject.execute({ name });
    return { exitCode: 0, stdout: [id], stderr: [`project created: ${name}`] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runRenameProject(
  args: Record<string, unknown>,
  renameProject: RenameProject,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  try {
    await renameProject.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
