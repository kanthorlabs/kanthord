/**
 * EPIC 007.13 Story B — `publish repository` CLI command wiring.
 *
 * Drives the built commander command tree (buildPublishRepositoryCommand)
 * directly, not just a bare handler function — catches wiring gaps the
 * handler-only test would miss.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildPublishRepositoryCommand } from "./repository.ts";
import type { CliDeps } from "../../deps.ts";
import type { CliIo } from "../action.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../../../../app/errors.ts";

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
    } as CliIo,
    out,
    err,
    code: () => code,
  };
}

type Captured = { repositoryId: string; branch: string };

function makeMockPublishRepository(
  execute: (input: Captured) => Promise<unknown>,
): { execute: typeof execute; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    execute: async (input: Captured) => {
      calls.push(input);
      return execute(input);
    },
    calls,
  };
}

describe("src/apps/cli/commands/publish/repository.ts", () => {
  test("--repository and --branch parse and forward to PublishRepository.execute", async () => {
    const mock = makeMockPublishRepository(async () => ({
      kind: "published",
      repositoryId: "repo-1",
      remoteOID: "abc123",
    }));
    const cap = capture();
    const deps = {
      publishRepository: mock,
    } as unknown as CliDeps;

    await buildPublishRepositoryCommand(deps, cap.io).parseAsync(
      ["--repository", "repo-1", "--branch", "main"],
      { from: "user" },
    );

    assert.deepEqual(mock.calls, [{ repositoryId: "repo-1", branch: "main" }]);
  });

  test("success prints the remote OID on stdout and a friendly note on stderr, exit 0", async () => {
    const mock = makeMockPublishRepository(async () => ({
      kind: "published",
      repositoryId: "repo-1",
      remoteOID: "abc123",
    }));
    const cap = capture();
    const deps = { publishRepository: mock } as unknown as CliDeps;

    await buildPublishRepositoryCommand(deps, cap.io).parseAsync(
      ["--repository", "repo-1", "--branch", "main"],
      { from: "user" },
    );

    assert.ok(
      cap.out.some((l) => l.includes("abc123")),
      `stdout must include the remote OID; got ${JSON.stringify(cap.out)}`,
    );
    assert.ok(
      cap.err.some((l) => l.includes("repo-1") && l.includes("abc123")),
      `stderr must include a friendly published note; got ${JSON.stringify(cap.err)}`,
    );
    assert.equal(cap.code(), 0);
  });

  test("divergence prints nothing on stdout, a friendly divergence note on stderr, and exits non-zero", async () => {
    const mock = makeMockPublishRepository(async () => ({
      kind: "diverged",
      repositoryId: "repo-1",
      remoteOID: "def456",
    }));
    const cap = capture();
    const deps = { publishRepository: mock } as unknown as CliDeps;

    await buildPublishRepositoryCommand(deps, cap.io).parseAsync(
      ["--repository", "repo-1", "--branch", "main"],
      { from: "user" },
    );

    assert.deepEqual(cap.out, []);
    assert.ok(
      cap.err.some((l) =>
        /diverg|not a fast-forward|remote moved|rejected/i.test(l),
      ),
      `stderr must name the divergence; got ${JSON.stringify(cap.err)}`,
    );
    assert.notEqual(cap.code(), 0);
  });

  test("unknown repository id: friendly error, exit 1, no leaked stack trace (S1 regression)", async () => {
    const mock = makeMockPublishRepository(async () => {
      throw new UnknownReferenceError("resource", "repo-x");
    });
    const cap = capture();
    const deps = { publishRepository: mock } as unknown as CliDeps;

    await buildPublishRepositoryCommand(deps, cap.io).parseAsync(
      ["--repository", "repo-x", "--branch", "main"],
      { from: "user" },
    );

    assert.deepEqual(cap.out, []);
    assert.ok(
      cap.err.some((l) => /^error: .*repo-x/.test(l)),
      `stderr must contain a friendly "error: ..." line naming repo-x; got ${JSON.stringify(cap.err)}`,
    );
    assert.notEqual(cap.code(), 0);
  });

  test("non-repository resource id: friendly error, exit 1, no leaked stack trace (S1 regression)", async () => {
    const mock = makeMockPublishRepository(async () => {
      throw new WrongTypeReferenceError("repository", "credential", "cred-x");
    });
    const cap = capture();
    const deps = { publishRepository: mock } as unknown as CliDeps;

    await buildPublishRepositoryCommand(deps, cap.io).parseAsync(
      ["--repository", "cred-x", "--branch", "main"],
      { from: "user" },
    );

    assert.deepEqual(cap.out, []);
    assert.ok(
      cap.err.some((l) => /^error: .*cred-x/.test(l)),
      `stderr must contain a friendly "error: ..." line naming cred-x; got ${JSON.stringify(cap.err)}`,
    );
    assert.notEqual(cap.code(), 0);
  });
});
