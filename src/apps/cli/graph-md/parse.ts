/**
 * I/O utilities for reading a graph-package directory into pre-read file
 * contents suitable for the core codec (RF2).
 * Pure parse/serialize logic lives in src/app/graph/graph-codec.ts.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** Recursively collect all `.md` file absolute paths under `dir`. */
async function collectMdFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      const nested = await collectMdFiles(full);
      results.push(...nested);
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Read all markdown files + optional manifest from a graph-package directory.
 * Returns `{ sourcePath, content }[]` ready for `parseGraphPackage` (core codec).
 * If `.kanthord-export.json` exists it is included as the last entry.
 */
export async function readGraphPackageDir(
  rootDir: string,
): Promise<Array<{ sourcePath: string; content: string }>> {
  const mdFiles = await collectMdFiles(rootDir);
  const result: Array<{ sourcePath: string; content: string }> = [];

  for (const absPath of mdFiles) {
    const content = await readFile(absPath, "utf8");
    const sourcePath = relative(rootDir, absPath);
    result.push({ sourcePath, content });
  }

  // Include manifest when present (create mode skips it gracefully).
  try {
    const manifestContent = await readFile(
      join(rootDir, ".kanthord-export.json"),
      "utf8",
    );
    result.push({
      sourcePath: ".kanthord-export.json",
      content: manifestContent,
    });
  } catch {
    // No manifest — create mode; packageId minted later.
  }

  return result;
}
