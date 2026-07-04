import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parsePlanFile,
  serializeFrontmatter,
} from "../foundations/plan-file.ts";
import { JsonlLog } from "../foundations/jsonl.ts";

/**
 * A compiled feature directory as an in-memory document.
 *
 * - `epic` — the `epic.md` plan file (frontmatter + body).
 * - `stories` — each story subdirectory: its `INDEX.md` content and task files.
 * - `runbook` — the `RUNBOOK.md` file content (PRD §7.1.1 §6).
 */
export interface FeatureDoc {
  epic: {
    frontmatter: Record<string, unknown>;
    body: string;
  };
  stories: Array<{
    story: { id: string; content: string };
    tasks: Array<{
      filename: string;
      frontmatter: Record<string, unknown>;
      body: string;
    }>;
  }>;
  runbook: string;
}

/**
 * Single-writer store over a feature directory (PRD §6.1 single-writer
 * invariant).  Frontmatter read/write uses the Epic 001 plan-file seam —
 * no second parser.
 */
export class FeatureStore {
  private readonly featureDir: string;

  constructor(featureDir: string) {
    this.featureDir = featureDir;
  }

  /**
   * Write all parts of `doc` to disk under `featureDir`.
   *
   * - `epic.md` — serialised as a frontmatter plan file.
   * - `RUNBOOK.md` — written verbatim.
   * - `<story-id>/INDEX.md` — written verbatim; the directory is created if absent.
   * - `<story-id>/<task.filename>` — serialised as a frontmatter plan file.
   */
  async writeFeature(doc: FeatureDoc): Promise<void> {
    // epic.md
    const epicContent =
      serializeFrontmatter(doc.epic.frontmatter) + doc.epic.body;
    await writeFile(join(this.featureDir, "epic.md"), epicContent, "utf8");

    // RUNBOOK.md
    await writeFile(
      join(this.featureDir, "RUNBOOK.md"),
      doc.runbook,
      "utf8",
    );

    // story subdirectories
    for (const storyEntry of doc.stories) {
      const storyDir = join(this.featureDir, storyEntry.story.id);
      await mkdir(storyDir, { recursive: true });

      // INDEX.md — plain content (PRD §6.2 story triple)
      await writeFile(
        join(storyDir, "INDEX.md"),
        storyEntry.story.content,
        "utf8",
      );

      // task files — plan-file format
      for (const task of storyEntry.tasks) {
        const taskContent =
          serializeFrontmatter(task.frontmatter) + task.body;
        await writeFile(join(storyDir, task.filename), taskContent, "utf8");
      }
    }
  }

  /**
   * Read the full feature directory back into a `FeatureDoc`.
   *
   * Story subdirectories are returned sorted by name.  Within each story,
   * task files (all `*.md` except `INDEX.md`) are sorted by filename.
   */
  async readFeature(): Promise<FeatureDoc> {
    // epic.md
    const epicText = await readFile(
      join(this.featureDir, "epic.md"),
      "utf8",
    );
    const epicParsed = parsePlanFile("epic.md", epicText);
    const epic = {
      frontmatter: epicParsed.frontmatter as Record<string, unknown>,
      body: epicParsed.body,
    };

    // RUNBOOK.md
    const runbook = await readFile(
      join(this.featureDir, "RUNBOOK.md"),
      "utf8",
    );

    // story subdirectories — every directory entry is a story
    const topEntries = await readdir(this.featureDir, { withFileTypes: true });
    const storyIds = topEntries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    const stories: FeatureDoc["stories"] = [];

    for (const storyId of storyIds) {
      const storyDir = join(this.featureDir, storyId);

      const indexContent = await readFile(
        join(storyDir, "INDEX.md"),
        "utf8",
      );

      // task files: all *.md in the story dir except INDEX.md
      const storyEntries = await readdir(storyDir, { withFileTypes: true });
      const taskFilenames = storyEntries
        .filter(
          (e) =>
            e.isFile() &&
            e.name.endsWith(".md") &&
            e.name !== "INDEX.md" &&
            !e.name.endsWith(".state.md"),
        )
        .map((e) => e.name)
        .sort();

      const tasks: FeatureDoc["stories"][number]["tasks"] = [];

      for (const filename of taskFilenames) {
        const taskText = await readFile(join(storyDir, filename), "utf8");
        const taskParsed = parsePlanFile(filename, taskText);
        tasks.push({
          filename,
          frontmatter: taskParsed.frontmatter as Record<string, unknown>,
          body: taskParsed.body,
        });
      }

      stories.push({
        story: { id: storyId, content: indexContent },
        tasks,
      });
    }

    return { epic, stories, runbook };
  }

  /**
   * Fully rewrite the task's `*.state.md` (bounded single-current-state;
   * PRD §6.2 STATE rewrite discipline).
   *
   * The file is created if absent and fully overwritten on every call.
   */
  async writeState(
    storyId: string,
    taskStem: string,
    content: string,
  ): Promise<void> {
    const path = join(this.featureDir, storyId, `${taskStem}.state.md`);
    await writeFile(path, content, "utf8");
  }

  /**
   * Append one journal event to the task's `*.journal.jsonl` (append-only;
   * PRD §6.2 JOURNAL append-only discipline). Uses the Epic 001 jsonl seam.
   */
  async appendJournal(
    storyId: string,
    taskStem: string,
    event: unknown,
  ): Promise<void> {
    const path = join(this.featureDir, storyId, `${taskStem}.journal.jsonl`);
    const log = new JsonlLog(path);
    await log.append(event);
  }
}
