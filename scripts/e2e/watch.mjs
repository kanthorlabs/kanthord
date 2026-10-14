import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { client, mainCheckout, readEnvFile, tokenOf } from "./api.mjs";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: watch.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const runDir = join(MAIN, ".dev/e2e", run);
const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
const api = client(state.endpoint, tokenOf(join(runDir, "human.cli.yaml")));
const TICK_MS = 15000;
const PR_EVERY_TICKS = 4;
const PROCESS_ABSENT = "ESRCH";
const TASK_KIND = "task";
const now = () => new Date().toISOString().slice(11, 19);
const githubToken = readEnvFile(resolve(MAIN, state.env_file))[
  state.github_token_env
];
if (!githubToken)
  throw new Error(`${state.env_file} lacks ${state.github_token_env}`);
const ghEnv = { ...process.env, GH_TOKEN: githubToken };

const nodes = new Map();
const ended = new Set();
const prs = new Map();
const down = new Set();
let projectState;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === PROCESS_ABSENT) return false;
    throw error;
  }
}

async function watchProject() {
  const project = await api.get(`/api/project/${state.project_id}`);
  const label =
    project.paused_at === null ? "project active" : "project paused";
  if (label === projectState) return;
  projectState = label;
  console.log(`${now()} ${label}`);
}

async function watchNodes(quiet) {
  const page = await api.get(`/api/mission/${state.mission_id}/node?limit=200`);
  for (const node of page.items) {
    if (node.kind === TASK_KIND) continue;
    const label = `${node.state}/a${node.attempt}`;
    const before = nodes.get(node.id);
    if (!quiet && before !== label)
      console.log(
        `${now()} node ${node.filename}: ${before ?? "-"} -> ${label}`,
      );
    nodes.set(node.id, label);
  }
}

async function watchExecutions(quiet) {
  const page = await api.get(
    `/api/scheduler/project/${state.project_id}/execution?limit=50`,
  );
  for (const execution of page.items) {
    if (execution.ended_at === null || ended.has(execution.execution_id))
      continue;
    ended.add(execution.execution_id);
    if (quiet) continue;
    const stop = execution.stop
      ? ` stop=${execution.stop.reason}${execution.stop.code ? `/${execution.stop.code}` : ""}`
      : "";
    console.log(
      `${now()} execution ${execution.execution_id.slice(-6)} ended${stop}`,
    );
  }
}

function watchWorkers() {
  const { instances } = JSON.parse(
    readFileSync(join(runDir, "run.json"), "utf8"),
  );
  for (const instance of instances) {
    const up = alive(instance.pid);
    if (!up && !down.has(instance.name))
      console.log(
        `${now()} worker ${instance.name} EXITED (log ${instance.log})`,
      );
    if (up) down.delete(instance.name);
    else down.add(instance.name);
  }
}

function watchPullRequests(quiet) {
  const list = JSON.parse(
    execFileSync(
      "gh",
      [
        "pr",
        "list",
        "-R",
        state.github,
        "--base",
        state.base_branch,
        "--state",
        "all",
        "--json",
        "number,state,title",
      ],
      { encoding: "utf8", env: ghEnv },
    ),
  );
  for (const pr of list) {
    if (prs.get(pr.number) === pr.state) continue;
    prs.set(pr.number, pr.state);
    if (quiet) continue;
    console.log(`${now()} PR #${pr.number}: ${pr.state} ${pr.title}`);
  }
}

for (let tick = 0; ; tick++) {
  try {
    await watchProject();
    await watchNodes(tick === 0);
    await watchExecutions(tick === 0);
    watchWorkers();
    if (tick % PR_EVERY_TICKS === 0) watchPullRequests(tick === 0);
  } catch (error) {
    console.log(`${now()} watch error: ${error.message}`);
  }
  await sleep(TICK_MS);
}
