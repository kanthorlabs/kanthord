import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, tokenOf } from "./api.mjs";
import {
  enablementCredentials,
  instanceCli,
  scaleServerBinding,
  scaleWorkerBinding,
  signInMessage,
} from "./instances.mjs";
import { isServerManaged } from "./placement.mjs";
import { spawnWorker, stopWorkers } from "./workers.mjs";

const [run, binding, countStr] = process.argv.slice(2);
if (!run || !binding || !countStr)
  throw new Error("usage: scale.mjs <run> <binding> <count>");
const count = Number(countStr);
if (!Number.isInteger(count) || count < 0)
  throw new Error("COUNT must be a non-negative integer");

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const ENGINE = join(ROOT, "engine");
const runDir = join(MAIN, ".dev/e2e", run);
const stateFile = join(runDir, "run.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));

const token = tokenOf(join(runDir, "human.cli.yaml"));
const api = client(state.endpoint, token);
const bindingSet = await api.get(
  `/api/project/${state.project_id}/binding-set`,
);
const entry = bindingSet.bindings[binding];
if (!entry) throw new Error(`binding ${binding} not found`);
if (entry.kind !== "worker")
  throw new Error(`binding ${binding} is not a worker binding`);

if (isServerManaged(state.placement)) {
  const prepared = await scaleServerBinding(
    {
      api,
      projectId: state.project_id,
      bindingSet,
      binding,
      count,
      placement: state.placement,
      run,
    },
    { api, cli: instanceCli(ENGINE, state.endpoint, token), main: MAIN },
  );
  for (const { name, result } of prepared)
    console.log(`e2e-scale: ${name} instance ${result}`);
} else {
  if (!state.config)
    throw new Error("run.json holds no config. Start a new run with make e2e");
  const config = JSON.parse(readFileSync(resolve(ROOT, state.config), "utf8"));
  const scaled = await scaleWorkerBinding(
    {
      api,
      projectId: state.project_id,
      bindingSet,
      binding,
      count,
      credentials: enablementCredentials(config.enablements),
      known: state.instances,
    },
    {
      api,
      cli: instanceCli(ENGINE, state.endpoint, token),
      main: MAIN,
      spawn: (home, logFile, name) => spawnWorker(ENGINE, home, logFile, name),
      stop: stopWorkers,
    },
  );
  for (const { name, pid, result, started } of scaled.prepared)
    console.log(
      `e2e-scale: ${name} instance ${result}, pid ${pid}${started ? " started" : ""}`,
    );
  if (scaled.instances === null) {
    console.error(signInMessage("e2e-scale", scaled.gaps));
    process.exit(1);
  }
  state.instances = scaled.instances;
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}
console.log(
  `e2e-scale: ${binding} worker_instances -> ${entry.config.worker_instances.join(", ")}`,
);
