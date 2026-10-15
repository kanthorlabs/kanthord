import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mainCheckout, readEnvFile } from "./api.mjs";

export const SCRATCH_PATTERN =
  /(^|\/)\.kanthord|scratch|\.tmp$|\.log$|\.bak$|~$|\.orig$|(^|\/)\.env$|\.db$|node_modules\//i;

export const SECRET_PATTERN =
  /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-|nvapi-/;

export function matchesScratch(path) {
  return SCRATCH_PATTERN.test(path);
}

export function matchesSecret(line) {
  return SECRET_PATTERN.test(line);
}

export function shouldPause(result) {
  return result === "fail";
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

  const cloneUrl = `https://x-access-token:${token}@github.com/${github}.git`;
  execFileSync(
    "git",
    [
      "-c",
      "credential.helper=",
      "clone",
      "-q",
      "--branch",
      base_branch,
      "--single-branch",
      cloneUrl,
      checkDir,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  execFileSync("git", [
    "-C",
    checkDir,
    "remote",
    "set-url",
    "origin",
    `https://github.com/${github}.git`,
  ]);

  let failed = false;

  const ci = spawnSync("npm", ["ci", "--ignore-scripts"], {
    cwd: checkDir,
    encoding: "utf8",
  });
  if (ci.status === 0) {
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
    const r = spawnSync("npm", ["run", "-s", script], {
      cwd: checkDir,
      encoding: "utf8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const summary = combined
      .split("\n")
      .filter((l) => /^ℹ (tests|pass|fail) /.test(l))
      .join(" ");
    console.log(`${script} rc=${r.status}${summary ? " " + summary : ""}`);
    if (r.status !== 0) failed = true;
  }

  const lint = spawnSync("npm", ["run", "-s", "lint"], {
    cwd: checkDir,
    encoding: "utf8",
  });
  if (lint.status === 0) {
    ok("lint");
  } else {
    fail("lint");
    failed = true;
  }

  const fmt = spawnSync("npm", ["run", "-s", "format:check"], {
    cwd: checkDir,
    encoding: "utf8",
  });
  if (fmt.status === 0) {
    ok("format");
  } else {
    fail("format");
    failed = true;
  }

  const diffNames = execFileSync(
    "git",
    ["-C", checkDir, "diff", "--name-only", fixture_commit, "HEAD"],
    { encoding: "utf8" },
  );
  const scratchFiles = diffNames
    .split("\n")
    .filter((f) => f && matchesScratch(f));
  if (scratchFiles.length === 0) {
    ok("scratch");
  } else {
    fail("scratch", scratchFiles.join(" "));
    failed = true;
  }

  const diffLines = execFileSync(
    "git",
    ["-C", checkDir, "diff", fixture_commit, "HEAD"],
    { encoding: "utf8" },
  );
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
