// src/apps/http/body.ts — request-body readers (EPIC 021 decision 2). Sibling to
// decode.ts, which owns the params/query readers: splitting by input location
// keeps both files small and leaves decode.ts untouched by this epic.
import { InvalidInputError } from "./errors.ts";
import type { RepositoryAuth } from "../../app/resource/add-resource.ts";

/** Every helper starts here: the body must be a plain JSON object. */
function bodyRecord(body: unknown, field: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InvalidInputError(field, "request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/**
 * Trims and rejects blank, mirroring `requirePathParam`
 * (`decode.ts:9-12`) — `{"name":"   "}` never reaches a use case, several of
 * which have no name validation of their own.
 */
export function requireBodyString(body: unknown, field: string): string {
  const raw = bodyRecord(body, field)[field];
  if (typeof raw !== "string") {
    throw new InvalidInputError(field, "must be a string");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidInputError(field, "must not be blank");
  }
  return trimmed;
}

export function optionalBodyString(
  body: unknown,
  field: string,
): string | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  return requireBodyString(body, field);
}

export function optionalBodyStringArray(
  body: unknown,
  field: string,
): string[] | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an array of strings");
  }
  return raw.map((entry) => {
    if (typeof entry !== "string") {
      throw new InvalidInputError(field, "must be an array of strings");
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new InvalidInputError(field, "entries must not be blank");
    }
    return trimmed;
  });
}

export function optionalBodyBool(
  body: unknown,
  field: string,
): boolean | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "boolean") {
    throw new InvalidInputError(field, "must be a boolean");
  }
  return raw;
}

export function requireBodyObject(
  body: unknown,
  field: string,
): Record<string, unknown> {
  const raw = bodyRecord(body, field)[field];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an object");
  }
  return raw as Record<string, unknown>;
}

export function requireBodyObjectArray(
  body: unknown,
  field: string,
): Array<Record<string, unknown>> {
  const raw = bodyRecord(body, field)[field];
  if (!Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an array of objects");
  }
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new InvalidInputError(field, "must be an array of objects");
    }
    return entry as Record<string, unknown>;
  });
}

export function optionalBodyRecord(
  body: unknown,
  field: string,
): Record<string, string> | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an object of strings");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new InvalidInputError(field, "must be an object of strings");
    }
    out[key] = value;
  }
  return out;
}

export function requireBodyRepositoryAuth(
  body: unknown,
  field: string,
): RepositoryAuth {
  const auth = requireBodyObject(body, field);
  const kind = requireBodyString(auth, "kind");
  if (kind === "ambient") {
    return { kind: "ambient" };
  }
  if (kind === "ssh-agent") {
    return { kind: "ssh-agent" };
  }
  if (kind === "https-token") {
    return {
      kind: "https-token",
      credentialId: requireBodyString(auth, "credentialId"),
    };
  }
  throw new InvalidInputError(
    field,
    'kind must be "ambient", "https-token" or "ssh-agent"',
  );
}

export function optionalBodyRepositoryAuth(
  body: unknown,
  field: string,
): RepositoryAuth | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  return requireBodyRepositoryAuth(body, field);
}
