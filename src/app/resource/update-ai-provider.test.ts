import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateAiProvider } from "./update-ai-provider.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import { UnknownModelError } from "../../model-catalog/port.ts";
import { FakeModelCatalog } from "../../model-catalog/fake.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Resource, AIProvider } from "../../domain/resource.ts";

// ------------------------------------------------------------------ fake repo

function makeAiProvider(
  overrides: Partial<AIProvider> = {},
): AIProvider & { projectId: string } {
  return {
    id: "aip-1",
    type: "ai_provider",
    projectId: "proj-1",
    name: "my-provider",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    effort: "medium",
    baseUrl: "https://api.example.com",
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

test("UpdateAiProvider execute: model update with accepting catalog persists new model", async () => {
  const aip = makeAiProvider();
  const repo = makeFakeProjectRepository(aip);
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-sol" },
  ]);
  const uc = new UpdateAiProvider(repo, catalog);
  await uc.execute({ id: "aip-1", model: "gpt-5.6-sol" });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as AIProvider).model, "gpt-5.6-sol");
});

test("UpdateAiProvider execute: model update with rejecting catalog throws UnknownModelError", async () => {
  const aip = makeAiProvider();
  const repo = makeFakeProjectRepository(aip);
  const catalog = new FakeModelCatalog(); // reject all
  const uc = new UpdateAiProvider(repo, catalog);
  await assert.rejects(
    () => uc.execute({ id: "aip-1", model: "no-such-model" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownModelError, "UnknownModelError expected");
      assert.equal(err.provider, "openai-codex");
      assert.equal(err.model, "no-such-model");
      assert.ok(
        err.message.includes("get models"),
        "message should mention 'get models'",
      );
      return true;
    },
  );
});

test("UpdateAiProvider execute: effort null clears effort field", async () => {
  const aip = makeAiProvider({ effort: "high" });
  const repo = makeFakeProjectRepository(aip);
  const catalog = new FakeModelCatalog();
  const uc = new UpdateAiProvider(repo, catalog);
  await uc.execute({ id: "aip-1", effort: null });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as AIProvider).effort, undefined);
});

test("UpdateAiProvider execute: baseUrl null clears baseUrl field", async () => {
  const aip = makeAiProvider({ baseUrl: "https://api.example.com" });
  const repo = makeFakeProjectRepository(aip);
  const catalog = new FakeModelCatalog();
  const uc = new UpdateAiProvider(repo, catalog);
  await uc.execute({ id: "aip-1", baseUrl: null });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as AIProvider).baseUrl, undefined);
});

test("UpdateAiProvider execute: provider change throws ImmutableFieldError", async () => {
  const aip = makeAiProvider();
  const repo = makeFakeProjectRepository(aip);
  const catalog = new FakeModelCatalog();
  const uc = new UpdateAiProvider(repo, catalog);
  await assert.rejects(
    () =>
      (uc.execute as (input: Record<string, unknown>) => Promise<void>)({
        id: "aip-1",
        provider: "anthropic",
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

test("UpdateAiProvider execute: unknown id throws UnknownReferenceError", async () => {
  const repo = makeFakeProjectRepository();
  const catalog = new FakeModelCatalog();
  const uc = new UpdateAiProvider(repo, catalog);
  await assert.rejects(
    () => uc.execute({ id: "no-such-id" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      return true;
    },
  );
});

test("UpdateAiProvider execute: name update persists new name", async () => {
  const aip = makeAiProvider();
  const repo = makeFakeProjectRepository(aip);
  const catalog = new FakeModelCatalog();
  const uc = new UpdateAiProvider(repo, catalog);
  await uc.execute({ id: "aip-1", name: "renamed" });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as AIProvider).name, "renamed");
});
