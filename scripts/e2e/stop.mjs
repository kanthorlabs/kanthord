import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, tokenOf } from "./api.mjs";
import { stopDevDaemon } from "./daemon.mjs";
import { stopWorkers } from "./workers.mjs";

const STOP_ENV = process.env.STOP ?? "";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: stop.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const state = JSON.parse(
  readFileSync(join(MAIN, ".dev/e2e", run, "run.json"), "utf8"),
);

if (state.placement === "server") {
  if (STOP_ENV === "daemon") {
    await stopDevDaemon(state.endpoint, "e2e-stop");
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
