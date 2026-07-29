// src/commit-presence/git.test.ts — regression tests for the BATCHED
// `hasCommits(homeDir, oids)` contract (EPIC 017 review blockers
// S3-batch-a/b/c). Hermetic: creates its own real git repo in a tmpdir, no
// network. Pins:
//   - same-length, same-ORDER results — never a Set keyed on the request
//     strings (`git cat-file --batch-check` echoes the RESOLVED full OID
//     for a found object, not the input spelling);
//   - the abbreviated-OID trap: a present commit passed as a 7-8 char
//     abbreviation must resolve `true`;
//   - an empty `oids` array performs NO spawn at all;
//   - a homeDir that was never cloned reports every oid absent;
//   - a directory that exists but is not a repository THROWS;
//   - an unresolvable `git` executable THROWS (never reported as absence).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { GitCommitPresence } from "./git.ts";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

describe("GitCommitPresence — batched hasCommits(homeDir, oids)", () => {
  let tmpRoot: string;
  let repoDir: string;
  let oidA: string;
  let oidB: string;
  const ABSENT_OID = "d".repeat(40);

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-017-batch-"));
    repoDir = join(tmpRoot, "repo");
    await mkdir(repoDir, { recursive: true });
    await execFile("git", ["init", "-q", "-b", "main"], { cwd: repoDir });

    await writeFile(join(repoDir, "a.txt"), "a\n");
    await git(repoDir, "add", "-A");
    await git(
      repoDir,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-m",
      "first",
    );
    oidA = await git(repoDir, "rev-parse", "HEAD");

    await writeFile(join(repoDir, "b.txt"), "b\n");
    await git(repoDir, "add", "-A");
    await git(
      repoDir,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-m",
      "second",
    );
    oidB = await git(repoDir, "rev-parse", "HEAD");
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("(017-S3-batch-a order) one boolean per input, in input order, including duplicates and a present/absent mix", async () => {
    const presence = new GitCommitPresence();
    const oids = [oidA, ABSENT_OID, oidA, oidB, ABSENT_OID];
    const result = await presence.hasCommits(repoDir, oids);
    assert.deepEqual(
      result,
      [true, false, true, true, false],
      "hasCommits must return one boolean per input, positionally aligned — never a Set keyed on request strings",
    );
  });

  test("(017-S3-batch-a abbrev) a present commit passed as a 7-8 char abbreviation resolves true, not merely as a literal-string match", async () => {
    const presence = new GitCommitPresence();
    const abbrev = oidA.slice(0, 8);
    const result = await presence.hasCommits(repoDir, [abbrev]);
    assert.deepEqual(
      result,
      [true],
      "`git cat-file --batch-check` echoes the RESOLVED full OID for an abbreviation, not the input spelling; a Set keyed on the request string would wrongly report this as absent",
    );
  });

  test("(017-S3-batch-c empty) an empty oids array performs no spawn at all", async () => {
    const presence = new GitCommitPresence();
    // cwd is a FILE, not a directory: any spawned git process using it as
    // cwd would fail. No throw here is the proof that an empty request
    // never reaches the spawn.
    const fileAsHomeDir = join(tmpRoot, "not-a-directory.txt");
    await writeFile(fileAsHomeDir, "x");
    const result = await presence.hasCommits(fileAsHomeDir, []);
    assert.deepEqual(result, []);
  });

  test("(017-S3-batch-c missing-home) a homeDir that has never been cloned reports every oid absent", async () => {
    const presence = new GitCommitPresence();
    const neverCloned = join(tmpRoot, "does-not-exist");
    const result = await presence.hasCommits(neverCloned, [oidA, oidB]);
    assert.deepEqual(result, [false, false]);
  });

  test("(017-S3-batch-c not-a-repository) an existing directory that is not a git repository throws", async () => {
    const presence = new GitCommitPresence();
    const notARepo = join(tmpRoot, "plain-dir");
    await mkdir(notARepo, { recursive: true });
    // Review R3-S4 — isolate from ancestor discovery: without a ceiling, git
    // walks UP from `notARepo` looking for a `.git`, so this case would
    // silently stop testing "not a repository" if any ancestor of $TMPDIR
    // happened to be a git working tree. GIT_CEILING_DIRECTORIES tells git to
    // stop searching upward at `notARepo` itself.
    const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = notARepo;
    try {
      await assert.rejects(() => presence.hasCommits(notARepo, [oidA]));
    } finally {
      if (savedCeiling === undefined)
        delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
    }
  });

  test("(017-S3-batch-c git-not-installed) an unresolvable git executable throws rather than reporting absence", async () => {
    const presence = new GitCommitPresence();
    const savedPath = process.env.PATH;
    try {
      // A real, existing directory with no executables in it — forces the
      // spawn to fail to resolve `git`, unlike an empty/unset PATH which can
      // fall back to a platform default search path.
      process.env.PATH = tmpRoot;
      await assert.rejects(() => presence.hasCommits(repoDir, [oidA]));
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

// ---------------------------------------------------------------------------
// Review blocker R3-S1/S2/S5 — three independent hardening regressions on the
// spawn-based adapter.
// ---------------------------------------------------------------------------

describe("GitCommitPresence — review blocker R3-S1 (read-side stream errors)", () => {
  test('(017-R3-S1) attaches an "error" listener to child.stdout and child.stderr so a read-side stream error settles the promise, instead of hanging or being silently swallowed', () => {
    // A real spawned pipe stream almost never emits "error" in normal use, so
    // this pins the source shape directly (same technique as the
    // 017-S6-shared-handler-result regression) rather than trying to force a
    // flaky OS-level pipe fault through a real child process.
    const src = readFileSync(
      fileURLToPath(new URL("./git.ts", import.meta.url)),
      "utf8",
    );
    // Review R4-S1 — a bare `.on("error", ...)` match would still pass if the
    // handler body swallowed the error instead of routing it to the reject
    // path. Require `settleReject` to appear inside the handler body itself.
    assert.match(
      src,
      /child\.stdout\.on\(\s*["']error["'],\s*\([^)]*\)\s*=>\s*\{[^}]*settleReject\([^}]*\}/,
      'child.stdout\'s "error" listener must call settleReject inside its handler body, not just attach a listener',
    );
    assert.match(
      src,
      /child\.stderr\.on\(\s*["']error["'],\s*\([^)]*\)\s*=>\s*\{[^}]*settleReject\([^}]*\}/,
      'child.stderr\'s "error" listener must call settleReject inside its handler body, not just attach a listener',
    );
  });
});

describe("GitCommitPresence — review blocker R3-S2 (spawn timeout)", () => {
  let wedgeDir: string;

  before(async () => {
    // A fake `git` on PATH that never answers `cat-file --batch-check` (never
    // reads stdin, never closes) but self-terminates after 2 real seconds so
    // the suite is bounded even if the timeout is never wired up.
    wedgeDir = await mkdtemp(join(tmpdir(), "kanthord-017-wedge-"));
    const fakeGit = join(wedgeDir, "git");
    await writeFile(fakeGit, "#!/bin/sh\nsleep 2\nexit 1\n");
    await chmod(fakeGit, 0o755);
  });

  after(async () => {
    await rm(wedgeDir, { recursive: true, force: true });
  });

  test("(017-R3-S2) a wedged git process rejects on a timeout naming the homeDir, instead of hanging the caller forever", async (t) => {
    // Must exist (existsSync gate) so `hasCommits` actually reaches the spawn
    // rather than short-circuiting to "absent" for a never-cloned home.
    const homeDir = await mkdtemp(join(tmpdir(), "kanthord-017-wedge-home-"));
    const savedPath = process.env.PATH;
    // Prepend so "git" resolves to the fake wedge script, but the script's
    // own `sleep`/`exit` still resolve via the real PATH.
    process.env.PATH = `${wedgeDir}:${savedPath ?? ""}`;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const presence = new GitCommitPresence();
      const started = Date.now();
      const pending = presence.hasCommits(homeDir, ["a".repeat(40)]);
      // Advance virtual time comfortably past any sane bound the
      // implementation picks — real time is untouched, so this only fires an
      // already-registered `setTimeout`, it never waits on the wedged
      // process's real 2-second sleep.
      t.mock.timers.tick(10 * 60 * 1000);
      await assert.rejects(
        () => pending,
        (err: unknown) => {
          assert.ok(err instanceof Error, "expected an Error rejection");
          assert.match(
            (err as Error).message,
            new RegExp(escapeRegex(homeDir)),
            `timeout rejection must name the homeDir; got: ${(err as Error).message}`,
          );
          assert.match(
            (err as Error).message,
            /timeout/i,
            `timeout rejection must say it is a timeout; got: ${(err as Error).message}`,
          );
          return true;
        },
      );
      assert.ok(
        Date.now() - started < 1000,
        "the rejection must be driven by the (virtual) timeout, not by waiting on the wedged process's real close event",
      );
    } finally {
      process.env.PATH = savedPath;
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});

describe("GitCommitPresence — review blocker R3-S5 (oid framing)", () => {
  test("(017-R3-S5 newline) an oid containing a newline is refused explicitly, never silently written into cat-file --batch-check's positional stdin", async () => {
    const presence = new GitCommitPresence();
    const notARepoIsFine = tmpdir();
    await assert.rejects(
      () =>
        presence.hasCommits(notARepoIsFine, ["a".repeat(40), "abc123\n456def"]),
      /oid/i,
      "an oid containing a newline must reject with an explicit error naming the oid, not desync the positional read",
    );
  });

  test("(017-R3-S5 carriage-return) an oid containing a carriage return is refused explicitly", async () => {
    const presence = new GitCommitPresence();
    await assert.rejects(
      () => presence.hasCommits(tmpdir(), ["abc123\rdef456"]),
      /oid/i,
      "an oid containing a carriage return must reject with an explicit error, not a silent skip",
    );
  });
});
