// src/repository-probe/git.ts — EPIC 014 Story 4
// Read-only `git ls-remote --heads <url> refs/heads/<branch>` probe. Never
// clones, never writes to the repository `--path`. The default `run` is
// `execFile("git", …)` (no shell); the constructor takes an injected `run`
// so tests fake the child process without standing up git.
//
// Output is always redacted through `makeRedactor(value)` where `value` is
// the resolved credential for https-token auth, or `null` for ambient /
// ssh-agent / a missing resolveCredential. A timeout (killed / SIGTERM) is
// reported as `probe timed out …` — the raw stderr never reaches the detail.
//
// `probe` NEVER rejects. Every failure — including a dangling credential that
// makes `buildGitEnv` throw — comes back as `{status:"failed"}`, because the
// caller (`CheckProject`) has no catch and a rejection would replace the whole
// readiness report with a stack trace.

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { buildGitEnv } from "../publication/git.ts";
import { makeRedactor } from "../domain/redact.ts";
import {
  REPOSITORY_PROBE_TIMEOUT_MS,
  type RepositoryProbe,
  type RepositoryProbeInput,
  type RepositoryProbeResult,
} from "./port.ts";

const execFile = promisify(execFileCb);

type RunFn = (
  args: string[],
  opts: { env: Record<string, string>; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRun: RunFn = async (args, opts) => {
  const result = await execFile("git", args, opts);
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
};

export class GitRepositoryProbe implements RepositoryProbe {
  readonly #resolveCredential?: (credentialId: string) => Promise<string>;
  readonly #run: RunFn;

  constructor(
    resolveCredential?: (credentialId: string) => Promise<string>,
    run: RunFn = defaultRun,
  ) {
    this.#resolveCredential = resolveCredential;
    this.#run = run;
  }

  async probe(input: RepositoryProbeInput): Promise<RepositoryProbeResult> {
    const ref = `refs/heads/${input.branch}`;
    // Resolve the credential at most ONCE and remember the secret, so the
    // catch path can build the redactor without a second resolve (which
    // could itself throw). `buildGitEnv` is what triggers the resolve.
    const resolveCredential = this.#resolveCredential;
    let secret: string | null = null;
    const resolveOnce = resolveCredential
      ? async (credentialId: string): Promise<string> => {
          if (secret === null) secret = await resolveCredential(credentialId);
          return secret;
        }
      : undefined;
    // `buildGitEnv` runs INSIDE the try: a dangling or wrong-typed credential
    // makes `resolveCredential` throw, and a probe must report `failed`, never
    // reject — a rejection here crashes the whole `check project` report.
    let cleanup: (() => void) | undefined;
    try {
      const git = await buildGitEnv(input.auth, resolveOnce);
      cleanup = git.cleanup;
      const { stdout } = await this.#run(
        ["ls-remote", "--heads", input.remoteUrl, ref],
        { env: git.env, timeout: REPOSITORY_PROBE_TIMEOUT_MS },
      );
      if (stdout.includes(ref)) {
        return { status: "ok", detail: `${ref} present on remote` };
      }
      return {
        status: "failed",
        detail: `branch "${input.branch}" not found on remote`,
      };
    } catch (err) {
      const e = err as {
        killed?: boolean;
        signal?: string;
        stderr?: string;
        message?: string;
      };
      if (e.killed === true || e.signal === "SIGTERM") {
        return {
          status: "failed",
          detail: `probe timed out after ${REPOSITORY_PROBE_TIMEOUT_MS}ms`,
        };
      }
      const redact = makeRedactor(secret);
      const raw = String(e.stderr ?? e.message ?? e);
      const firstLine = raw.split("\n")[0] ?? "";
      return {
        status: "failed",
        detail: redact(firstLine).trim().slice(0, 300),
      };
    } finally {
      // `cleanup` is undefined when `buildGitEnv` threw before returning.
      cleanup?.();
    }
  }
}
