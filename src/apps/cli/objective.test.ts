import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runCreateObjective,
  runRenameObjective,
  runApproveObjective,
  runRetryObjective,
  runRejectObjective,
} from "./objective.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import { CreateObjective } from "../../app/objective/create-objective.ts";
import { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { ApproveObjective } from "../../app/objective/approve-objective.ts";
import type { RetryObjective } from "../../app/objective/retry-objective.ts";
import type { RejectObjective } from "../../app/objective/reject-objective.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import { ObjectiveNotRetryableError } from "../../app/objective/retry-objective.ts";

class FakeInitiativeRepository implements InitiativeRepository {
  readonly #initiatives: Map<string, Initiative> = new Map();
  readonly #objectives: Map<string, Objective> = new Map();

  save(initiative: Initiative): void {
    this.#initiatives.set(initiative.id, { ...initiative });
  }

  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }

  saveObjective(objective: Objective): void {
    this.#objectives.set(objective.id, { ...objective });
  }

  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }

  listObjectives(initiativeId: string): Objective[] {
    return [...this.#objectives.values()].filter(
      (o) => o.initiativeId === initiativeId,
    );
  }

  resolveInitiativeByName(_projectId: string, _name: string): string[] {
    return [];
  }

  resolveObjectiveByName(initiativeId: string, name: string): string[] {
    const ids: string[] = [];
    for (const o of this.#objectives.values()) {
      if (o.initiativeId === initiativeId && o.name === name) ids.push(o.id);
    }
    return ids;
  }

  listInitiatives(_projectId: string) {
    return [];
  }

  setPaused(_id: string, _paused: boolean): void {}

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  conditionalRenameInitiative(
    _id: string,
    _expectedSha: string,
    _name: string,
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalRenameObjective(_id: string, _expectedSha: string, _name: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteObjective(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
  }
}

type KindResult =
  "project" | "resource" | "initiative" | "objective" | "task" | undefined;

class MockReferenceResolver implements ReferenceResolver {
  readonly #kind: KindResult;

  constructor(kind: KindResult) {
    this.#kind = kind;
  }

  resolveKind(_id: string): KindResult {
    return this.#kind;
  }
}

describe("runCreateObjective handler", () => {
  test("runCreateObjective returns exitCode 0, stdout [id], stderr [created msg] on success", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("initiative");
    const result = await runCreateObjective(
      { initiative: "init-1", name: "backend" },
      new CreateObjective(repo, resolver),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the id)",
    );
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/, "id is a ULID");
    assert.ok(result.stderr.length === 1);
    assert.ok(
      result.stderr[0]!.includes("backend"),
      "stderr mentions the objective name",
    );
  });

  test("runCreateObjective returns exitCode 1 with error line for unknown initiative reference", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(undefined);
    const result = await runCreateObjective(
      { initiative: "no-such", name: "backend" },
      new CreateObjective(repo, resolver),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateObjective returns exitCode 1 with error line for wrong-type initiative reference", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("project");
    const result = await runCreateObjective(
      { initiative: "proj-1", name: "backend" },
      new CreateObjective(repo, resolver),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

describe("runRenameObjective handler", () => {
  test("runRenameObjective returns exitCode 0 on success", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("initiative");
    const createResult = await runCreateObjective(
      { initiative: "init-1", name: "original" },
      new CreateObjective(repo, resolver),
    );
    const id = createResult.stdout[0]!;
    const result = await runRenameObjective(
      { id, name: "renamed" },
      new RenameObjective(repo),
    );
    assert.equal(result.exitCode, 0);
  });

  test("runRenameObjective returns exitCode 1 with error line for unknown id", async () => {
    const repo = new FakeInitiativeRepository();
    const result = await runRenameObjective(
      { id: "no-such-id", name: "whatever" },
      new RenameObjective(repo),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

class FakeApproveObjective {
  readonly calls: Array<{ objectiveId: string; expectedCommit: string }> = [];
  #error: unknown;

  constructor(error?: unknown) {
    this.#error = error;
  }

  async execute(input: {
    objectiveId: string;
    expectedCommit: string;
  }): Promise<{ outcome: "integrated" | "conflict" }> {
    this.calls.push({
      objectiveId: input.objectiveId,
      expectedCommit: input.expectedCommit,
    });
    if (this.#error !== undefined) {
      throw this.#error;
    }
    return { outcome: "integrated" };
  }
}

describe("runApproveObjective handler", () => {
  test("runApproveObjective --id <id> --expected-commit <oid>: returns exitCode 0, stdout [id], stderr ['objective integrated: <id>'] on success", async () => {
    const fake = new FakeApproveObjective();
    const result = await runApproveObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID" },
      fake as unknown as ApproveObjective,
    );
    assert.deepEqual(fake.calls, [
      { objectiveId: "obj-1", expectedCommit: "COMMIT_OID" },
    ]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["obj-1"]);
    assert.deepEqual(result.stderr, ["objective integrated: obj-1"]);
  });

  // e2e 20260727-141944 — the use case records a conflict instead of throwing,
  // so the CLI used to print "objective integrated" for an objective that was
  // NOT integrated. The exit code stays 0: a conflict is a real outcome of
  // approving, not a CLI failure.
  test("runApproveObjective on a conflict outcome: says conflict, never 'integrated'", async () => {
    const fake = {
      calls: [] as Array<{ objectiveId: string; expectedCommit: string }>,
      async execute(input: {
        objectiveId: string;
        expectedCommit: string;
      }): Promise<{ outcome: "integrated" | "conflict" }> {
        this.calls.push({
          objectiveId: input.objectiveId,
          expectedCommit: input.expectedCommit,
        });
        return { outcome: "conflict" as const };
      },
    };
    const result = await runApproveObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID" },
      fake as unknown as ApproveObjective,
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["obj-1"]);
    assert.equal(result.stderr.length, 1);
    assert.match(result.stderr[0]!, /conflict/);
    assert.doesNotMatch(
      result.stderr[0]!,
      /objective integrated/,
      "must not announce an integration that did not happen",
    );
  });

  test("runApproveObjective missing --id: returns exitCode 1, no use-case call", async () => {
    const fake = new FakeApproveObjective();
    const result = await runApproveObjective(
      { expectedCommit: "COMMIT_OID" },
      fake as unknown as ApproveObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fake.calls, []);
  });

  test("runApproveObjective missing --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call (Story 4, 012)", async () => {
    const fake = new FakeApproveObjective();
    const result = await runApproveObjective(
      { id: "obj-1" },
      fake as unknown as ApproveObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(
      fake.calls,
      [],
      "use case must not be called without --expected-commit",
    );
    assert.match(result.stderr[0]!, /missing required flag --expected-commit/);
  });

  test("runApproveObjective empty --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call (Story 4, 012)", async () => {
    const fake = new FakeApproveObjective();
    const result = await runApproveObjective(
      { id: "obj-1", expectedCommit: "" },
      fake as unknown as ApproveObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(
      fake.calls,
      [],
      "use case must not be called with empty --expected-commit",
    );
    assert.match(result.stderr[0]!, /missing required flag --expected-commit/);
  });

  test("runApproveObjective returns exitCode 1 with error line when the use case rejects (e.g. unknown objective)", async () => {
    const fake = new FakeApproveObjective(
      new UnknownReferenceError("objective", "no-such"),
    );
    const result = await runApproveObjective(
      { id: "no-such", expectedCommit: "COMMIT_OID" },
      fake as unknown as ApproveObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

class FakeRetryObjective {
  readonly calls: Array<{
    objectiveId: string;
    note?: string;
    expectedCommit: string;
  }> = [];
  #error: unknown;

  constructor(error?: unknown) {
    this.#error = error;
  }

  async execute(input: {
    objectiveId: string;
    note?: string;
    expectedCommit: string;
  }): Promise<void> {
    this.calls.push(input);
    if (this.#error !== undefined) {
      throw this.#error;
    }
  }
}

describe("runRetryObjective handler", () => {
  test("runRetryObjective --id <id> --expected-commit <oid>: returns exitCode 0, stdout [id] on success", async () => {
    const fake = new FakeRetryObjective();
    const result = await runRetryObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID" },
      fake as unknown as RetryObjective,
    );
    assert.deepEqual(fake.calls, [
      { objectiveId: "obj-1", expectedCommit: "COMMIT_OID" },
    ]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["obj-1"]);
  });

  test("runRetryObjective missing --id: returns exitCode 1, no use-case call", async () => {
    const fake = new FakeRetryObjective();
    const result = await runRetryObjective(
      { expectedCommit: "COMMIT_OID" },
      fake as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fake.calls, []);
  });

  test("runRetryObjective missing --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call (Story 4, 012)", async () => {
    const fake = new FakeRetryObjective();
    const result = await runRetryObjective(
      { id: "obj-1" },
      fake as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(
      fake.calls,
      [],
      "use case must not be called without --expected-commit",
    );
    assert.match(result.stderr[0]!, /missing required flag --expected-commit/);
  });

  test("runRetryObjective returns exitCode 1 with error line naming non-tip immutability when the use case rejects", async () => {
    const fake = new FakeRetryObjective(
      new ObjectiveNotRetryableError("obj-1"),
    );
    const result = await runRetryObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID" },
      fake as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(
      result.stderr[0]!,
      /non-tip|not rewritable|already integrated/i,
    );
  });

  test("runRetryObjective --id <id> --expected-commit <oid> --note <text>: passes {objectiveId, expectedCommit, note} through (Story 06 a + Story 4, 012)", async () => {
    const fake = new FakeRetryObjective();
    const result = await runRetryObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID", note: "guidance" },
      fake as unknown as RetryObjective,
    );
    assert.deepEqual(fake.calls, [
      {
        objectiveId: "obj-1",
        expectedCommit: "COMMIT_OID",
        note: "guidance",
      },
    ]);
    assert.equal(result.exitCode, 0);
  });

  test("runRetryObjective --id <id> --expected-commit <oid> without --note: passes no note key (Story 06 a + Story 4, 012)", async () => {
    const fake = new FakeRetryObjective();
    await runRetryObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID" },
      fake as unknown as RetryObjective,
    );
    assert.deepEqual(fake.calls, [
      { objectiveId: "obj-1", expectedCommit: "COMMIT_OID" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// runRejectObjective handler — Story 05 (10): mirrors runRejectTask's flag
// validation (`--id`, `--resolution retry|discard`).
//
// B3.4 (review blocker fix): `RejectObjective` is discard-only now (no
// `resolution` field on its own input); `runRejectObjective` itself routes
// the validated `--resolution` to one of two independent use cases —
// `retryObjective` (3rd param) for `retry`, `rejectObjective` (2nd param) for
// `discard`. These tests assert each branch calls exactly the one use case
// it should and never the other.
// ---------------------------------------------------------------------------

class FakeRejectObjective {
  readonly calls: Array<{
    objectiveId: string;
    reason?: string;
    expectedCommit: string;
  }> = [];
  #error: unknown;

  constructor(error?: unknown) {
    this.#error = error;
  }

  async execute(input: {
    objectiveId: string;
    reason?: string;
    expectedCommit: string;
  }): Promise<void> {
    this.calls.push(input);
    if (this.#error !== undefined) {
      throw this.#error;
    }
  }
}

describe("runRejectObjective handler", () => {
  test("runRejectObjective --id <id> --expected-commit <oid> --resolution discard: calls RejectObjective (discard use case), never RetryObjective", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      {
        id: "obj-1",
        expectedCommit: "COMMIT_OID",
        resolution: "discard",
        reason: "unachievable",
      },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["obj-1"]);
    assert.deepEqual(fakeDiscard.calls, [
      {
        objectiveId: "obj-1",
        reason: "unachievable",
        expectedCommit: "COMMIT_OID",
      },
    ]);
    assert.deepEqual(
      fakeRetry.calls,
      [],
      "RetryObjective must not be called for --resolution discard",
    );
  });

  test("runRejectObjective --id <id> --expected-commit <oid> --resolution retry: calls RetryObjective (retry use case), never RejectObjective", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      {
        id: "obj-1",
        expectedCommit: "COMMIT_OID",
        resolution: "retry",
      },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["obj-1"]);
    assert.deepEqual(fakeRetry.calls, [
      { objectiveId: "obj-1", expectedCommit: "COMMIT_OID" },
    ]);
    assert.deepEqual(
      fakeDiscard.calls,
      [],
      "RejectObjective must not be called for --resolution retry",
    );
  });

  test("runRejectObjective missing --id: returns exitCode 1, no use-case call", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      { resolution: "discard", expectedCommit: "COMMIT_OID" },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fakeDiscard.calls, []);
    assert.deepEqual(fakeRetry.calls, []);
  });

  test("runRejectObjective missing --resolution: returns exitCode 1, no use-case call", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      { id: "obj-1", expectedCommit: "COMMIT_OID" },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fakeDiscard.calls, []);
    assert.deepEqual(fakeRetry.calls, []);
  });

  test("runRejectObjective invalid --resolution value: returns exitCode 1, no use-case call", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      {
        id: "obj-1",
        expectedCommit: "COMMIT_OID",
        resolution: "badval",
      },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fakeDiscard.calls, []);
    assert.deepEqual(fakeRetry.calls, []);
  });

  test("runRejectObjective --resolution discard without --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call (Story 4, 012)", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      { id: "obj-1", resolution: "discard", reason: "x" },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fakeDiscard.calls, []);
    assert.deepEqual(fakeRetry.calls, []);
    assert.match(result.stderr[0]!, /missing required flag --expected-commit/);
  });

  test("runRejectObjective --resolution retry without --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call (Story 4, 012)", async () => {
    const fakeDiscard = new FakeRejectObjective();
    const fakeRetry = new FakeRetryObjective();
    const result = await runRejectObjective(
      { id: "obj-1", resolution: "retry" },
      fakeDiscard as unknown as RejectObjective,
      fakeRetry as unknown as RetryObjective,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(fakeDiscard.calls, []);
    assert.deepEqual(fakeRetry.calls, []);
    assert.match(result.stderr[0]!, /missing required flag --expected-commit/);
  });
});
