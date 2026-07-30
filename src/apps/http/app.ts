// src/apps/http/app.ts — buildHttpApp: the koa app, its fixed middleware order (Story 05).
import Koa from "koa";
import cors from "@koa/cors";
import { bodyParser } from "@koa/bodyparser";
import { ulid } from "ulid";
import type { HttpDeps } from "./deps.ts";
import type { Route } from "./routes.ts";
import { ROUTES } from "./routes.ts";
import { requireApiKey } from "./api-key.ts";
import { checkBasicAuth, BASIC_CHALLENGE } from "./basic-auth.ts";
import { HttpFailure } from "./errors.ts";
import { TRANSPORT_ERRORS, mapError } from "./error-registry.ts";
import { dataEnvelope, errorEnvelope } from "./envelope.ts";
import { matchRoute } from "./router.ts";

export interface HttpAppOptions {
  /** Already validated by requireApiKey; buildHttpApp never reads process.env. */
  readonly apiKey: string;
  /** Injectable so tests can prove gates no real row reaches. */
  readonly routes?: readonly Route[];
  /** Injectable for deterministic ids in tests. Defaults to ulid(). */
  readonly newRequestId?: () => string;
}

/** true for POST, PUT, PATCH — the methods that carry a JSON body. */
export function requiresJsonContentType(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH";
}

/** true for POST, PUT, PATCH, DELETE — every unsafe method. */
export function requiresOriginCheck(method: string): boolean {
  const upper = method.toUpperCase();
  return (
    upper === "POST" ||
    upper === "PUT" ||
    upper === "PATCH" ||
    upper === "DELETE"
  );
}

/** true for http://127.0.0.1[:port] and http://localhost[:port] only. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function parseHostname(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) {
    return undefined;
  }
  const colonIndex = hostHeader.lastIndexOf(":");
  return colonIndex === -1 ? hostHeader : hostHeader.slice(0, colonIndex);
}

export function buildHttpApp(deps: HttpDeps, opts: HttpAppOptions): Koa {
  requireApiKey(opts.apiKey);
  const routes = opts.routes ?? ROUTES;
  const newRequestId = opts.newRequestId ?? ulid;

  const app = new Koa();

  // 1. error boundary (outermost)
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      // Drain any request bytes the client is still writing (e.g. a body over
      // jsonLimit that @koa/bodyparser stopped reading mid-stream) before
      // responding, so ending the response early does not reset the socket
      // out from under the client's still-in-flight write. This guarantee
      // holds for keep-alive connections; with `Connection: close`, Node
      // still calls destroySoon() on the socket once the response ends, so
      // the peer can still see an RST despite the drain.
      ctx.req.resume();
      const m = mapError(err);
      const requestId = (ctx.state["requestId"] as string | undefined) ?? "";
      ctx.status = m.status;
      ctx.body = errorEnvelope(m.code, m.message, requestId);
      deps.logger.error("request failed", {
        requestId,
        method: ctx.method,
        path: ctx.path,
        status: m.status,
        code: m.code,
        cause: String(err),
      });
    }
  });

  // 2. requestId
  app.use(async (ctx, next) => {
    ctx.state["requestId"] = newRequestId();
    await next();
  });

  // 3. request log
  app.use(async (ctx, next) => {
    const startedAt = Date.now();
    try {
      await next();
      deps.logger.info("request", {
        requestId: ctx.state["requestId"],
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      // The error boundary (middleware 1) is outermost and sets ctx.status
      // only after this middleware's stack frame unwinds, so on an error
      // path ctx.status here still reflects koa's pre-mapping default. Log
      // the mapped status instead, then rethrow so the boundary still
      // handles the response body and its own error-level log.
      const m = mapError(err);
      deps.logger.info("request", {
        requestId: ctx.state["requestId"],
        method: ctx.method,
        path: ctx.path,
        status: m.status,
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  });

  // 4. Host check
  app.use(async (ctx, next) => {
    const hostname = parseHostname(ctx.get("host"));
    if (hostname !== "127.0.0.1" && hostname !== "localhost") {
      const e = TRANSPORT_ERRORS.host_not_allowed;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    await next();
  });

  // 5. @koa/cors
  app.use(
    cors({
      origin: (ctx) =>
        isAllowedOrigin(ctx.get("origin")) ? ctx.get("origin") : "",
      credentials: false,
      allowMethods: ["GET", "POST", "PATCH", "DELETE"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // 6. Basic auth
  app.use(async (ctx, next) => {
    if (!checkBasicAuth(ctx.get("authorization"), opts.apiKey)) {
      ctx.set("WWW-Authenticate", BASIC_CHALLENGE);
      const e = TRANSPORT_ERRORS.unauthenticated;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    await next();
  });

  // 7. unsafe-method gate
  app.use(async (ctx, next) => {
    if (
      requiresJsonContentType(ctx.method) &&
      ctx.request.type !== "application/json"
    ) {
      const e = TRANSPORT_ERRORS.unsupported_media_type;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    if (requiresOriginCheck(ctx.method)) {
      const origin = ctx.get("origin");
      // Decision 6 (EPIC 019): the CSRF gate must equal the server's own
      // origin (scheme+host+port), not merely "some loopback origin" — a
      // foreign loopback port must be rejected. `@koa/cors`'s isAllowedOrigin
      // (step 5) stays loose on purpose; only this gate is tight.
      //
      // koa@3's `ctx.origin` getter is a passthrough of the request's own
      // `Origin` header (node_modules/koa/lib/request.js:98-100), not the
      // server's computed scheme+host — it cannot be used here. Build the
      // server's own origin instead from `ctx.protocol` and `ctx.host`
      // (`ctx.host` reads the `Host` header, already validated as loopback
      // by the Host-check middleware at step 4).
      const serverOrigin = `${ctx.protocol}://${ctx.host}`;
      if (origin && origin !== serverOrigin) {
        const e = TRANSPORT_ERRORS.origin_not_allowed;
        throw new HttpFailure(e.code, e.status, e.message);
      }
    }
    await next();
  });

  // 8. @koa/bodyparser
  app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "1mb" }));

  // 9. dispatch
  app.use(async (ctx) => {
    const outcome = matchRoute(routes, ctx.method, ctx.path);
    if (outcome.kind === "not_found") {
      const e = TRANSPORT_ERRORS.unknown_route;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    if (outcome.kind === "method_not_allowed") {
      ctx.set("Allow", outcome.allow.join(", "));
      const e = TRANSPORT_ERRORS.method_not_allowed;
      throw new HttpFailure(e.code, e.status, e.message);
    }

    const route = outcome.route;
    const input = route.decode({
      params: outcome.params,
      query: ctx.query,
      body: ctx.request.body,
    });
    const result = await route.run(deps, input);

    if (route.successStatus === 204) {
      ctx.status = 204;
      ctx.body = null;
      return;
    }
    const present = route.present;
    if (present === undefined) {
      const e = TRANSPORT_ERRORS.internal;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    if (route.kind === "html") {
      ctx.status = route.successStatus;
      ctx.type = "text/html; charset=utf-8";
      ctx.body = present(result) as string;
      return;
    }
    ctx.status = route.successStatus;
    ctx.body = dataEnvelope(present(result));
  });

  return app;
}
