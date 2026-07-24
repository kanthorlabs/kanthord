/**
 * EPIC 007.13 Story B — `PublishRepository` use case.
 *
 * Hermetic: fakes the repository store, the RepositoryPublisher port (Story
 * A), the PublicationRepository (Story C), and the homeDir/target-OID
 * resolvers. No git, no network, no real SQLite.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PublishRepository } from "./publish-repository.ts";
import { PublishDivergedError } from "../../publication/port.ts";
import type {
  RepositoryPublisher,
  PublishInput,
} from "../../publication/port.ts";
import type {
  PublicationRepository,
  PublicationRecord,
} from "../../storage/port.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";
import type { Resource } from "../../domain/resource.ts";

function makeStore(resources: Record<string, Resource>) {
  return {
    getResource: (id: string): Resource | undefined => resources[id],
  };
}

function makeFakePublicationRepo(seed?: {
  key: string;
  record: PublicationRecord;
}): PublicationRepository & {
  setCalls: Array<{
    repoId: string;
    branch: string;
    record: PublicationRecord;
  }>;
} {
  const store = new Map<string, PublicationRecord>();
  if (seed) store.set(seed.key, seed.record);
  const setCalls: Array<{
    repoId: string;
    branch: string;
    record: PublicationRecord;
  }> = [];
  return {
    getPublication: (repoId: string, branch: string) =>
      store.get(`${repoId}:${branch}`),
    getLatestPublication: (repoId: string) => {
      let latest: PublicationRecord | undefined;
      for (const [key, record] of store) {
        if (key.startsWith(`${repoId}:`)) latest = record;
      }
      return latest;
    },
    setPublication: (
      repoId: string,
      branch: string,
      record: PublicationRecord,
    ) => {
      store.set(`${repoId}:${branch}`, record);
      setCalls.push({ repoId, branch, record });
    },
    setCalls,
  };
}

function makeMockPublisher(
  behavior: (
    input: PublishInput,
  ) => Promise<{ pushedOID: string; remoteOID: string }>,
): RepositoryPublisher & { calls: PublishInput[] } {
  const calls: PublishInput[] = [];
  return {
    publish: async (input: PublishInput) => {
      calls.push(input);
      return behavior(input);
    },
    calls,
  };
}

const REPO: Resource = {
  id: "repo-1",
  type: "repository",
  projectId: "proj-1",
  name: "verify",
  remoteUrl: "file:///tmp/remote.git",
  branch: "main",
  path: "/tmp/home",
  auth: { kind: "ambient" },
} as Resource;

describe("src/app/repository/publish-repository.ts", () => {
  test("success: publishes with the landed local head + last-known remote OID, persists published@<remoteOID>", async () => {
    const store = makeStore({ "repo-1": REPO });
    const publicationRepo = makeFakePublicationRepo({
      key: "repo-1:main",
      record: { state: "published", remoteOID: "old123" },
    });
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "new456",
      remoteOID: "new456",
    }));
    const resolveHomeDir = (repoId: string) => `/home/${repoId}`;
    const resolveTargetOID = async () => "new456";

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
    );

    const outcome = await uc.execute({
      repositoryId: "repo-1",
      branch: "main",
    });

    assert.deepEqual(outcome, {
      kind: "published",
      repositoryId: "repo-1",
      remoteOID: "new456",
    });
    assert.equal(publisher.calls.length, 1);
    assert.deepEqual(publisher.calls[0], {
      homeDir: "/home/repo-1",
      branch: "main",
      remoteUrl: "file:///tmp/remote.git",
      auth: { kind: "ambient" },
      expectedRemoteOID: "old123",
    });
    assert.deepEqual(publicationRepo.setCalls, [
      {
        repoId: "repo-1",
        branch: "main",
        record: { state: "published", remoteOID: "new456" },
      },
    ]);
  });

  test("PublishDivergedError: persists diverged state with the observed remote OID, non-zero outcome, no force retry", async () => {
    const store = makeStore({ "repo-1": REPO });
    const publicationRepo = makeFakePublicationRepo({
      key: "repo-1:main",
      record: { state: "published", remoteOID: "old123" },
    });
    const publisher = makeMockPublisher(async () => {
      throw new PublishDivergedError("moved789");
    });
    const resolveHomeDir = (repoId: string) => `/home/${repoId}`;
    const resolveTargetOID = async () => "new456";

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
    );

    const outcome = await uc.execute({
      repositoryId: "repo-1",
      branch: "main",
    });

    assert.deepEqual(outcome, {
      kind: "diverged",
      repositoryId: "repo-1",
      remoteOID: "moved789",
    });
    assert.equal(
      publisher.calls.length,
      1,
      "publish must be called exactly once — no automatic force retry on divergence",
    );
    assert.deepEqual(publicationRepo.setCalls, [
      {
        repoId: "repo-1",
        branch: "main",
        record: { state: "diverged", remoteOID: "moved789" },
      },
    ]);
  });

  test("unknown repository id throws UnknownReferenceError and never calls the publisher", async () => {
    const store = makeStore({});
    const publicationRepo = makeFakePublicationRepo();
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "x",
      remoteOID: "x",
    }));
    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      () => "/home/repo-1",
      async () => "x",
    );

    await assert.rejects(
      () => uc.execute({ repositoryId: "nope", branch: "main" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        return true;
      },
    );
    assert.equal(publisher.calls.length, 0);
  });

  test("non-repository resource id throws WrongTypeReferenceError and never calls the publisher", async () => {
    const notARepo: Resource = {
      id: "cred-1",
      type: "credential",
      projectId: "proj-1",
      name: "c1",
      provider: "openai-codex",
      value: "secret",
    } as Resource;
    const store = makeStore({ "cred-1": notARepo });
    const publicationRepo = makeFakePublicationRepo();
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "x",
      remoteOID: "x",
    }));
    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      () => "/home/cred-1",
      async () => "x",
    );

    await assert.rejects(
      () => uc.execute({ repositoryId: "cred-1", branch: "main" }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        return true;
      },
    );
    assert.equal(publisher.calls.length, 0);
  });
});
