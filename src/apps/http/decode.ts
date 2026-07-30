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
