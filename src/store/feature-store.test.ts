import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeatureStore } from "./feature-store.ts";
import type { FeatureDoc } from "./feature-store.ts";

// Helper: recursively collect all file paths (relative to root) → content.
async function snapshotDir(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const sub = await snapshotDir(full);
      for (const [k, v] of sub) {
        result.set(join(entry.name, k), v);
      }
    } else if (entry.isFile()) {
      result.set(entry.name, await readFile(full, "utf8"));
    }
  }
  return result;
}

// Suite: src/store/feature-store
// Story 001 — Feature-Directory Store, Task T1: write + read the feature triple and RUNBOOK.
// Tests the public round-trip contract of FeatureStore (writeFeature → readFeature)
// over a temp dir, asserting epic frontmatter + body, story INDEX.md content,
// task frontmatter + body, and RUNBOOK.md content all survive the round-trip.

describe("src/store/feature-store", () => {
  describe("writeFeature + readFeature — round-trip the triple and RUNBOOK", () => {
    let dir = "";
    let store: FeatureStore;

    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "kanthord-fs-t1-"));
      store = new FeatureStore(dir);
    });

    after(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    test("round-trips epic frontmatter, body, story INDEX content, task frontmatter+body, and RUNBOOK", async () => {
      const doc: FeatureDoc = {
        epic: {
          frontmatter: {
            id: "feat-rt",
            repo: "backend",
            ticket_system: "jira",
            ticket: "RT-100",
          },
          body: "\n## Acceptance\n\nFeature is complete.\n",
        },
        stories: [
          {
            story: {
              id: "001-story-a",
              content: "# Story A\n\nInitial content.\n",
            },
            tasks: [
              {
                filename: "001-task-alpha.md",
                frontmatter: {
                  id: "task-alpha",
                  workflow: "tdd@1",
                  repo: "backend",
                  ticket_system: "jira",
                  ticket: "RT-101",
                },
                body: "\n## Tests\n\nUnit tests for alpha.\n",
              },
            ],
          },
        ],
        runbook: "# Runbook\n\nInitial runbook content.\n",
      };

      await store.writeFeature(doc);
      const got = await store.readFeature();

      // Epic round-trip
      assert.deepEqual(
        got.epic.frontmatter,
        doc.epic.frontmatter,
        "epic frontmatter round-trips",
      );
      assert.equal(got.epic.body, doc.epic.body, "epic body round-trips");

      // RUNBOOK round-trip
      assert.equal(got.runbook, doc.runbook, "RUNBOOK.md content round-trips");

      // Story round-trip
      assert.equal(got.stories.length, 1, "one story in result");
      const gotStory = got.stories[0];
      assert.ok(gotStory !== undefined, "story[0] is defined");
      assert.equal(gotStory.story.id, "001-story-a", "story id preserved");
      assert.equal(
        gotStory.story.content,
        "# Story A\n\nInitial content.\n",
        "story INDEX.md content round-trips",
      );

      // Task round-trip
      assert.equal(gotStory.tasks.length, 1, "one task in result");
      const gotTask = gotStory.tasks[0];
      assert.ok(gotTask !== undefined, "task[0] is defined");
      const srcTask = doc.stories[0]?.tasks[0];
      assert.ok(srcTask !== undefined, "source task[0] is defined");
      assert.deepEqual(
        gotTask.frontmatter,
        srcTask.frontmatter,
        "task frontmatter round-trips",
      );
      assert.equal(gotTask.body, srcTask.body, "task body round-trips");
    });
  });

  // Story 001 — Task T2: STATE rewrite vs JOURNAL append disciplines.
  // Tests writeState (bounded rewrite) and appendJournal (append-only via Epic 001 jsonl seam).
  describe("writeState + appendJournal — STATE rewrite vs JOURNAL append disciplines", () => {
    let dir2 = "";
    let store2: FeatureStore;

    before(async () => {
      dir2 = await mkdtemp(join(tmpdir(), "kanthord-fs-t2-"));
      store2 = new FeatureStore(dir2);
      // story directory must exist before writeState / appendJournal can run
      await mkdir(join(dir2, "001-story-a"), { recursive: true });
    });

    after(async () => {
      if (dir2) await rm(dir2, { recursive: true, force: true });
    });

    test("writeState rewrites: second write fully replaces first content", async () => {
      await store2.writeState(
        "001-story-a",
        "001-task-alpha",
        "# State v1\n\nFirst state.\n",
      );
      await store2.writeState(
        "001-story-a",
        "001-task-alpha",
        "# State v2\n\nSecond state.\n",
      );
      const content = await readFile(
        join(dir2, "001-story-a", "001-task-alpha.state.md"),
        "utf8",
      );
      assert.equal(
        content,
        "# State v2\n\nSecond state.\n",
        "second writeState fully replaces first",
      );
    });

    test("appendJournal: two events appear in order with no overwrite", async () => {
      const event1 = { type: "started", ts: 1 };
      const event2 = { type: "completed", ts: 2 };
      await store2.appendJournal("001-story-a", "001-task-alpha", event1);
      await store2.appendJournal("001-story-a", "001-task-alpha", event2);
      const text = await readFile(
        join(dir2, "001-story-a", "001-task-alpha.journal.jsonl"),
        "utf8",
      );
      const lines = text.split("\n").filter((l) => l.length > 0);
      assert.equal(lines.length, 2, "two journal lines present");
      assert.deepEqual(
        JSON.parse(lines[0]!),
        event1,
        "first event preserved",
      );
      assert.deepEqual(
        JSON.parse(lines[1]!),
        event2,
        "second event preserved",
      );
    });

    test("writeState isolation: only the target *.state.md changed", async () => {
      // establish a two-task baseline so siblings can be checked
      await store2.writeState(
        "001-story-a",
        "001-task-alpha",
        "# Alpha baseline\n",
      );
      await store2.writeState(
        "001-story-a",
        "001-task-beta",
        "# Beta baseline\n",
      );

      const before = await snapshotDir(dir2);

      // update only alpha — beta and the journal must stay untouched
      await store2.writeState(
        "001-story-a",
        "001-task-alpha",
        "# Alpha updated\n",
      );

      const after = await snapshotDir(dir2);

      const targetKey = join("001-story-a", "001-task-alpha.state.md");
      const changed: string[] = [];
      for (const [k, afterVal] of after) {
        if (before.get(k) !== afterVal) changed.push(k);
      }
      for (const k of before.keys()) {
        if (!after.has(k)) changed.push(k);
      }

      assert.deepEqual(
        changed.sort(),
        [targetKey],
        "only the target *.state.md file changed",
      );
    });
  });

  // Story 001 — S2 regression: readFeature must not expose *.state.md as tasks
  describe("readFeature — *.state.md exclusion regression (S2)", () => {
    let dir3 = "";
    let store3: FeatureStore;

    before(async () => {
      dir3 = await mkdtemp(join(tmpdir(), "kanthord-fs-s2-"));
      store3 = new FeatureStore(dir3);
    });

    after(async () => {
      if (dir3) await rm(dir3, { recursive: true, force: true });
    });

    test("readFeature: task list does not contain *.state.md files written by writeState", async () => {
      const doc: FeatureDoc = {
        epic: {
          frontmatter: { id: "feat-s2", repo: "backend" },
          body: "\n## Acceptance\n\nDone.\n",
        },
        stories: [
          {
            story: { id: "001-story-a", content: "# Story A\n" },
            tasks: [
              {
                filename: "001-task-alpha.md",
                frontmatter: { id: "task-alpha", workflow: "tdd@1" },
                body: "\n## Tests\n\nTests.\n",
              },
            ],
          },
        ],
        runbook: "# Runbook\n",
      };

      await store3.writeFeature(doc);
      // Write state — this *.state.md must NOT appear in readFeature's task list
      await store3.writeState("001-story-a", "001-task-alpha", "# state v1\n");

      const got = await store3.readFeature();
      const story = got.stories[0];
      assert.ok(story !== undefined, "story[0] exists");
      const hasStateMd = story.tasks.some((t) => t.filename.endsWith(".state.md"));
      assert.equal(
        hasStateMd,
        false,
        "*.state.md must not appear in the task list returned by readFeature",
      );
    });
  });
});
