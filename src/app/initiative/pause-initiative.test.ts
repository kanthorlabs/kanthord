import { test } from "node:test";
import assert from "node:assert/strict";

import { PauseInitiative } from "./pause-initiative.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";
import type { Initiative } from "../../domain/initiative.ts";
import { newId } from "../../domain/entity.ts";

// Narrow repo the use case depends on
interface PauseRepo {
  get(id: string): Initiative | undefined;
  setPaused(id: string, paused: boolean): void;
}

// Narrow resolver the use case depends on
interface KindResolver {
  resolveKind(id: string): string | undefined;
}

class FakePauseRepo implements PauseRepo {
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

test("PauseInitiative execute sets the paused flag for a known initiative", async () => {
  const repo = new FakePauseRepo();
  const id = newId();
  repo.seed(id, false);
  const useCase = new PauseInitiative(repo, new MockKindResolver("initiative"));
  await useCase.execute({ initiativeId: id });
  assert.equal(repo.isPaused(id), true);
});

test("PauseInitiative execute is idempotent — pausing an already-paused initiative succeeds", async () => {
  const repo = new FakePauseRepo();
  const id = newId();
  repo.seed(id, true);
  const useCase = new PauseInitiative(repo, new MockKindResolver("initiative"));
  // must not throw
  await assert.doesNotReject(() => useCase.execute({ initiativeId: id }));
  assert.equal(repo.isPaused(id), true);
});

test("PauseInitiative execute throws UnknownReferenceError for an unknown id", async () => {
  const repo = new FakePauseRepo();
  const useCase = new PauseInitiative(repo, new MockKindResolver(undefined));
  await assert.rejects(
    () => useCase.execute({ initiativeId: "no-such" }),
    (err: unknown) => err instanceof UnknownReferenceError,
  );
});

test("PauseInitiative execute throws WrongTypeReferenceError for a task id", async () => {
  const repo = new FakePauseRepo();
  const useCase = new PauseInitiative(repo, new MockKindResolver("task"));
  await assert.rejects(
    () => useCase.execute({ initiativeId: "task-id" }),
    (err: unknown) => err instanceof WrongTypeReferenceError,
  );
});
