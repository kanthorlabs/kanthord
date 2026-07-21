/**
 * Transport-neutral DTO for a graph package (EPIC 007 — B8).
 * Zero I/O — no imports from `apps/` or `storage/`.
 */

export interface PkgTask {
  id?: string; // present iff frontmatter carries a ULID (exported / post-handoff)
  ref: string; // package-local id: a lowercase slug (created) OR the ULID (exported — the ULID is the ref)
  objectiveRef: string; // frontmatter `objective:` — a ULID (exported) or a slug (created)
  title: string;
  instructions: string;
  ac: string[];
  agent: string; // codec defaults absent → "generic@1"
  verification: string[] | null | undefined; // undefined = no `# Verification`; null/[] = empty section
  dependencies: string[]; // ULIDs or refs
  sourcePath: string; // B7 provenance, relative to package root
  context?: Record<string, string>; // C1: per-task context overrides (alias → resolved resource id)
}

export interface PkgObjective {
  id?: string;
  ref: string;
  initiativeRef: string;
  name: string;
  sourcePath: string;
  context?: Record<string, string>; // C1: objective-level context (alias → resolved resource id)
}

export interface PkgInitiative {
  id?: string;
  ref: string;
  name: string;
  sourcePath: string;
  bindings?: Record<string, string>; // C1: alias → resource type map (e.g. { source: "repository" })
}

export interface ExportManifest {
  initiativeId: string;
  packageId: string;
  formatVersion: number;
  digestAlgorithm: "sha256";
  nodes: Record<string, string>; // id → sha256 — FULL snapshot: initiative+objectives+tasks (TS1)
  files: string[]; // ids written as files — delete-eligibility set (TB1), SEPARATE from nodes
  refToId: {
    // kind-scoped (B6) — namespaces never collide
    objectives: Record<string, string>;
    tasks: Record<string, string>;
  };
}

export interface GraphPackage {
  packageId: string; // ULID minted at --create; read from manifest on --apply
  formatVersion: number;
  initiative: PkgInitiative;
  objectives: PkgObjective[];
  tasks: PkgTask[];
  manifest?: ExportManifest; // present when the package was exported (.kanthord-export.json)
}
