export type ProviderErrorKind =
  | "rate_limited"
  | "quota_exhausted"
  | "auth_failed"
  | "transient"
  | "fatal";

export interface ClassifiedProviderError {
  kind: ProviderErrorKind;
  detail?: string;
}

const CREDENTIAL_RE = /sk-[A-Za-z0-9_-]{10,}/g;

/**
 * Classify a raw provider error string into the typed taxonomy.
 * For a `fatal` result the raw string is redacted (credentials removed) and
 * bounded to 512 chars before being returned as `detail`.
 */
export function classifyProviderError(raw: string): ClassifiedProviderError {
  const lower = raw.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("rate_limit")) {
    return { kind: "rate_limited" };
  }
  if (lower.includes("quota exceeded") || lower.includes("quota_exceeded")) {
    return { kind: "quota_exhausted" };
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return { kind: "auth_failed" };
  }
  if (lower.includes("timeout") || lower.includes("retry")) {
    return { kind: "transient" };
  }

  // Fatal: redact credential-looking tokens first, then bound to 512 chars.
  const redacted = raw.replace(CREDENTIAL_RE, "[REDACTED]");
  const detail = redacted.slice(0, 512);
  return { kind: "fatal", detail };
}
