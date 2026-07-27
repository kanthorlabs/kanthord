import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export const RESOURCE_TYPES = [
  "repository",
  "credential",
  "notification",
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

/** Default context window (tokens) for custom OpenAI-compatible providers. */
export const CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW = 32768;
/** Default max output tokens for custom OpenAI-compatible providers. */
export const CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS = 4096;

export interface Filesystem extends Entity {
  type: "filesystem";
  name: string;
  path: string;
}

export type Resource = Repository | Credential | Notification | Filesystem;

export function isRepository(r: Resource): r is Repository {
  return r.type === "repository";
}

export function isCredential(r: Resource): r is Credential {
  return r.type === "credential";
}

export function isNotification(r: Resource): r is Notification {
  return r.type === "notification";
}

export function isFilesystem(r: Resource): r is Filesystem {
  return r.type === "filesystem";
}

export class EmbeddedCredentialError extends Error {
  readonly field: "remoteUrl";
  constructor(url: string) {
    super(
      `remoteUrl must not contain embedded credentials: ${redactUserinfo(url)}`,
    );
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

/**
 * Pure string check — no `new URL()`. Detects endpoints whose transport or
 * destination is inherently insecure: plain http://, loopback hosts, or
 * private IP ranges. Returns true when any condition matches.
 */
export function isInsecureEndpoint(url: string): boolean {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return false;
  const scheme = url.slice(0, schemeEnd);
  const authorityStart = schemeEnd + 3;
  const slashPos = url.indexOf("/", authorityStart);
  const authority =
    slashPos === -1
      ? url.slice(authorityStart)
      : url.slice(authorityStart, slashPos);
  // Extract host before any port delimiter.
  const hostEnd = authority.indexOf(":");
  let host = hostEnd === -1 ? authority : authority.slice(0, hostEnd);

  // Handle bracketed IPv6 literals — extract inner address from [::1] etc.
  if (host.startsWith("[")) {
    const closeBracket = authority.indexOf("]");
    if (closeBracket !== -1) {
      host = authority.slice(1, closeBracket);
    }
  }

  // plain http:// is always insecure regardless of host
  if (scheme === "http") return true;

  // loopback hosts
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "0.0.0.0"
  ) {
    return true;
  }

  // private IP ranges
  if (lower.startsWith("10.")) return true;
  if (lower.startsWith("192.168.")) return true;
  const match = lower.match(/^172\.(\d+)\./);
  if (match) {
    const second = parseInt(match[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}

/**
 * Replaces a URL's userinfo segment with `***`, keeping scheme, host and path so
 * the message still identifies which URL was rejected. Used by
 * `EmbeddedCredentialError`: the rejected URL carries a live token by definition,
 * so echoing it verbatim would leak the secret into logs and terminal output.
 * Returns `url` unchanged when there is no userinfo to redact.
 */
export function redactUserinfo(url: string): string {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return url;
  const authorityStart = schemeEnd + 3;
  const slashPos = url.indexOf("/", authorityStart);
  const authorityEnd = slashPos === -1 ? url.length : slashPos;
  const authority = url.slice(authorityStart, authorityEnd);
  const at = authority.lastIndexOf("@");
  if (at === -1) return url;
  return url.slice(0, authorityStart) + "***" + url.slice(authorityStart + at);
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

  if (type === "filesystem") {
    const name = requireString(input, "name");
    const path = requireString(input, "path");
    return { id, type: "filesystem", name, path };
  }

  throw new UnknownResourceTypeError(String(type));
}
