import type {
  GraphPackage,
  PkgInitiative,
  PkgObjective,
  PkgTask,
  ExportManifest,
} from "../../../app/graph/graph-package.ts";

export interface PkgInitiativeView {
  readonly id?: string;
  readonly ref: string;
  readonly name: string;
  readonly sourcePath: string;
  readonly after?: string[];
  readonly bindings?: Record<string, string>;
}

export interface PkgObjectiveView {
  readonly id?: string;
  readonly ref: string;
  readonly initiativeRef: string;
  readonly name: string;
  readonly sourcePath: string;
  readonly after?: string[];
  readonly context?: Record<string, string>;
}

export interface PkgTaskView {
  readonly id?: string;
  readonly ref: string;
  readonly objectiveRef: string;
  readonly title: string;
  readonly instructions: string;
  readonly ac: string[];
  readonly agent: string;
  readonly verification: readonly string[] | null | undefined;
  readonly dependencies: string[];
  readonly sourcePath: string;
  readonly context?: Record<string, string>;
}

export interface ExportManifestView {
  readonly initiativeId: string;
  readonly packageId: string;
  readonly formatVersion: number;
  readonly digestAlgorithm: "sha256";
  readonly nodes: Record<string, string>;
  readonly files: string[];
  readonly objectiveIds?: string[];
  readonly refToId: {
    readonly objectives: Record<string, string>;
    readonly tasks: Record<string, string>;
  };
}

export interface GraphPackageView {
  readonly packageId: string;
  readonly formatVersion: number;
  readonly initiative: PkgInitiativeView;
  readonly objectives: PkgObjectiveView[];
  readonly tasks: PkgTaskView[];
  readonly manifest?: ExportManifestView;
  readonly [key: string]: unknown;
}

function pkgInitiativeView(r: PkgInitiative): PkgInitiativeView {
  return {
    ...(r.id !== undefined ? { id: r.id } : {}),
    ref: r.ref,
    name: r.name,
    sourcePath: r.sourcePath,
    ...(r.after !== undefined ? { after: [...r.after] } : {}),
    ...(r.bindings !== undefined ? { bindings: { ...r.bindings } } : {}),
  };
}

function pkgObjectiveView(r: PkgObjective): PkgObjectiveView {
  return {
    ...(r.id !== undefined ? { id: r.id } : {}),
    ref: r.ref,
    initiativeRef: r.initiativeRef,
    name: r.name,
    sourcePath: r.sourcePath,
    ...(r.after !== undefined ? { after: [...r.after] } : {}),
    ...(r.context !== undefined ? { context: { ...r.context } } : {}),
  };
}

function pkgTaskView(r: PkgTask): PkgTaskView {
  return {
    ...(r.id !== undefined ? { id: r.id } : {}),
    ref: r.ref,
    objectiveRef: r.objectiveRef,
    title: r.title,
    instructions: r.instructions,
    ac: [...r.ac],
    agent: r.agent,
    verification:
      r.verification === undefined
        ? undefined
        : r.verification === null
          ? null
          : [...r.verification],
    dependencies: [...r.dependencies],
    sourcePath: r.sourcePath,
    ...(r.context !== undefined ? { context: { ...r.context } } : {}),
  };
}

function exportManifestView(r: ExportManifest): ExportManifestView {
  return {
    initiativeId: r.initiativeId,
    packageId: r.packageId,
    formatVersion: r.formatVersion,
    digestAlgorithm: r.digestAlgorithm,
    nodes: { ...r.nodes },
    files: [...r.files],
    ...(r.objectiveIds !== undefined
      ? { objectiveIds: [...r.objectiveIds] }
      : {}),
    refToId: {
      objectives: { ...r.refToId.objectives },
      tasks: { ...r.refToId.tasks },
    },
  };
}

/** Presents every field of a `GraphPackage` so a client can feed the result
 * straight back into `POST /api/initiative/:id/graph`. */
export function graphPackageView(r: GraphPackage): GraphPackageView {
  return {
    packageId: r.packageId,
    formatVersion: r.formatVersion,
    initiative: pkgInitiativeView(r.initiative),
    objectives: r.objectives.map(pkgObjectiveView),
    tasks: r.tasks.map(pkgTaskView),
    ...(r.manifest !== undefined
      ? { manifest: exportManifestView(r.manifest) }
      : {}),
  };
}
