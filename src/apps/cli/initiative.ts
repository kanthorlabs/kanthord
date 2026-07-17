import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
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
