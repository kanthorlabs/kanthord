import { execFileSync, spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mainCheckout } from "./api.mjs";
import { spawnWorker, stopWorkers } from "./workers.mjs";

const DAEMON_WAIT_S = 60;
const PORT_WAIT_MS = 5000;
const POLL_MS = 250;

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: restart.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const runDir = join(MAIN, ".dev/e2e", run);
const stateFile = join(runDir, "run.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));

function findListeners(port) {
  try {
    return execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function watchParent(pid) {
  try {
    const ppid = Number(
      execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim(),
    );
    if (!ppid || ppid === 1) return null;
    const cmd = execFileSync("ps", ["-o", "command=", "-p", String(ppid)], {
      encoding: "utf8",
    }).trim();
    return cmd.includes("--watch") ? ppid : null;
  } catch {
    return null;
  }
}

async function stopDaemon(port) {
  const pids = findListeners(port);
  if (!pids.length) return;
  for (const pid of pids) {
    const parent = watchParent(pid);
    if (parent) {
      try {
        process.kill(parent, "SIGTERM");
      } catch {}
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    console.log(`e2e-restart: daemon pid ${pid} stopped`);
  }
  const end = Date.now() + PORT_WAIT_MS;
  while (Date.now() < end && findListeners(port).length > 0)
    await sleep(POLL_MS);
}

async function startDaemon(port, devLog) {
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
  const port = Number(new URL(state.endpoint).port) || 31415;
  const devLog = join(MAIN, ".dev/e2e/dev.log");
  await stopDaemon(port);
  await startDaemon(port, devLog);
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
