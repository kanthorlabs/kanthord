import type { GetProject } from "../../app/project/get-project.ts";
import { toResult } from "./error-map.ts";

interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runGetProject(
  args: Record<string, unknown>,
  getProject: GetProject,
): Promise<HandlerResult> {
  const id = args["id"] as string;

  try {
    const project = await getProject.execute({ id });

    if (args["json"]) {
      return { exitCode: 0, stdout: [JSON.stringify(project)], stderr: [] };
    }

    return {
      exitCode: 0,
      stdout: [`id: ${project.id}`, `name: ${project.name}`],
      stderr: [],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
