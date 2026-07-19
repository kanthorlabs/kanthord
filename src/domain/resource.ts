import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export const RESOURCE_TYPES = [
  "repository",
  "credential",
  "notification",
  "ai_provider",
  "filesystem",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type RepositoryAuth =
  | { kind: "ambient" }
  | { kind: "https-token"; credentialId: string }
  | { kind: "ssh-agent" };

export interface Repository extends Entity {
  type: "repository";
  name: string;
  remoteUrl: string;
  branch: string;
  path: string;
  auth: RepositoryAuth;
}

export interface Credential extends Entity {
  type: "credential";
  name: string;
  provider: string;
  value: string;
}

export interface Notification extends Entity {
  type: "notification";
  name: string;
  provider: "slack" | "telegram";
  destination: string;
}

/** Reasoning effort levels — mirrors pi-ai's ThinkingLevel. */
export const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface AIProvider extends Entity {
  type: "ai_provider";
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  effort?: ReasoningEffort;
}

export interface Filesystem extends Entity {
  type: "filesystem";
  name: string;
  path: string;
}

export type Resource =
  Repository | Credential | Notification | AIProvider | Filesystem;

export function isRepository(r: Resource): r is Repository {
  return r.type === "repository";
}

export function isCredential(r: Resource): r is Credential {
  return r.type === "credential";
}

export function isNotification(r: Resource): r is Notification {
  return r.type === "notification";
}

export function isAIProvider(r: Resource): r is AIProvider {
  return r.type === "ai_provider";
}

export function isFilesystem(r: Resource): r is Filesystem {
  return r.type === "filesystem";
}

export class EmbeddedCredentialError extends Error {
  readonly field: "remoteUrl";
  constructor(url: string) {
    super(`remoteUrl must not contain embedded credentials: ${url}`);
    this.name = "EmbeddedCredentialError";
    this.field = "remoteUrl";
  }
}

export class ResourceValidationError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`Resource is missing required field: ${field}`);
    this.name = "ResourceValidationError";
    this.field = field;
  }
}

export class UnknownResourceTypeError extends Error {
  readonly resourceType: string;
  constructor(resourceType: string) {
    super(`Unknown resource type: ${resourceType}`);
    this.name = "UnknownResourceTypeError";
    this.resourceType = resourceType;
  }
}

/** Pure string check — no `new URL()`. Returns true when the URL authority contains `@`. */
export function hasEmbeddedUserinfo(url: string): boolean {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return false; // SSH-style URL (git@host:path) — no authority segment
  const authorityStart = schemeEnd + 3;
  const slashPos = url.indexOf("/", authorityStart);
  const authority =
    slashPos === -1
      ? url.slice(authorityStart)
      : url.slice(authorityStart, slashPos);
  return authority.includes("@");
}

function parseAuth(raw: unknown): RepositoryAuth {
  if (typeof raw !== "object" || raw === null) {
    throw new ResourceValidationError("auth");
  }
  const r = raw as Record<string, unknown>;
  const kind = r["kind"];
  if (kind === "ambient") return { kind: "ambient" };
  if (kind === "ssh-agent") return { kind: "ssh-agent" };
  if (kind === "https-token") {
    const credentialId = r["credentialId"];
    if (typeof credentialId !== "string" || credentialId.length === 0) {
      throw new ResourceValidationError("auth.credentialId");
    }
    return { kind: "https-token", credentialId };
  }
  throw new ResourceValidationError("auth");
}

function requireString(input: Record<string, unknown>, field: string): string {
  const v = input[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new ResourceValidationError(field);
  }
  return v;
}

export function buildResource(input: Record<string, unknown>): Resource {
  const type = input["type"];
  const id = newId();

  if (type === "repository") {
    const name = requireString(input, "name");
    const remoteUrl = requireString(input, "remoteUrl");
    if (hasEmbeddedUserinfo(remoteUrl)) {
      throw new EmbeddedCredentialError(remoteUrl);
    }
    const branch = requireString(input, "branch");
    const path = requireString(input, "path");
    const auth = parseAuth(input["auth"]);
    return { id, type: "repository", name, remoteUrl, branch, path, auth };
  }

  if (type === "credential") {
    const name = requireString(input, "name");
    const provider = requireString(input, "provider");
    const value = requireString(input, "value");
    return { id, type: "credential", name, provider, value };
  }

  if (type === "notification") {
    const name = requireString(input, "name");
    const provider = requireString(input, "provider") as "slack" | "telegram";
    const destination = requireString(input, "destination");
    return { id, type: "notification", name, provider, destination };
  }

  if (type === "ai_provider") {
    const name = requireString(input, "name");
    const provider = requireString(input, "provider");
    const model = requireString(input, "model");
    const baseUrlRaw = input["baseUrl"];
    const baseUrl =
      typeof baseUrlRaw === "string" && baseUrlRaw.length > 0
        ? baseUrlRaw
        : undefined;
    const effortRaw = input["effort"];
    let effort: ReasoningEffort | undefined;
    if (typeof effortRaw === "string" && effortRaw.length > 0) {
      if (!(REASONING_EFFORTS as readonly string[]).includes(effortRaw)) {
        throw new ResourceValidationError("effort");
      }
      effort = effortRaw as ReasoningEffort;
    }
    return {
      id,
      type: "ai_provider",
      name,
      provider,
      model,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
  }

  if (type === "filesystem") {
    const name = requireString(input, "name");
    const path = requireString(input, "path");
    return { id, type: "filesystem", name, path };
  }

  throw new UnknownResourceTypeError(String(type));
}
