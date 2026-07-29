// src/commit-presence/git.ts — GitCommitPresence adapter (EPIC 017
// human-review blocker S3, batched per S3-batch). Uses `git cat-file
// --batch-check` over a single `spawn`ed process per call (never
// `execFile` — async `execFile` has no stdin `input` option, and a
// promisified `{input}` hangs forever because stdin is never closed).
// `--batch-check` reads one object identifier per stdin line and writes
// exactly one output line per input line, IN ORDER — that streaming order
// is what makes positional association sound; the resolved OID it echoes
// for a found object is not necessarily the input spelling (an
// abbreviation resolves to its full 40-hex), so results are read by
// position, never by matching the echoed string back to the request.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { CommitPresence } from "./port.ts";

// review R3-S2 — a wedged/hung `git` process (e.g. a broken filesystem, a
// credential-helper prompt that never resolves) must not hang the daemon's
// `queue` command forever. 30s is generous for a local `cat-file
// --batch-check` (no network) while still bounding the wait.
const SPAWN_TIMEOUT_MS = 30_000;

// review R3-S5 — `--batch-check`'s stdin protocol is positional: one input
// line per answer line. An oid smuggling a newline/CR would inject an extra
// line (or split mid-line), desyncing every subsequent answer. Refuse it
// before it ever reaches the child's stdin.
const OID_FRAMING = /[\n\r]/;

export class GitCommitPresence implements CommitPresence {
  async hasCommits(
    homeDir: string,
    oids: readonly string[],
  ): Promise<readonly boolean[]> {
    // A home that has not been cloned yet genuinely holds no commit. This is
    // the one non-git way to be absent, and checking it first keeps the
    // spawn failure below unambiguous.
    if (!existsSync(homeDir)) return oids.map(() => false);

    // No OIDs to ask about — do not spawn a process for nothing.
    if (oids.length === 0) return [];

    for (const oid of oids) {
      if (OID_FRAMING.test(oid)) {
        throw new Error(
          `refusing to probe oid containing a newline/carriage-return (would desync cat-file --batch-check's positional stdin): ${JSON.stringify(oid)}`,
        );
      }
    }

    const lines = await this.#batchCheck(homeDir, oids);
    return oids.map((_, i) => {
      const line = lines[i];
      if (line === undefined) return false;
      const fields = line.split(" ");
      // review S4/S3-batch-c — `--batch-check` splits the cases exactly:
      // "<oid> commit <size>" is a found commit; "<oid> missing" and
      // "<oid> ambiguous" (and anything peeling a non-commit object) are
      // reported as absent, never as an error.
      return fields[1] === "commit";
    });
  }

  #batchCheck(homeDir: string, oids: readonly string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      // review R4-S3 — declared before `spawn` and guarded, so a settle that
      // ever lands before the timer is registered clears nothing instead of
      // raising a TDZ ReferenceError in place of the real rejection.
      let timer: NodeJS.Timeout | undefined;
      const clearTimer = (): void => {
        if (timer !== undefined) clearTimeout(timer);
      };
      const settleResolve = (lines: string[]): void => {
        if (settled) return;
        settled = true;
        clearTimer();
        resolve(lines);
      };
      const settleReject = (err: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimer();
        reject(err);
      };

      const child = spawn("git", ["cat-file", "--batch-check"], {
        cwd: homeDir,
      });

      timer = setTimeout(() => {
        child.kill();
        settleReject(
          new Error(
            `git cat-file --batch-check hit a timeout after ${String(SPAWN_TIMEOUT_MS)}ms in homeDir ${homeDir}`,
          ),
        );
      }, SPAWN_TIMEOUT_MS);

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        settleReject(err);
      });

      child.stdin.on("error", (err) => {
        // e.g. EPIPE when git exits (not a repository, git missing) before
        // reading all input. Usually the "close"/"error" handlers above
        // decide the outcome first (the `settled` guard makes this a no-op
        // then); this only prevents an unhandled stream error from crashing
        // the process when "close"/"error" never fire.
        settleReject(err);
      });

      child.stdout.on("error", (err) => {
        settleReject(err);
      });
      child.stderr.on("error", (err) => {
        settleReject(err);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          settleReject(
            new Error(
              `git cat-file --batch-check exited with code ${String(code)}: ${stderr.trim()}`,
            ),
          );
          return;
        }
        const lines = stdout.split("\n").filter((line) => line.length > 0);
        settleResolve(lines);
      });

      // Peel every input to a commit so a tag or a non-commit object is
      // reported as absent rather than "found, wrong type".
      const input = oids.map((oid) => `${oid}^{commit}`).join("\n") + "\n";
      child.stdin.write(input);
      child.stdin.end();
    });
  }
}
