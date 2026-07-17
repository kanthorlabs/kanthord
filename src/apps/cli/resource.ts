import type { AddResource } from "../../app/resource/add-resource.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

function requireFlag(args: Record<string, unknown>, flag: string): string {
  const value = args[flag];
  if (typeof value !== "string" || value === "") {
    throw new MissingFlagError(`--${flag}`);
  }
  return value;
}

export async function runCreateRepository(
  args: Record<string, unknown>,
  addResource: AddResource,
): Promise<HandlerResult> {
  try {
    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const organization = requireFlag(args, "organization");
    const branch = requireFlag(args, "branch");
    const path = typeof args["path"] === "string" ? args["path"] : "";
    const id = await addResource.execute({
      type: "repository",
      projectId,
      name,
      organization,
      branch,
      path,
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`repository resource added: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runCreateCredential(
  args: Record<string, unknown>,
  addResource: AddResource,
): Promise<HandlerResult> {
  try {
    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const provider = requireFlag(args, "provider");
    const value = requireFlag(args, "value");
    const id = await addResource.execute({
      type: "credential",
      projectId,
      name,
      provider,
      value,
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`credential resource added: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runCreateNotification(
  args: Record<string, unknown>,
  addResource: AddResource,
): Promise<HandlerResult> {
  try {
    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const provider = requireFlag(args, "provider");
    const destination = requireFlag(args, "destination");
    if (provider !== "slack" && provider !== "telegram") {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [
          `error: invalid provider "${provider}": must be slack or telegram`,
        ],
      };
    }
    const id = await addResource.execute({
      type: "notification",
      projectId,
      name,
      provider,
      destination,
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`notification resource added: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runCreateAiProvider(
  args: Record<string, unknown>,
  addResource: AddResource,
): Promise<HandlerResult> {
  try {
    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const provider = requireFlag(args, "provider");
    const model = requireFlag(args, "model");
    const baseUrl =
      typeof args["base-url"] === "string" ? args["base-url"] : undefined;
    const id = await addResource.execute({
      type: "ai_provider",
      projectId,
      name,
      provider,
      model,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`ai_provider resource added: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runCreateFilesystem(
  args: Record<string, unknown>,
  addResource: AddResource,
): Promise<HandlerResult> {
  try {
    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const path = requireFlag(args, "path");
    const id = await addResource.execute({
      type: "filesystem",
      projectId,
      name,
      path,
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`filesystem resource added: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
