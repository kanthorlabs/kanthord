import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, tokenOf } from "./api.mjs";
import { spawnWorker, withoutKanthordClient } from "./workers.mjs";

const [configPath, run] = process.argv.slice(2);
if (!configPath || !run) throw new Error("usage: start.mjs <config> <run>");
if (!/^[a-z0-9][a-z0-9-]*$/.test(run))
  throw new Error("RUN holds lower-case letters, digits and hyphens");

const PRIVATE_DIRECTORY = 0o700;
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const ENGINE = join(ROOT, "engine");
const config = JSON.parse(readFileSync(resolve(ROOT, configPath), "utf8"));
const runDir = join(MAIN, ".dev/e2e", run);
const baseBranch = `e2e/${run}`;
const log = (msg, fields = {}) =>
  console.log(`e2e-start: ${msg}`, Object.keys(fields).length ? fields : "");

if (existsSync(runDir)) throw new Error(`${runDir} exists. Choose another RUN`);
mkdirSync(runDir, { recursive: true, mode: PRIVATE_DIRECTORY });

function kanthord(args) {
  return execFileSync(process.execPath, ["src/main.ts", ...args], {
    cwd: ENGINE,
    encoding: "utf8",
    env: withoutKanthordClient(process.env),
  });
}

function secrets(file) {
  const values = {};
  for (const line of readFileSync(resolve(MAIN, file), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

const humanFile = join(runDir, "human.cli.yaml");
kanthord(["auth", "jwt", "generate", `e2e-${run}`, "--output", humanFile]);
const api = client(config.endpoint, tokenOf(humanFile));
log("human token issued", { file: humanFile });

const env = secrets(config.env_file);
for (const credential of config.credentials) {
  if (await api.get(`/api/llm/credential/${credential.name}`)) {
    log("credential exists", { name: credential.name });
    continue;
  }
  const key = env[credential.secret_env];
  if (!key)
    throw new Error(`${config.env_file} lacks ${credential.secret_env}`);
  const models = credential.metadata?.models ?? null;
  const metadata =
    models === null
      ? credential.metadata
      : { ...credential.metadata, models: [] };
  await api.post("/api/llm/credential", {
    name: credential.name,
    platform: credential.platform,
    metadata,
    secret: { key },
  });
  if (models !== null) {
    const created = await api.get(`/api/llm/credential/${credential.name}`);
    const revision = created.revisions.at(-1);
    await api.put(`/api/llm/credential/${credential.name}/metadata`, {
      expected_revision: revision.revision,
      metadata: { ...revision.metadata, models },
    });
  }
  log("credential created", { name: credential.name });
}

for (const [agent, enablement] of Object.entries(config.enablements)) {
  const current = await api.get(`/api/agent/enablement/${agent}`);
  const providers = [...(current?.agent_providers ?? [])];
  for (const provider of enablement.providers)
    if (!providers.some((item) => item.name === provider.name))
      providers.push(provider);
  await api.put(`/api/agent/enablement/${agent}`, {
    ...(current ? { expected_revision: current.revision } : {}),
    agent_providers: providers,
    default_configuration: enablement.default,
  });
  log("enablement set", { agent, ...enablement.default });
}

const fixture = execFileSync(
  "gh",
  [
    "api",
    `repos/${config.repository.github}/commits/${config.repository.fixture_commit}`,
    "--jq",
    ".sha",
  ],
  { encoding: "utf8" },
).trim();
execFileSync(
  "gh",
  [
    "api",
    `repos/${config.repository.github}/git/refs`,
    "-f",
    `ref=refs/heads/${baseBranch}`,
    "-f",
    `sha=${fixture}`,
  ],
  { stdio: "ignore" },
);
log("base branch pushed", { branch: baseBranch, commit: fixture.slice(0, 7) });

const project = await api.post("/api/project", { name: `e2e-${run}` });
const bindings = {
  [config.repository.binding]: {
    kind: "repository",
    config: {
      ...config.repository.config,
      strategy: {
        ...config.repository.config.strategy,
        base_branch: baseBranch,
      },
    },
  },
};
for (const worker of config.workers)
  bindings[worker.binding] = {
    kind: "worker",
    config: { worker: worker.worker, instance_count: worker.instances },
  };
const bindingSet = await api.get(`/api/project/${project.id}/binding-set`);
await api.put(`/api/project/${project.id}/binding-set`, {
  version: bindingSet.version,
  bindings,
});
log("project created", {
  project: project.id,
  bindings: Object.keys(bindings),
});

const mission = await api.get(`/api/mission/project/${project.id}`);
const planDir = resolve(ROOT, config.plan);
const snapshot = {
  mission_id: mission.id,
  mission_version: mission.version,
  reason: `Import the plan for the e2e run ${run}`,
  format: "markdown",
  files: readdirSync(planDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((filename) => ({
      filename,
      content: readFileSync(join(planDir, filename), "utf8"),
    })),
};
const preview = await api.post(
  `/api/mission/${mission.id}/import/preview`,
  snapshot,
);
if (preview.violations.length || preview.retirements.length)
  throw new Error(
    `plan preview refused: ${JSON.stringify(preview.violations)}`,
  );
await api.post(`/api/mission/${mission.id}/import`, {
  ...snapshot,
  preview_digest: preview.preview_digest,
  confirmed_retirements: [],
});
log("plan imported", { mission: mission.id, files: snapshot.files.length });

const instances = [];
for (const worker of config.workers)
  for (let index = 1; index <= worker.instances; index++) {
    const name = `${worker.binding}-${index}`;
    const home = join(runDir, name);
    const cliFile = join(home, "config/kanthord/cli.yaml");
    mkdirSync(dirname(cliFile), { recursive: true, mode: PRIVATE_DIRECTORY });
    kanthord([
      "auth",
      "jwt",
      "generate",
      "--project",
      project.id,
      "--binding",
      worker.binding,
      "--name",
      `e2e ${run} ${name}`,
      "--output",
      cliFile,
      "--endpoint",
      config.endpoint,
    ]);
    const logFile = join(runDir, `${name}.log`);
    const pid = spawnWorker(ENGINE, home, logFile);
    instances.push({ name, pid, log: logFile });
    log("worker started", { name, pid });
  }

writeFileSync(
  join(runDir, "run.json"),
  `${JSON.stringify(
    {
      run,
      endpoint: config.endpoint,
      github: config.repository.github,
      base_branch: baseBranch,
      project_id: project.id,
      mission_id: mission.id,
      instances,
    },
    null,
    2,
  )}\n`,
);
log("ready", { run_dir: runDir, watch: `make e2e-watch RUN=${run}` });
