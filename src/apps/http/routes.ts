import { packageVersion } from "../version.ts";
import type { HttpDeps } from "./deps.ts";
import { uiShell } from "./ui.ts";
import { healthView, type HealthResult } from "./views/health.ts";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Raw request material handed to a row's `decode`. */
export interface RouteInput {
  readonly params: Readonly<Record<string, string>>;
  /** Koa's ctx.query shape: a value may be absent. */
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: unknown;
}

export interface Route {
  /** Stable key the UI codes against, e.g. "health.get". */
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly successStatus: 200 | 201 | 204;
  /** "json" → envelope; "html" → `present` returns the document body. */
  readonly kind: "json" | "html";
  /** CLI leaf paths this row covers, e.g. ["get project"]. May be empty. */
  readonly cliCommands: readonly string[];
  /**
   * HTTP shape → use-case input. The only layer that touches HTTP-flavoured
   * data: params are strings, a query value may be absent or an array, the
   * body is whatever `@koa/bodyparser` parsed. Validate and coerce here —
   * `requirePathParam` rejects an id blank after `.trim()` with
   * `400 invalid_input`, so a single space never reaches a use case.
   * Never calls a use case; never touches the database.
   */
  readonly decode: (input: RouteInput) => unknown;
  /**
   * Calls the use case and returns its result — usually one line, with no
   * logic of its own (no validation, no formatting). `deps` is a PARAMETER,
   * not a closure, so `ROUTES` stays a static const the policy tests can
   * iterate (decision 8).
   */
  readonly run: (deps: HttpDeps, input: unknown) => Promise<unknown>;
  /**
   * Use-case result → wire DTO with a LITERAL field list, which
   * `dataEnvelope` then wraps as `{"data": …}`. Mandatory, not stylistic: a
   * use case returns a `domain/` entity and eslint `boundaries` forbids
   * `apps/` → `domain/`, so naming the fields here is the only legal answer
   * — and it stops an internal entity field leaking onto the wire.
   * Two exemptions: forbidden when `successStatus` is 204 (no body at all);
   * when `kind` is "html" it returns the document string and the envelope is
   * skipped — that is how `GET /` serves the UI shell.
   */
  readonly present?: (result: unknown) => unknown;
}

export const ROUTES: readonly Route[] = [
  {
    id: "health.get",
    method: "GET",
    path: "/healthz",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => ({ status: "ok" as const, version: packageVersion }),
    present: (result) => healthView(result as HealthResult),
  },
  {
    id: "ui.get",
    method: "GET",
    path: "/",
    successStatus: 200,
    kind: "html",
    cliCommands: [],
    decode: () => ({}),
    run: async () => uiShell(),
    present: (result) => result as string,
  },
];
