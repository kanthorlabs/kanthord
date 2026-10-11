import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mainCheckout } from "./api.mjs";
import { stopWorkers } from "./workers.mjs";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: stop.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const state = JSON.parse(
  readFileSync(join(MAIN, ".dev/e2e", run, "run.json"), "utf8"),
);
for (const instance of await stopWorkers(state.instances))
  console.log(
    `e2e-stop: ${instance.name} pid ${instance.pid} ${instance.result}`,
  );
