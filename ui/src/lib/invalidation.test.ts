// Story 03 Verify — invalidation matrix: all 8 rows, guard test, exactness.
import { describe, expect, test, vi } from "vitest";
import {
  INVALIDATION_MATRIX,
  invalidateFor,
  projectListTarget,
} from "./invalidation";
import type { MutationName } from "./invalidation";
import {
  projectKeys,
  initiativeKeys,
  objectiveKeys,
  taskKeys,
} from "./query-keys";
import type { QueryClient } from "@tanstack/react-query";

// All MutationName members for the guard test
const ALL_MUTATIONS: readonly MutationName[] = [
  "project.create",
  "project.rename",
  "initiative.create",
  "initiative.rename",
  "objective.create",
  "objective.rename",
  "task.create",
  "dependency.write",
];

// --- Guard tests ---

describe("INVALIDATION_MATRIX guard", () => {
  test("has exactly the 8 MutationName members", () => {
    const keys = Object.keys(INVALIDATION_MATRIX).sort();
    expect(keys).toEqual([...ALL_MUTATIONS].sort());
  });

  test("every value is a function that returns at least one target for a fully-populated context", () => {
    const fullCtx = {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      id: "e1",
      entityKey: ["task", "t1"],
    };
    for (const name of ALL_MUTATIONS) {
      const fn = INVALIDATION_MATRIX[name];
      const targets = fn(fullCtx);
      expect(targets.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// --- One test per matrix row (8 tests) ---

describe("project.create", () => {
  test("invalidates project list keys", async () => {
    const invalidateQueries = vi.fn();
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "project.create", {});
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const target = projectListTarget();
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: target.queryKey,
        exact: target.exact,
      }),
    );
  });
});

describe("project.rename", () => {
  test("invalidates project list, detail(id), and overview(id)", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "project.rename", { id: "p1" });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    // project list
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: ["project"],
        exact: false,
      }),
    );
    // project detail
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.detail("p1"),
        exact: true,
      }),
    );
    // project overview
    expect(calls[2]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
  });
});

describe("initiative.create", () => {
  test("invalidates initiative list and project overview", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "initiative.create", { projectId: "p1" });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: initiativeKeys.list("p1"),
        exact: true,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
  });
});

describe("initiative.rename", () => {
  test("invalidates initiative list, project overview, and initiative detail", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "initiative.rename", {
      projectId: "p1",
      id: "i1",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: initiativeKeys.list("p1"),
        exact: true,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
    expect(calls[2]).toEqual(
      expect.objectContaining({
        queryKey: initiativeKeys.detail("i1"),
        exact: true,
      }),
    );
  });
});

describe("objective.create", () => {
  test("invalidates objective list and project overview", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "objective.create", {
      initiativeId: "i1",
      projectId: "p1",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: objectiveKeys.list("i1"),
        exact: true,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
  });
});

describe("objective.rename", () => {
  test("invalidates objective list, project overview, and objective detail", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "objective.rename", {
      initiativeId: "i1",
      projectId: "p1",
      id: "o1",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: objectiveKeys.list("i1"),
        exact: true,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
    expect(calls[2]).toEqual(
      expect.objectContaining({
        queryKey: objectiveKeys.detail("o1"),
        exact: true,
      }),
    );
  });
});

describe("task.create", () => {
  test("invalidates task list (exact:false) and project overview", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    await invalidateFor(client, "task.create", {
      initiativeId: "i1",
      projectId: "p1",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: taskKeys.list("i1"),
        exact: false,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
  });
});

describe("dependency.write", () => {
  test("invalidates entityKey and project overview", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;
    const entityKey = ["task", "t1"] as const;
    await invalidateFor(client, "dependency.write", {
      projectId: "p1",
      entityKey,
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        queryKey: entityKey,
        exact: true,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        queryKey: projectKeys.overview("p1"),
        exact: true,
      }),
    );
  });
});

// --- project-list exactness ---

describe("project list exactness", () => {
  test("project.create invalidates only project list keys, not detail/overview/initiative", async () => {
    // Track which keys were invalidated
    const invalidated: unknown[][] = [];
    const client = {
      invalidateQueries: vi.fn(
        (opts: { queryKey: unknown[]; exact: boolean }) => {
          invalidated.push(opts.queryKey);
        },
      ),
    } as unknown as QueryClient;

    await invalidateFor(client, "project.create", {});

    // project.create should target project list only
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toEqual(["project"]);
  });
});

// --- project.rename does invalidate detail and overview ---

describe("project.rename detail and overview", () => {
  test("invalidates detail(p1) and overview(p1), not detail(p2)", async () => {
    const invalidated: unknown[][] = [];
    const client = {
      invalidateQueries: vi.fn(
        (opts: { queryKey: unknown[]; exact: boolean }) => {
          invalidated.push(opts.queryKey);
        },
      ),
    } as unknown as QueryClient;

    await invalidateFor(client, "project.rename", { id: "p1" });

    expect(invalidated).toHaveLength(3);
    expect(invalidated).toContainEqual(projectKeys.detail("p1"));
    expect(invalidated).toContainEqual(projectKeys.overview("p1"));
    // Should NOT contain p2
    expect(invalidated).not.toContainEqual(projectKeys.detail("p2"));
  });
});

// --- task.create prefix ---

describe("task.create prefix", () => {
  test("taskKeys.list(i1) with exact:false covers both objective-filtered and unfiltered", async () => {
    const calls: unknown[] = [];
    const invalidateQueries = vi.fn((...args: unknown[]) => {
      calls.push(args[0]);
    });
    const client = { invalidateQueries } as unknown as QueryClient;

    await invalidateFor(client, "task.create", {
      initiativeId: "i1",
      projectId: "p1",
    });

    // The task list target should be a prefix match
    const taskTarget = calls[0] as { queryKey: unknown[]; exact: boolean };
    expect(taskTarget.queryKey).toEqual(taskKeys.list("i1"));
    expect(taskTarget.exact).toBe(false);
  });
});

// --- missing context throws ---

describe("missing context throws", () => {
  test("invalidateFor with no initiativeId throws for objective.create", async () => {
    const client = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    await expect(
      invalidateFor(client, "objective.create", { projectId: "p1" }),
    ).rejects.toThrow(/objective\.create needs ctx\.initiativeId/);
  });

  test("invalidateFor with no projectId throws for initiative.create", async () => {
    const client = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    await expect(
      invalidateFor(client, "initiative.create", {}),
    ).rejects.toThrow(/initiative\.create needs ctx\.projectId/);
  });
});
