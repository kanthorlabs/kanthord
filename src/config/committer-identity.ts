import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CommitterIdentity {
  name: string;
  email: string;
}

const FILENAME = "committer.json";

export async function loadCommitterIdentity(
  dataRoot: string
): Promise<CommitterIdentity | undefined> {
  const filePath = join(dataRoot, FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as { name: string; email: string };
  return { name: parsed.name, email: parsed.email };
}

export async function saveCommitterIdentity(
  dataRoot: string,
  identity: CommitterIdentity
): Promise<void> {
  const filePath = join(dataRoot, FILENAME);
  await writeFile(filePath, JSON.stringify(identity), "utf8");
}

export function resolveCommitterIdentity({
  slotCommitter,
  globalIdentity,
}: {
  slotCommitter?: CommitterIdentity | undefined;
  globalIdentity?: CommitterIdentity | undefined;
}): CommitterIdentity | undefined {
  return slotCommitter ?? globalIdentity;
}
