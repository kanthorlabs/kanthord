import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const STOP_WAIT_MS = 15000;
const POLL_MS = 500;
const PROCESS_ABSENT = "ESRCH";

export function withoutKanthordClient(env) {
  const output = { ...env };
  for (const name of [
    "KANTHORD_ENDPOINT",
    "KANTHORD_CONFIG",
    "KANTHORD_TOKEN",
    "KANTHORD_WORKER_CONFIG",
  ])
    delete output[name];
  return output;
}

export function workerArguments(name) {
  return ["src/main.ts", "serve", "worker", "--instance", name];
}

export function spawnWorker(engine, home, logFile, name) {
  const child = spawn(process.execPath, workerArguments(name), {
    cwd: engine,
    detached: true,
    stdio: ["ignore", openSync(logFile, "a"), openSync(logFile, "a")],
    env: {
      ...withoutKanthordClient(process.env),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"),
      GIT_AUTHOR_NAME: "kanthord e2e",
      GIT_AUTHOR_EMAIL: "e2e@kanthorlabs.invalid",
      GIT_COMMITTER_NAME: "kanthord e2e",
      GIT_COMMITTER_EMAIL: "e2e@kanthorlabs.invalid",
    },
  });
  child.unref();
  return child.pid;
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === PROCESS_ABSENT) return false;
    throw error;
  }
}

export async function stopWorkers(instances) {
  for (const instance of instances)
    if (alive(instance.pid)) process.kill(instance.pid, "SIGTERM");
  const end = Date.now() + STOP_WAIT_MS;
  while (Date.now() < end && instances.some(({ pid }) => alive(pid)))
    await sleep(POLL_MS);
  return instances.map((instance) => {
    const running = alive(instance.pid);
    if (running) process.kill(instance.pid, "SIGKILL");
    return { ...instance, result: running ? "killed" : "stopped" };
  });
}
