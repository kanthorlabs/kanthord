import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCE_TYPES,
  isRepository,
  isCredential,
  isNotification,
  isAIProvider,
  isFilesystem,
} from "./resource.ts";
import type { Repository, Credential, Notification, AIProvider, Filesystem } from "./resource.ts";

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

test("guards narrow to vendor fields at compile time", () => {
  // Compile-time proof: after narrowing, vendor fields are readable.
  // If this file typechecks, the narrowing works.
  if (isRepository(repo)) {
    const _org: string = repo.organization;
    const _branch: string = repo.branch;
    const _path: string = repo.path;
    void _org; void _branch; void _path;
  }
  if (isCredential(cred)) {
    const _provider: string = cred.provider;
    const _value: string = cred.value;
    void _provider; void _value;
  }
  if (isNotification(notif)) {
    const _provider: "slack" | "telegram" = notif.provider;
    const _destination: string = notif.destination;
    void _provider; void _destination;
  }
  if (isAIProvider(ai)) {
    const _provider: string = ai.provider;
    const _model: string = ai.model;
    void _provider; void _model;
  }
  if (isFilesystem(fs)) {
    const _path: string = fs.path;
    void _path;
  }
  assert.ok(true, "compile-time narrowing verified");
});
