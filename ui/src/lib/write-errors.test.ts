// Story 07 Verify — write-errors: all 7 codes map to distinct messages.
import { describe, expect, test } from "vitest";
import { ApiError } from "./api-client";
import {
  DEPENDENCY_ERROR_CODES,
  DEPENDENCY_ERROR_MESSAGE,
  dependencyErrorMessage,
} from "./write-errors";

describe("DEPENDENCY_ERROR_MESSAGE", () => {
  test("all 7 codes have entries and the messages are distinct", () => {
    expect(DEPENDENCY_ERROR_CODES).toHaveLength(7);
    const messages = Object.values(DEPENDENCY_ERROR_MESSAGE);
    expect(new Set(messages).size).toBe(7);
  });

  test("the guard: every DEPENDENCY_ERROR_CODES member has a key and vice versa", () => {
    const matrixKeys = Object.keys(DEPENDENCY_ERROR_MESSAGE);
    expect(matrixKeys.sort()).toEqual([...DEPENDENCY_ERROR_CODES].sort());
  });
});

describe("dependencyErrorMessage", () => {
  test.each(DEPENDENCY_ERROR_CODES)("%s returns its pinned message", (code) => {
    const error = new ApiError(400, code, "raw server text");
    expect(dependencyErrorMessage(error)).toBe(DEPENDENCY_ERROR_MESSAGE[code]);
  });

  test("unknown code with a server message returns the server message", () => {
    const error = new ApiError(400, "unknown_code", "server says this");
    expect(dependencyErrorMessage(error)).toBe("server says this");
  });

  test("unknown code with a blank message returns the (status) fallback", () => {
    const error = new ApiError(409, "unknown_code", "");
    expect(dependencyErrorMessage(error)).toBe(
      "The server refused this edge (409).",
    );
  });
});
