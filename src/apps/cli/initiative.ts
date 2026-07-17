import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import { toResult } from "./error-map.ts";

export interface InitiativeDeps {
  initiativeRepository: InitiativeRepository;
  referenceResolver: ReferenceResolver;
}

export interface RenameInitiativeDeps {
  initiativeRepository: InitiativeRepository;
}

export async function runCreateInitiative(
  args: Record<string, unknown>,
  deps: InitiativeDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const projectId = args["project"] as string;
  const name = args["name"] as string;
  const uc = new CreateInitiative(
    deps.initiativeRepository,
    deps.referenceResolver,
  );
  try {
    const id = await uc.execute({ projectId, name });
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
  deps: RenameInitiativeDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  const uc = new RenameInitiative(deps.initiativeRepository);
  try {
    await uc.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
