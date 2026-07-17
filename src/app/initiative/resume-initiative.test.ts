import { test } from "node:test";
import assert from "node:assert/strict";

import { ResumeInitiative } from "./resume-initiative.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";
import type { Initiative } from "../../domain/initiative.ts";
import { newId } from "../../domain/entity.ts";

// Narrow repo the use case depends on
interface ResumeRepo {
  get(id: string): Initiative | undefined;
  setPaused(id: string, paused: boolean): void;
}

// Narrow resolver the use case depends on
interface KindResolver {
  resolveKind(id: string): string | undefined;
}

class FakeResumeRepo implements ResumeRepo {
  readonly #map = new Map<
    string,
    { initiative: Initiative; paused: boolean }
  >();

  seed(id: string, paused = false): void {
    this.#map.set(id, {
      initiative: { id, projectId: "proj-1", name: "test" },
      paused,
    });
  }

  get(id: string): Initiative | undefined {
    return this.#map.get(id)?.initiative;
  }

  setPaused(id: string, paused: boolean): void {
    const entry = this.#map.get(id);
    if (entry) entry.paused = paused;
  }

  isPaused(id: string): boolean {
    return this.#map.get(id)?.paused ?? false;
  }
}

class MockKindResolver implements KindResolver {
  readonly #kind: string | undefined;

  constructor(kind: string | undefined) {
    this.#kind = kind;
  }

  resolveKind(_id: string): string | undefined {
    return this.#kind;
  }
}

test("ResumeInitiative execute clears the paused flag for a known initiative", async () => {
  const repo = new FakeResumeRepo();
  const id = newId();
  repo.seed(id, true);
  const useCase = new ResumeInitiative(
    repo,
    new MockKindResolver("initiative"),
  );
  await useCase.execute({ initiativeId: id });
  assert.equal(repo.isPaused(id), false);
});

test("ResumeInitiative execute is idempotent — resuming an unpaused initiative succeeds", async () => {
  const repo = new FakeResumeRepo();
  const id = newId();
  repo.seed(id, false);
  const useCase = new ResumeInitiative(
    repo,
    new MockKindResolver("initiative"),
  );
  // must not throw
  await assert.doesNotReject(() => useCase.execute({ initiativeId: id }));
  assert.equal(repo.isPaused(id), false);
});

test("ResumeInitiative execute throws UnknownReferenceError for an unknown id", async () => {
  const repo = new FakeResumeRepo();
  const useCase = new ResumeInitiative(repo, new MockKindResolver(undefined));
  await assert.rejects(
    () => useCase.execute({ initiativeId: "no-such" }),
    (err: unknown) => err instanceof UnknownReferenceError,
  );
});

test("ResumeInitiative execute throws WrongTypeReferenceError for a task id", async () => {
  const repo = new FakeResumeRepo();
  const useCase = new ResumeInitiative(repo, new MockKindResolver("task"));
  await assert.rejects(
    () => useCase.execute({ initiativeId: "task-id" }),
    (err: unknown) => err instanceof WrongTypeReferenceError,
  );
});
