import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PassThrough } from "node:stream";

import { buildUpdateCommand } from "./update.ts";

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

describe("src/apps/cli/commands/update.ts", () => {
  test("updates a credential from stdin through its value-file input and emits its result", async () => {
    const input = new PassThrough();
    const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const cap = capture();
    const deps = {
      updateCredential: {
        execute: async (resource: { id: string; value: string }) => {
          assert.deepEqual(resource, {
            id: "credential-1",
            value: "credential-from-stdin",
          });
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: input,
    });
    try {
      input.end("credential-from-stdin\n");
      await buildUpdateCommand(
        deps,
        cap.io as Parameters<typeof buildUpdateCommand>[1],
      ).parseAsync(
        ["credential", "--id", "credential-1", "--value-file", "-"],
        { from: "user" },
      );
    } finally {
      if (originalStdin !== undefined) {
        Object.defineProperty(process, "stdin", originalStdin);
      }
    }

    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["credential updated\n"]);
    assert.equal(cap.code(), 0);
  });

  test("documents credential file input without placing a secret in its example", async () => {
    const cap = capture();
    const command = buildUpdateCommand(
      {} as unknown as Parameters<typeof buildUpdateCommand>[0],
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["credential", "--help"], { from: "user" }),
    );

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord update credential/);
    assert.match(help, /--value-file <path\|->/);
    assert.match(help, /Example/);
    assert.doesNotMatch(help, /credential-from-stdin/);
  });

  test("updates a repository with its remote URL and reclone flag", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      updateRepository: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    await buildUpdateCommand(
      deps,
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).parseAsync(
      [
        "repository",
        "--id",
        "repository-1",
        "--branch",
        "main",
        "--remote-url",
        "https://example.test/repository.git",
        "--reclone",
      ],
      { from: "user" },
    );

    assert.deepEqual(received, {
      id: "repository-1",
      branch: "main",
      remoteUrl: "https://example.test/repository.git",
      reclone: true,
    });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["repository updated\n"]);
    assert.equal(cap.code(), 0);
  });

  test("updates a notification with its destination", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      updateNotification: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    await buildUpdateCommand(
      deps,
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).parseAsync(
      ["notification", "--id", "notification-1", "--destination", "#ops"],
      { from: "user" },
    );

    assert.deepEqual(received, { id: "notification-1", destination: "#ops" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["notification updated\n"]);
    assert.equal(cap.code(), 0);
  });

  test("updates an ai-provider's model and emits the changed field names", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      updateAiProvider: {
        execute: (input: unknown) => {
          received = input;
          return { id: "aip-1", changed: ["model"] };
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    await buildUpdateCommand(
      deps,
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).parseAsync(["ai-provider", "--id", "aip-1", "--model", "m2"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "aip-1", model: "m2" });
    assert.deepEqual(cap.out, ["aip-1\n"]);
    assert.deepEqual(cap.err, ["ai-provider updated: aip-1 (model)\n"]);
    assert.equal(cap.code(), 0);
  });

  test("rotates an ai-provider's secret from stdin through --value-file and never echoes it", async () => {
    const input = new PassThrough();
    const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    let received: unknown;
    const cap = capture();
    const deps = {
      updateAiProvider: {
        execute: (inp: unknown) => {
          received = inp;
          return { id: "aip-1", changed: ["value"] };
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: input,
    });
    try {
      input.end("sk-new-secret\n");
      await buildUpdateCommand(
        deps,
        cap.io as Parameters<typeof buildUpdateCommand>[1],
      ).parseAsync(["ai-provider", "--id", "aip-1", "--value-file", "-"], {
        from: "user",
      });
    } finally {
      if (originalStdin !== undefined) {
        Object.defineProperty(process, "stdin", originalStdin);
      }
    }

    assert.deepEqual(received, { id: "aip-1", value: "sk-new-secret" });
    const combined = [...cap.out, ...cap.err].join("");
    assert.doesNotMatch(combined, /sk-new-secret/);
    assert.doesNotMatch(combined, /value-file/);
    assert.equal(cap.code(), 0);
  });

  test("rejects --name and --provider on update ai-provider as unknown options", async () => {
    const cap = capture();
    const deps = {} as unknown as Parameters<typeof buildUpdateCommand>[0];

    await assert.rejects(
      buildUpdateCommand(
        deps,
        cap.io as Parameters<typeof buildUpdateCommand>[1],
      )
        .exitOverride()
        .parseAsync(["ai-provider", "--id", "aip-1", "--name", "x"], {
          from: "user",
        }),
    );

    await assert.rejects(
      buildUpdateCommand(
        deps,
        cap.io as Parameters<typeof buildUpdateCommand>[1],
      )
        .exitOverride()
        .parseAsync(["ai-provider", "--id", "aip-1", "--provider", "y"], {
          from: "user",
        }),
    );
  });

  test("parses --context-window on update ai-provider as a number", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      updateAiProvider: {
        execute: (input: unknown) => {
          received = input;
          return { id: "aip-1", changed: ["contextWindow"] };
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    await buildUpdateCommand(
      deps,
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).parseAsync(["ai-provider", "--id", "aip-1", "--context-window", "8"], {
      from: "user",
    });

    assert.deepEqual(received, { id: "aip-1", contextWindow: 8 });
  });

  test("documents ai-provider update with usage and example help text", async () => {
    const cap = capture();
    const command = buildUpdateCommand(
      {} as unknown as Parameters<typeof buildUpdateCommand>[0],
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["ai-provider", "--help"], { from: "user" }),
    );

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord update ai-provider/);
    assert.match(help, /Example/);
  });

  test("updates a filesystem with its path", async () => {
    let received: unknown;
    const cap = capture();
    const deps = {
      updateFilesystem: {
        execute: async (input: unknown) => {
          received = input;
        },
      },
    } as unknown as Parameters<typeof buildUpdateCommand>[0];

    await buildUpdateCommand(
      deps,
      cap.io as Parameters<typeof buildUpdateCommand>[1],
    ).parseAsync(
      ["filesystem", "--id", "filesystem-1", "--path", "/srv/work"],
      { from: "user" },
    );

    assert.deepEqual(received, { id: "filesystem-1", path: "/srv/work" });
    assert.deepEqual(cap.out, []);
    assert.deepEqual(cap.err, ["filesystem updated\n"]);
    assert.equal(cap.code(), 0);
  });
});
