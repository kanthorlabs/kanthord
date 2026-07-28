// src/app/project/setup-answers.ts — EPIC 015 Story 2
// Pure, zero I/O. Parses an answer file into a `SetupAnswers` value or
// returns every error at once. The wizard's preflight runs this verbatim
// before the first write, so a failed parse leaves the database untouched.
//
// Why a function and not a class: the parse is a single text → value
// transformation with no dependencies. `baseDir` is data (the directory of
// the answers file), not a port. Keeping the shape a function makes the
// hermetic test contract obvious and avoids an empty wrapper class.

import { isAbsolute, resolve } from "node:path";

import { hasEmbeddedUserinfo } from "../../domain/resource.ts";
import type { ProviderApi, ProviderRoute, SetupAnswers } from "./setup-plan.ts";

export interface ParsedEntry {
  key: string;
  value: string;
  line: number;
}

export type ParseSetupAnswersResult =
  { ok: true; answers: SetupAnswers } | { ok: false; errors: string[] };

// ── Closed key set and value domains ────────────────────────────────────────
//
// These four domains (and the exact error message each one produces) are the
// single source of truth for both this preflight parser and the interactive
// prompt loop's per-key `validateKey` in `run-setup.ts`, so the two paths
// cannot silently drift onto different wording for the same rejection.

export const REPOSITORY_AUTH_MODES = [
  "ambient",
  "https-token",
  "ssh-agent",
] as const;
export const PROVIDER_ROUTES = ["oauth", "apiKey", "custom"] as const;
export const PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
] as const;
export const BOOLEAN_VALUES = ["true", "false"] as const;

/** The exact rejection message for an out-of-domain `repository.auth` value. */
export function repositoryAuthDomainError(): string {
  return `error: repository.auth must be one of: ${REPOSITORY_AUTH_MODES.join(", ")}`;
}

/** The exact rejection message for an out-of-domain `provider.route` value. */
export function providerRouteDomainError(): string {
  return `error: provider.route must be one of: ${PROVIDER_ROUTES.join(", ")}`;
}

/** The exact rejection message for an out-of-domain `provider.api` value. */
export function providerApiDomainError(): string {
  return `error: provider.api must be one of: ${PROVIDER_APIS.join(", ")}`;
}

/** The exact rejection message for an out-of-domain boolean key's value. */
export function booleanDomainError(key: string): string {
  return `error: ${key} must be exactly "true" or "false"`;
}

/** The exact rejection message for `-` (stdin) given to a `*.valueFile` key. */
export function stdinValueFileDomainError(key: string): string {
  return `error: ${key}: stdin ("-") is not supported with --answers; give a file path`;
}

/**
 * The two inline-secret keys are recognised so they can be rejected with a
 * secret-specific message instead of the generic "unknown key" message. The
 * value is never read after rejection — it is dropped before the answers
 * value is built.
 */
const SECRET_KEYS = new Set(["credential.value", "provider.value"]);

/**
 * Every known answer key. Anything outside this set (and outside the
 * `graph.bind.<alias>` regex) is an "unknown key" error. The two secret keys
 * are NOT in this set — they are intercepted in the secret-key phase.
 */
const KNOWN_KEYS = new Set<string>([
  "project.name",
  "repository.name",
  "repository.remoteUrl",
  "repository.branch",
  "repository.path",
  "repository.auth",
  "credential.name",
  "credential.provider",
  "credential.valueFile",
  "provider.route",
  "provider.name",
  "provider.provider",
  "provider.model",
  "provider.valueFile",
  "provider.confirmCost",
  "provider.oauthMethod",
  "provider.baseUrl",
  "provider.api",
  "graph.skip",
  "graph.packagePath",
]);

/** Graph bindings: `graph.bind.<alias>=<value>`, alias matches `[A-Za-z0-9_-]+`. */
const GRAPH_BIND_RE = /^graph\.bind\.([A-Za-z0-9_-]+)$/;

/**
 * Keys that are irrelevant when `provider.route` matches the listed route.
 * `provider.valueFile` / `provider.confirmCost` are required for apiKey and
 * custom, so they only appear in the oauth list (where they would bypass
 * the verification consent).
 */
const PROVIDER_ROUTE_IRRELEVANT: Record<ProviderRoute, readonly string[]> = {
  apiKey: ["provider.oauthMethod", "provider.baseUrl", "provider.api"],
  custom: ["provider.oauthMethod"],
  oauth: [
    "provider.valueFile",
    "provider.confirmCost",
    "provider.baseUrl",
    "provider.api",
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function isOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value);
}

/**
 * Resolve a path answer against the answers file's directory. Values are
 * never shell-unescaped, so `$HOME/mirror` stays a literal — the resolution
 * is plain `path.resolve` plus the absolute shortcut. The result is always
 * absolute (Story 2's "`repository.path` is always absolute" constraint).
 */
function resolvePath(baseDir: string, value: string): string {
  if (isAbsolute(value)) return value;
  return resolve(baseDir, value);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse an answer file's contents into a `SetupAnswers` value.
 *
 * @param text   The answers file contents (raw, with `\n` line endings).
 * @param baseDir The directory of the answers file; every path-valued answer
 *                is resolved against it. Treated as data, never as I/O.
 * @returns A discriminated result. On failure the result has no `answers`
 *          property — the parse is atomic, so a failed parse never exposes
 *          a partial value. Errors are collected in the order:
 *          grammar → secret-key → unknown → irrelevant → missing → value-domain.
 */
export function parseSetupAnswers(
  text: string,
  baseDir: string,
): ParseSetupAnswersResult {
  const errors: string[] = [];
  const entries = new Map<string, { value: string; line: number }>();
  const lines = text.split("\n");

  // 1. Grammar — parse line by line, pushing format errors in line order.
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.replace(/\r$/, "");
    const lineNum = i + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      errors.push(`error: line ${lineNum}: expected key=value`);
      continue;
    }
    const rawKey = line.slice(0, eqIdx).trim();
    const rawValue = line.slice(eqIdx + 1).trim();
    if (rawKey === "") {
      errors.push(`error: line ${lineNum}: expected key=value`);
      continue;
    }
    if (rawValue === "") {
      errors.push(`error: ${rawKey}: value must not be empty`);
      continue;
    }
    if (entries.has(rawKey)) {
      errors.push(`error: duplicate key: ${rawKey}`);
      continue;
    }
    entries.set(rawKey, { value: rawValue, line: lineNum });
  }

  const get = (key: string): string | undefined => entries.get(key)?.value;

  // 2. Secret-key rejections — recognisable keys that are never accepted.
  for (const key of SECRET_KEYS) {
    if (!entries.has(key)) continue;
    const prefix = key.split(".")[0]!;
    errors.push(
      `error: ${key} is not accepted; provide the secret as a path with ${prefix}.valueFile=<path>`,
    );
  }

  // 3. Unknown keys — every key outside the closed set (and not graph.bind.*).
  for (const key of entries.keys()) {
    if (SECRET_KEYS.has(key)) continue;
    if (KNOWN_KEYS.has(key)) continue;
    if (GRAPH_BIND_RE.test(key)) continue;
    errors.push(`error: unknown key: ${key}`);
  }

  // 4. Discriminants — auth, route, graph.skip gate the conditional sets.
  const authRaw = get("repository.auth");
  const routeRaw = get("provider.route");
  const graphSkipRaw = get("graph.skip");

  const auth = isOneOf(authRaw, REPOSITORY_AUTH_MODES) ? authRaw : null;
  const route = isOneOf(routeRaw, PROVIDER_ROUTES) ? routeRaw : null;
  // `graph.skip` is optional (default `false`); `null` here means "absent
  // or unparseable" — the build phase treats `null` and `false` the same
  // way (package path required, bind map populated). A value of `true`
  // makes both irrelevant.
  const graphSkip = isOneOf(graphSkipRaw, BOOLEAN_VALUES)
    ? graphSkipRaw === "true"
    : false;

  // 5. Irrelevant keys — emitted only when the governing discriminant is valid.
  if (auth !== null && auth !== "https-token") {
    for (const k of [
      "credential.name",
      "credential.provider",
      "credential.valueFile",
    ]) {
      if (entries.has(k)) {
        errors.push(`error: ${k} is not relevant for repository.auth=${auth}`);
      }
    }
  }
  if (route !== null) {
    for (const k of PROVIDER_ROUTE_IRRELEVANT[route]) {
      if (entries.has(k)) {
        errors.push(`error: ${k} is not relevant for provider.route=${route}`);
      }
    }
  }
  if (graphSkip === true) {
    for (const key of entries.keys()) {
      if (key === "graph.packagePath" || GRAPH_BIND_RE.test(key)) {
        errors.push(`error: ${key} is not relevant for graph.skip=true`);
      }
    }
  }

  // 6. Missing required keys — conditional sets add to the always-required set.
  //    When a discriminant is missing or out of domain, its conditional set
  //    is skipped (the discriminant error is reported later in value-domain).
  const required = new Set<string>([
    "project.name",
    "repository.name",
    "repository.remoteUrl",
    "repository.branch",
    "repository.path",
    "repository.auth",
    "provider.route",
    "provider.name",
    "provider.provider",
    "provider.model",
  ]);
  if (auth === "https-token") {
    required.add("credential.name");
    required.add("credential.provider");
    required.add("credential.valueFile");
  }
  if (route === "apiKey") {
    required.add("provider.valueFile");
    required.add("provider.confirmCost");
  } else if (route === "custom") {
    required.add("provider.valueFile");
    required.add("provider.confirmCost");
    required.add("provider.baseUrl");
    required.add("provider.api");
  } else if (route === "oauth") {
    required.add("provider.oauthMethod");
  }
  // graph.skip is optional; the default is false, which requires a package path.
  if (graphSkip !== true) {
    required.add("graph.packagePath");
  }
  for (const k of required) {
    if (!entries.has(k)) {
      errors.push(`error: ${k} is required`);
    }
  }

  // 7. Value-domain errors — enums, booleans, the confirmCost=true invariant,
  //    embedded credentials, and the stdin ("-") valueFile rejection.
  if (authRaw !== undefined && auth === null) {
    errors.push(repositoryAuthDomainError());
  }
  if (routeRaw !== undefined && route === null) {
    errors.push(providerRouteDomainError());
  }
  const apiRaw = get("provider.api");
  if (apiRaw !== undefined && !isOneOf(apiRaw, PROVIDER_APIS)) {
    errors.push(providerApiDomainError());
  }
  for (const k of ["graph.skip", "provider.confirmCost"]) {
    const v = get(k);
    if (v !== undefined && !isOneOf(v, BOOLEAN_VALUES)) {
      errors.push(booleanDomainError(k));
    }
  }
  // confirmCost must be true when the route requires provider verification.
  if (route === "apiKey" || route === "custom") {
    if (get("provider.confirmCost") === "false") {
      errors.push(
        `error: provider.confirmCost must be true to authorise the provider verification call`,
      );
    }
  }
  const remoteUrl = get("repository.remoteUrl");
  if (remoteUrl !== undefined && hasEmbeddedUserinfo(remoteUrl)) {
    errors.push(
      `error: repository.remoteUrl must not contain embedded credentials`,
    );
  }
  for (const k of ["credential.valueFile", "provider.valueFile"]) {
    if (get(k) === "-") {
      errors.push(stdinValueFileDomainError(k));
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // 8. Build the SetupAnswers value. The discriminant checks above have
  //    narrowed `auth`, `route`, and `graphSkip` to non-null; the `!`s here
  //    are safe because every required key is in `entries` at this point.
  const providerCommon = {
    name: get("provider.name")!,
    provider: get("provider.provider")!,
    model: get("provider.model")!,
  };
  const provider: SetupAnswers["provider"] =
    route === "oauth"
      ? {
          ...providerCommon,
          route: "oauth",
          oauthMethod: get("provider.oauthMethod")!,
        }
      : route === "apiKey"
        ? {
            ...providerCommon,
            route: "apiKey",
            valueFile: resolvePath(baseDir, get("provider.valueFile")!),
            confirmCost: true,
          }
        : {
            ...providerCommon,
            route: "custom",
            valueFile: resolvePath(baseDir, get("provider.valueFile")!),
            confirmCost: true,
            baseUrl: get("provider.baseUrl")!,
            api: get("provider.api")! as ProviderApi,
          };

  const bind: Record<string, string> = {};
  if (graphSkip === false) {
    for (const [key, { value }] of entries) {
      const m = GRAPH_BIND_RE.exec(key);
      if (m) bind[m[1]!] = value;
    }
  }

  const graph: SetupAnswers["graph"] =
    graphSkip === true
      ? { skip: true }
      : {
          skip: false,
          packagePath: resolvePath(baseDir, get("graph.packagePath")!),
          bind,
        };

  return {
    ok: true,
    answers: {
      project: { name: get("project.name")! },
      repository: {
        name: get("repository.name")!,
        remoteUrl: get("repository.remoteUrl")!,
        branch: get("repository.branch")!,
        path: resolvePath(baseDir, get("repository.path")!),
        auth: auth!,
      },
      credential:
        auth === "https-token"
          ? {
              name: get("credential.name")!,
              provider: get("credential.provider")!,
              valueFile: resolvePath(baseDir, get("credential.valueFile")!),
            }
          : undefined,
      provider,
      graph,
    },
  };
}
