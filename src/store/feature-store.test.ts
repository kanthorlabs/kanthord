import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FeatureStore } from "./feature-store.ts";
import type { FeatureDoc } from "./feature-store.ts";
import { GitStore } from "./git-store.ts";

const execFileAsync = promisify(execFile);

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

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B5 — git store wired behind Epic 003 store seam
//
// FeatureStore backed by a GitStore must produce one git commit per
// writeFeature call so that git history is preserved for all plan writes
// that go through the seam (not just direct GitStore.commit() calls).
// ---------------------------------------------------------------------------

describe("src/store/feature-store — B5 git-store-behind-seam", () => {
  let storeRoot: string;
  let gitStore: GitStore;

  before(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "kanthord-fs-b5-"));
    gitStore = new GitStore(storeRoot);
    await gitStore.open();
  });

  after(async () => {
    await gitStore.close();
    await rm(storeRoot, { recursive: true, force: true });
  });

  // (B5-a) writeFeature on a GitStore-backed FeatureStore produces exactly two
  //        commits when a runbook is present: a plan commit then an operational
  //        RUNBOOK commit (S1 decision: RUNBOOK split into its own operational commit).
  test("writeFeature on a GitStore-backed FeatureStore produces plan then operational commit", async () => {
    const featureDir = join(storeRoot, "feat-b5");
    await mkdir(featureDir, { recursive: true });

    const store = new FeatureStore(featureDir, { gitStore, changeClass: "plan", actor: "b5-agent" });

    const doc: FeatureDoc = {
      epic: {
        frontmatter: { id: "feat-b5", repo: "backend", ticket_system: "jira", ticket: "B5-1" },
        body: "\n## Acceptance\n\nB5 complete.\n",
      },
      stories: [
        {
          story: { id: "001-story-b5", content: "# B5 Story\n" },
          tasks: [
            {
              filename: "001-task-b5.md",
              frontmatter: { id: "task-b5", workflow: "tdd@1", repo: "backend", ticket_system: "jira", ticket: "B5-2" },
              body: "\n## Tests\n\necho ok\n",
            },
          ],
        },
      ],
      runbook: "# Runbook B5\n",
    };

    await store.writeFeature(doc);

    // S1: exactly two commits — plan commit then operational RUNBOOK commit.
    const { stdout } = await execFileAsync("git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot });
    const commits = stdout.trim().split("\n").filter((l) => l.length > 0);
    assert.equal(commits.length, 2, "exactly two git commits after writeFeature with runbook");

    // HEAD (newest) is the operational RUNBOOK commit.
    const { stdout: headBody } = await execFileAsync(
      "git", ["log", "-1", "--format=%B"], { cwd: storeRoot },
    );
    assert.ok(
      headBody.includes("Kanthord-Change-Class: operational"),
      `HEAD commit must carry operational trailer, got: ${headBody}`,
    );
    assert.ok(
      headBody.includes("Kanthord-Actor: b5-agent"),
      `HEAD commit must carry actor trailer, got: ${headBody}`,
    );

    // Older commit (HEAD~1) is the plan commit.
    const { stdout: planBody } = await execFileAsync(
      "git", ["log", "-1", "--format=%B", "HEAD~1"], { cwd: storeRoot },
    );
    assert.ok(
      planBody.includes("Kanthord-Change-Class: plan"),
      `plan commit must carry plan trailer, got: ${planBody}`,
    );
  });

  // (B5-b) Phase-1 seam contract holds: writeFeature+readFeature still
  //        round-trips correctly when FeatureStore is backed by GitStore.
  test("writeFeature+readFeature round-trip still works when backed by GitStore", async () => {
    const featureDir = join(storeRoot, "feat-b5-rt");
    await mkdir(featureDir, { recursive: true });

    const store = new FeatureStore(featureDir, { gitStore, changeClass: "plan", actor: "b5-rt-agent" });

    const doc: FeatureDoc = {
      epic: {
        frontmatter: { id: "feat-b5-rt", repo: "backend", ticket_system: "jira", ticket: "B5-RT-1" },
        body: "\n## Acceptance\n\nRound-trip complete.\n",
      },
      stories: [
        {
          story: { id: "001-story-rt", content: "# RT Story\n" },
          tasks: [
            {
              filename: "001-task-rt.md",
              frontmatter: { id: "task-rt", workflow: "tdd@1", repo: "backend", ticket_system: "jira", ticket: "B5-RT-2" },
              body: "\n## Tests\n\necho rt\n",
            },
          ],
        },
      ],
      runbook: "# Runbook RT\n",
    };

    await store.writeFeature(doc);
    const got = await store.readFeature();

    assert.deepEqual(got.epic.frontmatter, doc.epic.frontmatter, "epic frontmatter round-trips");
    assert.equal(got.epic.body, doc.epic.body, "epic body round-trips");
    assert.equal(got.runbook, doc.runbook, "RUNBOOK round-trips");
    assert.equal(got.stories.length, 1, "one story round-trips");
    const gotStory = got.stories[0];
    assert.ok(gotStory !== undefined, "story[0] defined");
    assert.equal(gotStory.tasks.length, 1, "one task round-trips");
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B2 (3rd review) — writeState/appendJournal must
// ALWAYS commit as `operational`, even when the FeatureStore is constructed
// with changeClass: "plan" (e.g. for writing plan features).
//
// Story 001 AC §24-26: STATE/journal writes are always `operational`; the
// caller-class is only for plan-content writes (writeFeature).
// ---------------------------------------------------------------------------

describe("src/store/feature-store — B2(3rd) operational-class-always-enforced", () => {
  let storeRoot: string;
  let gitStore: GitStore;
  let featureDir: string;

  before(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "kanthord-fs-b2-3rd-"));
    gitStore = new GitStore(storeRoot);
    await gitStore.open();
    featureDir = join(storeRoot, "feat-b2-3rd");
    await mkdir(join(featureDir, "001-story-b2"), { recursive: true });
  });

  after(async () => {
    await gitStore.close();
    await rm(storeRoot, { recursive: true, force: true });
  });

  // (B2-3rd-a) FeatureStore constructed with changeClass:"plan" must still
  //            commit STATE writes as operational — the plan class applies only
  //            to writeFeature, not writeState/appendJournal.
  test("writeState produces operational commit even when store changeClass is 'plan'", async () => {
    const store = new FeatureStore(featureDir, {
      gitStore,
      changeClass: "plan",
      actor: "b2-3rd-agent",
    });

    await store.writeState("001-story-b2", "001-task-b2", "# State forced-plan test\n");

    const { stdout: body } = await execFileAsync("git", ["log", "-1", "--format=%B"], { cwd: storeRoot });
    assert.ok(
      body.includes("Kanthord-Change-Class: operational"),
      `writeState must always commit as 'operational', even when store changeClass="plan"; got: ${body}`,
    );
    assert.ok(
      !body.includes("Kanthord-Change-Class: plan"),
      `writeState must NOT commit as 'plan'; got: ${body}`,
    );
  });

  // (B2-3rd-b) Same enforcement for appendJournal.
  test("appendJournal produces operational commit even when store changeClass is 'plan'", async () => {
    const store = new FeatureStore(featureDir, {
      gitStore,
      changeClass: "plan",
      actor: "b2-3rd-agent",
    });

    await store.appendJournal("001-story-b2", "001-task-b2", { event: "start" });

    const { stdout: body } = await execFileAsync("git", ["log", "-1", "--format=%B"], { cwd: storeRoot });
    assert.ok(
      body.includes("Kanthord-Change-Class: operational"),
      `appendJournal must always commit as 'operational', even when store changeClass="plan"; got: ${body}`,
    );
    assert.ok(
      !body.includes("Kanthord-Change-Class: plan"),
      `appendJournal must NOT commit as 'plan'; got: ${body}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B3 — writeState and appendJournal must produce
// operational-class git commits when backed by a GitStore.
//
// Story 001 AC: STATE (*.state.md), journal (*.journal.jsonl), and RUNBOOK.md
// writes carry class `operational` so plan history stays a clean drift signal
// (PRD §7.1.1 §9 decision 9).
// ---------------------------------------------------------------------------

describe("src/store/feature-store — B3 operational-seam-writes-git-disciplined", () => {
  let storeRoot: string;
  let gitStore: GitStore;
  let featureDir: string;

  before(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "kanthord-fs-b3-"));
    gitStore = new GitStore(storeRoot);
    await gitStore.open();
    featureDir = join(storeRoot, "feat-b3");
    await mkdir(join(featureDir, "001-story-b3"), { recursive: true });
  });

  after(async () => {
    await gitStore.close();
    await rm(storeRoot, { recursive: true, force: true });
  });

  // (B3-a) writeState on a GitStore-backed FeatureStore produces one
  //        operational commit; no plan-class commit appears.
  test("writeState produces one operational-class commit", async () => {
    const store = new FeatureStore(featureDir, { gitStore, changeClass: "operational", actor: "b3-daemon" });

    await store.writeState("001-story-b3", "001-task-b3", "# State v1\n");

    const { stdout } = await execFileAsync("git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot });
    const commits = stdout.trim().split("\n").filter((l) => l.length > 0);
    assert.equal(commits.length, 1, "exactly one commit after writeState");

    const { stdout: body } = await execFileAsync("git", ["log", "-1", "--format=%B"], { cwd: storeRoot });
    assert.ok(
      body.includes("Kanthord-Change-Class: operational"),
      `writeState commit must carry operational trailer, got: ${body}`,
    );
    assert.ok(
      body.includes("Kanthord-Actor: b3-daemon"),
      `writeState commit must carry actor trailer, got: ${body}`,
    );
  });

  // (B3-b) appendJournal on a GitStore-backed FeatureStore produces one
  //        operational commit per append call.
  test("appendJournal produces one operational-class commit", async () => {
    const store = new FeatureStore(featureDir, { gitStore, changeClass: "operational", actor: "b3-daemon" });

    // count commits before
    const { stdout: before } = await execFileAsync("git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot });
    const countBefore = before.trim().split("\n").filter((l) => l.length > 0).length;

    await store.appendJournal("001-story-b3", "001-task-b3", { event: "dispatch", ts: 1 });

    const { stdout: after } = await execFileAsync("git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot });
    const commits = after.trim().split("\n").filter((l) => l.length > 0);
    assert.equal(commits.length, countBefore + 1, "exactly one new commit after appendJournal");

    const { stdout: body } = await execFileAsync("git", ["log", "-1", "--format=%B"], { cwd: storeRoot });
    assert.ok(
      body.includes("Kanthord-Change-Class: operational"),
      `appendJournal commit must carry operational trailer, got: ${body}`,
    );
  });

  // (B3-c) plan history filtered by "plan" never includes STATE or journal commits.
  test("plan history filter excludes operational STATE and journal commits", async () => {
    const store = new FeatureStore(featureDir, { gitStore, changeClass: "operational", actor: "b3-daemon" });
    const stateFile = join(featureDir, "001-story-b3", "001-task-b3.state.md");

    await store.writeState("001-story-b3", "001-task-b3", "# State v2\n");

    const planHistory = await gitStore.history(stateFile, { changeClass: "plan" });
    assert.equal(
      planHistory.length,
      0,
      "state file must have zero plan-class history entries",
    );

    const opHistory = await gitStore.history(stateFile, { changeClass: "operational" });
    assert.ok(opHistory.length >= 1, "state file must have at least one operational-class history entry");
  });
});

// ---------------------------------------------------------------------------
// Suite: Human decision S1 — writeFeature must split RUNBOOK.md into its own
// operational commit, separate from the plan-class write-set commit.
//
// Epic gate §54-56: STATE/journal/RUNBOOK writes follow the PRD §7.1.1 hash
// boundary and their commits carry the `operational` change class so plan
// history filters clean.
//
// Acceptance criteria:
//   (S1-a) After writeFeature(), the plan-class commit does NOT contain
//          RUNBOOK.md in its staged tree.
//   (S1-b) RUNBOOK.md is committed in a separate `operational`-class commit.
//   (S1-c) gitStore.history(runbookPath, { changeClass: "plan" }) returns 0
//          entries.
//   (S1-d) gitStore.history(runbookPath, { changeClass: "operational" }) returns
//          exactly 1 entry.
//   (S1-e) Total commit count after writeFeature is exactly 2 (one plan, one
//          operational).
// ---------------------------------------------------------------------------

describe("src/store/feature-store — S1 writeFeature splits RUNBOOK into separate operational commit", () => {
  let storeRoot: string;
  let gitStore: GitStore;
  let featureDir: string;

  before(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "kanthord-fs-s1-"));
    gitStore = new GitStore(storeRoot);
    await gitStore.open();
    featureDir = join(storeRoot, "feat-s1");
    await mkdir(join(featureDir, "001-story-s1"), { recursive: true });
  });

  after(async () => {
    await gitStore.close();
    await rm(storeRoot, { recursive: true, force: true });
  });

  test("writeFeature produces a plan commit for plan files and a separate operational commit for RUNBOOK.md", async () => {
    const store = new FeatureStore(featureDir, {
      gitStore,
      changeClass: "plan",
      actor: "s1-agent",
    });

    const doc: FeatureDoc = {
      epic: {
        frontmatter: { id: "feat-s1", title: "S1 feature" },
        body: "# S1 epic body\n",
      },
      runbook: "# S1 RUNBOOK\n",
      stories: [
        {
          story: { id: "001-story-s1", content: "# S1 story\n" },
          tasks: [
            {
              frontmatter: {
                id: "001-task-s1",
                title: "S1 task",
                status: "open" as const,
                prerequisites: [] as string[],
                inputs: [] as string[],
                outputs: [] as string[],
              },
              body: "# S1 task body\n",
              filename: "001-task-s1.md",
            },
          ],
        },
      ],
    };

    await store.writeFeature(doc);

    // (S1-e) Exactly 2 commits must have been made.
    const { stdout: allLog } = await execFileAsync("git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot });
    const allCommits = allLog.trim().split("\n").filter((l) => l.length > 0);
    assert.equal(allCommits.length, 2, "writeFeature must produce exactly 2 commits (plan + operational RUNBOOK)");

    // Identify commits by class.
    const { stdout: log1 } = await execFileAsync("git", ["log", "-1", "--format=%B"], { cwd: storeRoot });
    const { stdout: log2 } = await execFileAsync("git", ["log", "-2", "--skip=1", "--format=%B"], { cwd: storeRoot });

    // The operational commit (RUNBOOK) must appear; one commit must be plan, one operational.
    const bothBodies = [log1, log2];
    const planCount = bothBodies.filter((b) => b.includes("Kanthord-Change-Class: plan")).length;
    const opCount = bothBodies.filter((b) => b.includes("Kanthord-Change-Class: operational")).length;
    assert.equal(planCount, 1, "exactly one plan-class commit");
    assert.equal(opCount, 1, "exactly one operational-class commit for RUNBOOK");

    // (S1-a) The plan-class commit must NOT contain RUNBOOK.md.
    // Identify the SHA of the plan commit.
    const planSha = allCommits.find((sha) => {
      return true; // examined below
    });
    // Find which commit is the plan commit:
    const sha0 = allCommits[0];
    const sha1 = allCommits[1];
    assert.ok(sha0 !== undefined && sha1 !== undefined, "both SHAs defined");
    const { stdout: body0 } = await execFileAsync("git", ["log", "-1", "--format=%B", sha0], { cwd: storeRoot });
    const planShaFinal = body0.includes("Kanthord-Change-Class: plan") ? sha0 : sha1;

    const { stdout: planFiles } = await execFileAsync(
      "git", ["diff-tree", "--no-commit-id", "-r", "--name-only", planShaFinal],
      { cwd: storeRoot },
    );
    assert.ok(
      !planFiles.includes("RUNBOOK.md"),
      `RUNBOOK.md must NOT be in the plan commit tree, got: ${planFiles}`,
    );

    // (S1-b/c/d) RUNBOOK.md history via gitStore.history.
    const runbookPath = join(featureDir, "RUNBOOK.md");
    const runbookPlanHistory = await gitStore.history(runbookPath, { changeClass: "plan" });
    assert.equal(
      runbookPlanHistory.length,
      0,
      "RUNBOOK.md must have zero plan-class history entries",
    );
    const runbookOpHistory = await gitStore.history(runbookPath, { changeClass: "operational" });
    assert.equal(
      runbookOpHistory.length,
      1,
      "RUNBOOK.md must have exactly one operational-class history entry",
    );
    assert.equal(runbookOpHistory[0]?.actor, "s1-agent", "RUNBOOK operational commit must carry the actor");
  });
});

// ---------------------------------------------------------------------------
// B1 blocker — runbook-only writeFeature must succeed with exactly one
// operational commit and no plan commit.
//
// When writeFeature is called a second time with unchanged plan files (epic.md,
// story INDEX.md, task files) but a changed RUNBOOK.md, the plan commit writeFn
// stages nothing new; the empty `git commit` must NOT be attempted.  Only the
// RUNBOOK operational commit must be produced.
// ---------------------------------------------------------------------------

describe("src/store/feature-store — B1 runbook-only writeFeature succeeds with one operational commit", () => {
  let storeRoot: string;
  let gitStore: GitStore;
  let featureDir: string;

  before(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "kanthord-fs-b1-runbook-"));
    gitStore = new GitStore(storeRoot);
    await gitStore.open();
    featureDir = join(storeRoot, "feat-b1-runbook");
    await mkdir(join(featureDir, "001-story-b1"), { recursive: true });
  });

  after(async () => {
    await gitStore.close();
    await rm(storeRoot, { recursive: true, force: true });
  });

  test("runbook-only writeFeature succeeds with exactly one operational commit and no plan commit", async () => {
    const store = new FeatureStore(featureDir, {
      gitStore,
      changeClass: "plan",
      actor: "b1-runbook-agent",
    });

    const baseDoc: FeatureDoc = {
      epic: {
        frontmatter: { id: "feat-b1-runbook", title: "B1 runbook feature" },
        body: "# B1 epic body\n",
      },
      runbook: "# B1 RUNBOOK v1\n",
      stories: [
        {
          story: { id: "001-story-b1", content: "# B1 story\n" },
          tasks: [
            {
              frontmatter: {
                id: "001-task-b1",
                title: "B1 task",
                status: "open" as const,
                prerequisites: [] as string[],
                inputs: [] as string[],
                outputs: [] as string[],
              },
              body: "# B1 task body\n",
              filename: "001-task-b1.md",
            },
          ],
        },
      ],
    };

    // First writeFeature: creates 2 commits (plan + RUNBOOK operational).
    await store.writeFeature(baseDoc);

    const { stdout: afterFirst } = await execFileAsync(
      "git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot },
    );
    const firstCommitCount = afterFirst.trim().split("\n").filter((l) => l.length > 0).length;
    assert.equal(firstCommitCount, 2, "first writeFeature must produce 2 commits (plan + operational)");

    // Second writeFeature: plan files unchanged, RUNBOOK updated.
    // The empty plan commit must NOT be attempted; only one operational commit added.
    const runbookOnlyDoc: FeatureDoc = {
      ...baseDoc,
      runbook: "# B1 RUNBOOK v2 — updated content\n",
    };

    // This must not throw even though plan files are unchanged (no new staged changes).
    await assert.doesNotReject(
      store.writeFeature(runbookOnlyDoc),
      "runbook-only writeFeature must not throw an error from an empty plan commit",
    );

    // Exactly one new commit must exist after the second writeFeature (the operational RUNBOOK commit).
    const { stdout: afterSecond } = await execFileAsync(
      "git", ["log", "--format=%H", "HEAD"], { cwd: storeRoot },
    );
    const secondCommitCount = afterSecond.trim().split("\n").filter((l) => l.length > 0).length;
    assert.equal(
      secondCommitCount,
      3,
      "second (runbook-only) writeFeature must produce exactly 1 new commit (total 3); no empty plan commit",
    );

    // The newest commit must be the operational RUNBOOK commit.
    const { stdout: newestBody } = await execFileAsync(
      "git", ["log", "-1", "--format=%B"], { cwd: storeRoot },
    );
    assert.ok(
      newestBody.includes("Kanthord-Change-Class: operational"),
      `newest commit must be operational, got: ${newestBody}`,
    );
    assert.ok(
      !newestBody.includes("Kanthord-Change-Class: plan"),
      "newest commit must not be plan-class",
    );
  });
});
