import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { ImportResources } from "../../app/resource/import-resources.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";
import { toResult } from "./error-map.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

export async function runImportResource(
  args: Record<string, unknown>,
  importResources: ImportResources,
): Promise<HandlerResult> {
  const filePath = args["path"];
  if (typeof filePath !== "string" || filePath === "") {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: missing required flag --path"],
    };
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: ${msg}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: ${msg}`],
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: YAML file must contain an object at the top level"],
    };
  }

  const doc = parsed as Record<string, unknown>;
  const projectId = doc["project"] as string;
  const entries = (
    Array.isArray(doc["resources"]) ? doc["resources"] : []
  ) as Array<Record<string, unknown>>;

  try {
    const ids = await importResources.execute({ projectId, entries });
    return {
      exitCode: 0,
      stdout: ids,
      stderr: [`imported ${ids.length} resources`],
    };
  } catch (err) {
    if (err instanceof ImportValidationError) {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [`error: ${err.message}`],
      };
    }
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
