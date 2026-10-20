import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, tokenOf } from "./api.mjs";
import { isServerManaged } from "./placement.mjs";

const [run, binding, countStr] = process.argv.slice(2);
if (!run || !binding || !countStr)
  throw new Error("usage: scale.mjs <run> <binding> <count>");
const count = Number(countStr);
if (!Number.isInteger(count) || count < 0)
  throw new Error("COUNT must be a non-negative integer");

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const runDir = join(MAIN, ".dev/e2e", run);
const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));

if (!isServerManaged(state.placement))
  throw new Error(`e2e-scale refuses a run at placement ${state.placement}`);

const api = client(state.endpoint, tokenOf(join(runDir, "human.cli.yaml")));
const bindingSet = await api.get(
  `/api/project/${state.project_id}/binding-set`,
);
const entry = bindingSet.bindings[binding];
if (!entry) throw new Error(`binding ${binding} not found`);
if (entry.kind !== "worker")
  throw new Error(`binding ${binding} is not a worker binding`);
entry.config.instance_count = count;
await api.put(`/api/project/${state.project_id}/binding-set`, {
  version: bindingSet.version,
  bindings: bindingSet.bindings,
});
console.log(`e2e-scale: ${binding} instance_count -> ${count}`);
