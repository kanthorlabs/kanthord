import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { client, mainCheckout, tokenOf } from "./api.mjs";
import { stopWorkers } from "./workers.mjs";

const STOP_ENV = process.env.STOP ?? "";
const PORT_WAIT_MS = 5000;
const POLL_MS = 250;

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: stop.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const state = JSON.parse(
  readFileSync(join(MAIN, ".dev/e2e", run, "run.json"), "utf8"),
);

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
  if (!pids.length) {
    console.log(`e2e-stop: no daemon on port ${port}`);
    return;
  }
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
    console.log(`e2e-stop: daemon pid ${pid} stopped`);
  }
  const end = Date.now() + PORT_WAIT_MS;
  while (Date.now() < end && findListeners(port).length > 0)
    await sleep(POLL_MS);
}

if (state.placement === "server") {
  if (STOP_ENV === "daemon") {
    const port = Number(new URL(state.endpoint).port) || 31415;
    await stopDaemon(port);
  } else {
    const runDir = join(MAIN, ".dev/e2e", run);
    const api = client(state.endpoint, tokenOf(join(runDir, "human.cli.yaml")));
    const project = await api.post(`/api/project/${state.project_id}/pause`);
    console.log(`e2e-stop: project ${project.id} paused`);
  }
} else {
  for (const instance of await stopWorkers(state.instances))
    console.log(
      `e2e-stop: ${instance.name} pid ${instance.pid} ${instance.result}`,
    );
}
