import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { buildProgram } from "./index.ts";

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

describe("src/apps/cli/index.ts", () => {
  test("builds the kanthord shell with check and db commands in help", async () => {
    const cap = capture();
    const program = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      cap.io,
    ).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(program.parseAsync(["--help"], { from: "user" }));

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord/);
    assert.match(help, /check/);
    assert.match(help, /db/);
  });

  test("routes db migrate through the injected use case and CLI I/O", async () => {
    let calls = 0;
    const cap = capture();
    const deps = {
      migrateDb: {
        execute: async () => {
          calls += 1;
          return { version: 1, applied: [{ version: 1, name: "initial" }] };
        },
      },
    } as Parameters<typeof buildProgram>[0];
    const program = buildProgram(deps, cap.io).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await program.parseAsync(["db", "migrate"], { from: "user" });

    assert.equal(calls, 1);
    assert.deepEqual(cap.out, ["applied: 1 initial\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists create in help and routes create project through the injected use case and CLI I/O", async () => {
    const helpCapture = capture();
    const helpProgram = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      helpCapture.io,
    ).exitOverride();
    helpProgram.configureOutput({
      writeOut: helpCapture.io.out,
      writeErr: helpCapture.io.err,
    });

    await assert.rejects(helpProgram.parseAsync(["--help"], { from: "user" }));
    assert.match(helpCapture.out.join(""), /create/);

    let received: unknown;
    const cap = capture();
    const deps = {
      createProject: {
        execute: async (input: unknown) => {
          received = input;
          return "project-1";
        },
      },
    } as Parameters<typeof buildProgram>[0];
    const program = buildProgram(deps, cap.io).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await program.parseAsync(["create", "project", "--name", "x"], {
      from: "user",
    });

    assert.deepEqual(received, { name: "x" });
    assert.deepEqual(cap.out, ["project-1\n"]);
    assert.deepEqual(cap.err, ["project created: project-1\n"]);
    assert.equal(cap.code(), 0);
  });

  test("lists mutation verbs in help and routes approve task through the injected use case and CLI I/O", async () => {
    const helpCapture = capture();
    const helpProgram = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      helpCapture.io,
    ).exitOverride();
    helpProgram.configureOutput({
      writeOut: helpCapture.io.out,
      writeErr: helpCapture.io.err,
    });

    await assert.rejects(helpProgram.parseAsync(["--help"], { from: "user" }));

    const help = helpCapture.out.join("");
    for (const verb of [
      "rename",
      "pause",
      "resume",
      "add",
      "remove",
      "retry",
      "approve",
      "reject",
    ]) {
      assert.match(help, new RegExp(verb));
    }

    let received: unknown;
    const cap = capture();
    const deps = {
      approveTask: {
        execute: async (input: unknown) => {
          received = input;
          return {
            kind: "approved",
            taskId: (input as { taskId: string }).taskId,
            canonicalSHA: "",
          };
        },
      },
    } as unknown as Parameters<typeof buildProgram>[0];
    const program = buildProgram(deps, cap.io).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await program.parseAsync(["approve", "task", "--id", "task-1"], {
      from: "user",
    });

    assert.deepEqual(received, { taskId: "task-1" });
    assert.deepEqual(cap.out, ["task-1\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists read verbs in help and routes canonical list model and event leaves", async () => {
    const helpCapture = capture();
    const helpProgram = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      helpCapture.io,
    ).exitOverride();
    helpProgram.configureOutput({
      writeOut: helpCapture.io.out,
      writeErr: helpCapture.io.err,
    });

    await assert.rejects(helpProgram.parseAsync(["--help"], { from: "user" }));

    const help = helpCapture.out.join("");
    for (const verb of ["get", "find", "list"]) {
      assert.match(help, new RegExp(verb));
    }

    const providers: Array<string | undefined> = [];
    const eventInputs: unknown[] = [];
    const cap = capture();
    const deps = {
      listModels: (provider?: string) => {
        providers.push(provider);
        return [];
      },
      listEvents: {
        execute: (input: unknown) => {
          eventInputs.push(input);
          return [];
        },
      },
    } as unknown as Parameters<typeof buildProgram>[0];

    const program = buildProgram(deps, cap.io).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await program.parseAsync(["list", "model", "--json"], { from: "user" });
    await program.parseAsync(["list", "event", "--after", "0", "--json"], {
      from: "user",
    });

    assert.deepEqual(providers, [undefined]);
    // Non-follow with no --limit → default page 10 + a probe row → limit 11.
    assert.deepEqual(eventInputs, [{ after: "0", limit: 11 }]);
    assert.deepEqual(cap.out, ["[]\n", '{"events":[],"nextCursor":""}\n']);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("lists update in help and routes update ai-provider through the injected use case and CLI I/O", async () => {
    const helpCapture = capture();
    const helpProgram = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      helpCapture.io,
    ).exitOverride();
    helpProgram.configureOutput({
      writeOut: helpCapture.io.out,
      writeErr: helpCapture.io.err,
    });

    await assert.rejects(helpProgram.parseAsync(["--help"], { from: "user" }));
    assert.match(helpCapture.out.join(""), /update/);

    let received: unknown;
    const cap = capture();
    const deps = {
      updateAiProvider: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as unknown as Parameters<typeof buildProgram>[0];
    const program = buildProgram(deps, cap.io).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await program.parseAsync(
      [
        "update",
        "ai-provider",
        "--id",
        "provider-1",
        "--model",
        "gpt-5.6-terra",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, { id: "provider-1", model: "gpt-5.6-terra" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["ai_provider updated\n"]);
    assert.equal(cap.code(), 0);
  });

  test("lists special verbs in help and routes run daemon and export initiative", async () => {
    const helpCapture = capture();
    const helpProgram = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      helpCapture.io,
    ).exitOverride();
    helpProgram.configureOutput({
      writeOut: helpCapture.io.out,
      writeErr: helpCapture.io.err,
    });

    await assert.rejects(helpProgram.parseAsync(["--help"], { from: "user" }));

    const help = helpCapture.out.join("");
    for (const verb of ["import", "export", "login", "run", "land"]) {
      assert.match(help, new RegExp(verb));
    }

    const out = await mkdtemp(join(tmpdir(), "kanthord-index-export-"));
    try {
      let daemonInput: unknown;
      let exportId: string | undefined;
      const cap = capture();
      const deps = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        buildDaemon: () => ({
          execute: async (input: unknown) => {
            daemonInput = input;
            return { exitCode: 0, escalatedCount: 0 };
          },
          stop: () => {},
        }),
        exportInitiative: {
          execute: async (id: string) => {
            exportId = id;
            return {
              packageId: "package-1",
              formatVersion: 1,
              initiative: {
                ref: "initiative-1",
                name: "initiative",
                sourcePath: "initiative.md",
              },
              objectives: [],
              tasks: [],
            };
          },
        },
      } as unknown as Parameters<typeof buildProgram>[0];
      const program = buildProgram(deps, cap.io).exitOverride();
      program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

      await program.parseAsync(["run", "daemon", "--until-idle"], {
        from: "user",
      });
      await program.parseAsync(
        ["export", "initiative", "initiative-1", "--out", out],
        { from: "user" },
      );

      assert.deepEqual(daemonInput, {
        untilIdle: true,
        pollIntervalMs: undefined,
      });
      assert.equal(exportId, "initiative-1");
      assert.match(cap.out.join(""), /exported to/);
      assert.deepEqual(cap.err, []);
      assert.equal(cap.code(), 0);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  test("rejects an unknown top-level command", async () => {
    const cap = capture();
    const program = buildProgram(
      {} as Parameters<typeof buildProgram>[0],
      cap.io,
    ).exitOverride();
    program.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      program.parseAsync(["bogus"], { from: "user" }),
      (error: { code?: string }) => error.code === "commander.unknownCommand",
    );
  });

  test("returns the package version", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    assert.equal(
      buildProgram({} as Parameters<typeof buildProgram>[0]).version(),
      packageJson.version,
    );
  });
});
