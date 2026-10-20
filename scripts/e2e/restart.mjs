import { spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mainCheckout } from "./api.mjs";
import { stopDevDaemon } from "./daemon.mjs";
import { buildDevImages } from "./images.mjs";
import { restartInstanceProcesses } from "./instances.mjs";
import { isServerManaged } from "./placement.mjs";
import { restartServerManaged } from "./restart-steps.mjs";
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

function saveState(next) {
  writeFileSync(stateFile, `${JSON.stringify(next, null, 2)}\n`);
}

if (isServerManaged(state.placement)) {
  const devLog = join(MAIN, ".dev/e2e/dev.log");
  await restartServerManaged(state, {
    buildImages: () => {
      const imageId = buildDevImages(ROOT);
      console.log(`e2e-restart: slot images rebuilt, image ${imageId}`);
      return imageId;
    },
    saveState,
    stopDaemon: () => stopDevDaemon(state.endpoint, "e2e-restart"),
    startDaemon: () => startDaemon(devLog),
  });
  console.log("e2e-restart: daemon ready");
} else {
  const { stopped, started } = await restartInstanceProcesses(
    MAIN,
    state.instances,
    {
      stop: stopWorkers,
      spawn: (home, logFile, name) =>
        spawnWorker(join(ROOT, "engine"), home, logFile, name),
    },
  );
  for (const instance of stopped)
    console.log(
      `e2e-restart: ${instance.name}${instance.pid ? ` pid ${instance.pid}` : ""} ${instance.result}`,
    );
  for (const instance of started)
    console.log(`e2e-restart: ${instance.name} started pid ${instance.pid}`);
  state.instances = started;
  saveState(state);
}
