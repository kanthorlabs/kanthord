import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { CreateObjective } from "../../app/objective/create-objective.ts";
import { RenameObjective } from "../../app/objective/rename-objective.ts";
import { toResult } from "./error-map.ts";

export interface ObjectiveDeps {
  initiativeRepository: InitiativeRepository;
  referenceResolver: ReferenceResolver;
}

export interface RenameObjectiveDeps {
  initiativeRepository: InitiativeRepository;
}

export async function runCreateObjective(
  args: Record<string, unknown>,
  deps: ObjectiveDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const initiativeId = args["initiative"] as string;
  const name = args["name"] as string;
  const uc = new CreateObjective(
    deps.initiativeRepository,
    deps.referenceResolver,
  );
  try {
    const id = await uc.execute({ initiativeId, name });
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
  deps: RenameObjectiveDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  const uc = new RenameObjective(deps.initiativeRepository);
  try {
    await uc.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
