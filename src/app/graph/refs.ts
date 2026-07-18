/**
 * Ref grammar for the graph codec (B6 — case-sensitive ULID vs slug).
 *
 * ULIDs: 26 uppercase Crockford base-32 chars (no I/L/O/U).
 * Refs:  lowercase-only slug, 1–64 chars, [a-z0-9][a-z0-9-]*.
 * The two sets are DISJOINT BY CASE — shape decides kind with no DB lookup.
 */

/** 26-char uppercase Crockford base-32 — case-SENSITIVE (B6). */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Lowercase slug ref — provably disjoint from ULID by case. */
export const REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type RefKind = "ulid" | "ref";

export class MalformedReferenceError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(
      `malformed reference: "${value}" matches neither ULID (26-char uppercase Crockford) nor ref (lowercase slug)`,
    );
    this.name = "MalformedReferenceError";
    this.value = value;
  }
}

/**
 * Classify a frontmatter reference value as `"ulid"` or `"ref"`.
 * Throws `MalformedReferenceError` if the value satisfies neither grammar.
 */
export function classifyRef(value: string): RefKind {
  if (ULID_RE.test(value)) return "ulid";
  if (REF_RE.test(value)) return "ref";
  throw new MalformedReferenceError(value);
}
