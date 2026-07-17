import type { ProjectRepository } from "../../storage/port.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import { toResult } from "./error-map.ts";

interface ProjectDeps {
  projectRepository: ProjectRepository;
}

interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runGetProject(
  args: Record<string, unknown>,
  deps: ProjectDeps,
): Promise<HandlerResult> {
  const id = args["id"] as string;

  try {
    const project = deps.projectRepository.get(id);
    if (project === undefined) {
      throw new UnknownReferenceError("project", id);
    }

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
