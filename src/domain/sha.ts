import { createHash } from "node:crypto";

/**
 * Canonical string for a task aggregate (B12/B16).
 * Fixed key-insertion order; dependencies are SET-sorted; verification is
 * null when undefined (distinct from an empty array []).
 */
export function canonicalTask(t: {
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | undefined;
  dependencies: string[];
  objectiveId: string;
  status: string;
}): string {
  return JSON.stringify({
    title: t.title,
    instructions: t.instructions,
    ac: t.ac,
    agent: t.agent,
    verification: t.verification ?? null,
    dependencies: [...t.dependencies].sort(),
    objectiveId: t.objectiveId,
    status: t.status,
  });
}

/** Canonical string for an objective aggregate (name + parent ref). */
export function canonicalObjective(o: {
  name: string;
  initiativeId: string;
}): string {
  return JSON.stringify({ name: o.name, initiativeId: o.initiativeId });
}

/** Canonical string for an initiative aggregate (name + parent ref). */
export function canonicalInitiative(i: {
  name: string;
  projectId: string;
}): string {
  return JSON.stringify({ name: i.name, projectId: i.projectId });
}

/** SHA-256 hex digest of the UTF-8 bytes of `canonical`. */
export function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
