import { InvalidInputError } from "./errors.ts";

export function requirePathParam(
  params: Readonly<Record<string, string>>,
  name: string,
): string {
  const raw = params[name];
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new InvalidInputError(name, "must not be blank");
  }
  return trimmed;
}

export function optionalQueryInt(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
  bounds: { readonly min: number; readonly max: number },
): number | undefined {
  const raw = query[name];
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    throw new InvalidInputError(name, "must be a single value");
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new InvalidInputError(name, "must be an integer");
  }
  const value = Number.parseInt(raw, 10);
  if (value < bounds.min || value > bounds.max) {
    throw new InvalidInputError(
      name,
      `must be between ${bounds.min} and ${bounds.max}`,
    );
  }
  return value;
}

export function optionalQueryString(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const raw = query[name];
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    throw new InvalidInputError(name, "must be a single value");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidInputError(name, "must not be blank");
  }
  return trimmed;
}

/**
 * A cursor query parameter. `undefined` when absent — for the event feed
 * "absent" means "from the start of the feed", so the row maps it to `""`.
 * When present it must be an exact 26-char uppercase Crockford ULID: the same
 * shape `AckProject` enforces (`src/app/project/ack-project.ts:44`). The value
 * is NOT trimmed — a ULID never carries surrounding space, and trimming would
 * silently accept `" <ulid> "`. The CLI's `--after 0` sentinel
 * (`src/apps/cli/events.ts:51`) is therefore rejected here by design.
 */
export function optionalQueryUlid(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const raw = query[name];
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    throw new InvalidInputError(name, "must be a single value");
  }
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(raw)) {
    throw new InvalidInputError(name, "must be a ULID");
  }
  return raw;
}

export function queryList(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): readonly string[] {
  const raw = query[name];
  if (raw === undefined) {
    return [];
  }
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((entry) =>
    entry
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}
