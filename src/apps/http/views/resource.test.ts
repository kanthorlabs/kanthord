import { test } from "node:test";
import assert from "node:assert/strict";
import { resourceView } from "./resource.ts";
import type { ResourceView } from "../../../app/resource/resource-view.ts";

test("credential variant: exact key set, value never present", () => {
  const result = {
    type: "credential",
    id: "c1",
    projectId: "p1",
    name: "creds",
    provider: "github",
    value: "sekret",
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "name",
    "projectId",
    "provider",
    "type",
  ]);
  assert.equal(view.value, undefined);
});

test("credential variant: projectId absent is absent, not undefined", () => {
  const result = {
    type: "credential",
    id: "c1",
    name: "creds",
    provider: "github",
    value: "sekret",
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "name",
    "provider",
    "type",
  ]);
  assert.equal(view.value, undefined);
});

test("repository variant: auth https-token round-trips with exactly two keys", () => {
  const result = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "https-token", credentialId: "c1" },
    publication: null,
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  const auth = view.auth as Record<string, unknown>;
  assert.deepEqual(Object.keys(auth).sort(), ["credentialId", "kind"]);
  assert.equal(auth.kind, "https-token");
  assert.equal(auth.credentialId, "c1");
});

test("repository variant: auth ambient gives exactly one key", () => {
  const result = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "ambient" },
    publication: null,
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  const auth = view.auth as Record<string, unknown>;
  assert.deepEqual(Object.keys(auth).sort(), ["kind"]);
  assert.equal(auth.kind, "ambient");
});

test("repository variant: an unrecognised auth kind maps to ambient", () => {
  const result = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "bogus" },
    publication: null,
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  const auth = view.auth as Record<string, unknown>;
  assert.deepEqual(auth, { kind: "ambient" });
});

test("repository variant: publication null stays null; populated has exactly remoteOID and state", () => {
  const nullResult = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "ambient" },
    publication: null,
  } as unknown as ResourceView;
  const nullView = resourceView(nullResult) as unknown as Record<
    string,
    unknown
  >;
  assert.equal(nullView.publication, null);

  const populatedResult = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "ambient" },
    publication: { state: "published", remoteOID: "abc123", extra: "leak-me" },
  } as unknown as ResourceView;
  const populatedView = resourceView(populatedResult) as unknown as Record<
    string,
    unknown
  >;
  const publication = populatedView.publication as Record<string, unknown>;
  assert.deepEqual(Object.keys(publication).sort(), ["remoteOID", "state"]);
  assert.equal(publication.state, "published");
  assert.equal(publication.remoteOID, "abc123");
});

test("notification variant: exact key set, injected extra dropped", () => {
  const result = {
    type: "notification",
    id: "n1",
    projectId: "p1",
    name: "notif",
    provider: "slack",
    destination: "#eng",
    extra: "leak-me",
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "destination",
    "id",
    "name",
    "projectId",
    "provider",
    "type",
  ]);
});

test("filesystem variant: exact key set, injected extra dropped", () => {
  const result = {
    type: "filesystem",
    id: "f1",
    projectId: "p1",
    name: "fs",
    path: "/data",
    extra: "leak-me",
  } as unknown as ResourceView;
  const view = resourceView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "name",
    "path",
    "projectId",
    "type",
  ]);
});
