/**
 * src/store/git-store.ts
 *
 * Story 012-001 — git-backed store: init/open repo + commit-per-write.
 *
 * A GitStore wraps a directory on disk as a git repository. Every logical
 * write-set (one call to `commit`) lands as exactly one git commit with
 * structured trailers (Kanthord-Change-Class, Kanthord-Actor). Lock files
 * and temp files are excluded via a managed .gitignore.
 */

import { access, appendFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { log, errMessage } from "../foundations/log.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WriterLock } from "./writer-lock.ts";

const execFileAsync = promisify(execFile);

/** Daemon identity used as git author/committer on every commit. */
const DAEMON_AUTHOR_NAME = "kanthord";
const DAEMON_AUTHOR_EMAIL = "kanthord@localhost";

/** Patterns that must never appear in any committed tree. */
const IGNORE_PATTERNS = [
  ".kanthord-writer-lock",
  "*.lock",
  "*.tmp",
];

/**
 * GitStore — a git-disciplined store root.
 *
 * Constructor accepts the `storeRoot` directory path.  Call `open()` before
 * any other method and `close()` when done (currently a no-op, kept for
 * symmetry with the store seam).
 */
export class GitStore {
  private storeRoot: string;
  private readOnly: boolean;
  private writerLock: WriterLock;
  private lockToken: string | null = null;

  constructor(storeRoot: string, opts?: { readOnly?: boolean }) {
    this.storeRoot = storeRoot;
    this.readOnly = opts?.readOnly ?? false;
    this.writerLock = new WriterLock(storeRoot, { readOnly: this.readOnly });
  }

  /** Absolute path of the git working tree root (the store root directory). */
  get dir(): string {
    return this.storeRoot;
  }

  /**
   * Open the store: initialise a git repo if none exists, or reuse the
   * existing repo.  Sets up the managed `.gitignore` (lock + temp patterns).
   *
   * When `readOnly` is true, both `ensureGitRepo()` and `ensureGitignore()`
   * are skipped — a read-only open must never write to the store root.
   */
  async open(): Promise<void> {
    this.lockToken = await this.writerLock.acquire();
    if (this.readOnly) {
      // Read-only open: no repo init or gitignore setup — no mutations.
      return;
    }
    try {
      await this.ensureGitRepo();
      await this.ensureGitignore();
    } catch (err) {
      await this.writerLock.release(this.lockToken);
      this.lockToken = null;
      throw err;
    }
  }

  /**
   * Execute `writeFn()` and produce one git commit for all changes under
   * `featureDir`.  The commit message is a one-liner summary followed by
   * structured trailers so downstream tooling can parse them reliably.
   *
   * @param featureDir   Absolute path of the feature directory being mutated.
   * @param writeFn      Async callback that performs the actual file writes.
   * @param opts.changeClass  `"plan"` or `"operational"` — the change class trailer.
   * @param opts.actor        Actor string (e.g. `"tdd-agent"`) — the actor trailer.
   */
  async commit(
    featureDir: string,
    writeFn: () => Promise<void>,
    opts: { changeClass: "plan" | "operational"; actor: string },
  ): Promise<void> {
    // Execute the write callback — all file mutations happen here.
    await writeFn();

    // Stage all changes under the feature directory.
    await this.git(["add", "--", featureDir]);

    // Check whether anything was actually staged.  `git diff --cached --quiet`
    // exits 0 when the index is clean (nothing new to commit) and 1 when there
    // are staged changes.  Any other non-zero exit is a real error.
    const hasStagedChanges = await this.hasStagedChanges();
    if (!hasStagedChanges) {
      // Nothing to commit — return silently without creating an empty commit.
      return;
    }

    // Build the commit message with RFC-style trailers.
    const message = [
      `store: ${opts.changeClass} write by ${opts.actor}`,
      "",
      `Kanthord-Change-Class: ${opts.changeClass}`,
      `Kanthord-Actor: ${opts.actor}`,
    ].join("\n");

    await this.git([
      "-c", `user.name=${DAEMON_AUTHOR_NAME}`,
      "-c", `user.email=${DAEMON_AUTHOR_EMAIL}`,
      "commit",
      "--no-gpg-sign",
      "-m", message,
    ]);
  }

  /**
   * Return the commit history for `filePath`, newest first.
   *
   * Each entry carries the structured trailers written by `commit()`.
   * Commits that lack the `Kanthord-Change-Class` or `Kanthord-Actor` trailers
   * are silently omitted.  When `opts.changeClass` is provided, only entries
   * with that class are returned.
   *
   * @param filePath   Absolute path of the file to query.
   * @param opts.changeClass  Optional filter: `"plan"` or `"operational"`.
   */
  async history(
    filePath: string,
    opts?: { changeClass?: "plan" | "operational" },
  ): Promise<Array<{
    sha: string;
    actor: string;
    changeClass: "plan" | "operational";
    timestamp: Date;
  }>> {
    // Use a record separator (ASCII 0x1E) to delimit commits unambiguously so
    // multi-line commit bodies don't split across records.
    const separator = "\x1e";
    // Format: sha, ISO author date, then the full body.
    const format = `%H${separator}%aI${separator}%B${separator}${separator}`;

    // git log exits 0 with empty output for a file with no history.
    // An empty repo (no commits yet) exits non-zero with a recognizable stderr;
    // that is also an absence case and must return [].
    // Any other non-zero exit (corrupt repo, EACCES, etc.) must propagate.
    let raw: string;
    try {
      raw = await this.git([
        "log",
        "--follow",
        `--format=${format}`,
        "--",
        filePath,
      ]);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      if (stderr.includes("does not have any commits yet")) {
        return [];
      }
      throw err;
    }

    if (!raw.trim()) {
      return [];
    }

    // Split on the double-separator that ends every record.
    const records = raw.split(`${separator}${separator}`).filter((r) => r.trim().length > 0);

    const results: Array<{
      sha: string;
      actor: string;
      changeClass: "plan" | "operational";
      timestamp: Date;
    }> = [];

    for (const record of records) {
      const parts = record.split(separator);
      // parts[0] = sha, parts[1] = ISO date, parts[2] = body (may contain newlines)
      const sha = (parts[0] ?? "").trim();
      const isoDate = (parts[1] ?? "").trim();
      const body = (parts[2] ?? "").trim();

      if (!sha || !isoDate) continue;

      // Parse trailers from the body.
      const classMatch = body.match(/^Kanthord-Change-Class:\s*(.+)$/m);
      const actorMatch = body.match(/^Kanthord-Actor:\s*(.+)$/m);

      if (!classMatch || !actorMatch) continue;

      const changeClass = (classMatch[1] ?? "").trim() as "plan" | "operational";
      const actor = (actorMatch[1] ?? "").trim();

      if (changeClass !== "plan" && changeClass !== "operational") continue;
      if (opts?.changeClass !== undefined && changeClass !== opts.changeClass) continue;

      results.push({
        sha,
        actor,
        changeClass,
        timestamp: new Date(isoDate),
      });
    }

    return results;
  }

  /**
   * Write `content` to `destPath` atomically via write-to-temp + rename.
   *
   * The temp file is placed inside `storeRoot` so it is covered by the
   * `*.tmp` `.gitignore` pattern and never committed.  The final `rename`
   * is POSIX-atomic so concurrent readers observe either the old file or
   * the fully written new file — never a partial write.
   *
   * @param destPath  Absolute path of the target file.
   * @param content   UTF-8 content to write.
   */
  async atomicWrite(destPath: string, content: string): Promise<void> {
    const tmpPath = join(this.storeRoot, `.atomic-${randomUUID()}.tmp`);
    try {
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, destPath);
    } catch (err) {
      // Best-effort cleanup of the temp file on failure.
      await unlink(tmpPath).catch((e) => log.debug("git-store-tmp-cleanup-failed", { error: errMessage(e) }));
      throw err;
    }
  }

  /**
   * Release the writer lock and any held resources.
   */
  async close(): Promise<void> {
    await this.writerLock.release(this.lockToken);
    this.lockToken = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Return `true` when the git index has staged changes ready to commit.
   *
   * `git diff --cached --quiet` exits 0 when the index is clean and exits 1
   * when there are staged differences.  Any other non-zero exit code is
   * propagated as an error.
   */
  private async hasStagedChanges(): Promise<boolean> {
    try {
      await execFileAsync("git", ["diff", "--cached", "--quiet"], {
        cwd: this.storeRoot,
      });
      // Exit 0 — index is clean; nothing staged.
      return false;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exitCode = (err as any).code;
      if (exitCode === 1) {
        // Exit 1 — staged changes present.
        return true;
      }
      // Any other exit code is a genuine git error.
      throw err;
    }
  }

  /** Run `git <args>` inside `storeRoot`. */
  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.storeRoot,
    });
    return stdout;
  }

  /**
   * Initialise a new repo if `.git` does not exist; otherwise do nothing.
   * Uses `git init` idempotency: running it on an existing repo is safe but
   * we skip it to avoid reinitialising author/config.
   */
  private async ensureGitRepo(): Promise<void> {
    const gitDir = join(this.storeRoot, ".git");
    const exists = await access(gitDir).then(() => true).catch(() => false);
    if (!exists) {
      await this.git(["init", "--initial-branch=main"]);
    }
  }

  /**
   * Append any missing ignore patterns to `.gitignore`.  Only adds lines that
   * are not already present — idempotent.
   */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = join(this.storeRoot, ".gitignore");

    let existing = "";
    try {
      existing = await readFile(gitignorePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    const lines = existing.split("\n");
    const toAdd = IGNORE_PATTERNS.filter((p) => !lines.includes(p));

    if (toAdd.length === 0) {
      return;
    }

    const appendContent =
      (existing.length > 0 && !existing.endsWith("\n") ? "\n" : "") +
      toAdd.join("\n") +
      "\n";

    await appendFile(gitignorePath, appendContent, "utf8");
  }
}
