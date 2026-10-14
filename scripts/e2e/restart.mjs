import { spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mainCheckout } from "./api.mjs";
import { stopDevDaemon } from "./daemon.mjs";
import { spawnWorker, stopWorkers } from "./workers.mjs";

const DAEMON_WAIT_S = 60;

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: restart.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const runDir = join(MAIN, ".dev/e2e", run);
const stateFile = join(runDir, "run.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));

async function startDaemon(devLog) {
  const child = spawn(join(ROOT, "scripts/dev/run.sh"), [], {
    detached: true,
    stdio: ["ignore", openSync(devLog, "a"), openSync(devLog, "a")],
  });
  child.unref();
  console.log(`e2e-restart: daemon started pid ${child.pid}, log ${devLog}`);
  const liveness = `${state.endpoint}/api/liveness`;
  for (let i = 0; i < DAEMON_WAIT_S; i++) {
    try {
      const r = await fetch(liveness);
      if (r.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(
    `daemon did not answer in ${DAEMON_WAIT_S} s. Read ${devLog}`,
  );
}

if (state.placement === "server") {
  const devLog = join(MAIN, ".dev/e2e/dev.log");
  await stopDevDaemon(state.endpoint, "e2e-restart");
  await startDaemon(devLog);
  console.log("e2e-restart: daemon ready");
} else {
  for (const instance of await stopWorkers(state.instances))
    console.log(
      `e2e-restart: ${instance.name} pid ${instance.pid} ${instance.result}`,
    );
  state.instances = state.instances.map((instance) => {
    const pid = spawnWorker(
      join(ROOT, "engine"),
      join(runDir, instance.name),
      instance.log,
    );
    console.log(`e2e-restart: ${instance.name} started pid ${pid}`);
    return { ...instance, pid };
  });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}
