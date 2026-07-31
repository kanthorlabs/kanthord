import type { Route } from "./routes.ts";
import { InvalidInputError } from "./errors.ts";

export type MatchOutcome =
  | {
      readonly kind: "match";
      readonly route: Route;
      readonly params: Record<string, string>;
    }
  | {
      readonly kind: "method_not_allowed";
      readonly allow: readonly string[];
    }
  | { readonly kind: "not_found" };

function normalize(path: string): string {
  const stripped =
    path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
  return stripped;
}

function segmentsOf(path: string): string[] {
  return normalize(path).split("/").slice(1);
}

function matchSegments(
  routeSegments: readonly string[],
  requestSegments: readonly string[],
): Record<string, string> | undefined {
  if (routeSegments.length !== requestSegments.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSegment = routeSegments[i];
    const requestSegment = requestSegments[i];
    if (routeSegment === undefined || requestSegment === undefined) {
      return undefined;
    }
    if (routeSegment.startsWith(":")) {
      const paramName = routeSegment.slice(1);
      try {
        params[paramName] = decodeURIComponent(requestSegment);
      } catch {
        throw new InvalidInputError(paramName, "is not valid percent-encoding");
      }
    } else if (routeSegment !== requestSegment) {
      return undefined;
    }
  }
  return params;
}

export function matchRoute(
  routes: readonly Route[],
  method: string,
  path: string,
): MatchOutcome {
  const requestSegments = segmentsOf(path);
  const upperMethod = method.toUpperCase();
  // HTTP requires HEAD wherever GET is supported, so a HEAD matches the GET row
  // and koa suppresses the body. Rows never declare HEAD themselves — that would
  // double the table and let the two answers drift apart. EPIC 026 needs this for
  // `HEAD /assets/:file`; it applies to every GET row alike.
  const matchMethod = upperMethod === "HEAD" ? "GET" : upperMethod;

  const pathMatches: Array<{ route: Route; params: Record<string, string> }> =
    [];
  for (const route of routes) {
    const params = matchSegments(segmentsOf(route.path), requestSegments);
    if (params !== undefined) {
      pathMatches.push({ route, params });
    }
  }

  if (pathMatches.length === 0) {
    return { kind: "not_found" };
  }

  const methodMatch = pathMatches.find((m) => m.route.method === matchMethod);
  if (methodMatch) {
    return {
      kind: "match",
      route: methodMatch.route,
      params: methodMatch.params,
    };
  }

  const allow = Array.from(
    new Set(pathMatches.map((m) => m.route.method)),
  ).sort();
  return { kind: "method_not_allowed", allow };
}
