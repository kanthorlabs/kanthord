// src/publication/git.ts — GitRepositoryPublisher adapter.
// Pushes refs/heads/<branch> from a bare managed home to a remote via
// execFile("git", …) (no shell), fast-forward-only: --force-with-lease is used
// only as a divergence GUARD (never blind --force). Reuses the buildGitEnv /
// GIT_ASKPASS plumbing style from src/workspace/local.ts.

import { chmod, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type { RepositoryAuth } from "../domain/resource.ts";
import type {
  RepositoryPublisher,
  PublishInput,
  PublishResult,
} from "./port.ts";
import { PublishDivergedError } from "./port.ts";

const execFile = promisify(execFileCb);

/** Keys stripped from every child git process env to prevent credential leakage via traces. */
const GIT_STRIP_KEYS = [
  "GIT_TRACE",
  "GIT_TRACE_CURL",
  "GIT_TRACE_PACK_ACCESS",
  "GIT_TRACE_PERFORMANCE",
  "GIT_TRACE_SETUP",
  "GIT_CURL_VERBOSE",
];

/** Non-fast-forward / stale `--force-with-lease` rejection markers in git's stderr. */
const DIVERGENCE_PATTERN = /rejected|stale info|non-fast-forward/i;

interface GitEnv {
  env: Record<string, string>;
  /** Delete any temp credential files. Idempotent; never throws. */
  cleanup: () => void;
}

/**
 * Build a sanitised env for every child git process: strip GIT_TRACE* /
 * GIT_CURL_VERBOSE, always set GIT_TERMINAL_PROMPT=0, and for https-token
 * auth resolve the credential into a chmod-600 temp file + static askpass
 * script wired via GIT_ASKPASS. `ambient`/`ssh-agent` skip askpass entirely.
 */
async function buildGitEnv(
  auth: RepositoryAuth,
  resolveCredential?: (credentialId: string) => Promise<string>,
): Promise<GitEnv> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const key of GIT_STRIP_KEYS) {
    delete env[key];
  }
  env["GIT_TERMINAL_PROMPT"] = "0";

  if (auth.kind === "https-token" && resolveCredential) {
    const token = await resolveCredential(auth.credentialId);
    const id = randomBytes(4).toString("hex");
    const tokenFile = join(tmpdir(), `kanthord-pub-${id}.token`);
    const askpassFile = join(tmpdir(), `kanthord-pub-${id}.askpass.sh`);

    try {
      await writeFile(tokenFile, token, { encoding: "utf8" });
      await chmod(tokenFile, 0o600);
      await writeFile(askpassFile, `#!/bin/sh\ncat "${tokenFile}"\n`, {
        encoding: "utf8",
      });
      await chmod(askpassFile, 0o700);
    } catch (err) {
      rmSync(tokenFile, { force: true });
      rmSync(askpassFile, { force: true });
      throw err;
    }

    env["GIT_ASKPASS"] = askpassFile;

    const cleanup = (): void => {
      rmSync(tokenFile, { force: true });
      rmSync(askpassFile, { force: true });
    };
    return { env, cleanup };
  }

  return { env, cleanup: () => {} };
}

async function gitOut(
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  const { stdout } = await execFile("git", args, { env });
  return stdout.trim();
}

export class GitRepositoryPublisher implements RepositoryPublisher {
  readonly #resolveCredential?: (credentialId: string) => Promise<string>;

  constructor(resolveCredential?: (credentialId: string) => Promise<string>) {
    this.#resolveCredential = resolveCredential;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { homeDir, branch, remoteUrl, auth, expectedRemoteOID } = input;
    const ref = `refs/heads/${branch}`;

    const { env, cleanup } = await buildGitEnv(auth, this.#resolveCredential);
    try {
      const pushedOID = await gitOut(
        [`--git-dir=${homeDir}`, "rev-parse", ref],
        env,
      );

      const pushArgs = [
        `--git-dir=${homeDir}`,
        "-c",
        "credential.helper=",
        "push",
      ];
      if (expectedRemoteOID !== null) {
        pushArgs.push(`--force-with-lease=${ref}:${expectedRemoteOID}`);
      }
      pushArgs.push(remoteUrl, `${ref}:${ref}`);

      try {
        await execFile("git", pushArgs, { env });
      } catch (err) {
        const stderr = String((err as { stderr?: string }).stderr ?? err);
        if (DIVERGENCE_PATTERN.test(stderr)) {
          const remoteOID = await this.#lsRemoteOID(remoteUrl, ref, env);
          throw new PublishDivergedError(remoteOID);
        }
        throw err;
      }

      const remoteOID = await this.#lsRemoteOID(remoteUrl, ref, env);
      return { pushedOID, remoteOID };
    } finally {
      cleanup();
    }
  }

  async #lsRemoteOID(
    remoteUrl: string,
    ref: string,
    env: Record<string, string>,
  ): Promise<string> {
    const out = await gitOut(["ls-remote", remoteUrl, ref], env);
    return (out.split(/\s+/)[0] ?? "").trim();
  }
}
