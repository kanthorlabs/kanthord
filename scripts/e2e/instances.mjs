import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { checkoutCommand } from "./api.mjs";
import { withoutKanthordClient } from "./workers.mjs";

export const INSTANCES_DIRECTORY = ".dev/e2e/instances";
const PRIVATE_DIRECTORY = 0o700;
const INSTANCE_ID_LINE = /^instance_id: (\S+)$/m;
const PROCESS_FILE = "process.json";
const LOG_FILE = "serve.log";
const WORKER_PLACEMENT = "worker";

export function devInstanceName(worker, index) {
  return `e2e-${worker.split("@")[0]}-${index}`;
}

export function devInstances(worker, count) {
  return Array.from({ length: count }, (_, index) => ({
    name: devInstanceName(worker, index + 1),
    worker,
  }));
}

export function configInstances(workers) {
  const instances = new Map();
  for (const { worker, instances: count } of workers)
    for (const instance of devInstances(worker, count))
      instances.set(instance.name, instance);
  return [...instances.values()];
}

export function workerBindingConfig({ worker, instances }, placement) {
  if (placement !== WORKER_PLACEMENT)
    return { worker, instance_count: instances, placement };
  return {
    worker,
    placement,
    worker_instances: devInstances(worker, instances).map(({ name }) => name),
  };
}

export function instanceHome(main, name) {
  return join(main, INSTANCES_DIRECTORY, name);
}

export function localInstanceId(home, name) {
  const file = join(home, "config/kanthord/workers", `${name}.yaml`);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").match(INSTANCE_ID_LINE)?.[1] ?? null;
}

export function instanceCli(engine, endpoint, token) {
  return (home, args) =>
    execFileSync(process.execPath, ["src/main.ts", ...args], {
      cwd: engine,
      encoding: "utf8",
      env: {
        ...withoutKanthordClient(process.env),
        XDG_CONFIG_HOME: join(home, "config"),
        KANTHORD_ENDPOINT: endpoint,
        KANTHORD_TOKEN: token,
      },
    });
}

export async function ensureInstance(api, cli, home, { name, worker }) {
  const record = await api.get(`/api/worker/instance/${name}`);
  if (record !== null && record.ended_at !== null)
    throw new Error(
      `worker instance ${name} is archived. An archived name stays taken, so the run cannot create it again. Reset the dev database`,
    );
  if (record !== null && localInstanceId(home, name) === record.id)
    return "kept";
  mkdirSync(home, { recursive: true, mode: PRIVATE_DIRECTORY });
  rmSync(join(home, "config"), { recursive: true, force: true });
  if (record === null) {
    cli(home, [
      "worker",
      "instance",
      "create",
      name,
      "--worker",
      worker,
      "--output",
    ]);
    return "created";
  }
  cli(home, [
    "worker",
    "instance",
    "rotate",
    name,
    "--expected-revision",
    String(record.revision),
    "--output",
  ]);
  return "rotated";
}

export function processCommand(pid, exec = execFileSync) {
  try {
    return exec("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

export function runningProcess(home, name, commandOf = processCommand) {
  const file = join(home, PROCESS_FILE);
  if (!existsSync(file)) return null;
  const recorded = JSON.parse(readFileSync(file, "utf8"));
  return commandOf(recorded.pid).endsWith(`serve worker --instance ${name}`)
    ? recorded
    : null;
}

export function startInstanceProcess(home, name, spawn) {
  const log = join(home, LOG_FILE);
  const pid = spawn(home, log, name);
  writeFileSync(join(home, PROCESS_FILE), `${JSON.stringify({ pid, log })}\n`);
  return { pid, log };
}

export async function prepareInstances(
  instances,
  { api, cli, main, spawn, stop, commandOf = processCommand },
) {
  const prepared = [];
  for (const instance of instances) {
    const home = instanceHome(main, instance.name);
    const result = await ensureInstance(api, cli, home, instance);
    let running = runningProcess(home, instance.name, commandOf);
    if (running !== null && result !== "kept") {
      await stop([{ name: instance.name, ...running }]);
      running = null;
    }
    const started = running === null;
    const process = running ?? startInstanceProcess(home, instance.name, spawn);
    prepared.push({ ...instance, ...process, result, started });
  }
  return prepared;
}

export function runInstances(prepared) {
  return prepared.map(({ name, worker, pid, log }) => ({
    name,
    worker,
    pid,
    log,
  }));
}

export function listedInstances(bindings, known) {
  const byName = new Map(known.map((instance) => [instance.name, instance]));
  const listed = new Set(
    Object.values(bindings).flatMap(({ kind, config }) =>
      kind === "worker" ? (config.worker_instances ?? []) : [],
    ),
  );
  return [...listed].flatMap((name) =>
    byName.has(name) ? [byName.get(name)] : [],
  );
}

export async function restartInstanceProcesses(
  main,
  instances,
  { stop, spawn, commandOf = processCommand },
) {
  const stopped = await stopInstanceProcesses(main, instances, {
    stop,
    commandOf,
  });
  const started = instances.map((instance) => ({
    ...instance,
    ...startInstanceProcess(
      instanceHome(main, instance.name),
      instance.name,
      spawn,
    ),
  }));
  return { stopped, started };
}

export async function scaleWorkerBinding(
  { api, projectId, bindingSet, binding, count, credentials, known },
  deps,
) {
  const entry = bindingSet.bindings[binding];
  const instances = devInstances(entry.config.worker, count);
  const prepared = await prepareInstances(instances, deps);
  const gaps = await signInGaps(api, instances, credentials);
  if (hasSignInGaps(gaps)) return { prepared, gaps, instances: null };
  entry.config.worker_instances = instances.map(({ name }) => name);
  await api.put(`/api/project/${projectId}/binding-set`, {
    version: bindingSet.version,
    bindings: bindingSet.bindings,
  });
  return {
    prepared,
    gaps,
    instances: listedInstances(bindingSet.bindings, [
      ...known,
      ...runInstances(prepared),
    ]),
  };
}

export async function stopInstanceProcesses(
  main,
  instances,
  { stop, commandOf = processCommand },
) {
  const running = [];
  const absent = [];
  for (const { name } of instances) {
    const process = runningProcess(instanceHome(main, name), name, commandOf);
    if (process === null) absent.push({ name, result: "not running" });
    else running.push({ name, ...process });
  }
  return [...(await stop(running)), ...absent];
}

export function enablementCredentials(enablements) {
  const credentials = new Map();
  for (const enablement of Object.values(enablements))
    for (const configuration of [
      enablement.default,
      ...enablement.fallback_configurations,
    ]) {
      const provider = enablement.providers.find(
        ({ name }) => name === configuration.agent_provider,
      );
      if (provider) credentials.set(provider.credential, provider.provider);
    }
  return [...credentials].map(([credential, platform]) => ({
    credential,
    platform,
  }));
}

function hasLiveRevision(copy, platform) {
  return (
    copy.platform === platform &&
    copy.revisions.some(({ ended_at }) => ended_at === null)
  );
}

export async function signInGaps(api, instances, credentials) {
  const commands = [];
  const blocked = [];
  for (const { name } of instances)
    for (const { credential, platform } of credentials) {
      const copy = await api.get(
        `/api/llm/credential/${credential}?holder=${name}`,
      );
      if (copy === null || hasLiveRevision(copy, platform)) {
        if (copy?.sealed_current) continue;
        commands.push(
          checkoutCommand(
            `llm credential login ${platform} --name ${credential} --holder ${name}`,
          ),
        );
      } else blocked.push({ instance: name, credential });
    }
  return { commands, blocked };
}

export function hasSignInGaps({ commands, blocked }) {
  return commands.length + blocked.length > 0;
}

export function signInMessage(label, { commands, blocked }) {
  const lines = [];
  if (commands.length)
    lines.push(
      `${label}: sign in once on each dev instance below. The instance processes stay active, because a sign-in needs a connected instance.`,
      `${label}: do one login at a time. Open its address, then run ${checkoutCommand("llm credential login-code <session_id> <code#state>")} before the next login.`,
      ...commands.map((command) => `  ${command}`),
    );
  for (const { instance, credential } of blocked)
    lines.push(
      `${label}: ${instance} holds a copy of ${credential} that takes no sign-in, because the copy is archived or holds another platform. Reset the dev database, then sign in again.`,
    );
  lines.push(`${label}: then run the command again.`);
  return lines.join("\n");
}

export function connectionChanges(known, records) {
  const changes = [];
  for (const [name, record] of records) {
    const label = connectionLabel(record);
    const before = known.get(name);
    if (before !== label)
      changes.push(`instance ${name}: ${before ?? "-"} -> ${label}`);
    known.set(name, label);
  }
  return changes;
}

export function connectionLabel(record) {
  const connection = record?.connection ?? null;
  if (connection === null) return "disconnected";
  return `connected name=${connection.connection_name} since=${new Date(connection.connected_at).toISOString()}`;
}
