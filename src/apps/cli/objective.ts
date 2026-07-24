import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import type { ApproveObjective } from "../../app/objective/approve-objective.ts";
import type { RetryObjective } from "../../app/objective/retry-objective.ts";
import type { GetObjective } from "../../app/objective/get-objective.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

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

export async function runGetObjective(
  args: Record<string, unknown>,
  getObjective: GetObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  try {
    const output = await getObjective.execute({ id });
    if (args["json"]) {
      return { exitCode: 0, stdout: [JSON.stringify(output)], stderr: [] };
    }
    const lines: string[] = [
      `id: ${output.id}`,
      `name: ${output.name}`,
      `status: ${output.status}`,
      ...output.integrations.map(
        (i) => `integration: ${i.repository} ${i.state}`,
      ),
    ];
    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runApproveObjective(
  args: Record<string, unknown>,
  approveObjective: ApproveObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  try {
    await approveObjective.execute({ objectiveId: id });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`objective integrated: ${id}`],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRetryObjective(
  args: Record<string, unknown>,
  retryObjective: RetryObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  try {
    await retryObjective.execute({ objectiveId: id });
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
