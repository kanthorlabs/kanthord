// src/apps/cli/ai-provider.ts — CLI runner functions for global AI provider
// commands (008.1 Story C: register, get, set-default, list; Story D: logout, remove).

import type { RegisterAiProvider } from "../../app/ai-provider/register-ai-provider.ts";
import type { GetAiProvider } from "../../app/ai-provider/get-ai-provider.ts";
import type { SetDefaultAiProvider } from "../../app/ai-provider/set-default-ai-provider.ts";
import type { ListAiProviders } from "../../app/ai-provider/list-ai-providers.ts";
import type { LogoutAiProvider } from "../../app/ai-provider/logout-ai-provider.ts";
import type { RemoveAiProvider } from "../../app/ai-provider/remove-ai-provider.ts";
import type { AssignAiProvider } from "../../app/ai-provider/assign-ai-provider.ts";
import type { UnassignAiProvider } from "../../app/ai-provider/unassign-ai-provider.ts";
import type { ResolveProjectChain } from "../../app/ai-provider/resolve-project-chain.ts";
import { InvalidRankError } from "../../app/ai-provider/errors.ts";
import type { TestAiProvider } from "../../app/ai-provider/test-ai-provider.ts";
import { MissingFlagError, toResult } from "./error-map.ts";
import { readCredentialValue } from "./credential-input.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

function requireFlag(args: Record<string, unknown>, flag: string): string {
  const value = args[flag];
  if (typeof value !== "string" || value === "") {
    throw new MissingFlagError(`--${flag}`);
  }
  return value;
}

export async function runRegisterAiProvider(
  args: Record<string, unknown>,
  registerAiProvider: RegisterAiProvider,
): Promise<HandlerResult> {
  try {
    const name = requireFlag(args, "name");
    const api: "openai-completions" | "openai-responses" | undefined =
      typeof args["api"] === "string" && args["api"] !== ""
        ? (args["api"] as "openai-completions" | "openai-responses")
        : undefined;
    const provider =
      api !== undefined
        ? typeof args["provider"] === "string"
          ? args["provider"]
          : ""
        : requireFlag(args, "provider");
    const model = requireFlag(args, "model");
    const valueFile =
      typeof args["valueFile"] === "string" && args["valueFile"] !== ""
        ? args["valueFile"]
        : undefined;
    const baseUrl =
      typeof args["baseUrl"] === "string" ? args["baseUrl"] : undefined;
    const effort =
      typeof args["effort"] === "string" ? args["effort"] : undefined;
    const customProviderId =
      typeof args["customProviderId"] === "string" &&
      args["customProviderId"] !== ""
        ? args["customProviderId"]
        : undefined;
    const contextWindow =
      typeof args["contextWindow"] === "string" && args["contextWindow"] !== ""
        ? parseInt(args["contextWindow"] as string, 10)
        : undefined;
    const maxTokens =
      typeof args["maxTokens"] === "string" && args["maxTokens"] !== ""
        ? parseInt(args["maxTokens"] as string, 10)
        : undefined;
    const allowInsecure = args["allowInsecure"] === true;

    const value = await readCredentialValue({
      valuefile: valueFile,
      timeoutMs: 180_000,
    });

    const id = registerAiProvider.execute({
      name,
      provider,
      model,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(api !== undefined ? { api } : {}),
      ...(customProviderId !== undefined ? { customProviderId } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(allowInsecure ? { allowInsecure } : {}),
      value,
    });

    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`ai-provider registered: ${id}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runGetAiProvider(
  args: Record<string, unknown>,
  getAiProvider: GetAiProvider,
): HandlerResult {
  try {
    const id = requireFlag(args, "id");
    const view = getAiProvider.execute(id);
    const isJson = args["json"] === true;
    if (isJson) {
      return {
        exitCode: 0,
        stdout: [JSON.stringify(view, null, 2)],
        stderr: [],
      };
    }
    // Plain-text: one `key: value` line per field.
    const lines: string[] = [];
    for (const [k, v] of Object.entries(
      view as unknown as Record<string, unknown>,
    )) {
      if (v === undefined) continue;
      lines.push(`${k}: ${v}`);
    }
    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runSetDefaultAiProvider(
  args: Record<string, unknown>,
  setDefaultAiProvider: SetDefaultAiProvider,
): HandlerResult {
  try {
    const id = requireFlag(args, "id");
    setDefaultAiProvider.execute(id);
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`default ai-provider set: ${id}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runListAiProviders(
  args: Record<string, unknown>,
  listAiProviders: ListAiProviders,
): HandlerResult {
  try {
    const views = listAiProviders.execute();
    const isJson = args["json"] === true;
    if (isJson) {
      return { exitCode: 0, stdout: [JSON.stringify(views)], stderr: [] };
    }
    return {
      exitCode: 0,
      stdout: views.map((v) => `${v.id}  ${v.name}`),
      stderr: [],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runLogoutAiProvider(
  args: Record<string, unknown>,
  logoutAiProvider: LogoutAiProvider,
  providerInfo?: { name: string; provider: string },
): HandlerResult {
  try {
    const id = requireFlag(args, "id");
    const replacement =
      typeof args["replacement"] === "string" ? args["replacement"] : undefined;
    const confirmNoDefault = args["confirmNoDefault"] === true;
    logoutAiProvider.execute(id, { replacement, confirmNoDefault });

    const audit = providerInfo
      ? `logout: ${id} (${providerInfo.provider}/${providerInfo.name}) — local invalidation only, no remote token revoke`
      : `logout: ${id}`;
    const stderr: string[] = [audit];
    if (replacement) {
      stderr.push(`default reassigned to ${replacement}`);
    }
    if (confirmNoDefault) {
      stderr.push("default cleared — no default provider remains");
    }

    return { exitCode: 0, stdout: [id], stderr };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runRemoveAiProvider(
  args: Record<string, unknown>,
  removeAiProvider: RemoveAiProvider,
  providerInfo?: { name: string; provider: string; isDefault?: boolean },
): HandlerResult {
  try {
    const id = requireFlag(args, "id");
    const replacement =
      typeof args["replacement"] === "string" ? args["replacement"] : undefined;
    const confirmNoDefault = args["confirmNoDefault"] === true;
    const cascade = args["cascade"] === true;
    removeAiProvider.execute(id, {
      ...(replacement !== undefined ? { replacement } : {}),
      ...(confirmNoDefault ? { confirmNoDefault: true } : {}),
      ...(cascade ? { cascade: true } : {}),
    });

    const audit = providerInfo
      ? `remove: ${id} (${providerInfo.provider}/${providerInfo.name})`
      : `remove: ${id}`;
    const stderr: string[] = [audit];
    // S4: only print "default reassigned" when the removed provider was actually the default.
    if (replacement && providerInfo?.isDefault) {
      stderr.push(`default reassigned to ${replacement}`);
    }
    if (confirmNoDefault) {
      stderr.push("default cleared — no default provider remains");
    }

    return { exitCode: 0, stdout: [id], stderr };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runAssignAiProvider(
  args: Record<string, unknown>,
  assignAiProvider: AssignAiProvider,
): HandlerResult {
  try {
    const projectId = requireFlag(args, "project");
    const providerId = requireFlag(args, "provider");
    let rank =
      typeof args["rank"] === "number" ? (args["rank"] as number) : undefined;

    // B4: validate --rank is a non-negative integer.
    if (rank !== undefined) {
      if (!Number.isInteger(rank) || rank < 0) {
        throw new InvalidRankError(rank);
      }
    }

    const input: { projectId: string; providerId: string; rank?: number } = {
      projectId,
      providerId,
    };
    if (rank !== undefined) {
      input.rank = rank;
    }

    assignAiProvider.execute(input);
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runUnassignAiProvider(
  args: Record<string, unknown>,
  unassignAiProvider: UnassignAiProvider,
): HandlerResult {
  try {
    const projectId = requireFlag(args, "project");
    const providerId = requireFlag(args, "provider");

    unassignAiProvider.execute({ projectId, providerId });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runResolveProjectChain(
  args: Record<string, unknown>,
  resolveProjectChain: ResolveProjectChain,
): HandlerResult {
  try {
    const projectId = requireFlag(args, "project");
    const views = resolveProjectChain.execute(projectId);
    const isJson = args["json"] === true;
    if (isJson) {
      return { exitCode: 0, stdout: [JSON.stringify(views)], stderr: [] };
    }
    return {
      exitCode: 0,
      stdout: views.map((v) => `${v.id}  ${v.name}`),
      stderr: [],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runTestAiProvider(
  args: Record<string, unknown>,
  testAiProvider: TestAiProvider,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    const prompt =
      typeof args["prompt"] === "string" && args["prompt"] !== ""
        ? args["prompt"]
        : "What is today's datetime?";
    const result = await testAiProvider.execute({ id, prompt });
    return { exitCode: 0, stdout: [result], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
