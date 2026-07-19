/**
 * Story 05 T3 — CLI adapter for `import graph --create`.
 * Story 08 T1 — `--apply --dry-run` path.
 * Calls the CreateGraph / ApplyGraph use case, then rewrites source files.
 * All filesystem I/O lives here (B5/RF2).
 */
import { writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { readGraphPackageDir } from "./graph-md/parse.ts";
import {
  parseGraphPackage,
  serializeNode,
} from "../../app/graph/graph-codec.ts";
import { GRAPH_FORMAT_VERSION } from "../../app/graph/format.ts";
import type {
  CreateGraphInput,
  CreateGraphResult,
} from "../../app/graph/create-graph.ts";
import {
  UnknownBindingNameError,
  AmbiguousBindingNameError,
  IncompatibleBindingTypeError,
} from "../../app/graph/import-errors.ts";
import type { ApplyGraphResult } from "../../app/graph/apply-graph.ts";
import type {
  PkgInitiative,
  PkgObjective,
  PkgTask,
  GraphPackage,
} from "../../app/graph/graph-package.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HandlerResult = {
  exitCode: number;
  stdout: string[];
  stderr: string[];
};

type CreateGraphUC = {
  execute(input: CreateGraphInput): Promise<CreateGraphResult>;
};

type ApplyGraphUC = {
  execute(input: {
    pkg: GraphPackage;
    initiativeId: string;
    dryRun?: boolean;
    deleteMissing?: boolean;
    confirmDelete?: boolean;
  }): Promise<ApplyGraphResult>;
};

export type ImportGraphDeps = {
  createGraph: CreateGraphUC;
  applyGraph?: ApplyGraphUC;
  newId: () => string;
  /** C1: resolve a resource by name within a project (for --bind name-style values). */
  findResourcesByName?: (
    projectId: string,
    name: string,
    type: string,
  ) => Promise<Array<{ id: string }>>;
  /** C1: fetch a resource by id to verify its type. */
  getResource?: (
    id: string,
  ) => Promise<{ type: string; provider?: string } | undefined>;
};

export type ImportGraphArgs = {
  dir: string;
  create: boolean;
  apply: boolean;
  dryRun?: boolean;
  deleteMissing?: boolean;
  confirmDelete?: boolean;
  project?: string;
  initiative?: string;
  /** C1: --bind alias=value pairs from the CLI. */
  bind?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/**
 * Handle `import graph --create --project <id> <dir>` (and future --apply).
 * Returns a result object — never throws, never calls `process.exit`.
 */
export async function runImportGraph(
  args: ImportGraphArgs,
  deps: ImportGraphDeps,
): Promise<HandlerResult> {
  // Guard: mutually exclusive modes
  if (args.create && args.apply) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --create and --apply are mutually exclusive"],
    };
  }

  // Guard: --create requires --project
  if (args.create && !args.project) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --project <id> is required with --create"],
    };
  }

  if (args.create) {
    return runCreate(
      args.dir,
      args.project!,
      deps.createGraph,
      deps.newId,
      args.bind,
      deps.findResourcesByName,
      deps.getResource,
    );
  }

  if (args.apply) {
    return runApply(args, deps.applyGraph!);
  }

  return {
    exitCode: 1,
    stdout: [],
    stderr: ["error: --create or --apply is required"],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a file atomically via temp + rename (S3). */
async function atomicWrite(absPath: string, content: string): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  const tmpPath = absPath + ".tmp";
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, absPath);
}

// ---------------------------------------------------------------------------
// --apply mode (includes --dry-run)
// ---------------------------------------------------------------------------

async function runApply(
  args: ImportGraphArgs,
  applyGraph: ApplyGraphUC,
): Promise<HandlerResult> {
  if (!args.initiative) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --initiative <id> is required with --apply"],
    };
  }

  const files = await readGraphPackageDir(args.dir);
  const pkg = parseGraphPackage(files);
  const dryRun = args.dryRun ?? false;
  const deleteMissing = args.deleteMissing ?? false;
  const confirmDelete = args.confirmDelete ?? false;

  const result = await applyGraph.execute({
    pkg,
    initiativeId: args.initiative,
    dryRun,
    deleteMissing,
    confirmDelete,
  });

  // Format each classification line for stdout
  const stdout: string[] = [];
  for (const cls of result.classifications) {
    const label = cls.name ?? cls.id ?? cls.ref;
    if (cls.class === "missing" && cls.reason !== undefined) {
      stdout.push(`missing (${cls.reason}): ${label}`);
    } else if (cls.sourcePath !== undefined) {
      stdout.push(`${cls.class}: ${label} (${join(args.dir, cls.sourcePath)})`);
    } else {
      stdout.push(`${cls.class}: ${label}`);
    }
  }

  // Print summary
  const s = result.summary;
  stdout.push(
    `${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged, ${s.missing} missing`,
  );

  // When --delete-missing is set but --confirm-delete was NOT given, print a
  // delete plan for each eligible (reason: undefined) missing node and exit 0.
  if (deleteMissing && !confirmDelete) {
    const eligible = result.classifications.filter(
      (c) => c.class === "missing" && c.reason === undefined,
    );
    for (const c of eligible) {
      stdout.push(`would delete: ${c.ref}`);
    }
    stdout.push(
      `delete plan: ${eligible.length} node(s) eligible for deletion`,
    );
    return { exitCode: 0, stdout, stderr: [] };
  }

  // When --confirm-delete was given and nodes were deleted, report the count.
  if (confirmDelete && (result.summary.deleted ?? 0) > 0) {
    stdout.push(`${result.summary.deleted} deleted`);
  }

  // B4e / B1 id-handoff: after a successful non-dry-run apply, rewrite the
  // manifest with fresh shas AND rewrite newly created files with their ULIDs.
  if (!dryRun && result.applied) {
    const existingManifest = pkg.manifest;
    if (existingManifest !== undefined && result.freshNodeShas !== undefined) {
      // Merge fresh shas on top of existing ones (missing nodes keep old shas).
      const updatedNodes = {
        ...existingManifest.nodes,
        ...result.freshNodeShas,
      };

      const updatedFiles = [...existingManifest.files];
      const updatedRefToId = {
        objectives: { ...existingManifest.refToId.objectives },
        tasks: { ...existingManifest.refToId.tasks },
      };

      // Rewrite each newly created file with its assigned ULID (B1 id-handoff).
      for (const cn of result.createdNodes ?? []) {
        const pkgTask = pkg.tasks.find((t) => t.ref === cn.ref);
        if (pkgTask === undefined) continue;

        const updatedTask: PkgTask = {
          ...pkgTask,
          id: cn.id,
          ref: cn.id, // After id-handoff, the ULID becomes the ref (B18/ULID-as-ref)
        };
        await atomicWrite(
          join(args.dir, pkgTask.sourcePath),
          serializeNode(updatedTask),
        );

        // Add to manifest structures.
        updatedFiles.push(cn.id);
        updatedRefToId.tasks[cn.ref] = cn.id;
      }

      const updatedManifest = {
        ...existingManifest,
        nodes: updatedNodes,
        files: updatedFiles,
        refToId: updatedRefToId,
      };

      await writeFile(
        join(args.dir, ".kanthord-export.json"),
        JSON.stringify(updatedManifest, null, 2),
        "utf8",
      );
    }
  }

  // Dry-run always exits 0; a live apply that committed also exits 0.
  // A live apply that was blocked by conflicts exits 1.
  const exitCode = dryRun || result.applied ? 0 : 1;

  return { exitCode, stdout, stderr: [] };
}

// ---------------------------------------------------------------------------
// --create mode
// ---------------------------------------------------------------------------

/** Returns true when a string is ULID-shaped (26 Crockford base32 chars). */
function isUlidShaped(value: string): boolean {
  return value.length === 26 && /^[0-9A-Za-z]{26}$/.test(value);
}

async function runCreate(
  dir: string,
  projectId: string,
  createGraph: CreateGraphUC,
  mintId: () => string,
  bind: Record<string, string> | undefined,
  findResourcesByName: ImportGraphDeps["findResourcesByName"] | undefined,
  getResource: ImportGraphDeps["getResource"] | undefined,
): Promise<HandlerResult> {
  // 1. Read + parse the authored package directory
  const files = await readGraphPackageDir(dir);
  const pkg = parseGraphPackage(files);

  // 2. C1 — resolve --bind aliases before the graph transaction
  let resolvedBindings: Record<string, string> | undefined;
  if (pkg.initiative.bindings !== undefined) {
    const declaredAliases = Object.keys(pkg.initiative.bindings);
    const errors: string[] = [];
    const bindMap: Record<string, string> = {};

    for (const alias of declaredAliases) {
      const value = (bind ?? {})[alias];
      if (value === undefined) {
        errors.push(
          `error: alias "${alias}" has no --bind mapping (missing --bind ${alias}=<id>)`,
        );
        continue;
      }

      const expectedType = pkg.initiative.bindings[alias]!;
      let resolvedId: string;

      if (isUlidShaped(value)) {
        // ULID-shaped → treat as a direct resource id
        resolvedId = value;
      } else {
        // Name-style → resolve via findResourcesByName
        const matches = await (findResourcesByName ?? (async () => []))(
          projectId,
          value,
          expectedType,
        );
        if (matches.length === 0) {
          errors.push(new UnknownBindingNameError(alias, value).message);
          continue;
        }
        if (matches.length > 1) {
          errors.push(
            new AmbiguousBindingNameError(alias, value, matches.length).message,
          );
          continue;
        }
        resolvedId = matches[0]!.id;
      }

      // Type validation via getResource
      const resource = await (getResource ?? (async () => undefined))(
        resolvedId,
      );
      if (resource === undefined) {
        errors.push(
          `error: alias "${alias}": resource "${resolvedId}" not found`,
        );
        continue;
      }
      if (resource.type !== expectedType) {
        errors.push(
          new IncompatibleBindingTypeError(alias, expectedType, resource.type)
            .message,
        );
        continue;
      }

      bindMap[alias] = resolvedId;
    }

    if (errors.length > 0) {
      return { exitCode: 1, stdout: [], stderr: errors };
    }

    resolvedBindings = bindMap;
  }

  // 3. Mint a stable packageId for this create session
  const packageId = mintId();

  // 4. Call the use case — assigns ULIDs for every node
  const result = await createGraph.execute({
    pkg,
    projectId,
    packageId,
    bindings: resolvedBindings,
  });

  const { initiativeId } = result;
  const objectiveRefToId = result.refToId.objectives;
  const taskRefToId = result.refToId.tasks;

  // 4. Rewrite initiative source file with assigned ULID (B1 id-handoff)
  const updatedInitiative: PkgInitiative = {
    ...pkg.initiative,
    id: initiativeId,
  };
  await atomicWrite(
    join(dir, pkg.initiative.sourcePath),
    serializeNode(updatedInitiative),
  );

  // 5. Rewrite objective source files
  for (const obj of pkg.objectives) {
    const assignedId = objectiveRefToId[obj.ref];
    if (assignedId === undefined) continue;
    const updatedObjective: PkgObjective = {
      ...obj,
      id: assignedId,
      // Resolve initiative ref from slug → ULID (B1 — all refs become ULIDs post-handoff)
      initiativeRef: initiativeId,
    };
    await atomicWrite(
      join(dir, obj.sourcePath),
      serializeNode(updatedObjective),
    );
  }

  // 6. Rewrite task source files
  for (const task of pkg.tasks) {
    const assignedId = taskRefToId[task.ref];
    if (assignedId === undefined) continue;
    // Resolve objectiveRef slug → ULID
    const resolvedObjectiveRef =
      objectiveRefToId[task.objectiveRef] ?? task.objectiveRef;
    // Resolve dependsOn refs → ULIDs
    const resolvedDependsOn = task.dependsOn.map(
      (ref) => taskRefToId[ref] ?? ref,
    );
    const updatedTask: PkgTask = {
      ...task,
      id: assignedId,
      objectiveRef: resolvedObjectiveRef,
      dependsOn: resolvedDependsOn,
    };
    await atomicWrite(join(dir, task.sourcePath), serializeNode(updatedTask));
  }

  // 7. Write .kanthord-export.json manifest (B1 + TB1)
  const fileIds: string[] = [
    initiativeId,
    ...pkg.objectives
      .map((o) => objectiveRefToId[o.ref])
      .filter((id): id is string => id !== undefined),
    ...pkg.tasks
      .map((t) => taskRefToId[t.ref])
      .filter((id): id is string => id !== undefined),
  ];

  const manifest = {
    packageId,
    formatVersion:
      pkg.initiative.bindings !== undefined ? GRAPH_FORMAT_VERSION : 1,
    digestAlgorithm: "sha256" as const,
    initiativeId,
    nodes: result.nodes,
    files: fileIds,
    refToId: {
      objectives: result.refToId.objectives,
      tasks: result.refToId.tasks,
    },
  };

  await writeFile(
    join(dir, ".kanthord-export.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  const totalNodes = Object.keys(result.nodes).length;

  return {
    exitCode: 0,
    stdout: [`created ${totalNodes} nodes`],
    stderr: [],
  };
}
