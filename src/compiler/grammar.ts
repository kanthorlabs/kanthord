import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export class GrammarError extends Error {
  readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = "GrammarError";
  }
}

export type ParsedNodeName = {
  major: number;
  lane: number | undefined;
  slug: string;
  kind: "task" | "story";
};

// Grammar: <major>[.<lane>]-<slug>.md  (task file)
const TASK_PATTERN = /^(\d+)(?:\.(\d+))?-(.+)\.md$/;

// Grammar: <major>[.<lane>]-<slug>/   (story directory)
const STORY_PATTERN = /^(\d+)(?:\.(\d+))?-(.+)\/$/;

/**
 * Parse a bare filename or directory-entry name against the
 * `<major>[.<lane>]-<slug>(.md | /)` grammar and return its typed position.
 *
 * Throws `GrammarError` with a message that names the offending filename for
 * every malformed case (missing major, non-numeric major/lane, empty slug,
 * wrong extension).
 */
export function parseNodeName(name: string): ParsedNodeName {
  const taskMatch = TASK_PATTERN.exec(name);
  if (taskMatch !== null) {
    const laneStr = taskMatch[2];
    return {
      major: parseInt(taskMatch[1]!, 10),
      lane: laneStr !== undefined ? parseInt(laneStr, 10) : undefined,
      slug: taskMatch[3]!,
      kind: "task",
    };
  }

  const storyMatch = STORY_PATTERN.exec(name);
  if (storyMatch !== null) {
    const laneStr = storyMatch[2];
    return {
      major: parseInt(storyMatch[1]!, 10),
      lane: laneStr !== undefined ? parseInt(laneStr, 10) : undefined,
      slug: storyMatch[3]!,
      kind: "story",
    };
  }

  throw new GrammarError(
    `"${name}" is not a valid task filename or story directory name` +
      ` (expected <major>[.<lane>]-<slug>(.md | /))`,
  );
}

export type FileKind =
  | "task"
  | "state"
  | "journal"
  | "runbook"
  | "index"
  | "epic";

export type FileEntry = {
  name: string;
  kind: FileKind;
};

export type StoryEntry = {
  name: string;
  parsed: ParsedNodeName;
  files: FileEntry[];
};

export type StoryGroup = {
  major: number;
  parallel: boolean;
  stories: StoryEntry[];
};

export type FeatureWalk = {
  groups: StoryGroup[];
};

function classifyFile(name: string): FileKind {
  if (name === "INDEX.md") return "index";
  if (name === "RUNBOOK.md") return "runbook";
  if (name.endsWith(".state.md")) return "state";
  if (name.endsWith(".journal.jsonl")) return "journal";
  if (name === "epic.md") return "epic";
  return "task";
}

/**
 * Walk a feature directory, parse all story-dir names via `parseNodeName`,
 * group stories by major, and classify the files inside each story dir by kind.
 * Groups are returned sorted ascending by major.
 */
export async function walkFeature(dir: string): Promise<FeatureWalk> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      entries = [];
    } else {
      throw err;
    }
  }

  const storyEntries: StoryEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirName = `${entry.name}/`;
    let parsed: ParsedNodeName;
    try {
      parsed = parseNodeName(dirName);
    } catch (err) {
      if (/^\d/.test(entry.name) && err instanceof GrammarError) {
        throw err; // digit-prefix dir that fails grammar is a malformed story dir
      }
      continue; // unrelated dir (no digit prefix) — skip silently
    }

    if (parsed.kind !== "story") continue;

    const storyPath = join(dir, entry.name);
    const fileEntries = await readdir(storyPath, { withFileTypes: true });
    const files: FileEntry[] = [];
    for (const fe of fileEntries) {
      if (!fe.isFile()) continue;
      files.push({ name: fe.name, kind: classifyFile(fe.name) });
    }

    storyEntries.push({ name: entry.name, parsed, files });
  }

  // Group by major
  const groupMap = new Map<number, StoryEntry[]>();
  for (const s of storyEntries) {
    const group = groupMap.get(s.parsed.major) ?? [];
    group.push(s);
    groupMap.set(s.parsed.major, group);
  }

  // Sort groups by major ascending
  const sortedMajors = [...groupMap.keys()].sort((a, b) => a - b);
  const groups: StoryGroup[] = sortedMajors.map((major) => {
    const stories = groupMap.get(major)!;
    const lanes = new Set(
      stories.flatMap((s) =>
        s.parsed.lane !== undefined ? [s.parsed.lane] : [],
      ),
    );
    return { major, parallel: lanes.size >= 2, stories };
  });

  return { groups };
}
