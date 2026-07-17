import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { dispatch } from "./router.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("e2e smoke: full Proof sequence through composition root", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-e2e-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);

    // -- db migrate (must run before any writes) --
    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    // -- create project --
    const r1 = await dispatch(["create", "project", "--name", "demo"], deps);
    assert.equal(r1.exitCode, 0, "create project exits 0");
    assert.equal(
      r1.stdout.length,
      1,
      "create project stdout has exactly one line",
    );
    const PROJECT = r1.stdout[0]!;
    assert.match(PROJECT, ULID_RE, "create project returns a ULID");

    // -- create repository --
    const r2 = await dispatch(
      [
        "create",
        "repository",
        "--project",
        PROJECT,
        "--name",
        "backend",
        "--organization",
        "acme",
        "--branch",
        "main",
      ],
      deps,
    );
    assert.equal(r2.exitCode, 0, "create repository exits 0");
    assert.equal(
      r2.stdout.length,
      1,
      "create repository stdout has exactly one line",
    );
    assert.match(r2.stdout[0]!, ULID_RE, "create repository returns a ULID");

    // -- create initiative --
    const r3 = await dispatch(
      ["create", "initiative", "--project", PROJECT, "--name", "oauth"],
      deps,
    );
    assert.equal(r3.exitCode, 0, "create initiative exits 0");
    assert.equal(
      r3.stdout.length,
      1,
      "create initiative stdout has exactly one line",
    );
    const INITIATIVE = r3.stdout[0]!;
    assert.match(INITIATIVE, ULID_RE, "create initiative returns a ULID");

    // -- create objective --
    const r4 = await dispatch(
      ["create", "objective", "--initiative", INITIATIVE, "--name", "backend"],
      deps,
    );
    assert.equal(r4.exitCode, 0, "create objective exits 0");
    assert.equal(
      r4.stdout.length,
      1,
      "create objective stdout has exactly one line",
    );
    const OBJECTIVE = r4.stdout[0]!;
    assert.match(OBJECTIVE, ULID_RE, "create objective returns a ULID");

    // -- create task: implement api --
    const r5 = await dispatch(
      ["create", "task", "--objective", OBJECTIVE, "--title", "implement api"],
      deps,
    );
    assert.equal(r5.exitCode, 0, "create task (api) exits 0");
    assert.equal(
      r5.stdout.length,
      1,
      "create task (api) stdout has exactly one line",
    );
    const TASK_API = r5.stdout[0]!;
    assert.match(TASK_API, ULID_RE, "create task (api) returns a ULID");

    // -- create task: deploy (depends-on api) --
    const r6 = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "deploy",
        "--depends-on",
        TASK_API,
      ],
      deps,
    );
    assert.equal(r6.exitCode, 0, "create task (deploy) exits 0");
    assert.equal(
      r6.stdout.length,
      1,
      "create task (deploy) stdout has exactly one line",
    );
    const TASK_DEPLOY = r6.stdout[0]!;
    assert.match(TASK_DEPLOY, ULID_RE, "create task (deploy) returns a ULID");

    // -- list task: implement api ready; deploy blocked (waiting: implement api) --
    const r7 = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(r7.exitCode, 0, "list task exits 0");
    const listing1 = r7.stdout.join("\n");
    assert.ok(
      listing1.includes("implement api"),
      "listing1 contains 'implement api'",
    );
    assert.ok(listing1.includes("ready"), "listing1 contains 'ready'");
    assert.ok(listing1.includes("deploy"), "listing1 contains 'deploy'");
    assert.ok(listing1.includes("blocked"), "listing1 contains 'blocked'");
    assert.ok(
      listing1.includes("waiting: implement api"),
      "listing1 shows 'waiting: implement api' for deploy",
    );

    // -- create task: spike auth --
    const r8 = await dispatch(
      ["create", "task", "--objective", OBJECTIVE, "--title", "spike auth"],
      deps,
    );
    assert.equal(r8.exitCode, 0, "create task (spike auth) exits 0");
    assert.equal(
      r8.stdout.length,
      1,
      "create task (spike auth) stdout has exactly one line",
    );
    const TASK_PREP = r8.stdout[0]!;
    assert.match(TASK_PREP, ULID_RE, "create task (spike auth) returns a ULID");

    // -- add dependency: api now also depends-on spike auth --
    const r9 = await dispatch(
      ["add", "dependency", "--task", TASK_API, "--depends-on", TASK_PREP],
      deps,
    );
    assert.equal(r9.exitCode, 0, "add dependency exits 0");

    // -- list task: spike auth ready; implement api blocked (waiting: spike auth); deploy blocked --
    const r10 = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(r10.exitCode, 0, "list task (rearranged) exits 0");
    const listing2 = r10.stdout.join("\n");
    assert.ok(
      listing2.includes("spike auth"),
      "listing2 contains 'spike auth'",
    );
    assert.ok(
      listing2.includes("waiting: spike auth"),
      "listing2 shows 'waiting: spike auth' for implement api",
    );
    assert.ok(
      listing2.includes("implement api"),
      "listing2 still contains 'implement api'",
    );

    // -- cycle-closing add dependency: spike auth → deploy would form a cycle → exit 1 --
    const r11 = await dispatch(
      ["add", "dependency", "--task", TASK_PREP, "--depends-on", TASK_DEPLOY],
      deps,
    );
    assert.equal(r11.exitCode, 1, "cycle-closing dependency exits 1");
    assert.equal(
      r11.stderr.length,
      1,
      "cycle error has exactly one stderr line",
    );
    assert.ok(
      r11.stderr[0]!.startsWith("error:"),
      "cycle error line starts with 'error:'",
    );
    assert.ok(
      !r11.stderr[0]!.includes("    at "),
      "cycle error has no stack trace",
    );

    // -- wrong-type reference: create task --objective <task-id> → WrongTypeReferenceError, exit 1 --
    const r12 = await dispatch(
      ["create", "task", "--objective", TASK_API, "--title", "bad parent"],
      deps,
    );
    assert.equal(r12.exitCode, 1, "wrong-type objective exits 1");
    assert.equal(
      r12.stderr.length,
      1,
      "wrong-type error has exactly one stderr line",
    );
    assert.ok(
      r12.stderr[0]!.startsWith("error:"),
      "wrong-type error line starts with 'error:'",
    );
    assert.ok(
      !r12.stderr[0]!.includes("    at "),
      "wrong-type error has no stack trace",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
