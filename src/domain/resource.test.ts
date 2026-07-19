import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCE_TYPES,
  isRepository,
  isCredential,
  isNotification,
  isAIProvider,
  isFilesystem,
  buildResource,
  ResourceValidationError,
  UnknownResourceTypeError,
} from "./resource.ts";
import type {
  Repository,
  Credential,
  Notification,
  AIProvider,
  Filesystem,
} from "./resource.ts";

const repo: Repository = {
  id: "01H000000000000000000000AA",
  type: "repository",
  name: "kanthord",
  organization: "kanthorlabs",
  branch: "main",
  path: "/home/dev/kanthord",
};

const cred: Credential = {
  id: "01H000000000000000000000BB",
  type: "credential",
  name: "github-token",
  provider: "github",
  value: "ghp_secret",
};

const notif: Notification = {
  id: "01H000000000000000000000CC",
  type: "notification",
  name: "alerts",
  provider: "slack",
  destination: "#general",
};

const ai: AIProvider = {
  id: "01H000000000000000000000DD",
  type: "ai_provider",
  name: "openai",
  provider: "openai",
  model: "gpt-4o",
};

const fs: Filesystem = {
  id: "01H000000000000000000000EE",
  type: "filesystem",
  name: "workspace",
  path: "/workspace",
};

test("RESOURCE_TYPES lists exactly the five literals in order", () => {
  assert.deepEqual(RESOURCE_TYPES, [
    "repository",
    "credential",
    "notification",
    "ai_provider",
    "filesystem",
  ]);
});

test("isRepository returns true only for Repository variant", () => {
  assert.equal(isRepository(repo), true);
  assert.equal(isCredential(repo), false);
  assert.equal(isNotification(repo), false);
  assert.equal(isAIProvider(repo), false);
  assert.equal(isFilesystem(repo), false);
});

test("isCredential returns true only for Credential variant", () => {
  assert.equal(isRepository(cred), false);
  assert.equal(isCredential(cred), true);
  assert.equal(isNotification(cred), false);
  assert.equal(isAIProvider(cred), false);
  assert.equal(isFilesystem(cred), false);
});

test("isNotification returns true only for Notification variant", () => {
  assert.equal(isRepository(notif), false);
  assert.equal(isCredential(notif), false);
  assert.equal(isNotification(notif), true);
  assert.equal(isAIProvider(notif), false);
  assert.equal(isFilesystem(notif), false);
});

test("isAIProvider returns true only for AIProvider variant", () => {
  assert.equal(isRepository(ai), false);
  assert.equal(isCredential(ai), false);
  assert.equal(isNotification(ai), false);
  assert.equal(isAIProvider(ai), true);
  assert.equal(isFilesystem(ai), false);
});

test("isFilesystem returns true only for Filesystem variant", () => {
  assert.equal(isRepository(fs), false);
  assert.equal(isCredential(fs), false);
  assert.equal(isNotification(fs), false);
  assert.equal(isAIProvider(fs), false);
  assert.equal(isFilesystem(fs), true);
});

test("AIProvider with optional baseUrl typechecks at compile time", () => {
  // Compile-time proof: an AIProvider WITH baseUrl must be assignable to the
  // interface — if baseUrl? is removed from AIProvider this file won't typecheck.
  const aiWithBase: AIProvider = {
    id: "01H000000000000000000000FF",
    type: "ai_provider",
    name: "azure-openai",
    provider: "azure",
    model: "gpt-4o",
    baseUrl: "https://my-azure.openai.azure.com/",
  };
  assert.equal(isAIProvider(aiWithBase), true);
  if (isAIProvider(aiWithBase)) {
    const _baseUrl: string | undefined = aiWithBase.baseUrl;
    void _baseUrl;
  }
  assert.ok(true, "AIProvider with baseUrl typechecks");
});

test("guards narrow to vendor fields at compile time", () => {
  // Compile-time proof: after narrowing, vendor fields are readable.
  // If this file typechecks, the narrowing works.
  if (isRepository(repo)) {
    const _org: string = repo.organization;
    const _branch: string = repo.branch;
    const _path: string = repo.path;
    void _org;
    void _branch;
    void _path;
  }
  if (isCredential(cred)) {
    const _provider: string = cred.provider;
    const _value: string = cred.value;
    void _provider;
    void _value;
  }
  if (isNotification(notif)) {
    const _provider: "slack" | "telegram" = notif.provider;
    const _destination: string = notif.destination;
    void _provider;
    void _destination;
  }
  if (isAIProvider(ai)) {
    const _provider: string = ai.provider;
    const _model: string = ai.model;
    void _provider;
    void _model;
  }
  if (isFilesystem(fs)) {
    const _path: string = fs.path;
    void _path;
  }
  assert.ok(true, "compile-time narrowing verified");
});

// Story 09 T1 — buildResource domain extraction

test("buildResource repository: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "repository",
    name: "kanthord",
    organization: "kanthorlabs",
    branch: "main",
    path: "/home/dev/kanthord",
  });
  assert.equal(typeof r.id, "string", "id must be a non-empty string");
  assert.ok(r.id.length > 0, "id must be non-empty");
  assert.equal(r.type, "repository");
  assert.equal(r.name, "kanthord");
  if (!isRepository(r)) assert.fail("expected Repository variant");
  assert.equal(r.organization, "kanthorlabs");
  assert.equal(r.branch, "main");
  assert.equal(r.path, "/home/dev/kanthord");
});

test("buildResource credential: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "credential",
    name: "openai-key",
    provider: "openai",
    value: "sk-test",
  });
  assert.equal(r.type, "credential");
  assert.equal(r.name, "openai-key");
  if (!isCredential(r)) assert.fail("expected Credential variant");
  assert.equal(r.provider, "openai");
  assert.equal(r.value, "sk-test");
});

test("buildResource notification: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "notification",
    name: "alerts",
    provider: "slack",
    destination: "#general",
  });
  assert.equal(r.type, "notification");
  assert.equal(r.name, "alerts");
  if (!isNotification(r)) assert.fail("expected Notification variant");
  assert.equal(r.provider, "slack");
  assert.equal(r.destination, "#general");
});

test("buildResource ai_provider: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "ai_provider",
    name: "openai",
    provider: "openai",
    model: "gpt-5.5",
  });
  assert.equal(r.type, "ai_provider");
  assert.equal(r.name, "openai");
  if (!isAIProvider(r)) assert.fail("expected AIProvider variant");
  assert.equal(r.provider, "openai");
  assert.equal(r.model, "gpt-5.5");
  assert.equal(r.baseUrl, undefined);
});

test("buildResource ai_provider with baseUrl: builds correct variant", () => {
  const r = buildResource({
    type: "ai_provider",
    name: "azure",
    provider: "azure",
    model: "gpt-4o",
    baseUrl: "https://my-azure.openai.azure.com/",
  });
  if (!isAIProvider(r)) assert.fail("expected AIProvider variant");
  assert.equal(r.baseUrl, "https://my-azure.openai.azure.com/");
});

test("buildResource ai_provider with valid effort: keeps the effort level", () => {
  const r = buildResource({
    type: "ai_provider",
    name: "openai",
    provider: "openai-codex",
    model: "gpt-5.5",
    effort: "medium",
  });
  if (!isAIProvider(r)) assert.fail("expected AIProvider variant");
  assert.equal(r.effort, "medium");
});

test("buildResource ai_provider without effort: effort is undefined", () => {
  const r = buildResource({
    type: "ai_provider",
    name: "openai",
    provider: "openai-codex",
    model: "gpt-5.5",
  });
  if (!isAIProvider(r)) assert.fail("expected AIProvider variant");
  assert.equal(r.effort, undefined);
});

test("buildResource ai_provider with invalid effort: throws ResourceValidationError naming effort", () => {
  assert.throws(
    () =>
      buildResource({
        type: "ai_provider",
        name: "openai",
        provider: "openai-codex",
        model: "gpt-5.5",
        effort: "ultra",
      }),
    (err: unknown) =>
      err instanceof ResourceValidationError && err.field === "effort",
  );
});

test("buildResource filesystem: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "filesystem",
    name: "workspace",
    path: "/workspace",
  });
  assert.equal(r.type, "filesystem");
  assert.equal(r.name, "workspace");
  if (!isFilesystem(r)) assert.fail("expected Filesystem variant");
  assert.equal(r.path, "/workspace");
});

test("buildResource missing required field: throws ResourceValidationError naming the field", () => {
  // repository missing organization
  assert.throws(
    () =>
      buildResource({
        type: "repository",
        name: "test",
        branch: "main",
        path: "/p",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof ResourceValidationError,
        "must throw ResourceValidationError",
      );
      const e = err as ResourceValidationError;
      assert.equal(typeof e.field, "string", "error must carry field name");
      assert.ok(e.field.length > 0, "field name must be non-empty");
      return true;
    },
  );
});

test("buildResource unknown type: throws UnknownResourceTypeError naming the type", () => {
  assert.throws(
    () => buildResource({ type: "magic_wand", name: "test" }),
    (err: unknown) => {
      assert.ok(
        err instanceof UnknownResourceTypeError,
        "must throw UnknownResourceTypeError",
      );
      const e = err as UnknownResourceTypeError;
      assert.equal(
        typeof e.resourceType,
        "string",
        "error must carry the type string",
      );
      assert.equal(e.resourceType, "magic_wand");
      return true;
    },
  );
});
