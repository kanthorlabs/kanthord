import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, readEnvFile, tokenOf } from "./api.mjs";
import {
  mergedProviders,
  requireEnablementCredentials,
  unsuitableEnablementCredentials,
} from "./enablement.mjs";
import {
  addDeployKey,
  createSshKey,
  pinHostKey,
  sshCredentialNameOf,
  sshHostOf,
} from "./ssh-identity.mjs";
import { spawnWorker, withoutKanthordClient } from "./workers.mjs";

const [configPath, run, pausedFlag = "1", placement = "server"] =
  process.argv.slice(2);
if (!configPath || !run) throw new Error("usage: start.mjs <config> <run>");
const paused = pausedFlag !== "0";
if (!/^[a-z0-9][a-z0-9-]*$/.test(run))
  throw new Error("RUN holds lower-case letters, digits and hyphens");
if (placement !== "server" && placement !== "worker")
  throw new Error(`PLACEMENT must be server or worker, got ${placement}`);

const PRIVATE_DIRECTORY = 0o700;
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const ENGINE = join(ROOT, "engine");
const config = JSON.parse(readFileSync(resolve(ROOT, configPath), "utf8"));
const runDir = join(MAIN, ".dev/e2e", run);
const baseBranch = `e2e/${run}`;
const log = (msg, fields = {}) =>
  console.log(`e2e-start: ${msg}`, Object.keys(fields).length ? fields : "");

const sshCredential = config.repository_credentials.find(
  (credential) =>
    credential.platform === "ssh" &&
    credential.name === config.repository.config.ssh_credential,
);
if (!sshCredential)
  throw new Error(
    `repository_credentials holds no ssh entry ${config.repository.config.ssh_credential}`,
  );
const sshCredentialName = sshCredentialNameOf(sshCredential.name, run);

if (existsSync(runDir)) throw new Error(`${runDir} exists. Choose another RUN`);
mkdirSync(runDir, { recursive: true, mode: PRIVATE_DIRECTORY });

function writeRunState() {
  writeFileSync(
    join(runDir, "run.json"),
    `${JSON.stringify(runState, null, 2)}\n`,
  );
}

function kanthord(args) {
  return execFileSync(process.execPath, ["src/main.ts", ...args], {
    cwd: ENGINE,
    encoding: "utf8",
    env: withoutKanthordClient(process.env),
  });
}

const humanFile = join(runDir, "human.cli.yaml");
kanthord(["auth", "jwt", "generate", `e2e-${run}`, "--output", humanFile]);
const api = client(config.endpoint, tokenOf(humanFile));
log("human token issued", { file: humanFile });

const env = readEnvFile(resolve(MAIN, config.env_file));
function secretOf(name) {
  if (!env[name]) throw new Error(`${config.env_file} lacks ${name}`);
  return env[name];
}

for (const credential of config.credentials) {
  if (await api.get(`/api/llm/credential/${credential.name}`)) {
    log("credential exists", { name: credential.name });
    continue;
  }
  const key = secretOf(credential.secret_env);
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

const githubTokenEnv = config.repository_credentials.find(
  (credential) => credential.name === config.repository.config.credential,
).secret_env;

for (const credential of config.repository_credentials) {
  if (credential.platform === "ssh") continue;
  if (await api.get(`/api/repository/credential/${credential.name}`)) {
    log("credential exists", { name: credential.name });
    continue;
  }
  await api.post("/api/repository/credential", {
    name: credential.name,
    platform: credential.platform,
    metadata: null,
    secret: { key: secretOf(credential.secret_env) },
  });
  log("credential created", { name: credential.name });
}

requireEnablementCredentials(
  await unsuitableEnablementCredentials(api, config.enablements, configPath),
);

const sshKey = await createSshKey(api, sshCredentialName);
log("SSH key created", {
  name: sshCredentialName,
  fingerprint: sshKey.fingerprint,
});
const sshHost = sshHostOf(config.repository.config.address);
const pin = await pinHostKey(api, sshHost);
log("host key pinned", { host: pin.host, fingerprint: pin.fingerprint });
const runState = {
  run,
  endpoint: config.endpoint,
  env_file: config.env_file,
  github_token_env: githubTokenEnv,
  github: config.repository.github,
  ssh_credential: sshCredentialName,
  deploy_key_id: null,
  placement,
};
writeRunState();
runState.deploy_key_id = addDeployKey({
  repository: config.repository.github,
  token: secretOf(githubTokenEnv),
  run,
  publicKey: sshKey.public_key,
});
writeRunState();
log("deploy key added", {
  repository: config.repository.github,
  id: runState.deploy_key_id,
});

for (const [agent, enablement] of Object.entries(config.enablements)) {
  const current = await api.get(`/api/agent/enablement/${agent}`);
  await api.put(`/api/agent/enablement/${agent}`, {
    ...(current ? { expected_revision: current.revision } : {}),
    agent_providers: mergedProviders(current, enablement),
    default_configuration: enablement.default,
    fallback_configurations: enablement.fallback_configurations,
  });
  log("enablement set", { agent, ...enablement.default });
}

const ghEnv = { ...process.env, GH_TOKEN: secretOf(githubTokenEnv) };
const fixture = execFileSync(
  "gh",
  [
    "api",
    `repos/${config.repository.github}/commits/${config.repository.fixture_commit}`,
    "--jq",
    ".sha",
  ],
  { encoding: "utf8", env: ghEnv },
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
  { stdio: "ignore", env: ghEnv },
);
log("base branch pushed", { branch: baseBranch, commit: fixture.slice(0, 7) });

const project = await api.post("/api/project", { name: `e2e-${run}` });
if (paused) {
  await api.post(`/api/project/${project.id}/pause`);
  log("project paused", { project: project.id });
}
const bindings = {
  [config.repository.binding]: {
    kind: "repository",
    config: {
      ...config.repository.config,
      ssh_credential: sshCredentialName,
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
    config: {
      worker: worker.worker,
      instance_count: worker.instances,
      ...(placement === "server" ? { placement: "server" } : {}),
    },
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

const inbound = await api.post("/api/intake/inbound", {
  project_id: project.id,
  kind: "poll",
  platform: "github",
  consumer: "mission.delivery.admit",
  credential: config.repository.config.credential,
  configuration: { resource: config.repository.github },
});
log("poll inbound created", {
  inbound: inbound.id,
  resource: config.repository.github,
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

Object.assign(runState, {
  base_branch: baseBranch,
  fixture_commit: fixture,
  project_id: project.id,
  mission_id: mission.id,
});

if (placement === "server") {
  log("workers managed by the daemon pool", {
    bindings: config.workers.map((worker) => worker.binding),
  });
} else {
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
  runState.instances = instances;
}

writeRunState();
log("ready", {
  run_dir: runDir,
  placement,
  watch: `make e2e-watch RUN=${run}`,
  ...(paused ? { resume: `make e2e-resume RUN=${run}` } : {}),
});
