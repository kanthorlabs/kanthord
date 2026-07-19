/**
 * Canonical frontmatter key-order constants and shared format values (B9/B16).
 * Imported by the graph codec (graph-codec.ts) so parse and serialize cannot drift.
 */

/**
 * Current graph package format version.
 * Bumped to 2 for EPIC 007.1 C1: bindings + context fields now round-trip.
 */
export const GRAPH_FORMAT_VERSION = 2;

/** Format version 1 (EPIC 007) — still parseable for backwards compatibility. */
// TODO: remove this once we no longer need to support legacy format.
export const GRAPH_FORMAT_VERSION_LEGACY = 1;

/** Default agent when frontmatter `agent:` is absent. */
export const DEFAULT_AGENT = "generic@1";

/** Canonical frontmatter key order for initiative nodes. */
export const INITIATIVE_KEY_ORDER = ["kind", "id", "ref", "name"] as const;

/** Canonical frontmatter key order for objective nodes. */
export const OBJECTIVE_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "initiative",
  "name",
] as const;

/**
 * Canonical frontmatter key order for task nodes.
 * `depends-on` is omitted when the dep list is empty.
 */
export const TASK_FRONTMATTER_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "objective",
  "title",
  "agent",
  "depends-on",
] as const;
