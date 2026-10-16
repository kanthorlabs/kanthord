import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { mainCheckout, readEnvFile } from "./api.mjs";

export const SCRATCH_PATTERN =
  /(^|\/)\.kanthord|scratch|\.tmp$|\.log$|\.bak$|~$|\.orig$|(^|\/)\.env$|\.db$|node_modules\//i;

export const SECRET_PATTERN =
  /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-|nvapi-/;

const CHILD_TIMEOUT_MS = 10 * 60 * 1000;

export function matchesScratch(path) {
  return SCRATCH_PATTERN.test(path);
}

export function matchesSecret(line) {
  return SECRET_PATTERN.test(line);
}

export function shouldPause(result) {
  return result === "fail";
}

export function githubAuthHeader(token) {
  return (
    "Authorization: Basic " +
    Buffer.from("x-access-token:" + token).toString("base64")
  );
}

export function pendingCheckAction(completedCount, checkRunning) {
  if (completedCount === 0) return "none";
  return checkRunning ? "queue" : "start";
}

function exec(command, args, cwd, timeoutMs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(env && { env }),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
    }
  });
}

async function git(args, cwd, env) {
  const result = await exec("git", args, cwd, null, env);
  if (result.status !== 0) {
    const sub = args.find((a) => !a.startsWith("-") && !a.includes("/"));
    throw new Error(`git ${sub ?? args[0]} failed`);
  }
  return result.stdout;
}

function ok(label) {
  console.log(`${label} ok`);
}

function fail(label, detail) {
  console.log(`${label} FAILED${detail ? `: ${detail}` : ""}`);
}

export async function runCheck(run, MAIN) {
  const runDir = join(MAIN, ".dev/e2e", run);
  const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const { github, base_branch, fixture_commit } = state;
  if (!fixture_commit)
    throw new Error(`run.json for ${run} lacks fixture_commit`);

  const env = readEnvFile(resolve(MAIN, state.env_file));
  const token = env[state.github_token_env];
  if (!token)
    throw new Error(`${state.env_file} lacks ${state.github_token_env}`);

  const checkDir = join(MAIN, ".dev/e2e", run, "check");
  if (existsSync(checkDir)) rmSync(checkDir, { recursive: true });
  mkdirSync(dirname(checkDir), { recursive: true });

  const cloneEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: githubAuthHeader(token),
    GIT_TERMINAL_PROMPT: "0",
  };
  await git(
    [
      "-c",
      "credential.helper=",
      "clone",
      "-q",
      "--branch",
      base_branch,
      "--single-branch",
      `https://github.com/${github}.git`,
      checkDir,
    ],
    undefined,
    cloneEnv,
  );

  let failed = false;

  const ci = await exec(
    "npm",
    ["ci", "--ignore-scripts"],
    checkDir,
    CHILD_TIMEOUT_MS,
  );
  if (ci.timedOut) {
    fail("npm-ci", "timeout");
    failed = true;
  } else if (ci.status === 0) {
    ok("npm-ci");
  } else {
    fail("npm-ci");
    failed = true;
  }

  const pkg = JSON.parse(readFileSync(join(checkDir, "package.json"), "utf8"));
  const testScripts = Object.keys(pkg.scripts ?? {}).filter(
    (k) => k === "test" || k.startsWith("test:"),
  );
  for (const script of testScripts) {
    const r = await exec(
      "npm",
      ["run", "-s", script],
      checkDir,
      CHILD_TIMEOUT_MS,
    );
    if (r.timedOut) {
      fail(script, "timeout");
      failed = true;
    } else {
      const combined = r.stdout + r.stderr;
      const summary = combined
        .split("\n")
        .filter((l) => /^ℹ (tests|pass|fail) /.test(l))
        .join(" ");
      console.log(`${script} rc=${r.status}${summary ? " " + summary : ""}`);
      if (r.status !== 0) failed = true;
    }
  }

  const lint = await exec(
    "npm",
    ["run", "-s", "lint"],
    checkDir,
    CHILD_TIMEOUT_MS,
  );
  if (lint.timedOut) {
    fail("lint", "timeout");
    failed = true;
  } else if (lint.status === 0) {
    ok("lint");
  } else {
    fail("lint");
    failed = true;
  }

  const fmt = await exec(
    "npm",
    ["run", "-s", "format:check"],
    checkDir,
    CHILD_TIMEOUT_MS,
  );
  if (fmt.timedOut) {
    fail("format", "timeout");
    failed = true;
  } else if (fmt.status === 0) {
    ok("format");
  } else {
    fail("format");
    failed = true;
  }

  const diffNames = await git([
    "-C",
    checkDir,
    "diff",
    "--name-only",
    fixture_commit,
    "HEAD",
  ]);
  const scratchFiles = diffNames
    .split("\n")
    .filter((f) => f && matchesScratch(f));
  if (scratchFiles.length === 0) {
    ok("scratch");
  } else {
    fail("scratch", scratchFiles.join(" "));
    failed = true;
  }

  const diffLines = await git(["-C", checkDir, "diff", fixture_commit, "HEAD"]);
  const secretLines = diffLines
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .filter((l) => matchesSecret(l));
  if (secretLines.length === 0) {
    ok("secrets");
  } else {
    fail("secrets");
    failed = true;
  }

  const result = failed ? "fail" : "pass";
  console.log(`RESULT ${result}`);
  return result;
}

const isMain =
  process.argv[1] &&
  new URL(import.meta.url).pathname === resolve(process.argv[1]);
if (isMain) {
  const [run] = process.argv.slice(2);
  if (!run) throw new Error("usage: check.mjs <run>");
  const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const MAIN = mainCheckout(ROOT);
  const result = await runCheck(run, MAIN);
  process.exitCode = result === "pass" ? 0 : 1;
}
