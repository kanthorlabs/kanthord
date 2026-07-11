import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export function resolveDataRoot(): string {
  const env = process.env["KANTHORD_DATA"];
  if (env !== undefined && env !== "") {
    return env;
  }
  return join(homedir(), ".kanthord");
}

export async function ensureDataRoot(dataRoot: string): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  return dataRoot;
}
