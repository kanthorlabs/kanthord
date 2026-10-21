import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configInstances,
  connectionLabel,
  devInstances,
  enablementCredentials,
  ensureInstance,
  instanceHome,
  listedInstances,
  localInstanceId,
  prepareInstances,
  processCommand,
  runInstances,
  runningProcess,
  connectionChanges,
  hasSignInGaps,
  restartInstanceProcesses,
  scaleWorkerBinding,
  signInGaps,
  signInMessage,
  stopInstanceProcesses,
  workerBindingConfig,
} from "./instances.mjs";
import { withoutKanthordClient, workerArguments } from "./workers.mjs";

const TODOAPP = JSON.parse(
  readFileSync(new URL("./todoapp.json", import.meta.url), "utf8"),
);
const CODER = { name: "e2e-coder-1", worker: "coder@1" };
const LIVE_ID = "worker_instance_01K00000000000000000000002";
const OLD_ID = "worker_instance_01K00000000000000000000001";
const LIVE_RECORD = {
  id: LIVE_ID,
  name: "e2e-coder-1",
  worker: "coder@1",
  revision: 2,
  ended_at: null,
};
const SUBSCRIPTION = {
  credential: "anthropic-subscription",
  platform: "anthropic-subscription",
};
const LOGIN =
  "(cd engine && node src/main.ts llm credential login anthropic-subscription --name anthropic-subscription --holder";
const login = (name) => `${LOGIN} ${name})`;

function withMain(body) {
  const main = mkdtempSync(join(tmpdir(), "e2e-instances-"));
  return Promise.resolve(body(main)).finally(() =>
    rmSync(main, { recursive: true, force: true }),
  );
}

function writeInstanceFile(home, name, instanceId) {
  const directory = join(home, "config/kanthord/workers");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${name}.yaml`),
    `name: ${name}\nendpoint: http://127.0.0.1:31415\ninstance_id: ${instanceId}\nprivate_key: AAAA\n`,
  );
}

function fakeApi(answers) {
  const paths = [];
  return {
    api: {
      get: (path) => {
        paths.push(path);
        return Promise.resolve(answers[path] ?? null);
      },
    },
    paths,
  };
}

function recordingCli(instanceId = LIVE_ID) {
  const calls = [];
  return {
    calls,
    cli: (home, args) => {
      calls.push(args);
      writeInstanceFile(home, args[3], instanceId);
      return "";
    },
  };
}

test("the dev instances of a config are e2e-<worker>-<n>, one list for each worker", () => {
  assert.deepEqual(devInstances("reviewer@1", 2), [
    { name: "e2e-reviewer-1", worker: "reviewer@1" },
    { name: "e2e-reviewer-2", worker: "reviewer@1" },
  ]);
  assert.deepEqual(configInstances(TODOAPP.workers), [
    CODER,
    { name: "e2e-reviewer-1", worker: "reviewer@1" },
  ]);
  assert.deepEqual(
    configInstances([
      { binding: "a", worker: "coder@1", instances: 2 },
      { binding: "b", worker: "coder@1", instances: 1 },
    ]).map(({ name }) => name),
    ["e2e-coder-1", "e2e-coder-2"],
  );
});

test("a worker binding lists its dev instances at the worker placement and keeps instance_count elsewhere", () => {
  const coder = { binding: "coder", worker: "coder@1", instances: 2 };
  assert.deepEqual(workerBindingConfig(coder, "worker"), {
    worker: "coder@1",
    placement: "worker",
    worker_instances: ["e2e-coder-1", "e2e-coder-2"],
  });
  for (const placement of ["server", "container"])
    assert.deepEqual(workerBindingConfig(coder, placement), {
      worker: "coder@1",
      instance_count: 2,
      placement,
    });
});

test("a missing record removes the local configuration and creates the instance again", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    writeInstanceFile(home, CODER.name, OLD_ID);
    writeFileSync(join(home, "config/kanthord/stale.yaml"), "x");
    const { api } = fakeApi({});
    const { cli, calls } = recordingCli();
    assert.equal(await ensureInstance(api, cli, home, CODER), "created");
    assert.deepEqual(calls, [
      [
        "worker",
        "instance",
        "create",
        "e2e-coder-1",
        "--worker",
        "coder@1",
        "--output",
      ],
    ]);
    assert.equal(existsSync(join(home, "config/kanthord/stale.yaml")), false);
    assert.equal(localInstanceId(home, CODER.name), LIVE_ID);
  }));

test("an ended revision or a lost local file rotates the instance with the live revision", async () => {
  for (const localId of [OLD_ID, null])
    await withMain(async (main) => {
      const home = instanceHome(main, CODER.name);
      if (localId) writeInstanceFile(home, CODER.name, localId);
      const { api } = fakeApi({
        "/api/worker/instance/e2e-coder-1": LIVE_RECORD,
      });
      const { cli, calls } = recordingCli();
      assert.equal(await ensureInstance(api, cli, home, CODER), "rotated");
      assert.deepEqual(calls, [
        [
          "worker",
          "instance",
          "rotate",
          "e2e-coder-1",
          "--expected-revision",
          "2",
          "--output",
        ],
      ]);
      assert.equal(localInstanceId(home, CODER.name), LIVE_ID);
    });
});

test("a live record with the local revision keeps the instance and calls no command", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    writeInstanceFile(home, CODER.name, LIVE_ID);
    const { api } = fakeApi({
      "/api/worker/instance/e2e-coder-1": LIVE_RECORD,
    });
    const { cli, calls } = recordingCli();
    assert.equal(await ensureInstance(api, cli, home, CODER), "kept");
    assert.deepEqual(calls, []);
  }));

test("an archived instance stops the run, because its name stays taken", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    const { api } = fakeApi({
      "/api/worker/instance/e2e-coder-1": {
        ...LIVE_RECORD,
        ended_at: 1792426097901,
      },
    });
    const { cli, calls } = recordingCli();
    await assert.rejects(
      ensureInstance(api, cli, home, CODER),
      /e2e-coder-1 is archived/,
    );
    assert.deepEqual(calls, []);
  }));

test("prepareInstances starts a process for an instance without one and joins a running process", async () =>
  withMain(async (main) => {
    const reviewer = { name: "e2e-reviewer-1", worker: "reviewer@1" };
    writeInstanceFile(instanceHome(main, CODER.name), CODER.name, LIVE_ID);
    writeInstanceFile(
      instanceHome(main, reviewer.name),
      reviewer.name,
      "worker_instance_01K00000000000000000000003",
    );
    writeFileSync(
      join(instanceHome(main, reviewer.name), "process.json"),
      JSON.stringify({ pid: 4100, log: "/r.log" }),
    );
    const { api } = fakeApi({
      "/api/worker/instance/e2e-coder-1": LIVE_RECORD,
      "/api/worker/instance/e2e-reviewer-1": {
        ...LIVE_RECORD,
        id: "worker_instance_01K00000000000000000000003",
        name: reviewer.name,
        worker: reviewer.worker,
      },
    });
    const spawned = [];
    const prepared = await prepareInstances([CODER, reviewer], {
      api,
      cli: recordingCli().cli,
      main,
      spawn: (home, log, name) => {
        spawned.push({ home, log, name });
        return 4200;
      },
      stop: () => assert.fail("no stop expected"),
      commandOf: (pid) =>
        pid === 4100
          ? "node src/main.ts serve worker --instance e2e-reviewer-1"
          : "",
    });
    const coderHome = instanceHome(main, CODER.name);
    assert.deepEqual(spawned, [
      { home: coderHome, log: join(coderHome, "serve.log"), name: CODER.name },
    ]);
    assert.deepEqual(
      JSON.parse(readFileSync(join(coderHome, "process.json"), "utf8")),
      { pid: 4200, log: join(coderHome, "serve.log") },
    );
    assert.deepEqual(runInstances(prepared), [
      {
        name: "e2e-coder-1",
        worker: "coder@1",
        pid: 4200,
        log: join(coderHome, "serve.log"),
      },
      {
        name: "e2e-reviewer-1",
        worker: "reviewer@1",
        pid: 4100,
        log: "/r.log",
      },
    ]);
    assert.deepEqual(
      prepared.map(({ result, started }) => ({ result, started })),
      [
        { result: "kept", started: true },
        { result: "kept", started: false },
      ],
    );
  }));

test("prepareInstances stops the process of a created again instance before it starts a new one", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    writeInstanceFile(home, CODER.name, OLD_ID);
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "process.json"),
      JSON.stringify({ pid: 4100, log: "/c.log" }),
    );
    const { api } = fakeApi({});
    const order = [];
    const prepared = await prepareInstances([CODER], {
      api,
      cli: recordingCli().cli,
      main,
      spawn: () => {
        order.push("spawn");
        return 4300;
      },
      stop: async (instances) => {
        order.push(["stop", instances.map(({ name, pid }) => [name, pid])]);
        return [];
      },
      commandOf: (pid) =>
        pid === 4100
          ? "node src/main.ts serve worker --instance e2e-coder-1"
          : "",
    });
    assert.deepEqual(order, [["stop", [["e2e-coder-1", 4100]]], "spawn"]);
    assert.equal(prepared[0].result, "created");
    assert.equal(prepared[0].pid, 4300);
  }));

test("runningProcess accepts only a serve worker process of the same instance", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    assert.equal(
      runningProcess(home, CODER.name, () => ""),
      null,
    );
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "process.json"),
      JSON.stringify({ pid: 4100, log: "/c.log" }),
    );
    const cases = [
      ["", null],
      ["/usr/bin/vim notes.txt", null],
      ["node src/main.ts serve worker --instance e2e-coder-10", null],
      [
        "/opt/node src/main.ts serve worker --instance e2e-coder-1",
        { pid: 4100, log: "/c.log" },
      ],
    ];
    for (const [command, expected] of cases)
      assert.deepEqual(
        runningProcess(home, CODER.name, () => command),
        expected,
      );
  }));

test("processCommand reads the command of a pid through ps and answers empty for a gone pid", () => {
  const calls = [];
  const command = processCommand(4100, (file, args) => {
    calls.push([file, args]);
    return "node src/main.ts serve worker --instance e2e-coder-1\n";
  });
  assert.equal(command, "node src/main.ts serve worker --instance e2e-coder-1");
  assert.deepEqual(calls, [["ps", ["-ww", "-o", "command=", "-p", "4100"]]]);
  assert.equal(
    processCommand(4100, () => {
      throw new Error("exit 1");
    }),
    "",
  );
});

test("the enablement credentials are the providers of the default and fallback configurations", () => {
  assert.deepEqual(enablementCredentials(TODOAPP.enablements), [SUBSCRIPTION]);
  const enablement = {
    providers: [
      { name: "a", provider: "openrouter", credential: "e2e-openrouter" },
      { name: "b", provider: "nvidia", credential: "e2e-nvidia" },
      { name: "c", provider: "openrouter", credential: "unused" },
    ],
    default: { agent_provider: "a" },
    fallback_configurations: [{ agent_provider: "b" }],
  };
  assert.deepEqual(enablementCredentials({ "swe@1": enablement }), [
    { credential: "e2e-openrouter", platform: "openrouter" },
    { credential: "e2e-nvidia", platform: "nvidia" },
  ]);
});

const LIVE_COPY = {
  platform: "anthropic-subscription",
  sealed_current: true,
  revisions: [{ revision: 1, ended_at: null }],
};
const copyPath = (name) =>
  `/api/llm/credential/anthropic-subscription?holder=${name}`;

test("signInGaps names one login for each dev instance without a live copy and reports an archived copy", async () => {
  const instances = [
    { name: "e2e-coder-1" },
    { name: "e2e-coder-2" },
    { name: "e2e-coder-3" },
    { name: "e2e-coder-4" },
    { name: "e2e-reviewer-1" },
  ];
  const { api, paths } = fakeApi({
    [copyPath("e2e-coder-1")]: LIVE_COPY,
    [copyPath("e2e-coder-2")]: { ...LIVE_COPY, sealed_current: false },
    [copyPath("e2e-coder-3")]: {
      ...LIVE_COPY,
      sealed_current: false,
      revisions: [{ revision: 1, ended_at: 1792426097901 }],
    },
    [copyPath("e2e-coder-4")]: { ...LIVE_COPY, platform: "openai-codex" },
  });
  const gaps = await signInGaps(api, instances, [SUBSCRIPTION]);
  assert.deepEqual(
    paths,
    instances.map(({ name }) => copyPath(name)),
  );
  assert.deepEqual(gaps, {
    commands: [login("e2e-coder-2"), login("e2e-reviewer-1")],
    blocked: [
      { instance: "e2e-coder-3", credential: "anthropic-subscription" },
      { instance: "e2e-coder-4", credential: "anthropic-subscription" },
    ],
  });
  assert.equal(hasSignInGaps(gaps), true);
  const none = await signInGaps(
    fakeApi({ [copyPath("e2e-coder-1")]: LIVE_COPY }).api,
    [instances[0]],
    [SUBSCRIPTION],
  );
  assert.deepEqual(none, { commands: [], blocked: [] });
  assert.equal(hasSignInGaps(none), false);
});

test("the sign-in message prints each command from the checkout root, one login at a time, and the reset for an archived copy", () => {
  assert.equal(
    signInMessage("e2e-start", {
      commands: [login("e2e-coder-1")],
      blocked: [
        { instance: "e2e-coder-2", credential: "anthropic-subscription" },
      ],
    }),
    [
      "e2e-start: sign in once on each dev instance below. The instance processes stay active, because a sign-in needs a connected instance.",
      "e2e-start: do one login at a time. Open its address, then run (cd engine && node src/main.ts llm credential login-code <session_id> <code#state>) before the next login.",
      "  (cd engine && node src/main.ts llm credential login anthropic-subscription --name anthropic-subscription --holder e2e-coder-1)",
      "e2e-start: e2e-coder-2 holds a copy of anthropic-subscription that takes no sign-in, because the copy is archived or holds another platform. Reset the dev database, then sign in again.",
      "e2e-start: then run the command again.",
    ].join("\n"),
  );
});

function scaleFixture(main, answers) {
  writeInstanceFile(instanceHome(main, CODER.name), CODER.name, LIVE_ID);
  const puts = [];
  const { api } = fakeApi({
    "/api/worker/instance/e2e-coder-1": LIVE_RECORD,
    [copyPath("e2e-coder-1")]: LIVE_COPY,
    ...answers,
  });
  api.put = (path, body) => {
    puts.push({ path, body: structuredClone(body) });
    return Promise.resolve(null);
  };
  const bindingSet = {
    version: 7,
    bindings: {
      repo: { kind: "repository", config: {} },
      coder: {
        kind: "worker",
        config: {
          worker: "coder@1",
          placement: "worker",
          worker_instances: ["e2e-coder-1"],
        },
      },
    },
  };
  const request = {
    api,
    projectId: "project_1",
    bindingSet,
    binding: "coder",
    count: 2,
    credentials: [SUBSCRIPTION],
    known: [{ name: "e2e-coder-1", worker: "coder@1", pid: 1, log: "/1" }],
  };
  let pid = 5000;
  const deps = {
    api,
    cli: recordingCli("worker_instance_01K00000000000000000000009").cli,
    main,
    spawn: () => ++pid,
    stop: async () => [],
    commandOf: () => "",
  };
  return { request, deps, puts };
}

test("scale at worker writes no binding while a new dev instance holds no live copy", async () =>
  withMain(async (main) => {
    const { request, deps, puts } = scaleFixture(main, {});
    const scaled = await scaleWorkerBinding(request, deps);
    assert.equal(scaled.instances, null);
    assert.deepEqual(scaled.gaps.commands, [login("e2e-coder-2")]);
    assert.deepEqual(
      scaled.prepared.map(({ name, result, started }) => [
        name,
        result,
        started,
      ]),
      [
        ["e2e-coder-1", "kept", true],
        ["e2e-coder-2", "created", true],
      ],
    );
    assert.deepEqual(puts, []);
  }));

test("scale at worker lists the first n dev instances and starts the missing processes", async () =>
  withMain(async (main) => {
    const { request, deps, puts } = scaleFixture(main, {
      [copyPath("e2e-coder-2")]: LIVE_COPY,
    });
    const scaled = await scaleWorkerBinding(request, deps);
    assert.deepEqual(puts, [
      {
        path: "/api/project/project_1/binding-set",
        body: {
          version: 7,
          bindings: {
            repo: { kind: "repository", config: {} },
            coder: {
              kind: "worker",
              config: {
                worker: "coder@1",
                placement: "worker",
                worker_instances: ["e2e-coder-1", "e2e-coder-2"],
              },
            },
          },
        },
      },
    ]);
    assert.deepEqual(
      scaled.instances.map(({ name, worker, pid }) => ({ name, worker, pid })),
      [
        { name: "e2e-coder-1", worker: "coder@1", pid: 5001 },
        { name: "e2e-coder-2", worker: "coder@1", pid: 5002 },
      ],
    );
  }));

test("restartInstanceProcesses stops each running process and records the new pid and log", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "process.json"),
      JSON.stringify({ pid: 4100, log: join(home, "serve.log") }),
    );
    const stopCalls = [];
    const { stopped, started } = await restartInstanceProcesses(
      main,
      [{ ...CODER, pid: 4100, log: join(home, "serve.log") }],
      {
        stop: async (instances) => {
          stopCalls.push(instances.map(({ pid }) => pid));
          return instances.map((instance) => ({
            ...instance,
            result: "stopped",
          }));
        },
        spawn: () => 4400,
        commandOf: (pid) =>
          pid === 4100
            ? "node src/main.ts serve worker --instance e2e-coder-1"
            : "",
      },
    );
    assert.deepEqual(stopCalls, [[4100]]);
    assert.equal(stopped[0].result, "stopped");
    assert.deepEqual(started, [
      { ...CODER, pid: 4400, log: join(home, "serve.log") },
    ]);
    assert.deepEqual(
      JSON.parse(readFileSync(join(home, "process.json"), "utf8")).pid,
      4400,
    );
  }));

test("stopInstanceProcesses stops the running processes and keeps the instances", async () =>
  withMain(async (main) => {
    const home = instanceHome(main, CODER.name);
    writeInstanceFile(home, CODER.name, LIVE_ID);
    writeFileSync(
      join(home, "process.json"),
      JSON.stringify({ pid: 4100, log: "/c.log" }),
    );
    const stopped = await stopInstanceProcesses(
      main,
      [CODER, { name: "e2e-reviewer-1", worker: "reviewer@1" }],
      {
        stop: async (instances) =>
          instances.map((instance) => ({ ...instance, result: "stopped" })),
        commandOf: (pid) =>
          pid === 4100
            ? "node src/main.ts serve worker --instance e2e-coder-1"
            : "",
      },
    );
    assert.deepEqual(stopped, [
      { name: "e2e-coder-1", pid: 4100, log: "/c.log", result: "stopped" },
      { name: "e2e-reviewer-1", result: "not running" },
    ]);
    assert.equal(localInstanceId(home, CODER.name), LIVE_ID);
  }));

test("listedInstances keeps the instances that a worker binding lists, with the newest process", () => {
  const bindings = {
    repo: { kind: "repository", config: {} },
    coder: {
      kind: "worker",
      config: { worker_instances: ["e2e-coder-1", "e2e-coder-2"] },
    },
  };
  const known = [
    { name: "e2e-coder-1", worker: "coder@1", pid: 1, log: "/1" },
    { name: "e2e-coder-3", worker: "coder@1", pid: 3, log: "/3" },
    { name: "e2e-coder-1", worker: "coder@1", pid: 11, log: "/1" },
    { name: "e2e-coder-2", worker: "coder@1", pid: 2, log: "/2" },
  ];
  assert.deepEqual(listedInstances(bindings, known), [
    { name: "e2e-coder-1", worker: "coder@1", pid: 11, log: "/1" },
    { name: "e2e-coder-2", worker: "coder@1", pid: 2, log: "/2" },
  ]);
});

test("connectionLabel names the connection of an instance or disconnected", () => {
  assert.equal(connectionLabel(null), "disconnected");
  assert.equal(connectionLabel({ connection: null }), "disconnected");
  assert.equal(
    connectionLabel({
      connection: {
        connection_name: "mac",
        connected_at: 0,
        last_heartbeat_at: 5,
      },
    }),
    "connected name=mac since=1970-01-01T00:00:00.000Z",
  );
});

test("connectionChanges prints a change of connection only once", () => {
  const known = new Map();
  const connected = {
    connection: {
      connection_name: "mac",
      connected_at: 0,
      last_heartbeat_at: 1,
    },
  };
  assert.deepEqual(connectionChanges(known, [["e2e-coder-1", null]]), [
    "instance e2e-coder-1: - -> disconnected",
  ]);
  assert.deepEqual(connectionChanges(known, [["e2e-coder-1", null]]), []);
  assert.deepEqual(connectionChanges(known, [["e2e-coder-1", connected]]), [
    "instance e2e-coder-1: disconnected -> connected name=mac since=1970-01-01T00:00:00.000Z",
  ]);
  assert.deepEqual(
    connectionChanges(known, [
      [
        "e2e-coder-1",
        { connection: { ...connected.connection, last_heartbeat_at: 9 } },
      ],
    ]),
    [],
  );
});

test("a worker process runs serve worker with the instance name", () => {
  assert.deepEqual(workerArguments("e2e-coder-1"), [
    "src/main.ts",
    "serve",
    "worker",
    "--instance",
    "e2e-coder-1",
  ]);
});

test("withoutKanthordClient strips the client and the instance configuration values", () => {
  assert.deepEqual(
    withoutKanthordClient({
      PATH: "/bin",
      KANTHORD_ENDPOINT: "http://127.0.0.1:31415",
      KANTHORD_CONFIG: "/c.yaml",
      KANTHORD_TOKEN: "t",
      KANTHORD_WORKER_CONFIG: "eyJ9",
    }),
    { PATH: "/bin" },
  );
});
