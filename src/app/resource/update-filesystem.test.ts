import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateFilesystem } from "./update-filesystem.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Resource, Filesystem } from "../../domain/resource.ts";

// ------------------------------------------------------------------ fake repo

function makeFilesystem(overrides: Partial<Filesystem> = {}): Filesystem {
  return {
    id: "fs-1",
    type: "filesystem",
    projectId: "proj-1",
    name: "my-fs",
    path: "/old/path",
    ...overrides,
  };
}

function makeFakeProjectRepository(
  initial?: Resource,
): ProjectRepository & { saved: Resource | undefined } {
  const store: Map<string, Resource> = new Map();
  if (initial) store.set(initial.id, initial);
  return {
    saved: undefined as Resource | undefined,
    save() {},
    get() {
      return undefined;
    },
    addResource(_projectId: string, resource: Resource) {
      store.set(resource.id, resource);
      (this as { saved: Resource | undefined }).saved = resource;
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
  } as unknown as ProjectRepository & { saved: Resource | undefined };
}

// ------------------------------------------------------------------ tests

test("UpdateFilesystem execute: path update persists new path", async () => {
  const fs = makeFilesystem();
  const repo = makeFakeProjectRepository(fs);
  const uc = new UpdateFilesystem(repo);
  await uc.execute({ id: "fs-1", path: "/new/path" });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as Filesystem).path, "/new/path");
});

test("UpdateFilesystem execute: name update persists new name", async () => {
  const fs = makeFilesystem();
  const repo = makeFakeProjectRepository(fs);
  const uc = new UpdateFilesystem(repo);
  await uc.execute({ id: "fs-1", name: "renamed-fs" });
  assert.ok(repo.saved);
  assert.equal((repo.saved as Filesystem).name, "renamed-fs");
});

test("UpdateFilesystem execute: type change throws ImmutableFieldError", async () => {
  const fs = makeFilesystem();
  const repo = makeFakeProjectRepository(fs);
  const uc = new UpdateFilesystem(repo);
  await assert.rejects(
    () =>
      (uc.execute as (input: Record<string, unknown>) => Promise<void>)({
        id: "fs-1",
        type: "repository",
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

test("UpdateFilesystem execute: unknown id throws UnknownReferenceError", async () => {
  const repo = makeFakeProjectRepository();
  const uc = new UpdateFilesystem(repo);
  await assert.rejects(
    () => uc.execute({ id: "no-such-id" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      return true;
    },
  );
});
