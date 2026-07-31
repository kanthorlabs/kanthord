// S5 — asyncStateOf: branch-order adapter from react-query result to AsyncState.
// Branch order is binding — evaluate top to bottom, first match wins.
import { describe, expect, test } from "vitest";
import { ApiError } from "./api-client";

describe("asyncStateOf", () => {
  test("isPending:true → 'loading' (branch 1)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: true,
      isError: false,
      error: null,
      data: undefined,
    };
    expect(asyncStateOf(query)).toBe("loading");
  });

  test("isError + ApiError(404) → 'missing' (branch 2)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: true,
      error: new ApiError(404, "not_found", "gone"),
      data: undefined,
    };
    expect(asyncStateOf(query)).toBe("missing");
  });

  test("isError + ApiError(503) → 'error' (branch 2 does not match, branch 3)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: true,
      error: new ApiError(503, "unavailable", "x"),
      data: undefined,
    };
    expect(asyncStateOf(query)).toBe("error");
  });

  test("isError + plain Error → 'error' (branch 3)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: true,
      error: new Error("plain"),
      data: undefined,
    };
    expect(asyncStateOf(query)).toBe("error");
  });

  test("not pending, not error, data undefined → 'loading' (branch 4)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
    };
    expect(asyncStateOf(query)).toBe("loading");
  });

  test("data:[] with isEmpty predicate → 'empty' (branch 5)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: false,
      error: null,
      data: [] as string[],
    };
    expect(asyncStateOf(query, { isEmpty: (d) => d.length === 0 })).toBe(
      "empty",
    );
  });

  test("data:['a'] with isEmpty predicate → 'resolved' (branch 5 does not match, branch 6)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: false,
      error: null,
      data: ["a"] as string[],
    };
    expect(asyncStateOf(query, { isEmpty: (d) => d.length === 0 })).toBe(
      "resolved",
    );
  });

  test("data:[] with no isEmpty → 'resolved' (adapter never guesses emptiness)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: false,
      isError: false,
      error: null,
      data: [] as string[],
    };
    expect(asyncStateOf(query)).toBe("resolved");
  });

  test("pending AND error → 'loading' (branch 1 wins over branch 3)", async () => {
    const { asyncStateOf } = await import("./async-state");
    const query = {
      isPending: true,
      isError: true,
      error: new Error("both"),
      data: undefined,
    };
    expect(asyncStateOf(query)).toBe("loading");
  });
});
