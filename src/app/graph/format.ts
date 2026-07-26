/**
 * Canonical frontmatter key-order constants and shared format values (B9/B16).
 * Imported by the graph codec (graph-codec.ts) so parse and serialize cannot drift.
 */

/**
 * Current graph package format version.
 * Bumped to 2 for EPIC 007.1 C1: bindings + context fields now round-trip.
 * Bumped to 3 for EPIC 007.18: node shas are content-only (status removed),
 * so a pre-007.18 manifest's baselines predate the hash change.
 */
export const GRAPH_FORMAT_VERSION = 3;

/** Default agent when frontmatter `agent:` is absent. */
export const DEFAULT_AGENT = "generic@1";

/** Canonical frontmatter key order for initiative nodes. */
export const INITIATIVE_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "name",
  "after",
] as const;

/** Canonical frontmatter key order for objective nodes. */
export const OBJECTIVE_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "initiative",
  "name",
  "after",
] as const;

/**
 * Canonical frontmatter key order for task nodes.
 * `dependencies` is omitted when the dep list is empty.
 */
export const TASK_FRONTMATTER_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "objective",
  "title",
  "agent",
  "dependencies",
] as const;
