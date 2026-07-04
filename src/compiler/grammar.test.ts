import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseNodeName, GrammarError, walkFeature } from "./grammar.ts";

describe("src/compiler/grammar", () => {
  describe("parseNodeName — valid names", () => {
    test("task file without lane: 002-backend-impl.md → major=2, no lane, slug=backend-impl, kind=task", () => {
      const result = parseNodeName("002-backend-impl.md");
      assert.equal(result.major, 2);
      assert.equal(result.lane, undefined);
      assert.equal(result.slug, "backend-impl");
      assert.equal(result.kind, "task");
    });

    test("story dir with lane: 02.1-clients-mobile/ → major=2, lane=1, slug=clients-mobile, kind=story", () => {
      const result = parseNodeName("02.1-clients-mobile/");
      assert.equal(result.major, 2);
      assert.equal(result.lane, 1);
      assert.equal(result.slug, "clients-mobile");
      assert.equal(result.kind, "story");
    });
  });

  describe("parseNodeName — malformed names throw GrammarError naming the filename", () => {
    test("missing major prefix: backend.md → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName("backend.md"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes("backend.md"),
            `expected message to name "backend.md", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });

    test("non-numeric major: ab-backend.md → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName("ab-backend.md"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes("ab-backend.md"),
            `expected message to name "ab-backend.md", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });

    test("empty slug: 01-.md → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName("01-.md"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes("01-.md"),
            `expected message to name "01-.md", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });

    test("non-numeric lane: 02.x-foo.md → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName("02.x-foo.md"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes("02.x-foo.md"),
            `expected message to name "02.x-foo.md", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });

    test("lane without major: .1-foo.md → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName(".1-foo.md"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes(".1-foo.md"),
            `expected message to name ".1-foo.md", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });

    test("wrong extension for task file: 002-backend.txt → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName("002-backend.txt"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes("002-backend.txt"),
            `expected message to name "002-backend.txt", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });

    test("malformed story-dir name: abc-story/ → GrammarError message includes filename", () => {
      assert.throws(
        () => parseNodeName("abc-story/"),
        (err: unknown) => {
          assert.ok(err instanceof GrammarError, "expected GrammarError");
          assert.ok(
            (err as GrammarError).message.includes("abc-story/"),
            `expected message to name "abc-story/", got: ${(err as GrammarError).message}`,
          );
          return true;
        },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// B8 — walkFeature digit-prefix heuristic regression tests
// ---------------------------------------------------------------------------

describe("walkFeature — malformed story-dir heuristic (B8)", () => {
  test(
    "dir starting with digit but failing story grammar → walkFeature throws GrammarError naming the dir",
    async () => {
      // "1bad" starts with digit '1' but has no '-' separator → fails STORY_PATTERN
      const dir = await mkdtemp(join(tmpdir(), "kanthord-grammar-b8a-"));
      await writeFile(join(dir, "epic.md"), "");
      await mkdir(join(dir, "1bad"));
      try {
        await assert.rejects(
          async () => walkFeature(dir),
          (err: unknown) => {
            assert.ok(err instanceof GrammarError, "expected GrammarError");
            assert.ok(
              (err as GrammarError).message.includes("1bad"),
              `expected message to name "1bad", got: ${(err as GrammarError).message}`,
            );
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    },
  );

  test(
    "dir NOT starting with digit (e.g. docs/) is silently skipped by walkFeature (characterization — already shipped)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kanthord-grammar-b8b-"));
      await writeFile(join(dir, "epic.md"), "");
      await mkdir(join(dir, "docs"));
      try {
        // docs/ does not start with a digit → silently skipped; no groups
        const walk = await walkFeature(dir);
        assert.equal(walk.groups.length, 0, "docs/ is silently skipped — no story groups");
      } finally {
        await rm(dir, { recursive: true });
      }
    },
  );
});

describe("walkFeature — feature dir walk", () => {
  let tmpDir = "";

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-grammar-t2-"));

    // Root-level feature files
    await writeFile(join(tmpDir, "epic.md"), "");
    await writeFile(join(tmpDir, "INDEX.md"), "");

    // Story group major=1, two lanes (.1 and .2) → parallel-intended
    const alpha = join(tmpDir, "001.1-story-alpha");
    await mkdir(alpha);
    await writeFile(join(alpha, "INDEX.md"), "");
    await writeFile(join(alpha, "001-task-one.md"), "");
    await writeFile(join(alpha, "001-task-one.state.md"), ""); // state file
    await writeFile(join(alpha, "RUNBOOK.md"), ""); // runbook

    const beta = join(tmpDir, "001.2-story-beta");
    await mkdir(beta);
    await writeFile(join(beta, "INDEX.md"), "");
    await writeFile(join(beta, "001-task-two.md"), "");
    await writeFile(join(beta, "001-task-two.journal.jsonl"), ""); // journal

    // Story group major=3 (gap from 1→3 is legal), no lane → not parallel
    const gamma = join(tmpDir, "003-story-gamma");
    await mkdir(gamma);
    await writeFile(join(gamma, "INDEX.md"), "");
    await writeFile(join(gamma, "001-task-three.md"), "");
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  test(
    "walkFeature: story groups in major order, lane pair flagged parallel-intended, state/journal/runbook/index files classified by kind",
    async () => {
      const walk = await walkFeature(tmpDir);

      // Two groups: major=1 (two lanes) and major=3 (gap from 1 is legal)
      assert.equal(walk.groups.length, 2);

      const g1 = walk.groups[0]!;
      assert.equal(g1.major, 1);
      assert.equal(g1.parallel, true); // lanes .1 and .2 → parallel-intended
      assert.equal(g1.stories.length, 2);

      const g3 = walk.groups[1]!;
      assert.equal(g3.major, 3);
      assert.equal(g3.parallel, false); // single story, no lane
      assert.equal(g3.stories.length, 1);

      // File kind classification inside story alpha (lane=1)
      const alphaStory = g1.stories.find((s) => s.parsed.lane === 1);
      assert.ok(alphaStory, "expected story with lane=1 in group major=1");
      const alphaKind = new Map(alphaStory.files.map((f) => [f.name, f.kind]));
      assert.equal(alphaKind.get("INDEX.md"), "index");
      assert.equal(alphaKind.get("001-task-one.md"), "task");
      assert.equal(alphaKind.get("001-task-one.state.md"), "state");
      assert.equal(alphaKind.get("RUNBOOK.md"), "runbook");

      // File kind classification inside story beta (lane=2)
      const betaStory = g1.stories.find((s) => s.parsed.lane === 2);
      assert.ok(betaStory, "expected story with lane=2 in group major=1");
      const betaKind = new Map(betaStory.files.map((f) => [f.name, f.kind]));
      assert.equal(betaKind.get("INDEX.md"), "index");
      assert.equal(betaKind.get("001-task-two.md"), "task");
      assert.equal(betaKind.get("001-task-two.journal.jsonl"), "journal");
    },
  );
});
