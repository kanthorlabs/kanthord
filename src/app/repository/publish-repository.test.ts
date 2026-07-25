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
import type { Event } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";

class FakeFeed implements EventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
  readAfter(): Event[] {
    return [];
  }
}

class FakeUow implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

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
    const feed = new FakeFeed();
    const uow = new FakeUow();

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
      feed,
      uow,
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
    assert.equal(feed.events.length, 1);
    assert.equal(feed.events[0]!.type, "repository.published");
    assert.equal(
      feed.events[0]!.repositoryId,
      "repo-1",
      "repositoryId must be the event subject column (Story 04)",
    );
    assert.deepEqual(feed.events[0]!.payload, {
      branch: "main",
      remoteOID: "new456",
    });
    assert.ok(
      !("repositoryId" in (feed.events[0]!.payload ?? {})),
      "payload must not also carry repositoryId (Story 04)",
    );
  });

  test("idempotent: re-publishing the same remoteOID that is already published returns kind:already_published and appends no event (Story 03 C)", async () => {
    const store = makeStore({ "repo-1": REPO });
    const publicationRepo = makeFakePublicationRepo({
      key: "repo-1:main",
      record: { state: "published", remoteOID: "same123" },
    });
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "same123",
      remoteOID: "same123",
    }));
    const resolveHomeDir = (repoId: string) => `/home/${repoId}`;
    const resolveTargetOID = async () => "same123";
    const feed = new FakeFeed();
    const uow = new FakeUow();

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
      feed,
      uow,
    );

    const outcome = await uc.execute({
      repositoryId: "repo-1",
      branch: "main",
    });

    assert.deepEqual(outcome, {
      kind: "already_published",
      repositoryId: "repo-1",
      remoteOID: "same123",
    });
    assert.equal(
      feed.events.length,
      0,
      "no-op re-publish of the same remoteOID must not append a second event",
    );
  });

  test("publishing twice with an unchanged remote OID: first call returns kind:published (one event), second call returns kind:already_published (still exactly one event total) (Story 03 C)", async () => {
    const store = makeStore({ "repo-1": REPO });
    const publicationRepo = makeFakePublicationRepo();
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "stable789",
      remoteOID: "stable789",
    }));
    const resolveHomeDir = (repoId: string) => `/home/${repoId}`;
    const resolveTargetOID = async () => "stable789";
    const feed = new FakeFeed();
    const uow = new FakeUow();

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
      feed,
      uow,
    );

    const first = await uc.execute({ repositoryId: "repo-1", branch: "main" });
    assert.deepEqual(first, {
      kind: "published",
      repositoryId: "repo-1",
      remoteOID: "stable789",
    });

    const second = await uc.execute({
      repositoryId: "repo-1",
      branch: "main",
    });
    assert.deepEqual(second, {
      kind: "already_published",
      repositoryId: "repo-1",
      remoteOID: "stable789",
    });

    assert.equal(
      feed.events.filter((e) => e.type === "repository.published").length,
      1,
      "the second, no-op publish must not append a second repository.published event",
    );
  });

  test("an unknown ref (resolveTargetOID rejects) throws UnknownReferenceError('branch', ...) and never calls the publisher (Story 03 B)", async () => {
    const store = makeStore({ "repo-1": REPO });
    const publicationRepo = makeFakePublicationRepo();
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "x",
      remoteOID: "x",
    }));
    const resolveHomeDir = (repoId: string) => `/home/${repoId}`;
    const resolveTargetOID = async (): Promise<string> => {
      throw new Error(
        "fatal: unknown revision or path not in the working tree.",
      );
    };
    const feed = new FakeFeed();
    const uow = new FakeUow();

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
      feed,
      uow,
    );

    await assert.rejects(
      () => uc.execute({ repositoryId: "repo-1", branch: "nope/missing" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "branch");
        assert.equal(err.id, "nope/missing");
        return true;
      },
    );
    assert.equal(
      publisher.calls.length,
      0,
      "an unresolvable ref must never reach the publisher",
    );
    assert.equal(feed.events.length, 0);
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
    const feed = new FakeFeed();
    const uow = new FakeUow();

    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      resolveHomeDir,
      resolveTargetOID,
      feed,
      uow,
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
    assert.equal(
      feed.events.length,
      0,
      "diverged outcome must not append a repository.published event",
    );
  });

  test("unknown repository id throws UnknownReferenceError and never calls the publisher", async () => {
    const store = makeStore({});
    const publicationRepo = makeFakePublicationRepo();
    const publisher = makeMockPublisher(async () => ({
      pushedOID: "x",
      remoteOID: "x",
    }));
    const feed = new FakeFeed();
    const uow = new FakeUow();
    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      () => "/home/repo-1",
      async () => "x",
      feed,
      uow,
    );

    await assert.rejects(
      () => uc.execute({ repositoryId: "nope", branch: "main" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        return true;
      },
    );
    assert.equal(publisher.calls.length, 0);
    assert.equal(feed.events.length, 0);
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
    const feed = new FakeFeed();
    const uow = new FakeUow();
    const uc = new PublishRepository(
      store,
      publisher,
      publicationRepo,
      () => "/home/cred-1",
      async () => "x",
      feed,
      uow,
    );

    await assert.rejects(
      () => uc.execute({ repositoryId: "cred-1", branch: "main" }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        return true;
      },
    );
    assert.equal(publisher.calls.length, 0);
    assert.equal(feed.events.length, 0);
  });
});
