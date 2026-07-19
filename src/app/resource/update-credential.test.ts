import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateCredential } from "./update-credential.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Resource, Credential } from "../../domain/resource.ts";

// ------------------------------------------------------------------ fake repo

function makeCredential(
  overrides: Partial<Credential> = {},
): Credential & { projectId: string } {
  return {
    id: "cred-1",
    type: "credential",
    projectId: "proj-1",
    name: "my-cred",
    provider: "anthropic",
    value: "sk-original",
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

// ------------------------------------------------------------------ tests

test("UpdateCredential execute: name update persists new name", async () => {
  const cred = makeCredential();
  const repo = makeFakeProjectRepository(cred);
  const uc = new UpdateCredential(repo);
  await uc.execute({ id: "cred-1", name: "renamed" });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as Credential).name, "renamed");
});

test("UpdateCredential execute: value update persists new value", async () => {
  const cred = makeCredential();
  const repo = makeFakeProjectRepository(cred);
  const uc = new UpdateCredential(repo);
  await uc.execute({ id: "cred-1", value: "sk-new" });
  assert.ok(repo.saved);
  assert.equal((repo.saved as Credential).value, "sk-new");
});

test("UpdateCredential execute: provider change throws ImmutableFieldError", async () => {
  const cred = makeCredential();
  const repo = makeFakeProjectRepository(cred);
  const uc = new UpdateCredential(repo);
  // Simulate a caller passing an immutable field — cast required because the
  // input type intentionally omits 'provider' to prevent misuse; the guard
  // must still reject it at runtime.
  await assert.rejects(
    () =>
      (uc.execute as (input: Record<string, unknown>) => Promise<void>)({
        id: "cred-1",
        provider: "openai",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof ImmutableFieldError,
        "ImmutableFieldError expected",
      );
      assert.equal(err.field, "provider");
      return true;
    },
  );
});

test("UpdateCredential execute: unknown id throws UnknownReferenceError", async () => {
  const repo = makeFakeProjectRepository();
  const uc = new UpdateCredential(repo);
  await assert.rejects(
    () => uc.execute({ id: "no-such-id" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      return true;
    },
  );
});

test("UpdateCredential execute: omitting name leaves name unchanged", async () => {
  const cred = makeCredential();
  const repo = makeFakeProjectRepository(cred);
  const uc = new UpdateCredential(repo);
  await uc.execute({ id: "cred-1" });
  assert.ok(repo.saved);
  assert.equal((repo.saved as Credential).name, "my-cred");
});
