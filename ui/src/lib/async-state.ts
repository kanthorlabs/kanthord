// S5 — asyncStateOf: branch-order adapter from react-query result to AsyncState.
// Branch order is binding — evaluate top to bottom, first match wins.
import { ApiError } from "./api-client";

export type AsyncState =
  | "loading"
  | "empty"
  | "error"
  | "missing"
  | "resolved"
  | "expired"
  | "truncated";

export interface QueryLike<T> {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly data: T | undefined;
}

export interface AsyncStateOptions<T> {
  readonly isEmpty?: (data: T) => boolean;
}

export function asyncStateOf<T>(
  query: QueryLike<T>,
  options?: AsyncStateOptions<T>,
): AsyncState {
  // Branch 1: pending → loading
  if (query.isPending) return "loading";
  // Branch 2: error + ApiError(404) → missing
  if (
    query.isError &&
    query.error instanceof ApiError &&
    query.error.status === 404
  )
    return "missing";
  // Branch 3: error → error
  if (query.isError) return "error";
  // Branch 4: data === undefined → loading
  if (query.data === undefined) return "loading";
  // Branch 5: isEmpty predicate → empty
  if (options?.isEmpty?.(query.data)) return "empty";
  // Branch 6: resolved
  return "resolved";
}
