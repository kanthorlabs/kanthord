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

/** Canonical string for an objective aggregate (name + parent ref + after set). */
export function canonicalObjective(o: {
  name: string;
  initiativeId: string;
  after?: string[];
}): string {
  const json: Record<string, unknown> = {
    name: o.name,
    initiativeId: o.initiativeId,
  };
  if (o.after !== undefined && o.after.length > 0) {
    json.after = [...o.after].sort();
  }
  return JSON.stringify(json);
}

/** Canonical string for an initiative aggregate (name + parent ref + after set). */
export function canonicalInitiative(i: {
  name: string;
  projectId: string;
  after?: string[];
}): string {
  const json: Record<string, unknown> = {
    name: i.name,
    projectId: i.projectId,
  };
  if (i.after !== undefined && i.after.length > 0) {
    json.after = [...i.after].sort();
  }
  return JSON.stringify(json);
}

/** SHA-256 hex digest of the UTF-8 bytes of `canonical`. */
export function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
