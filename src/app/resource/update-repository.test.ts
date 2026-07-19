import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateRepository } from "./update-repository.ts";
import { ImmutableFieldError, CacheConflictError } from "./update-resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import { EmbeddedCredentialError } from "../../domain/resource.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Resource, Repository } from "../../domain/resource.ts";

// ------------------------------------------------------------------ fake repo

function makeRepository(
  overrides: Partial<Repository> = {},
): Repository & { projectId: string } {
  return {
    id: "repo-1",
    type: "repository",
    projectId: "proj-1",
    name: "my-repo",
    remoteUrl: "https://github.com/o/r.git",
    branch: "main",
    path: "/home/user/.kanthord/repos/my-repo",
    auth: { kind: "ambient" },
    ...overrides,
  };
}

function makeFakeProjectRepository(
  initial?: Resource,
): ProjectRepository & { saved: Resource | undefined } {
  const store: Map<string, Resource> = new Map();
  if (initial) store.set(initial.id, initial);

  const repo = {
    saved: undefined as Resource | undefined,
    save() {},
    get() {
      return undefined;
    },
    addResource(_projectId: string, resource: Resource) {
      store.set(resource.id, resource);
      this.saved = resource;
    },
    getResource(id: string) {
      return store.get(id);
    },
    listResources() {
      return [];
    },
    listProjects() {
      return [];
    },
    resolveProjectByName() {
      return [];
    },
    resolveResourceByName() {
      return [];
    },
  } satisfies ProjectRepository & { saved: Resource | undefined };
  return repo;
}

/** Fake home-path-exists checker. */
function makeHomePathExists(
  exists: boolean,
): (path: string) => Promise<boolean> {
  return async (_path: string) => exists;
}

// ------------------------------------------------------------------ tests

test("UpdateRepository execute: branch update succeeds", async () => {
  const repo = makeRepository({ branch: "main" });
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(false));
  await uc.execute({ id: "repo-1", branch: "develop" });
  assert.ok(fakeRepo.saved, "resource was saved");
  assert.equal((fakeRepo.saved as Repository).branch, "develop");
});

test("UpdateRepository execute: remoteUrl update when home path absent succeeds", async () => {
  const repo = makeRepository({ path: "" }); // no home path
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(false));
  await uc.execute({ id: "repo-1", remoteUrl: "https://github.com/o/r2.git" });
  assert.ok(fakeRepo.saved, "resource was saved");
  assert.equal(
    (fakeRepo.saved as Repository).remoteUrl,
    "https://github.com/o/r2.git",
  );
});

test("UpdateRepository execute: remoteUrl update when home path exists and reclone absent throws CacheConflictError", async () => {
  const repo = makeRepository(); // path is a non-empty string
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(true));
  await assert.rejects(
    () =>
      uc.execute({ id: "repo-1", remoteUrl: "https://github.com/o/r2.git" }),
    (err: unknown) => {
      assert.ok(
        err instanceof CacheConflictError,
        "CacheConflictError expected",
      );
      assert.equal(err.resourceId, "repo-1");
      return true;
    },
  );
});

test("UpdateRepository execute: remoteUrl update with reclone:true when home path exists succeeds and clears path", async () => {
  const repo = makeRepository(); // path is non-empty (home clone exists)
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(true));
  await uc.execute({
    id: "repo-1",
    remoteUrl: "https://github.com/o/r2.git",
    reclone: true,
  });
  assert.ok(fakeRepo.saved, "resource was saved");
  assert.equal(
    (fakeRepo.saved as Repository).remoteUrl,
    "https://github.com/o/r2.git",
  );
  assert.equal(
    (fakeRepo.saved as Repository).path,
    "",
    "path cleared to force reclone on next prepare",
  );
});

test("UpdateRepository execute: remoteUrl with embedded userinfo throws EmbeddedCredentialError", async () => {
  const repo = makeRepository();
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(false));
  await assert.rejects(
    () =>
      uc.execute({
        id: "repo-1",
        remoteUrl: "https://x-access-token:sk@github.com/o/r.git",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof EmbeddedCredentialError,
        "EmbeddedCredentialError expected",
      );
      assert.equal(err.field, "remoteUrl");
      return true;
    },
  );
});

test("UpdateRepository execute: type change throws ImmutableFieldError", async () => {
  const repo = makeRepository();
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(false));
  await assert.rejects(
    () =>
      (uc.execute as (input: Record<string, unknown>) => Promise<void>)({
        id: "repo-1",
        type: "credential",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof ImmutableFieldError,
        "ImmutableFieldError expected",
      );
      assert.equal(err.field, "type");
      return true;
    },
  );
});

test("UpdateRepository execute: unknown id throws UnknownReferenceError", async () => {
  const fakeRepo = makeFakeProjectRepository();
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(false));
  await assert.rejects(
    () => uc.execute({ id: "no-such-id", branch: "main" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      return true;
    },
  );
});

test("UpdateRepository execute: name update persists new name", async () => {
  const repo = makeRepository({ name: "old-name" });
  const fakeRepo = makeFakeProjectRepository(repo);
  const uc = new UpdateRepository(fakeRepo, makeHomePathExists(false));
  await uc.execute({ id: "repo-1", name: "new-name" });
  assert.ok(fakeRepo.saved, "resource was saved");
  assert.equal((fakeRepo.saved as Repository).name, "new-name");
});
