import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDbCommand,
  buildDbMigrateCommand,
  buildDbStatusCommand,
} from "./db.ts";

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

describe("src/apps/cli/commands/db.ts", () => {
  test("migrates the database and emits its result", async () => {
    let calls = 0;
    const cap = capture();
    const deps = {
      migrateDb: {
        execute: async () => {
          calls += 1;
          return { version: 1, applied: [{ version: 1, name: "initial" }] };
        },
      },
    } as Parameters<typeof buildDbMigrateCommand>[0];

    await buildDbMigrateCommand(
      deps,
      cap.io as Parameters<typeof buildDbMigrateCommand>[1],
    ).parseAsync([], { from: "user" });

    assert.equal(calls, 1);
    assert.deepEqual(cap.out, ["applied: 1 initial\n"]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("shows database status and emits its result", async () => {
    let calls = 0;
    const cap = capture();
    const deps = {
      getDbStatus: {
        execute: async () => {
          calls += 1;
          return {
            dbPath: "/tmp/kanthord.db",
            schemaVersion: 1,
            journalMode: "wal",
            tables: [],
          };
        },
      },
    } as Parameters<typeof buildDbStatusCommand>[0];

    await buildDbStatusCommand(
      deps,
      cap.io as Parameters<typeof buildDbStatusCommand>[1],
    ).parseAsync([], { from: "user" });

    assert.equal(calls, 1);
    assert.deepEqual(cap.out, [
      "db: /tmp/kanthord.db\n",
      "schema: 1\n",
      "journal_mode: wal\n",
    ]);
    assert.deepEqual(cap.err, []);
    assert.equal(cap.code(), 0);
  });

  test("documents db leaves with canonical usage and examples", async () => {
    const cap = capture();
    const deps = {} as Parameters<typeof buildDbCommand>[0];
    const db = buildDbCommand(
      deps,
      cap.io as Parameters<typeof buildDbCommand>[1],
    ).exitOverride();
    db.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(db.parseAsync(["--help"], { from: "user" }));
    assert.match(cap.out.join(""), /migrate/);
    assert.match(cap.out.join(""), /status/);

    for (const command of [
      buildDbMigrateCommand(
        deps,
        cap.io as Parameters<typeof buildDbMigrateCommand>[1],
      ),
      buildDbStatusCommand(
        deps,
        cap.io as Parameters<typeof buildDbStatusCommand>[1],
      ),
    ]) {
      command.exitOverride();
      command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });
      await assert.rejects(command.parseAsync(["--help"], { from: "user" }));
    }

    const help = cap.out.join("");
    assert.match(help, /Usage: kanthord db migrate/);
    assert.match(help, /Usage: kanthord db status/);
    assert.match(help, /Example/);
  });
});
