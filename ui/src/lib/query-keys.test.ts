// Story 02 — query keys and invalidateOverview (decision 11).
// Tests that projectKeys/resourceKeys produce the exact query-key tuples
// and that invalidateOverview touches only the overview key.
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { projectKeys, resourceKeys, invalidateOverview } from "./query-keys";

describe("projectKeys", () => {
  test("all() is ['project']", () => {
    expect(projectKeys.all()).toEqual(["project"]);
  });

  test("list() with no arg is ['project']", () => {
    expect(projectKeys.list()).toEqual(["project"]);
  });

  test("list('') is ['project'] — blank never sends name=", () => {
    expect(projectKeys.list("")).toEqual(["project"]);
  });

  test("list('a') is ['project', { name: 'a' }]", () => {
    expect(projectKeys.list("a")).toEqual(["project", { name: "a" }]);
  });

  test("detail('p1') is ['project', 'p1']", () => {
    expect(projectKeys.detail("p1")).toEqual(["project", "p1"]);
  });

  test("overview('p1') is ['project', 'p1', 'overview']", () => {
    expect(projectKeys.overview("p1")).toEqual(["project", "p1", "overview"]);
  });

  test("resources('p1', 'repository') is ['project', 'p1', 'resource', 'repository']", () => {
    expect(projectKeys.resources("p1", "repository")).toEqual([
      "project",
      "p1",
      "resource",
      "repository",
    ]);
  });

  test("resources('p1', 'repository', 'x') appends { name: 'x' }", () => {
    expect(projectKeys.resources("p1", "repository", "x")).toEqual([
      "project",
      "p1",
      "resource",
      "repository",
      { name: "x" },
    ]);
  });
});

describe("resourceKeys", () => {
  test("detail('r1') is ['resource', 'r1']", () => {
    expect(resourceKeys.detail("r1")).toEqual(["resource", "r1"]);
  });
});

describe("invalidateOverview", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    client.clear();
  });

  test("invalidates the overview key and leaves resource + list keys untouched", async () => {
    // Seed four distinct keys
    client.setQueryData(projectKeys.overview("p1"), { projectId: "p1" });
    client.setQueryData(projectKeys.list(), [{ id: "p1", name: "alpha" }]);
    client.setQueryData(projectKeys.resources("p1", "repository"), [
      { id: "r1", name: "repo" },
    ]);
    client.setQueryData(resourceKeys.detail("r1"), { id: "r1", name: "repo" });

    await invalidateOverview(client, "p1");

    // Overview: invalidated
    expect(
      client.getQueryState(projectKeys.overview("p1"))?.isInvalidated,
    ).toBe(true);

    // Others: NOT invalidated
    expect(client.getQueryState(projectKeys.list())?.isInvalidated).toBe(false);
    expect(
      client.getQueryState(projectKeys.resources("p1", "repository"))
        ?.isInvalidated,
    ).toBe(false);
    expect(client.getQueryState(resourceKeys.detail("r1"))?.isInvalidated).toBe(
      false,
    );
  });
});
