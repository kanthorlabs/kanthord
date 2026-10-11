import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mainCheckout } from "./api.mjs";
import { spawnWorker, stopWorkers } from "./workers.mjs";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: restart.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const runDir = join(MAIN, ".dev/e2e", run);
const stateFile = join(runDir, "run.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
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
