import type { CreateProject } from "../../app/project/create-project.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import type { ListProjects } from "../../app/project/list-projects.ts";
import type { AckProject } from "../../app/project/ack-project.ts";
import type { GetProjectOverview } from "../../app/project/get-project-overview.ts";
import { toResult } from "./error-map.ts";

export async function runCreateProject(
  args: Record<string, unknown>,
  createProject: CreateProject,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const name = args["name"] as string;
  try {
    const id = await createProject.execute({ name });
    return { exitCode: 0, stdout: [id], stderr: [`project created: ${id}`] };
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

export async function runAckProject(
  args: Record<string, unknown>,
  ackProject: AckProject,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const cursor = args["cursor"] as string;
  try {
    const result = await ackProject.execute({ projectId: id, cursor });
    return {
      exitCode: 0,
      stdout: [],
      stderr: [`project acknowledged: ${id} @ ${result.cursor}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runListProjects(
  args: Record<string, unknown>,
  listProjects: ListProjects,
): { exitCode: number; stdout: string[]; stderr: string[] } {
  const rows = listProjects.execute();
  if (args["json"]) {
    return { exitCode: 0, stdout: [JSON.stringify(rows)], stderr: [] };
  }
  return {
    exitCode: 0,
    stdout: rows.map((r) => `${r.id}  ${r.name}`),
    stderr: [],
  };
}

// EPIC 016 Story 6 — `get overview --project <id>`. Text-mode line order is
// pinned by the Story 6 §C spec; see the Story file for the exact sequence.
export async function runGetProjectOverview(
  args: Record<string, unknown>,
  getProjectOverview: GetProjectOverview,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const projectId = args["project"] as string;
  try {
    const output = await getProjectOverview.execute({ projectId });
    if (args["json"]) {
      return { exitCode: 0, stdout: [JSON.stringify(output)], stderr: [] };
    }
    const lines: string[] = [
      `project: ${output.projectId}`,
      `since: ${output.digest.since ?? "never acknowledged"}`,
    ];
    let activityLine = `activity: ${output.digest.totalCount} event(s)`;
    if (output.digest.hasMore) {
      activityLine += ` (showing ${output.digest.events.length})`;
    }
    lines.push(activityLine);
    for (const init of output.initiatives) {
      lines.push(
        `initiative ${init.id} ${init.name} [${init.status}] paused=${init.paused} needs-human=${init.needsHuman}`,
      );
    }
    for (const lane of output.lanes) {
      const repoLabel = lane.repositoryId ?? "-";
      lines.push(`lane ${repoLabel} objectives=${lane.objectiveIds.length}`);
    }
    for (const d of output.decisions) {
      lines.push(
        `decision ${d.action.kind} ${d.action.target.type}:${d.action.target.id} down=${d.downstream}`,
      );
    }
    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
