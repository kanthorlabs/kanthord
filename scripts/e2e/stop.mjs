import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, readEnvFile, tokenOf } from "./api.mjs";
import { stopDevDaemon } from "./daemon.mjs";
import { stopInstanceProcesses } from "./instances.mjs";
import { deleteRunDeployKeys } from "./ssh-identity.mjs";
import { stopRun } from "./stop-steps.mjs";
import {
  containerRuntime,
  requireNoOwnedContainers,
} from "./slot-containers.mjs";
import { stopWorkers } from "./workers.mjs";

const STOP_ENV = process.env.STOP ?? "";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: stop.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const state = JSON.parse(
  readFileSync(join(MAIN, ".dev/e2e", run, "run.json"), "utf8"),
);

if (STOP_ENV === "daemon") {
  const env = readEnvFile(resolve(MAIN, state.env_file));
  if (!env[state.github_token_env])
    throw new Error(`${state.env_file} lacks ${state.github_token_env}`);
  const deleted = deleteRunDeployKeys({
    repository: state.github,
    token: env[state.github_token_env],
    run,
  });
  console.log(
    `e2e-stop: ${deleted.length} deploy key(s) of ${run} deleted from ${state.github}`,
    deleted,
  );
}

const runDir = join(MAIN, ".dev/e2e", run);
await stopRun(state, STOP_ENV === "daemon", {
  pauseProject: () =>
    client(state.endpoint, tokenOf(join(runDir, "human.cli.yaml"))).post(
      `/api/project/${state.project_id}/pause`,
    ),
  stopInstances: () =>
    stopInstanceProcesses(MAIN, state.instances, { stop: stopWorkers }),
  stopDevDaemon: () => stopDevDaemon(state.endpoint, "e2e-stop"),
  requireNoContainers: () => requireNoOwnedContainers(containerRuntime()),
  log: (line) => console.log(line),
});
