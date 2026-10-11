import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mainCheckout } from "./api.mjs";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: stop.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const state = JSON.parse(
  readFileSync(join(MAIN, ".dev/e2e", run, "run.json"), "utf8"),
);
const STOP_WAIT_MS = 15000;
const POLL_MS = 500;
const PROCESS_ABSENT = "ESRCH";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === PROCESS_ABSENT) return false;
    throw error;
  }
}

for (const instance of state.instances)
  if (alive(instance.pid)) process.kill(instance.pid, "SIGTERM");
const end = Date.now() + STOP_WAIT_MS;
while (Date.now() < end && state.instances.some(({ pid }) => alive(pid)))
  await sleep(POLL_MS);
for (const instance of state.instances) {
  const running = alive(instance.pid);
  if (running) process.kill(instance.pid, "SIGKILL");
  console.log(
    `e2e-stop: ${instance.name} pid ${instance.pid} ${running ? "killed" : "stopped"}`,
  );
}
