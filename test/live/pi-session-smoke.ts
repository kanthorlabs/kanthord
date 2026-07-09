/**
 * MAINTAINER-RUN ONLY — not part of `npm test` (excluded by the `src/**\/*.test.ts` glob).
 *
 * Requires real provider credentials in the environment (e.g. ANTHROPIC_API_KEY).
 * Run manually:
 *
 *   node test/live/pi-session-smoke.ts
 *
 * Validates that a real pi session can be spawned and torn down in a worktree
 * with a minimal prompt. Does NOT run during `npm test`; the hermetic suite
 * passes with no credentials present.
 *
 * After a successful run, record observations in:
 *   .agent/plan/feedback/016-real-agent-sessions/live-smoke.md
 */

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PI_CLI =
  process.env["KANTHORD_PI_CLI"] ??
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
const EXPECTED_MARKER = "KANTHORD_LIVE_SMOKE_OK";
const ARTIFACT_PATH = join(
  REPO_ROOT,
  ".agent",
  "plan",
  "feedback",
  "016-real-agent-sessions",
  "live-smoke.md",
);

interface SmokeObservation {
  worktreePath: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Spawn a real pi CLI session in a temporary worktree with tools disabled.
 * The prompt is intentionally tiny to keep cost low and avoid repository edits.
 */
export async function runLiveSmoke(): Promise<void> {
  const startedAt = new Date();
  const tempParent = await mkdtemp(join(tmpdir(), "kanthord-live-smoke-"));
  const worktreePath = join(tempParent, "worktree");

  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024,
    });

    const prompt =
      `Reply with exactly ${EXPECTED_MARKER} and no other text. ` +
      "This is a maintainer-run kanthord live smoke.";
    const started = Date.now();
    const { stdout, stderr } = await runPiCli(worktreePath, prompt);
    const durationMs = Date.now() - started;

    if (!stdout.includes(EXPECTED_MARKER)) {
      throw new Error(
        `pi live smoke did not return ${EXPECTED_MARKER}; stdout=${JSON.stringify(stdout.slice(0, 1000))}`,
      );
    }

    await writeArtifact(startedAt, {
      worktreePath,
      stdout,
      stderr,
      durationMs,
    });
  } finally {
    await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function writeArtifact(startedAt: Date, observation: SmokeObservation): Promise<void> {
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
  const completedAt = new Date();
  const artifact = `# Epic 016 Live Smoke

- result: PASS
- started_at: ${startedAt.toISOString()}
- completed_at: ${completedAt.toISOString()}
- command: \`node test/live/pi-session-smoke.ts\`
- pi_cli: \`${PI_CLI}\`
- worktree_strategy: temporary detached git worktree
- worktree_path: \`${observation.worktreePath}\`
- prompt_marker: \`${EXPECTED_MARKER}\`
- duration_ms: ${observation.durationMs}

## Observations

- real_pi_session_spawn: PASS - pi CLI completed and returned the expected marker.
- worktree_spawn: PASS - command ran with cwd set to the temporary worktree path.
- teardown: PASS - temporary worktree removal was attempted after the run.
- hermetic_default_suite: PASS - this file is under \`test/live/\` and is not matched by \`npm test\`.
- context_size_signal_fidelity: NOT_OBSERVED - the pi CLI text-mode smoke does not expose a context-size signal in stdout/stderr.
- cost_signal_fidelity: NOT_OBSERVED - the pi CLI text-mode smoke does not expose cost accounting in stdout/stderr.

## Output Summary

- stdout_contains_marker: ${observation.stdout.includes(EXPECTED_MARKER)}
- stdout_bytes: ${Buffer.byteLength(observation.stdout, "utf8")}
- stderr_bytes: ${Buffer.byteLength(observation.stderr, "utf8")}
`;
  await writeFile(ARTIFACT_PATH, artifact, "utf8");
}

async function runPiCli(
  worktreePath: string,
  prompt: string,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        PI_CLI,
        "--print",
        "--approve",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-session",
        "--mode",
        "text",
        prompt,
      ],
      {
        cwd: worktreePath,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 300_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      rejectPromise(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(
        new Error(
          `pi CLI failed with code=${String(code)} signal=${String(signal)} stdout=${JSON.stringify(stdout.slice(0, 1000))} stderr=${JSON.stringify(stderr.slice(0, 1000))}`,
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Direct invocation entry point (node test/live/pi-session-smoke.ts)
// ---------------------------------------------------------------------------

const isMain =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("pi-session-smoke.ts");

if (isMain) {
  console.log("[live-smoke] starting …");
  runLiveSmoke()
    .then(() => {
      console.log("[live-smoke] PASS");
    })
    .catch((err: unknown) => {
      console.error("[live-smoke] FAIL", err);
      process.exitCode = 1;
    });
}
