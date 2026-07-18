/**
 * Graph-package disk writer (RF2 — all fs I/O stays at the CLI edge).
 * Serialization logic lives in src/app/graph/graph-codec.ts.
 */
import { writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type {
  PkgTask,
  PkgObjective,
  PkgInitiative,
  GraphPackage,
} from "../../../app/graph/graph-package.ts";
import { serializeNode } from "../../../app/graph/graph-codec.ts";

/**
 * Write a graph package to disk (temp file + atomic rename per node, S3).
 * Each node's `sourcePath` is relative to `rootDir`.
 */
export async function writePackage(
  rootDir: string,
  pkg: GraphPackage,
): Promise<void> {
  const nodes: Array<PkgTask | PkgObjective | PkgInitiative> = [
    pkg.initiative,
    ...pkg.objectives,
    ...pkg.tasks,
  ];

  for (const node of nodes) {
    const absPath = join(rootDir, node.sourcePath);
    await mkdir(dirname(absPath), { recursive: true });
    const content = serializeNode(node);
    const tmpPath = absPath + ".tmp";
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, absPath);
  }
}
