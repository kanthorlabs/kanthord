// src/apps/http/static.ts — serving the built UI (EPIC 026 S5, decision 2).
//
// `@koa/send` is a FUNCTION, not a routing middleware, so `ROUTES` stays the
// single routing authority: it owns MIME, `Content-Length`, `Last-Modified`,
// range handling and hidden-file refusal, while this module owns which paths
// exist, the cache policy, the validator and the 404 policy.
//
// Two measured facts about `@koa/send@6` shape the code below:
//   * it sets `Cache-Control` only when the response does not already carry one,
//     so the policy must be set BEFORE the call to win;
//   * it sets no `ETag` and performs no conditional-request check, so the
//     `ETag`/`304` pair is ours to add.
import { send } from "@koa/send";
import type { Context } from "koa";
import type { Readable } from "node:stream";
import { HttpFailure } from "./errors.ts";
import { TRANSPORT_ERRORS } from "./error-registry.ts";

/** A hashed asset can never change under its own name. One year, immutable. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * `index.html`, `sw.js` and `manifest.webmanifest` carry no hash, so a cached
 * copy would pin the operator to a stale build. `no-cache` still allows the
 * `ETag` revalidation below — it means "ask first", not "never store".
 */
export const NO_CACHE_CACHE_CONTROL = "no-cache";

export type StaticCachePolicy = "immutable" | "no-cache";

/** What a static route row resolves to: a dist-relative file and its policy. */
export interface StaticFileTarget {
  /** Path relative to the dist root, e.g. `index.html`, `assets/main-a1b2.js`. */
  readonly file: string;
  readonly cache: StaticCachePolicy;
}

function cacheControlOf(policy: StaticCachePolicy): string {
  return policy === "immutable"
    ? IMMUTABLE_CACHE_CONTROL
    : NO_CACHE_CACHE_CONTROL;
}

function unknownRoute(): HttpFailure {
  const e = TRANSPORT_ERRORS.unknown_route;
  return new HttpFailure(e.code, e.status, e.message);
}

/**
 * true when every segment of a dist-relative path is an ordinary name.
 *
 * The router already percent-decodes a `:param`, so `%2e%2e%2f` arrives here as
 * `../` — one validator covers both spellings the Gate names. Rejecting before
 * `@koa/send` runs is deliberate: `resolve-path` would answer 403 with its own
 * error shape, and every refusal on this surface must look like the same
 * `404 unknown_route` envelope the rest of the route table answers with.
 */
export function isSafeDistPath(file: string): boolean {
  if (file === "" || file.includes("\0") || file.includes("\\")) {
    return false;
  }
  return file
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Serve one file from the injected dist root.
 *
 * `distRoot` is INJECTED, never discovered at import time: `ui/dist` is
 * gitignored, so a root resolved at module scope would make every backend test
 * run depend on a prior UI build. An absent root, an unbuilt directory and a
 * missing file all answer `404 unknown_route` — the app still constructs and
 * `/healthz` still answers with no UI build present at all.
 */
export async function sendUiFile(
  ctx: Context,
  distRoot: string | undefined,
  target: StaticFileTarget,
): Promise<void> {
  if (distRoot === undefined || distRoot === "") {
    throw unknownRoute();
  }
  if (!isSafeDistPath(target.file)) {
    throw unknownRoute();
  }

  // Set the policy first — `@koa/send` will not overwrite an existing value.
  ctx.set("Cache-Control", cacheControlOf(target.cache));

  let sent: string | undefined;
  try {
    sent = await send(ctx, target.file, {
      root: distRoot,
      // No directory listing, no directory-to-index rewrite and no extension
      // guessing: `ROUTES` decides which paths exist, not the filesystem.
      index: false,
      format: false,
      extensions: false,
      hidden: false,
      // The daemon is loopback-only and serves no pre-compressed twins.
      gzip: false,
      brotli: false,
      setHeaders: (_res, _path, stats) => {
        // A weak validator over size + mtime. Weak is honest here: it says
        // "semantically the same bytes", which is exactly what a rebuild of an
        // unchanged file produces, and it needs no read of the file to compute.
        ctx.set(
          "ETag",
          `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`,
        );
      },
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { status?: number }).status === 404
    ) {
      throw unknownRoute();
    }
    throw err;
  }

  // `@koa/send` returns undefined instead of throwing when it refuses a path
  // (a hidden segment, or a directory with no index). That must not fall
  // through to koa's bare 404 — it would answer outside the error envelope.
  if (sent === undefined) {
    throw unknownRoute();
  }

  const body: unknown = ctx.body;
  const stream =
    typeof body === "object" &&
    body !== null &&
    typeof (body as Readable).destroy === "function"
      ? (body as Readable)
      : undefined;

  // A `HEAD` and a `304` both end the response without reading the stream, so
  // the file descriptor `createReadStream` already opened would leak. Closing
  // on `close` covers all three cases; on a normal 200 the stream has already
  // ended and `destroy()` is a no-op.
  if (stream !== undefined) {
    ctx.res.once("close", () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    });
  }

  // `ctx.fresh` compares the request's `If-None-Match` against the `ETag` just
  // set. Koa nulls the body itself for an empty status, which is what drops the
  // content headers a 304 must not carry.
  if (ctx.fresh) {
    ctx.status = 304;
  }
}
