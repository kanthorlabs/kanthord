import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { client, mainCheckout, readEnvFile, tokenOf } from "./api.mjs";
import { runCheck, shouldPause, pendingCheckAction } from "./check.mjs";
import { isServerManaged } from "./placement.mjs";

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
const runtimeStates = new Map();
let projectState;
let shownImageId;
let checkRunning = false;
let checkPending = false;
const COMPLETED_STATE = "Completed";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === PROCESS_ABSENT) return false;
    throw error;
  }
}

async function pauseProject() {
  try {
    await api.post(`/api/project/${state.project_id}/pause`);
    console.log(`${now()} project paused`);
  } catch (err) {
    console.log(`${now()} pause error: ${err.message}`);
  }
}

function startCheck(label) {
  checkRunning = true;
  runCheck(run, MAIN)
    .then(async (result) => {
      console.log(`${now()} check ${result} (after ${label} completed)`);
      if (shouldPause(result)) {
        await pauseProject();
      }
    })
    .catch(async (err) => {
      console.log(`${now()} check error: ${err.message}`);
      await pauseProject();
    })
    .finally(() => {
      checkRunning = false;
      if (checkPending) {
        checkPending = false;
        startCheck("queued");
      }
    });
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
  const completedNodes = [];
  for (const node of page.items) {
    const label = `${node.state}/a${node.attempt}`;
    const before = nodes.get(node.id);
    if (!quiet && before !== label)
      console.log(
        `${now()} node ${node.filename}: ${before ?? "-"} -> ${label}`,
      );
    if (!quiet && before !== label && node.state === COMPLETED_STATE)
      completedNodes.push(node.filename);
    nodes.set(node.id, label);
  }
  const action = pendingCheckAction(completedNodes.length, checkRunning);
  if (action === "queue") {
    checkPending = true;
  } else if (action === "start") {
    startCheck(completedNodes.join(", "));
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

function watchImage() {
  const { image_id: imageId } = JSON.parse(
    readFileSync(join(runDir, "run.json"), "utf8"),
  );
  if (imageId === shownImageId) return;
  console.log(`${now()} image ${imageId}`);
  shownImageId = imageId;
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

async function watchRegistrations(quiet) {
  const page = await api.get(
    `/api/worker/registration?project_id=${state.project_id}`,
  );
  for (const registration of page?.items ?? []) {
    const id = registration.runtime_identity;
    const label = `placement=${registration.placement} activity=${registration.activity} draining=${registration.draining} resource=${registration.resource_identity} worker=${registration.worker_name}`;
    const before = runtimeStates.get(id);
    if (!quiet && before !== label)
      console.log(`${now()} registration ${id}: ${before ?? "-"} -> ${label}`);
    runtimeStates.set(id, label);
  }
  const listed = new Set(
    (page?.items ?? []).map((registration) => registration.runtime_identity),
  );
  for (const id of [...runtimeStates.keys()]) {
    if (listed.has(id)) continue;
    runtimeStates.delete(id);
    if (!quiet) console.log(`${now()} registration ${id} -> gone`);
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
    if (isServerManaged(state.placement)) {
      if (state.placement === "container") watchImage();
      await watchRegistrations(tick === 0);
    } else {
      watchWorkers();
    }
    if (tick % PR_EVERY_TICKS === 0) watchPullRequests(tick === 0);
  } catch (error) {
    console.log(`${now()} watch error: ${error.message}`);
  }
  await sleep(TICK_MS);
}
