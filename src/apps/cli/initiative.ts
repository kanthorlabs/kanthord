import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import type { PauseInitiative } from "../../app/initiative/pause-initiative.ts";
import type { ResumeInitiative } from "../../app/initiative/resume-initiative.ts";
import type { ListInitiatives } from "../../app/initiative/list-initiatives.ts";
import { toResult } from "./error-map.ts";

export async function runCreateInitiative(
  args: Record<string, unknown>,
  createInitiative: CreateInitiative,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const projectId = args["project"] as string;
  const name = args["name"] as string;
  try {
    const id = await createInitiative.execute({ projectId, name });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`initiative created: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runRenameInitiative(
  args: Record<string, unknown>,
  renameInitiative: RenameInitiative,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  try {
    await renameInitiative.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runPauseInitiative(
  args: Record<string, unknown>,
  useCase: PauseInitiative,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  try {
    await useCase.execute({ initiativeId: id });
    return { exitCode: 0, stdout: [], stderr: [`initiative paused: ${id}`] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runResumeInitiative(
  args: Record<string, unknown>,
  useCase: ResumeInitiative,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  try {
    await useCase.execute({ initiativeId: id });
    return { exitCode: 0, stdout: [], stderr: [`initiative resumed: ${id}`] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runListInitiatives(
  args: Record<string, unknown>,
  listInitiatives: ListInitiatives,
): { exitCode: number; stdout: string[]; stderr: string[] } {
  const projectId = args["project"] as string;
  const rows = listInitiatives.execute({ projectId });
  if (args["json"]) {
    return { exitCode: 0, stdout: [JSON.stringify(rows)], stderr: [] };
  }
  return {
    exitCode: 0,
    stdout: rows.map((r) => `${r.id}  ${r.name}`),
    stderr: [],
  };
}
