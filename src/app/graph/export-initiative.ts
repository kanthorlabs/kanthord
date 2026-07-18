import { newId } from "../../domain/entity.ts";
import type {
  InitiativeRepository,
  TaskRepository,
} from "../../storage/port.ts";
import type {
  GraphPackage,
  PkgInitiative,
  PkgObjective,
  PkgTask,
  ExportManifest,
} from "./graph-package.ts";

/**
 * Story 04 T1 — query use case that returns a `GraphPackage`.
 * Never touches the filesystem or codec (B5/B8).
 * Only pending tasks become files; manifest.nodes covers ALL nodes (TS1/TB1).
 */
export class ExportInitiative {
  readonly #tasks: TaskRepository;
  readonly #initiatives: InitiativeRepository;

  constructor(deps: {
    tasks: TaskRepository;
    initiatives: InitiativeRepository;
  }) {
    this.#tasks = deps.tasks;
    this.#initiatives = deps.initiatives;
  }

  async execute(initiativeId: string): Promise<GraphPackage> {
    const initiative = this.#initiatives.get(initiativeId);
    if (initiative === undefined) {
      throw new Error(`Initiative not found: ${initiativeId}`);
    }

    const objectives = this.#initiatives.listObjectives(initiativeId);
    const allTasks = this.#tasks.listByInitiative(initiativeId);
    const pendingTasks = allTasks.filter((t) => t.status === "pending");

    const packageId = newId();
    const formatVersion = 1;

    // Build manifest: nodes = full snapshot; files = initiative + objectives + pending tasks
    const nodes: Record<string, string> = {};
    const files: string[] = [];

    // Initiative
    const initSha = this.#initiatives.getSha256(initiativeId) ?? "";
    nodes[initiativeId] = initSha;
    files.push(initiativeId);

    // Objectives
    const refToIdObjectives: Record<string, string> = {};
    for (const obj of objectives) {
      const sha = this.#initiatives.getSha256(obj.id) ?? "";
      nodes[obj.id] = sha;
      files.push(obj.id);
      refToIdObjectives[obj.id] = obj.id; // ULID-as-ref
    }

    // All tasks (including non-pending for manifest.nodes)
    const refToIdTasks: Record<string, string> = {};
    for (const task of allTasks) {
      const sha = this.#tasks.getSha256(task.id) ?? "";
      nodes[task.id] = sha;
      refToIdTasks[task.id] = task.id; // ULID-as-ref
    }

    // Files: only pending tasks
    for (const task of pendingTasks) {
      files.push(task.id);
    }

    const manifest: ExportManifest = {
      initiativeId,
      packageId,
      formatVersion,
      digestAlgorithm: "sha256",
      nodes,
      files,
      refToId: {
        objectives: refToIdObjectives,
        tasks: refToIdTasks,
      },
    };

    // Build DTOs — ULID-as-ref (id === ref, no lowercase slug)
    const pkgInitiative: PkgInitiative = {
      id: initiative.id,
      ref: initiative.id,
      name: initiative.name,
      sourcePath: `${initiative.name}.md`,
    };

    const pkgObjectives: PkgObjective[] = objectives.map((obj) => ({
      id: obj.id,
      ref: obj.id,
      initiativeRef: initiativeId,
      name: obj.name,
      sourcePath: `${obj.name}/${obj.name}.md`,
    }));

    const pkgTasks: PkgTask[] = pendingTasks.map((task) => {
      const obj = objectives.find((o) => o.id === task.objectiveId);
      const objName = obj?.name ?? task.objectiveId;
      return {
        id: task.id,
        ref: task.id,
        objectiveRef: task.objectiveId,
        title: task.title,
        instructions: task.instructions ?? "",
        ac: task.ac ?? [],
        agent: task.agent ?? "generic@1",
        verification: task.verification,
        dependsOn: task.dependencies,
        sourcePath: `${objName}/${task.title.toLowerCase().replace(/\s+/g, "-")}.md`,
      };
    });

    return {
      packageId,
      formatVersion,
      initiative: pkgInitiative,
      objectives: pkgObjectives,
      tasks: pkgTasks,
      manifest,
    };
  }
}
