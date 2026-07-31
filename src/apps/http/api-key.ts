export const API_KEY_MIN_LENGTH = 16;

export class MissingApiKeyError extends Error {}

/** Validate a candidate API key. Throws MissingApiKeyError when unusable. */
export function requireApiKey(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length < API_KEY_MIN_LENGTH) {
    throw new MissingApiKeyError(
      `API_KEY must be set to at least 16 characters (got "${trimmed.slice(0, 3)}...")`,
    );
  }
  return trimmed;
}
