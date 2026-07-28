import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildGetCommand } from "./get.ts";
import { buildFindCommand } from "./find.ts";
import { buildListCommand } from "./list.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;

  return {
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      setExitCode: (exitCode: number) => {
        code = exitCode;
      },
    },
    out,
    err,
    code: () => code,
  };
}

describe("src/apps/cli/commands/read.ts", () => {
  test("gets a task in JSON mode with only its JSON boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getTask: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "task-1",
            title: "task",
            status: "pending",
            agent: undefined,
            objectiveId: "objective-1",
            dependencies: [],
            result: undefined,
            context: {},
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["task", "--id", "task-1", "--json"], { from: "user" });

    assert.deepEqual(received, { id: "task-1" });
    assert.equal(cap.code(), 0);
    assert.equal(cap.err.length, 0);
    assert.equal(cap.out.length, 1);
    assert.equal(JSON.parse(cap.out[0]!).id, "task-1");
  });

  test("gets a task result with only its result boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getTask: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "task-1",
            title: "task",
            status: "completed",
            agent: undefined,
            objectiveId: "objective-1",
            dependencies: [],
            result: {
              workspace: null,
              branch: null,
              baseCommit: null,
              proposalCommit: null,
              commitSha: "commit-1",
              summary: "done",
              reason: null,
              rejectionResolution: null,
              rejectionReason: null,
              evidence: null,
            },
            context: {},
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["task", "--id", "task-1", "--result"], { from: "user" });

    assert.deepEqual(received, { id: "task-1" });
    assert.equal(cap.code(), 0);
    assert.equal(cap.err.length, 0);
    assert.ok(cap.out.some((line) => line.includes("commit-1")));
  });

  test("gets a project with its ID and JSON boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getProject: {
        execute: async (input: unknown) => {
          received = input;
          return { id: "project-1", name: "roadmap" };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["project", "--id", "project-1", "--json"], { from: "user" });

    assert.deepEqual(received, { id: "project-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(cap.out, ['{"id":"project-1","name":"roadmap"}\n']);
  });

  test("gets a resource with its ID and JSON boolean", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getResource: {
        execute: (input: unknown) => {
          received = input;
          return { id: "resource-1", type: "filesystem" };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["resource", "--id", "resource-1", "--json"], {
      from: "user",
    });

    assert.equal(received, "resource-1");
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(cap.out, [
      '{\n  "id": "resource-1",\n  "type": "filesystem"\n}\n',
    ]);
  });

  test("gets an initiative with its ID and JSON boolean (Story F, 007.12)", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getInitiative: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "init-1",
            name: "init-wf",
            status: "building",
            paused: false,
            workspace: "/tmp/init-1-clone",
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["initiative", "--id", "init-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "init-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.out.length, 1);
    assert.deepEqual(JSON.parse(cap.out[0]!), {
      id: "init-1",
      name: "init-wf",
      status: "building",
      paused: false,
      workspace: "/tmp/init-1-clone",
    });
  });

  test("gets an objective with its ID and JSON boolean (Story F, 007.12)", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getObjective: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "obj-1",
            name: "backend",
            status: "integrated",
            integrations: [{ repository: "repo-1", state: "integrated" }],
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["objective", "--id", "obj-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "obj-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.out.length, 1);
    assert.deepEqual(JSON.parse(cap.out[0]!), {
      id: "obj-1",
      name: "backend",
      status: "integrated",
      integrations: [{ repository: "repo-1", state: "integrated" }],
    });
  });

  test("gets an objective with commitOid and parentOid on --json (Story 3, 012)", async () => {
    const S3_COMMIT = "a".repeat(40);
    const S3_PARENT = "b".repeat(40);
    let received: unknown;
    const cap = capture();
    const deps = {
      getObjective: {
        execute: async (input: unknown) => {
          received = input;
          return {
            id: "obj-1",
            name: "backend",
            status: "awaiting_confirmation",
            commitOid: S3_COMMIT,
            parentOid: S3_PARENT,
            integrations: [
              { repository: "repo-1", state: "awaiting_confirmation" },
            ],
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["objective", "--id", "obj-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "obj-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.out.length, 1);
    assert.deepEqual(JSON.parse(cap.out[0]!), {
      id: "obj-1",
      name: "backend",
      status: "awaiting_confirmation",
      commitOid: S3_COMMIT,
      parentOid: S3_PARENT,
      integrations: [{ repository: "repo-1", state: "awaiting_confirmation" }],
    });
  });

  test("documents get resource with an example that does not expose a secret", async () => {
    const cap = capture();
    const command = buildGetCommand(
      {} as unknown as Parameters<typeof buildGetCommand>[0],
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["resource", "--help"], { from: "user" }),
    );

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord get resource/);
    assert.match(help, /--id <id>/);
    assert.match(help, /Example/);
    assert.doesNotMatch(help, /not-a-secret-value/);
  });

  test("finds a project from its required name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findProject: {
        execute: async (input: unknown) => {
          received = input;
          return "project-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(["project", "--name", "roadmap"], { from: "user" });

    assert.deepEqual(received, { name: "roadmap" });
    assert.deepEqual(cap.out, ["project-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("finds an initiative from its required project and name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findInitiative: {
        execute: async (input: unknown) => {
          received = input;
          return "initiative-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(["initiative", "--project", "project-1", "--name", "cli"], {
      from: "user",
    });

    assert.deepEqual(received, { projectId: "project-1", name: "cli" });
    assert.deepEqual(cap.out, ["initiative-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("finds an objective from its required initiative and name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findObjective: {
        execute: async (input: unknown) => {
          received = input;
          return "objective-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(
      ["objective", "--initiative", "initiative-1", "--name", "routing"],
      { from: "user" },
    );

    assert.deepEqual(received, {
      initiativeId: "initiative-1",
      name: "routing",
    });
    assert.deepEqual(cap.out, ["objective-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("finds a resource from its required project and name and emits its bare ID", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      findResource: {
        execute: async (input: unknown) => {
          received = input;
          return "resource-1";
        },
      },
    } as unknown as Parameters<typeof buildFindCommand>[0];

    await buildFindCommand(
      deps,
      cap.io as Parameters<typeof buildFindCommand>[1],
    ).parseAsync(
      ["resource", "--project", "project-1", "--name", "workspace"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", name: "workspace" });
    assert.deepEqual(cap.out, ["resource-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists tasks with its required and optional filters in JSON mode", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listTasks: {
        execute: async (input: unknown) => {
          received = input;
          return [
            {
              id: "task-1",
              title: "migrate",
              status: "pending",
              state: "ready",
              waiting: [],
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(
      [
        "task",
        "--initiative",
        "initiative-1",
        "--objective",
        "objective-1",
        "--status",
        "pending",
        "--json",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      initiativeId: "initiative-1",
      objectiveId: "objective-1",
      status: "pending",
    });
    assert.deepEqual(cap.out, [
      '[{"id":"task-1","title":"migrate","status":"pending","state":"ready","waiting":[]}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists initiatives from its required project in JSON mode", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listInitiatives: {
        execute: (input: unknown) => {
          received = input;
          return [{ id: "initiative-1", name: "cli" }];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["initiative", "--project", "project-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { projectId: "project-1" });
    assert.deepEqual(cap.out, ['[{"id":"initiative-1","name":"cli"}]\n']);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists objectives from its required initiative in JSON mode", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listObjectives: {
        execute: (input: unknown) => {
          received = input;
          return [{ id: "objective-1", name: "routing" }];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["objective", "--initiative", "initiative-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { initiativeId: "initiative-1" });
    assert.deepEqual(cap.out, ['[{"id":"objective-1","name":"routing"}]\n']);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists events with canonical options and removes its SIGINT listener", async () => {
    const cap = capture();
    const listenersBefore = process.listenerCount("SIGINT");
    let listenersWhileListing = 0;
    const received: Array<{ after: string; limit?: number }> = [];
    const deps = {
      listEvents: {
        execute: (input: { after: string; limit?: number }) => {
          listenersWhileListing = process.listenerCount("SIGINT");
          received.push(input);
          setTimeout(() => process.emit("SIGINT"), 0);
          return [{ id: "event-1", type: "task.ready", taskId: "task-1" }];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(
      [
        "event",
        "--after",
        "0",
        "--limit",
        "1",
        "--json",
        "--follow",
        "--poll-interval",
        "1",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, [{ after: "0", limit: 1 }]);
    assert.equal(listenersWhileListing, listenersBefore + 1);
    assert.equal(process.listenerCount("SIGINT"), listenersBefore);
    // Story 4: non-empty page → nextCursor is the last shown event id, not ''.
    assert.deepEqual(cap.out, [
      '{"events":[{"id":"event-1","type":"task.ready","taskId":"task-1"}],"nextCursor":"event-1"}\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(011 S4) list event --project p1 --after 0 --json forwards projectId: 'p1' to the use case", async () => {
    const cap = capture();
    const received: Array<{
      after: string;
      limit?: number;
      projectId?: string;
    }> = [];
    const deps = {
      listEvents: {
        execute: (input: {
          after: string;
          limit?: number;
          projectId?: string;
        }) => {
          received.push(input);
          return [];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["event", "--project", "p1", "--after", "0", "--json"], {
      from: "user",
    });

    // Non-follow with no --limit → default page 10 + a probe row → limit 11.
    assert.deepEqual(received, [{ after: "0", limit: 11, projectId: "p1" }]);
    // Empty page → nextCursor is the input --after, unchanged.
    assert.deepEqual(cap.out, ['{"events":[],"nextCursor":"0"}\n']);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists models in JSON and filters models by provider", async () => {
    const allModels = capture();
    const providers: Array<string | undefined> = [];
    const deps = {
      listModels: (provider?: string) => {
        providers.push(provider);
        return [
          {
            provider: provider ?? "openai-codex",
            id: "gpt-5.5",
            name: "GPT-5.5",
            reasoning: true,
            contextWindow: 200000,
          },
        ];
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    await buildListCommand(
      deps,
      allModels.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["model", "--json"], { from: "user" });

    assert.deepEqual(providers, [undefined]);
    assert.deepEqual(JSON.parse(allModels.out.join("")), [
      {
        provider: "openai-codex",
        id: "gpt-5.5",
        name: "GPT-5.5",
        reasoning: true,
        contextWindow: 200000,
      },
    ]);
    assert.equal(allModels.code(), 0);

    const filtered = capture();
    await buildListCommand(
      deps,
      filtered.io as Parameters<typeof buildListCommand>[1],
    ).parseAsync(["model", "--provider", "anthropic"], { from: "user" });

    assert.deepEqual(providers, [undefined, "anthropic"]);
    assert.match(filtered.out.join(""), /anthropic/);
    assert.deepEqual(filtered.err, []);
    assert.equal(filtered.code(), 0);
  });

  // -------------------------------------------------------------------------
  // 007.9 Story 03 item A — list credential | ai-provider | repository
  // -------------------------------------------------------------------------

  test("(007.9 S3-A) list credential --project <id> --json: forwards {projectId, type: 'credential'}; secret absent from output", async () => {
    let received: unknown;
    const cap = capture();
    const CANARY = "CANARY_SECRET_VALUE";
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "credential",
              id: "cred-1",
              name: "k1",
              provider: "openai",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["credential", "--project", "project-1", "--json"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", type: "credential" });
    const out = cap.out.join("");
    assert.ok(
      out.includes("cred-1") && out.includes("k1"),
      `expected id + name in output, got: ${out}`,
    );
    assert.equal(
      out.includes(CANARY),
      false,
      "credential secret value must never appear in list output (even --json)",
    );
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(007.9 S3-A) list repository --project <id> --json: forwards {projectId, type: 'repository'}", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "repository",
              id: "repo-1",
              name: "home",
              remoteUrl: "https://github.com/acme/api.git",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["repository", "--project", "project-1", "--json"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", type: "repository" });
    assert.deepEqual(cap.out, [
      '[{"type":"repository","id":"repo-1","name":"home","remoteUrl":"https://github.com/acme/api.git"}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  // -------------------------------------------------------------------------
  // 011 Story 1 — list project
  // -------------------------------------------------------------------------

  test("(011 S1) list project --json: emits one JSON line of all projects in repo order", async () => {
    const cap = capture();
    const deps = {
      listProjects: {
        execute: () => [
          { id: "p1", name: "alpha" },
          { id: "p2", name: "beta" },
        ],
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(["project", "--json"], { from: "user" });

    assert.deepEqual(cap.out, [
      '[{"id":"p1","name":"alpha"},{"id":"p2","name":"beta"}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(011 S1) list project: emits id + two spaces + name, one line per project", async () => {
    const cap = capture();
    const deps = {
      listProjects: {
        execute: () => [
          { id: "p1", name: "alpha" },
          { id: "p2", name: "beta" },
        ],
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(["project"], { from: "user" });

    assert.deepEqual(cap.out, ["p1  alpha\n", "p2  beta\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  // -------------------------------------------------------------------------
  // 011 Story 2 — list notification / list filesystem / non-vacuous canary
  // -------------------------------------------------------------------------

  test("(011 S2) list notification --project <id> --json: forwards {projectId, type: 'notification'}; emits one notification view line", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "notification",
              id: "notif-1",
              name: "ops",
              provider: "slack",
              destination: "#ops",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["notification", "--project", "project-1", "--json"],
      { from: "user" },
    );

    assert.deepEqual(received, {
      projectId: "project-1",
      type: "notification",
    });
    assert.deepEqual(cap.out, [
      '[{"type":"notification","id":"notif-1","name":"ops","provider":"slack","destination":"#ops"}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(011 S2) list filesystem --project <id> --json: forwards {projectId, type: 'filesystem'}; emits one filesystem view line", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      listResources: {
        execute: (input: unknown) => {
          received = input;
          return [
            {
              type: "filesystem",
              id: "fs-1",
              name: "scratch",
              path: "/w",
            },
          ];
        },
      },
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["filesystem", "--project", "project-1", "--json"],
      { from: "user" },
    );

    assert.deepEqual(received, { projectId: "project-1", type: "filesystem" });
    assert.deepEqual(cap.out, [
      '[{"type":"filesystem","id":"fs-1","name":"scratch","path":"/w"}]\n',
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("(011 S2) list credential --project <id> --json: NON-VACUOUS no-secret-leak canary (real ListResources, fake repo returns value)", async () => {
    // Characterization test (passes today, pins the no-secret-leak invariant).
    // The existing 007.9 S3-A test uses a fake that returns a credential row
    // without a `value` field, so the canary can never appear. This test
    // constructs a real `ListResources` over a fake `ProjectRepository` whose
    // `listResourcesByProject` actually returns a credential carrying the
    // canary value, so the canary would appear in the output if any path
    // (use case, view, or handler) leaked the `value` field.
    const CANARY = "CANARY_SECRET_VALUE";
    const { ListResources } =
      await import("../../../app/resource/list-resources.ts");
    const cap = capture();
    const fakeRepo = {
      listResourcesByProject: (_projectId: string, _type: string) => [
        {
          type: "credential",
          id: "cred-1",
          projectId: "project-1",
          name: "gh",
          provider: "github",
          value: CANARY,
        },
      ],
    };
    const listResources = new ListResources(
      fakeRepo as unknown as ConstructorParameters<typeof ListResources>[0],
    );
    const deps = {
      listResources,
    } as unknown as Parameters<typeof buildListCommand>[0];

    const command = buildListCommand(
      deps,
      cap.io as Parameters<typeof buildListCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
    await command.parseAsync(
      ["credential", "--project", "project-1", "--json"],
      { from: "user" },
    );

    const out = cap.out.join("");
    assert.equal(
      out.includes(CANARY),
      false,
      "credential secret value must never appear in list output (even --json)",
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed[0].value, undefined);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  // -------------------------------------------------------------------------
  // 016 Story 4 — get graph --initiative <id>
  // -------------------------------------------------------------------------

  test("(016 S4) get graph --initiative <id> --json: forwards {id} to the use case; emits one JSON line", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getInitiativeGraph: {
        execute: async (input: unknown) => {
          received = input;
          return {
            projectId: "project-1",
            initiative: {
              id: "init-1",
              name: "init",
              status: "building",
              paused: false,
              branch: "kanthord/init/init-1",
              action: null,
            },
            groups: [],
            nodes: [],
            edges: [],
            criticalPath: {
              metric: "remaining-node-count",
              nodeIds: [],
              length: 0,
            },
            counts: {
              pending: 0,
              running: 0,
              completed: 0,
              failed: 0,
              awaiting_confirmation: 0,
              discarded: 0,
              blocked: 0,
              blockedForever: 0,
              actionable: 0,
            },
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["graph", "--initiative", "init-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "init-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.out.length, 1, "exactly one stdout line");
    const parsed = JSON.parse(cap.out[0]!);
    assert.equal(parsed.projectId, "project-1");
    assert.equal(parsed.initiative.id, "init-1");
  });

  test("(016 S4) get graph --initiative <id>: missing required --initiative rejects with commander.missingMandatoryOptionValue", async () => {
    let called = false;
    const cap = capture();
    const command = buildGetCommand(
      {
        getInitiativeGraph: {
          execute: async () => {
            called = true;
            throw new Error("must not be called");
          },
        },
      } as unknown as Parameters<typeof buildGetCommand>[0],
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["graph", "--json"], { from: "user" }),
      (error: { code?: string }) =>
        error.code === "commander.missingMandatoryOptionValue",
    );
    assert.equal(
      called,
      false,
      "execute must not be called when --initiative is missing",
    );
  });

  // ── 016 Story 6 — `get overview` leaf. Forwards { projectId } to the use case.

  test("(016 S6) get overview --project <id> --json: forwards { projectId } to the use case and emits one JSON line", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      getProjectOverview: {
        execute: async (input: unknown) => {
          received = input;
          return {
            projectId: "project-1",
            initiatives: [],
            lanes: [],
            decisions: [],
            digest: {
              since: null,
              latest: null,
              totalCount: 0,
              byType: {},
              events: [],
              hasMore: false,
              pageCursor: null,
            },
          };
        },
      },
    } as unknown as Parameters<typeof buildGetCommand>[0];

    await buildGetCommand(
      deps,
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).parseAsync(["overview", "--project", "project-1", "--json"], {
      from: "user",
    });

    assert.deepEqual(received, { projectId: "project-1" });
    assert.equal(cap.code(), 0);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.out.length, 1, "exactly one stdout line");
    const parsed = JSON.parse(cap.out[0]!);
    assert.equal(parsed.projectId, "project-1");
  });

  test("(016 S6) get overview: missing required --project rejects with commander.missingMandatoryOptionValue and the use case is never called", async () => {
    let called = false;
    const cap = capture();
    const command = buildGetCommand(
      {
        getProjectOverview: {
          execute: async () => {
            called = true;
            throw new Error("must not be called");
          },
        },
      } as unknown as Parameters<typeof buildGetCommand>[0],
      cap.io as Parameters<typeof buildGetCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["overview", "--json"], { from: "user" }),
      (error: { code?: string }) =>
        error.code === "commander.missingMandatoryOptionValue",
    );
    assert.equal(
      called,
      false,
      "execute must not be called when --project is missing",
    );
  });
});
