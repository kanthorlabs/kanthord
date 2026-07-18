import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import { toResult } from "./error-map.ts";

export async function runCreateObjective(
  args: Record<string, unknown>,
  createObjective: CreateObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const initiativeId = args["initiative"] as string;
  const name = args["name"] as string;
  try {
    const id = await createObjective.execute({ initiativeId, name });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`objective created: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runRenameObjective(
  args: Record<string, unknown>,
  renameObjective: RenameObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  try {
    await renameObjective.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runListObjectives(
  args: Record<string, unknown>,
  listObjectives: ListObjectives,
): { exitCode: number; stdout: string[]; stderr: string[] } {
  const initiativeId = args["initiative"] as string;
  const rows = listObjectives.execute({ initiativeId });
  if (args["json"]) {
    return { exitCode: 0, stdout: [JSON.stringify(rows)], stderr: [] };
  }
  return {
    exitCode: 0,
    stdout: rows.map((r) => `${r.id}  ${r.name}`),
    stderr: [],
  };
}
