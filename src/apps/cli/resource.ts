import type { AddResource } from "../../app/resource/add-resource.ts";
import type { GetResource } from "../../app/resource/get-resource.ts";
import type { ListResources } from "../../app/resource/list-resources.ts";
import type { UpdateAiProvider } from "../../app/resource/update-ai-provider.ts";
import type { UpdateCredential } from "../../app/resource/update-credential.ts";
import type { UpdateRepository } from "../../app/resource/update-repository.ts";
import type { UpdateNotification } from "../../app/resource/update-notification.ts";
import type { UpdateFilesystem } from "../../app/resource/update-filesystem.ts";
import { MissingFlagError, toResult } from "./error-map.ts";
import {
  readCredentialValue,
  CredentialReadTimeoutError,
} from "./credential-input.ts";

// Mirrors the domain ReasoningEffort union (apps must not import domain
// directly — the domain re-validates on its side).
const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// Mirrors the domain ResourceType union (apps must not import domain
// directly — the domain re-validates on its side).
export type ResourceType =
  "repository" | "credential" | "notification" | "ai_provider" | "filesystem";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

function requireFlag(args: Record<string, unknown>, flag: string): string {
  const value = args[flag];
  if (typeof value !== "string" || value === "") {
    throw new MissingFlagError(`--${flag}`);
  }
  return value;
}

function parseValueTimeout(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const m = raw.match(/^(\d+)(ms|s|m)$/);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  if (m[2] === "ms") return n;
  if (m[2] === "s") return n * 1000;
  if (m[2] === "m") return n * 60_000;
  return undefined;
}

function parseRepositoryAuth(
  args: Record<string, unknown>,
):
  | { kind: "ambient" }
  | { kind: "https-token"; credentialId: string }
  | { kind: "ssh-agent" } {
  const authKind = typeof args["auth"] === "string" ? args["auth"] : "ambient";
  if (authKind === "https-token") {
    const credentialId = requireFlag(args, "credential");
    return { kind: "https-token", credentialId };
  }
  if (authKind === "ssh-agent") return { kind: "ssh-agent" };
  return { kind: "ambient" };
}

export async function runCreateRepository(
  args: Record<string, unknown>,
  addResource: AddResource,
): Promise<HandlerResult> {
  try {
    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const remoteUrl = requireFlag(args, "remote-url");
    const branch = requireFlag(args, "branch");
    const path = typeof args["path"] === "string" ? args["path"] : "";
    const auth = parseRepositoryAuth(args);
    const id = await addResource.execute({
      type: "repository",
      projectId,
      name,
      remoteUrl,
      branch,
      path,
      auth,
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`repository created: ${id}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runCreateCredential(
  args: Record<string, unknown>,
  addResource: AddResource,
  io: {
    tty?: NodeJS.ReadStream;
    timeoutMs?: number;
    stdin?: NodeJS.ReadableStream;
  } = {},
): Promise<HandlerResult> {
  try {
    // Reject old --value flag (removed; use --value-file instead)
    if (args["value"] !== undefined) {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [
          "error: --value is no longer supported; use --value-file <path> or --value-file - for stdin",
        ],
      };
    }

    const projectId = requireFlag(args, "project");
    const name = requireFlag(args, "name");
    const provider = requireFlag(args, "provider");

    const valuefile =
      typeof args["value-file"] === "string" ? args["value-file"] : undefined;
    const timeoutMs =
      parseValueTimeout(args["value-timeout"]) ?? io.timeoutMs ?? 180_000;

    let value: string;
    try {
      value = await readCredentialValue({
        valuefile,
        tty: io.tty,
        stdin: io.stdin,
        timeoutMs,
      });
    } catch (readErr) {
      if (readErr instanceof CredentialReadTimeoutError) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [`error: credential read timeout: ${readErr.message}`],
        };
      }
      if (readErr instanceof Error) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [`error: ${readErr.message}`],
        };
      }
      throw readErr;
    }

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
      stderr: [`credential created: ${id}`],
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
      stderr: [`notification created: ${id}`],
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
    let effort: ReasoningEffort | undefined;
    if (typeof args["effort"] === "string" && args["effort"] !== "") {
      if (!(REASONING_EFFORTS as readonly string[]).includes(args["effort"])) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [
            `error: invalid effort "${args["effort"]}": must be one of ${REASONING_EFFORTS.join(", ")}`,
          ],
        };
      }
      effort = args["effort"] as ReasoningEffort;
    }
    const id = await addResource.execute({
      type: "ai_provider",
      projectId,
      name,
      provider,
      model,
      ...(effort !== undefined ? { effort } : {}),
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`ai_provider created: ${id}`],
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
      stderr: [`filesystem created: ${id}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runGetResource(
  args: Record<string, unknown>,
  getResource: GetResource,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    const view = getResource.execute(id);
    const isJson = args["json"] === true;
    if (isJson) {
      return {
        exitCode: 0,
        stdout: [JSON.stringify(view, null, 2)],
        stderr: [],
      };
    }
    // Plain-text: one `key: value` line per field (omit undefined optional fields)
    const lines: string[] = [];
    for (const [k, v] of Object.entries(view as Record<string, unknown>)) {
      if (v === undefined) continue;
      const valueStr =
        typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      lines.push(`${k}: ${valueStr}`);
    }
    return {
      exitCode: 0,
      stdout: lines,
      stderr: [],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runListResources(
  args: Record<string, unknown>,
  type: ResourceType,
  listResources: ListResources,
): HandlerResult {
  const projectId = args["project"] as string;
  const rows = listResources.execute({ projectId, type });
  if (args["json"]) {
    return { exitCode: 0, stdout: [JSON.stringify(rows)], stderr: [] };
  }
  return {
    exitCode: 0,
    stdout: rows.map((r) => `${r.id}  ${r.name}`),
    stderr: [],
  };
}

export async function runUpdateAiProvider(
  args: Record<string, unknown>,
  updateAiProvider: UpdateAiProvider,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    await updateAiProvider.execute({
      id,
      ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
      ...(typeof args["model"] === "string" ? { model: args["model"] } : {}),
      ...(args["clear-effort"] === true
        ? { effort: null }
        : typeof args["effort"] === "string" && args["effort"] !== ""
          ? { effort: args["effort"] as ReasoningEffort }
          : {}),
      ...(args["clear-base-url"] === true
        ? { baseUrl: null }
        : typeof args["base-url"] === "string"
          ? { baseUrl: args["base-url"] }
          : {}),
    });
    return { exitCode: 0, stdout: [], stderr: ["ai_provider updated"] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runUpdateCredential(
  args: Record<string, unknown>,
  updateCredential: UpdateCredential,
  io: {
    tty?: NodeJS.ReadStream;
    timeoutMs?: number;
    stdin?: NodeJS.ReadableStream;
  } = {},
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    const valuefile =
      typeof args["value-file"] === "string" ? args["value-file"] : undefined;
    const timeoutMs =
      parseValueTimeout(args["value-timeout"]) ?? io.timeoutMs ?? 180_000;

    let value: string | undefined;
    if (valuefile !== undefined) {
      try {
        value = await readCredentialValue({
          valuefile,
          tty: io.tty,
          stdin: io.stdin,
          timeoutMs,
        });
      } catch (readErr) {
        if (readErr instanceof CredentialReadTimeoutError) {
          return {
            exitCode: 1,
            stdout: [],
            stderr: [`error: credential read timeout: ${readErr.message}`],
          };
        }
        if (readErr instanceof Error) {
          return {
            exitCode: 1,
            stdout: [],
            stderr: [`error: ${readErr.message}`],
          };
        }
        throw readErr;
      }
    }

    await updateCredential.execute({
      id,
      ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
      ...(value !== undefined ? { value } : {}),
    });
    return { exitCode: 0, stdout: [], stderr: ["credential updated"] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runUpdateRepository(
  args: Record<string, unknown>,
  updateRepository: UpdateRepository,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    await updateRepository.execute({
      id,
      ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
      ...(typeof args["branch"] === "string" ? { branch: args["branch"] } : {}),
      ...(typeof args["remote-url"] === "string"
        ? { remoteUrl: args["remote-url"] }
        : {}),
      ...(args["reclone"] === true ? { reclone: true } : {}),
    });
    return { exitCode: 0, stdout: [], stderr: ["repository updated"] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runUpdateNotification(
  args: Record<string, unknown>,
  updateNotification: UpdateNotification,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    await updateNotification.execute({
      id,
      ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
      ...(typeof args["destination"] === "string"
        ? { destination: args["destination"] }
        : {}),
    });
    return { exitCode: 0, stdout: [], stderr: ["notification updated"] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runUpdateFilesystem(
  args: Record<string, unknown>,
  updateFilesystem: UpdateFilesystem,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    await updateFilesystem.execute({
      id,
      ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
      ...(typeof args["path"] === "string" ? { path: args["path"] } : {}),
    });
    return { exitCode: 0, stdout: [], stderr: ["filesystem updated"] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
