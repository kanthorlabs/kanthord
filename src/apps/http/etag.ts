// src/apps/http/etag.ts — the strong validator every 200 json response carries
// (EPIC 021 decision 3). No entity has a version column, so the validator is a
// hash of the PRESENTED DTO: both sides run the same view function with its
// literal field list, so key order is identical by construction and no
// canonicaliser is needed. Hashing the DTO (not the enveloped bytes) keeps the
// value stable across envelope changes.
import { createHash } from "node:crypto";

export function etagOf(dto: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(dto)).digest("hex");
  return `"${digest}"`;
}
