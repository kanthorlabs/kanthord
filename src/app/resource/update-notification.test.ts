import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateNotification } from "./update-notification.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Resource, Notification } from "../../domain/resource.ts";

// ------------------------------------------------------------------ fake repo

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-1",
    type: "notification",
    projectId: "proj-1",
    name: "my-notif",
    provider: "slack",
    destination: "#old-channel",
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

test("UpdateNotification execute: destination update persists new destination", async () => {
  const notif = makeNotification();
  const repo = makeFakeProjectRepository(notif);
  const uc = new UpdateNotification(repo);
  await uc.execute({ id: "notif-1", destination: "#new-channel" });
  assert.ok(repo.saved, "resource was saved");
  assert.equal((repo.saved as Notification).destination, "#new-channel");
});

test("UpdateNotification execute: name update persists new name", async () => {
  const notif = makeNotification();
  const repo = makeFakeProjectRepository(notif);
  const uc = new UpdateNotification(repo);
  await uc.execute({ id: "notif-1", name: "renamed-notif" });
  assert.ok(repo.saved);
  assert.equal((repo.saved as Notification).name, "renamed-notif");
});

test("UpdateNotification execute: provider change throws ImmutableFieldError", async () => {
  const notif = makeNotification();
  const repo = makeFakeProjectRepository(notif);
  const uc = new UpdateNotification(repo);
  await assert.rejects(
    () =>
      (uc.execute as (input: Record<string, unknown>) => Promise<void>)({
        id: "notif-1",
        provider: "telegram",
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

test("UpdateNotification execute: unknown id throws UnknownReferenceError", async () => {
  const repo = makeFakeProjectRepository();
  const uc = new UpdateNotification(repo);
  await assert.rejects(
    () => uc.execute({ id: "no-such-id" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      return true;
    },
  );
});
