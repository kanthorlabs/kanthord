// src/apps/cli/setup/run-setup.ts — EPIC 015 Story 4 + Story 5
// The guided-setup wizard's step executor. Pure orchestrator: every read,
// probe, and write flows through `deps`. Owns the step order, the
// drift/ambiguous short-circuit, the probe/verification scopes, the
// secret-hygiene guarantee, the interactive prompt loop, and the closing
// output (readiness verdict + exact next command).
//
// Why the orchestrator sits here and not in `src/app/`: per AGENTS.md, no use
// case calls another use case, and `src/app/` may not import a capability
// port. The step executor is a coordinator — a driving-adapter concern — so
// it lives in `apps/cli/setup/`, next to the drift-report formatter it
// reuses. The seam the wizard exposes is the `RunSetupDeps` bundle: every
// dep is a small structural shape the leaf wires in `composition.ts`.
//
// Secret rules:
//   - `value` (read by `readSecretFile`) is held in a local and handed to
//     `addResource` / `registerAiProvider` only. It never appears in a
//     stdout line, a stderr line, a thrown error, or the returned result.
//   - The probe + verification details are already redacted by EPIC 014's
//     `makeRedactor`; this module does not re-redact, truncate, or read
//     the secret back. The detail passes through verbatim.
//   - Interactive mode prompts for a *path* (the `*.valueFile` key), never
//     for a secret value. The ask message for a valueFile is
//     `<key> (path to a file containing the secret):`.

import type { AddResourceInput } from "../../../app/resource/add-resource.ts";
import type { CheckProjectInput } from "../../../app/project/check-project.ts";
import type { RegisterAiProviderInput } from "../../../app/ai-provider/register-ai-provider.ts";
import type { AssignAiProviderInput } from "../../../app/ai-provider/assign-ai-provider.ts";
import type {
  LoginProviderInput,
  OAuthLoginPresenter,
} from "../../../app/auth/login-provider.ts";
import type { CreateGraphInput } from "../../../app/graph/create-graph.ts";
import type { GraphPackage } from "../../../app/graph/graph-package.ts";
import type { LoginIO } from "../login.ts";
import type { ObserveSetupFactsInput } from "../../../app/project/observe-setup-facts.ts";
import type { ObservedFacts } from "../../../app/project/setup-plan.ts";
import type { ReadinessReport } from "../../../app/project/project-readiness.ts";
import {
  planSetup,
  planGraph,
  type RepositoryAuthValue,
  type SetupAnswers,
  type StepOutcome,
} from "../../../app/project/setup-plan.ts";
import {
  parseSetupAnswers,
  REPOSITORY_AUTH_MODES,
  PROVIDER_ROUTES,
  PROVIDER_APIS,
  BOOLEAN_VALUES,
  repositoryAuthDomainError,
  providerRouteDomainError,
  providerApiDomainError,
  booleanDomainError,
  stdinValueFileDomainError,
} from "../../../app/project/setup-answers.ts";
import { resolveGraphBindings } from "../import-graph.ts";
import { toResult } from "../error-map.ts";
import { formatDriftReport, formatAmbiguousReport } from "./drift-report.ts";
import type { SetupPrompt } from "./prompt.ts";
import type { ImportGraphDeps } from "../import-graph.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal structural surface of EPIC 014's `RepositoryProbe`
 * (`src/repository-probe/port.ts`). Declared locally rather than imported so
 * this `apps/` module honors the architecture boundary: `apps/` may depend on
 * `app/` only, never a capability port. `GitRepositoryProbe` stays
 * structurally assignable, so `composition.ts` can pass it straight through.
 * Mirrors the `CliWorkspaceManager` pattern at `src/apps/cli/deps.ts:82-85`.
 *
 * `auth` is the app-layer `RepositoryAuthValue` from `setup-plan.ts`, which is
 * structurally identical to the domain `RepositoryAuth` the port declares.
 * `detail` arrives already redacted and single-line from the 014 adapter, and
 * the probe never throws — a timeout is a `failed` result.
 */
export interface CliRepositoryProbe {
  probe(input: {
    remoteUrl: string;
    branch: string;
    auth: RepositoryAuthValue;
  }): Promise<{ status: "ok" | "failed"; detail: string }>;
}

export interface RunSetupArgs {
  answersPath?: string;
  nonInteractive: boolean;
  /**
   * The directory the answers file lives in; path-valued answers are
   * resolved against it. The leaf computes it from
   * `dirname(resolvePath(answersPath))` (or `process.cwd()` when no
   * answers file is provided) and always passes it in — `run-setup.ts`
   * never reads `process.cwd()` itself.
   */
  baseDir: string;
}

export interface RunSetupDeps {
  /**
   * Structural seam over the fact collector. Declared by capability (not the
   * concrete class) so a hermetic test fake with only `execute(input)` is
   * assignable, while the production `ObserveSetupFacts` class stays a
   * satisfying instance.
   */
  observeSetupFacts: {
    execute(input: ObserveSetupFactsInput): ObservedFacts;
  };
  /**
   * Structural seam over `CreateProject`. Only the `execute` method the
   * orchestrator actually calls is in the type, so the test fake with no
   * private fields remains assignable.
   */
  createProject: {
    execute(input: { name: string }): Promise<string>;
  };
  addResource: {
    execute(input: AddResourceInput): Promise<string>;
  };
  registerAiProvider: {
    execute(input: RegisterAiProviderInput): string;
  };
  assignAiProvider: {
    execute(input: AssignAiProviderInput): void;
  };
  /** The `login provider` use case + its live I/O for the OAuth presenter. */
  login: {
    loginProvider: {
      execute(input: LoginProviderInput): Promise<string>;
    };
    io: LoginIO;
  };
  createGraph: {
    execute(input: CreateGraphInput): Promise<{
      initiativeId: string;
    }>;
  };
  /** EPIC 014 `CheckProject`. Structural seam so the test fake is assignable. */
  checkProject: {
    execute(input: CheckProjectInput): Promise<ReadinessReport>;
  };
  /** EPIC 014 `GitRepositoryProbe`. */
  repositoryProbe: CliRepositoryProbe;
  /**
   * EPIC 014 `ProbeAiProvider`. Reused instead of `TestAiProvider` directly:
   * it never throws, it applies 014's `makeRedactor` to the failure detail,
   * and it owns the fixed `PROVIDER_PROBE_PROMPT`. Setup therefore
   * hand-rolls neither a prompt constant nor secret scrubbing.
   */
  providerProbe: {
    execute(providerId: string): Promise<{
      resourceId: string;
      status: "ok" | "failed";
      detail: string;
    }>;
  };
  newId: () => string;
  readTextFile: (path: string) => Promise<string>;
  readSecretFile: (path: string) => Promise<string>;
  readGraphPackage: (dir: string) => Promise<GraphPackage>;
  findResourcesByName: ImportGraphDeps["findResourcesByName"];
  getResource: ImportGraphDeps["getResource"];
  /** Story 5 — the only optional dep; a fully interactive run requires it. */
  prompt?: SetupPrompt;
  /** Story 5 — whether stdin is a real TTY, required so the mode guard is testable. */
  stdinIsTty: boolean;
}

// Re-export so leaf files can import the prompt type from one place.
export type { SetupPrompt } from "./prompt.ts";

export interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed provider-verification timeout, 60s. Mirrors 014's prompt contract. */
const PROVIDER_VERIFY_TIMEOUT_MS = 60_000;

/**
 * Placeholder for the redacted form of any secret the orchestrator has
 * handled during this run. The orchestrator never echoes a secret
 * verbatim — any detail that contains a tracked secret is rewritten to
 * carry `[redacted]` in place of the secret's bytes before it lands on
 * stderr. 014's adapter (`makeRedactor`) does the same on the way IN to
 * the probe; we mirror it on the way OUT so a mis-wired adapter (or a
 * test fake that forgets to redact) cannot leak the secret.
 */
const REDACTED_PLACEHOLDER = "[redacted]";

// ---------------------------------------------------------------------------
// Story 5 — interactive prompt constants
// ---------------------------------------------------------------------------

/**
 * The maximum number of invalid answers the wizard accepts for one key
 * before it gives up. Fixed at three; the spec is explicit: no
 * randomness, no implementer choice.
 */
const PROMPT_MAX_ATTEMPTS = 3;

/**
 * The fixed order in which the wizard asks for missing keys, with
 * discriminants before their dependents. The order is pinned by the
 * Story 5 verify list; a re-ordering would change the test-recorded
 * `ask` order and break the contract.
 */
const PINNED_KEY_ORDER: readonly string[] = [
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
  "provider.oauthMethod",
  "provider.baseUrl",
  "provider.api",
  "provider.valueFile",
  "provider.confirmCost",
  "graph.skip",
  "graph.packagePath",
];

/**
 * Discriminants the wizard asks before their dependents. The order is
 * what makes "relevance is recomputed after each discriminant is known"
 * work: once `repository.auth` is known, the three `credential.*` keys
 * become relevant or not; once `provider.route` is known, the route-
 * specific provider keys become relevant or not; once `graph.skip` is
 * known, `graph.packagePath` becomes relevant or not.
 */
const DISCRIMINANT_KEYS = new Set<string>([
  "repository.auth",
  "provider.route",
  "graph.skip",
]);

/**
 * The set of keys whose ask message is path-shaped (we never prompt for
 * a secret). The message is
 * `<key> (path to a file containing the secret):`.
 */
const VALUE_FILE_KEYS = new Set<string>([
  "credential.valueFile",
  "provider.valueFile",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The guided-setup step executor. Returns a `HandlerResult`; never throws.
 *
 * The body, in this exact order:
 *  1. Read + parse answers. Preflight-validated atomically: a failed parse
 *     returns before any database read.
 *  2. Observe current state. `ObserveSetupFacts` resolves the project by
 *     name and scopes the four other lists to it.
 *  3. Plan. `planSetup` decides each step as create / skip / drift /
 *     ambiguous.
 *  4. Abort on drift or ambiguity, before any write. This is what makes
 *     Phase I of the Proof mutate nothing on a stale answers file.
 *  5. Execute the five steps in fixed order: project → credential →
 *     repository → provider → graph. Each step appends exactly one summary
 *     line to stdout. A step failure returns `exitCode: 1` immediately
 *     with the lines produced so far on stdout and the failure on stderr —
 *     earlier steps stay applied.
 */
export async function runSetup(
  args: RunSetupArgs,
  deps: RunSetupDeps,
): Promise<HandlerResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  // Secrets read by `readSecretFile` are tracked here so any detail that
  // happens to embed one (a 014 probe with a mis-wired redaction, a
  // future test fake that forgets to redact) is scrubbed before it lands
  // on stderr. Tracking a Set is cheaper than scanning the answers
  // again on every failure.
  const trackedSecrets = new Set<string>();

  // 0. Mode guards (Story 5). These run BEFORE any I/O so a misuse of the
  //    flags returns immediately, with zero calls on the read or write
  //    fakes. The order is fixed by the spec.
  if (args.nonInteractive && args.answersPath === undefined) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --non-interactive requires --answers <file>"],
    };
  }
  if (
    !args.nonInteractive &&
    args.answersPath === undefined &&
    deps.stdinIsTty !== true
  ) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        "error: stdin is not a TTY; use --answers <file> --non-interactive",
      ],
    };
  }
  if (!args.nonInteractive && deps.prompt === undefined) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        "error: stdin is not a TTY; use --answers <file> --non-interactive",
      ],
    };
  }

  // 1. Read the answers file (or use empty text for a fully interactive
  //    run). Preflight-validated atomically: a failed parse returns
  //    before any database read.
  let answersText = "";
  if (args.answersPath !== undefined) {
    try {
      answersText = await deps.readTextFile(args.answersPath);
    } catch {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [`error: cannot read answers file: ${args.answersPath}`],
      };
    }
  }

  // 2. Interactive merge. Only runs when the user did NOT pass
  //    `--non-interactive`; a missing answer in `--non-interactive` mode
  //    is Story 2's preflight error, never a re-prompt. The prompt loop
  //    builds a `prompted` map of (key → value) for every required key
  //    not present in the answers file, in the pinned order, with
  //    relevance recomputed after each discriminant is known.
  if (!args.nonInteractive) {
    const promptResult = await collectInteractiveAnswers(
      answersText,
      deps.prompt!,
    );
    // Per-key validation errors (e.g. "wrong-value" for `repository.auth`)
    // are always pushed to stderr so the user sees the same message the
    // final `parseSetupAnswers` would emit; on success they're collected
    // here and dropped.
    for (const e of promptResult.errors) stderr.push(e);
    if (!promptResult.ok) {
      return { exitCode: 1, stdout, stderr };
    }
    answersText = mergeAnswersText(answersText, promptResult.prompted);
  }

  // 3. Re-parse the (possibly merged) text. One validation pass over the
  //    union so an interactive run and an `--answers` run are validated
  //    identically.
  const parsed = parseSetupAnswers(answersText, args.baseDir);
  if (!parsed.ok) {
    return { exitCode: 1, stdout, stderr: parsed.errors };
  }
  const answers = parsed.answers;

  // 2. Observe current state. Per Story 4's whole-orchestrator "never
  //    throw" contract: this call reads the database directly (unlike the
  //    step calls below, it can surface a raw infrastructure error, e.g. an
  //    un-migrated schema) so it needs its own fallback when the thrown
  //    error isn't one of `toResult`'s known domain errors.
  let facts: ObservedFacts;
  try {
    facts = deps.observeSetupFacts.execute({
      projectName: answers.project.name,
      repositoryName: answers.repository.name,
      providerName: answers.provider.name,
      ...(answers.credential !== undefined
        ? { credentialName: answers.credential.name }
        : {}),
    });
  } catch (err) {
    return failureResult([], stderr, err, trackedSecrets);
  }

  // 3. Plan.
  const plan = planSetup(facts, answers);

  // 4. Abort on drift or ambiguity, before any write. Walk in the spec's
  //    fixed order; the first offender short-circuits the rest.
  const ctx = {
    projectId: facts.projectsByName[0]?.id ?? "",
    ...(answers.graph.skip ? {} : { packagePath: answers.graph.packagePath }),
  };
  const ordered: StepOutcome[] = [
    plan.project,
    ...(plan.credential !== undefined ? [plan.credential] : []),
    plan.repository,
    plan.provider,
  ];
  for (const outcome of ordered) {
    if (outcome.kind === "drift") {
      return {
        exitCode: 1,
        stdout: [],
        stderr: formatDriftReport(outcome, ctx),
      };
    }
    if (outcome.kind === "ambiguous") {
      return {
        exitCode: 1,
        stdout: [],
        stderr: formatAmbiguousReport(outcome, ctx),
      };
    }
  }

  // 5. Execute the five steps in fixed order. Each step appends exactly
  //    one summary line to stdout; a step failure returns immediately
  //    with the lines produced so far.
  // 5a. Project.
  const projectOutcome = plan.project;
  let projectId: string;
  if (projectOutcome.kind === "create") {
    try {
      projectId = await deps.createProject.execute({
        name: answers.project.name,
      });
    } catch (err) {
      return failureResult(stdout, stderr, err, trackedSecrets);
    }
    stdout.push(`project: created ${projectId}`);
  } else {
    // skip — `projectsByName.length === 1` is guaranteed by the drift /
    // ambiguous short-circuit above.
    projectId = facts.projectsByName[0]!.id;
    stdout.push(`project: already satisfied (${projectId})`);
  }

  // 5b. Credential — only when `plan.credential !== undefined`, which
  //     is exactly when `answers.repository.auth === "https-token"`.
  let credentialId: string | undefined;
  if (plan.credential !== undefined) {
    const credentialOutcome = plan.credential;
    if (credentialOutcome.kind === "create") {
      try {
        const value = await deps.readSecretFile(answers.credential!.valueFile);
        trackedSecrets.add(value);
        credentialId = await deps.addResource.execute({
          type: "credential",
          projectId,
          name: answers.credential!.name,
          provider: answers.credential!.provider,
          value,
        });
      } catch (err) {
        return failureResult(stdout, stderr, err, trackedSecrets);
      }
      stdout.push(`credential: created ${credentialId}`);
    } else {
      // skip
      credentialId = facts.credentialsByName[0]!.id;
      stdout.push(`credential: already satisfied (${credentialId})`);
    }
    // `value` is a local; it never reaches stdout/stderr/result.
  }

  // 5c. Repository. `skip` does NOT call the probe (the spec's
  //     "probe on create only" rule). `create` builds the `auth` value
  //     BEFORE the probe because the probe needs it to resolve a token
  //     for a private remote.
  const repositoryOutcome = plan.repository;
  let repositoryId: string;
  if (repositoryOutcome.kind === "create") {
    const auth: RepositoryAuthValue =
      answers.repository.auth === "https-token"
        ? { kind: "https-token", credentialId: credentialId! }
        : { kind: answers.repository.auth };
    let probe: { status: "ok" | "failed"; detail: string };
    try {
      probe = await deps.repositoryProbe.probe({
        remoteUrl: answers.repository.remoteUrl,
        branch: answers.repository.branch,
        auth,
      });
    } catch (err) {
      return failureResult(stdout, stderr, err, trackedSecrets);
    }
    if (probe.status === "failed") {
      stderr.push(
        `error: repository: remote probe failed: ${scrub(probe.detail, trackedSecrets)}`,
      );
      return { exitCode: 1, stdout, stderr };
    }
    try {
      repositoryId = await deps.addResource.execute({
        type: "repository",
        projectId,
        name: answers.repository.name,
        remoteUrl: answers.repository.remoteUrl,
        branch: answers.repository.branch,
        path: answers.repository.path,
        auth,
      });
    } catch (err) {
      return failureResult(stdout, stderr, err, trackedSecrets);
    }
    stdout.push(`repository: created ${repositoryId}`);
  } else {
    repositoryId = facts.repositoriesByName[0]!.id;
    stdout.push(`repository: already satisfied (${repositoryId})`);
  }

  // 5d. Provider. `skip` does not register, assign, or verify.
  //     `create` decides `needsRegister` from observed state and
  //     `needsAssign` from the assignment flag; both default to true
  //     when no provider is observed.
  const providerOutcome = plan.provider;
  let providerId: string;
  if (providerOutcome.kind === "create") {
    const observed = facts.providersByName[0];
    const needsRegister =
      observed === undefined || observed.state === "logged_out";
    const needsAssign = observed === undefined || !observed.assignedToProject;

    if (needsRegister) {
      try {
        const registered = await registerProvider(
          answers,
          deps,
          trackedSecrets,
        );
        providerId = registered.id;
      } catch (err) {
        return failureResult(stdout, stderr, err, trackedSecrets);
      }
    } else {
      providerId = observed!.id;
    }

    let line: string;
    if (needsRegister) {
      line = `provider: created ${providerId}`;
    } else {
      line = `provider: registered already (${providerId})`;
    }

    if (needsAssign) {
      try {
        deps.assignAiProvider.execute({ projectId, providerId });
      } catch (err) {
        return failureResult(stdout, stderr, err, trackedSecrets);
      }
      line += " — assigned";
    }

    // Verify only when we just registered AND the route is not oauth.
    // The successful oauth login IS the verification; no `confirmCost`
    // consent exists for that route, and re-running a probe would re-bill.
    if (needsRegister && answers.provider.route !== "oauth") {
      let verifyOutcome: {
        resourceId: string;
        status: "ok" | "failed";
        detail: string;
      };
      try {
        verifyOutcome = await runWithTimeout(
          () => deps.providerProbe.execute(providerId),
          PROVIDER_VERIFY_TIMEOUT_MS,
          () => ({
            resourceId: providerId,
            status: "failed" as const,
            detail: `provider verification timed out after ${PROVIDER_VERIFY_TIMEOUT_MS}ms`,
          }),
        );
      } catch (err) {
        stdout.push(line);
        return failureResult(stdout, stderr, err, trackedSecrets);
      }
      if (verifyOutcome.status === "failed") {
        // The line is pushed BEFORE the failure return so the user sees
        // the registration on stdout; the two-line stderr then says what
        // to do. The line carries no "— verified" suffix because the
        // verification didn't pass.
        stdout.push(line);
        stderr.push(
          `error: provider: verification failed: ${scrub(verifyOutcome.detail, trackedSecrets)}`,
        );
        stderr.push(
          `provider ${providerId} is registered but unverified; fix the credential and rerun setup`,
        );
        return { exitCode: 1, stdout, stderr };
      }
      line += " — verified";
    }

    stdout.push(line);
  } else {
    // skip
    providerId = facts.providersByName[0]!.id;
    stdout.push(`provider: already satisfied (${providerId})`);
  }

  // 5e. Graph. The graph step computes its own outcome here (it is not in
  //     `planSetup` because it depends on the package's initiative name,
  //     which we have not read yet).
  if (answers.graph.skip) {
    stdout.push("graph: already satisfied (graph.skip=true)");
  } else {
    let pkg: GraphPackage;
    try {
      pkg = await deps.readGraphPackage(answers.graph.packagePath);
    } catch {
      stderr.push(
        `error: graph: cannot read package directory: ${answers.graph.packagePath}`,
      );
      return { exitCode: 1, stdout, stderr };
    }

    const graphOutcome = planGraph(
      facts.initiatives,
      answers,
      pkg.initiative.name,
    );
    if (graphOutcome.kind === "drift") {
      return {
        exitCode: 1,
        stdout,
        stderr: formatDriftReport(graphOutcome, ctx),
      };
    }
    if (graphOutcome.kind === "ambiguous") {
      return {
        exitCode: 1,
        stdout,
        stderr: formatAmbiguousReport(graphOutcome, ctx),
      };
    }
    if (graphOutcome.kind === "skip") {
      stdout.push(`graph: already satisfied (${graphOutcome.reason})`);
    } else {
      // create
      const resolved = await resolveGraphBindings(
        pkg.initiative.bindings ?? {},
        answers.graph.bind,
        projectId,
        {
          findResourcesByName: deps.findResourcesByName,
          getResource: deps.getResource,
        },
      );
      if (!resolved.ok) {
        return { exitCode: 1, stdout, stderr: resolved.errors };
      }
      let createResult: { initiativeId: string };
      try {
        createResult = await deps.createGraph.execute({
          pkg,
          projectId,
          packageId: deps.newId(),
          paused: false,
          bindings: resolved.bindings,
        });
      } catch (err) {
        return failureResult(stdout, stderr, err, trackedSecrets);
      }
      stdout.push(`graph: created initiative ${createResult.initiativeId}`);
    }
  }

  // 6. Closing output (Story 5). Appended after the graph step succeeds.
  //    The block names the project id, the readiness verdict (read-only
  //    — both probe flags are false), and the exact next command. A
  //    rejecting `checkProject` yields `readiness: unavailable` but keeps
  //    `exitCode: 0` — the configuration did happen.
  // `withWork` reflects the project's observed state, not just this run's
  // `graph.skip` flag: a rerun that legitimately skips the graph step on an
  // already-configured project (`facts.initiatives.length > 0`) still has
  // work, and a `create`/name-matching `skip` graph outcome this run always
  // leaves at least one initiative in place (Story 5 §C).
  const withWork = facts.initiatives.length > 0 || !answers.graph.skip;
  await appendClosingOutput(stdout, projectId, withWork, deps);

  return { exitCode: 0, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Register an AI provider by route. The `value` is read by
 * `readSecretFile` and handed to `registerAiProvider`; it never appears in
 * the returned id, never in a stdout line, never in a thrown error. The
 * value is also added to `trackedSecrets` so any subsequent
 * provider-verification `detail` that happens to embed the secret is
 * scrubbed before it lands on stderr.
 */
async function registerProvider(
  answers: SetupAnswers,
  deps: RunSetupDeps,
  trackedSecrets: Set<string>,
): Promise<{ id: string }> {
  if (answers.provider.route === "oauth") {
    const presenter = buildOAuthPresenter(deps.login.io);
    const id = await deps.login.loginProvider.execute({
      providerId: answers.provider.provider,
      name: answers.provider.name,
      method: answers.provider.oauthMethod,
      model: answers.provider.model,
      presenter,
    });
    return { id };
  }
  const value = await deps.readSecretFile(answers.provider.valueFile);
  trackedSecrets.add(value);
  if (answers.provider.route === "apiKey") {
    const id = deps.registerAiProvider.execute({
      name: answers.provider.name,
      provider: answers.provider.provider,
      model: answers.provider.model,
      value,
    });
    return { id };
  }
  // custom
  const id = deps.registerAiProvider.execute({
    name: answers.provider.name,
    provider: answers.provider.provider,
    customProviderId: answers.provider.provider,
    model: answers.provider.model,
    value,
    baseUrl: answers.provider.baseUrl,
    api: answers.provider.api,
  });
  return { id };
}

/**
 * Build an `OAuthLoginPresenter` over the live `LoginIO`. The presenter
 * is the only thing that can ever echo an OAuth token or device code to
 * the terminal; we forward it unchanged so the use case's own
 * presentation logic stays in charge. The tests prove none of the
 * presenter strings reach our stdout or stderr.
 */
function buildOAuthPresenter(io: LoginIO): OAuthLoginPresenter {
  return {
    showAuthUrl: (url, instructions) => {
      io.print(`\nOpen this URL in your browser to authenticate:\n${url}\n`);
      if (instructions) io.print(instructions);
    },
    showDeviceCode: ({ userCode, verificationUri }) => {
      io.print(`\nGo to ${verificationUri} and enter code: ${userCode}\n`);
    },
    progress: (message) => io.print(message),
    promptCode: (message) => io.prompt(message),
  };
}

/**
 * Race `op` against a timeout. `ProbeAiProvider.execute` is documented to
 * never throw, so the only way the timeout arm fires is when the adapter
 * itself hangs. The synthesised `failed` outcome carries a redacted
 * detail (no secret, no model reply) and a single line.
 */
async function runWithTimeout<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Replace any tracked secret embedded in `text` with `[redacted]`. Empty
 * strings and a non-empty `trackedSecrets` set are tolerated: an empty
 * set short-circuits to the input unchanged. The replacement is
 * non-overlapping and case-sensitive (real secrets are case-sensitive
 * tokens) so a real redaction cannot accidentally swallow a partial
 * match inside a different literal.
 */
function scrub(text: string, trackedSecrets: ReadonlySet<string>): string {
  if (trackedSecrets.size === 0) return text;
  let out = text;
  for (const secret of trackedSecrets) {
    if (secret.length === 0) continue;
    // Replace every occurrence; `String.prototype.replaceAll` is in Node 15+.
    out = out.split(secret).join(REDACTED_PLACEHOLDER);
  }
  return out;
}

/**
 * Map any use-case or infrastructure throw to a `HandlerResult`, per
 * Story 4 (`04-step-execution.md:283-284,136-138`): "Return HandlerResult;
 * never throw" and "On any step failure, return exitCode: 1 immediately
 * with the lines produced so far on stdout and the failure on stderr".
 * Reuses `toResult` — the same mapping every other CLI handler applies —
 * but `toResult` rethrows every error not in its `instanceof` list
 * (AUTO_REVIEW F-B1), so that call is wrapped: an unmapped error (a plain
 * `Error`, a raw infrastructure error such as `no such table: projects` on
 * an un-migrated schema) falls back to the same `error: <message>` shape
 * `toResult` would have produced had it matched, so no raw stack trace
 * ever escapes `runSetup`. Every mapped line is run through `scrub` so a
 * message that happens to embed a tracked secret is redacted like every
 * other failure path. Callers pass `[]` for `stdout` when no step has run
 * yet (e.g. the `observeSetupFacts` call).
 */
function failureResult(
  stdout: string[],
  stderr: string[],
  err: unknown,
  trackedSecrets: ReadonlySet<string>,
): HandlerResult {
  let mapped: { exitCode: number; stderr: string[] };
  try {
    mapped = toResult(err);
  } catch {
    mapped = {
      exitCode: 1,
      stderr: [`error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return {
    exitCode: mapped.exitCode,
    stdout,
    stderr: [...stderr, ...mapped.stderr.map((l) => scrub(l, trackedSecrets))],
  };
}

// ---------------------------------------------------------------------------
// Story 5 — interactive prompt helpers
// ---------------------------------------------------------------------------

/**
 * The result of one interactive-prompt pass. Either a map of newly
 * prompted key → value (to merge into the answers text) or a hard error
 * that must be reported to the user before any write happens. The
 * `errors` array is always present so the caller can iterate it
 * unconditionally to surface per-key validation messages.
 */
type InteractiveResult = {
  ok: boolean;
  prompted: Map<string, string>;
  errors: string[];
};

/**
 * Scan an answers file for the `<key>=<value>` pairs it contains.
 * Grammar-only: invalid lines (missing `=`, empty key/value, duplicates)
 * are silently ignored here so the prompt loop can ask for what the
 * file is missing. The full validation is done by `parseSetupAnswers`
 * on the merged text afterwards.
 */
function scanAnswersEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    if (key === "" || value === "") continue;
    entries.set(key, value);
  }
  return entries;
}

/**
 * The ask message for one key. ValueFile keys are path-shaped — the
 * wizard never prompts for a secret, only for a path. Other keys are
 * just the key name. The test contract (`run-setup.interactive.test.ts`)
 * records the message verbatim, so the format must match exactly.
 */
function formatAskMessage(key: string): string {
  if (VALUE_FILE_KEYS.has(key)) {
    return `${key} (path to a file containing the secret)`;
  }
  return key;
}

/**
 * Validate one prompted value in isolation, mirroring the per-key
 * messages `parseSetupAnswers` would emit. Returns `null` on success or
 * the error string to push to stderr and re-ask the same key.
 */
function validateKey(key: string, value: string): string | null {
  if (value === "") {
    return `error: ${key}: value must not be empty`;
  }
  switch (key) {
    case "repository.auth":
      if (!(REPOSITORY_AUTH_MODES as readonly string[]).includes(value)) {
        return repositoryAuthDomainError();
      }
      return null;
    case "provider.route":
      if (!(PROVIDER_ROUTES as readonly string[]).includes(value)) {
        return providerRouteDomainError();
      }
      return null;
    case "provider.api":
      if (!(PROVIDER_APIS as readonly string[]).includes(value)) {
        return providerApiDomainError();
      }
      return null;
    case "graph.skip":
    case "provider.confirmCost":
      if (!(BOOLEAN_VALUES as readonly string[]).includes(value)) {
        return booleanDomainError(key);
      }
      return null;
    case "credential.valueFile":
    case "provider.valueFile":
      if (value === "-") {
        return stdinValueFileDomainError(key);
      }
      return null;
    default:
      return null;
  }
}

/**
 * Is `key` relevant right now, given the partial answers + already-
 * prompted values? Discriminants first: `repository.auth`, `provider.route`,
 * `graph.skip`. The conditional sets are asked only for the chosen
 * route / auth / skip value.
 */
function isKeyRelevant(
  key: string,
  answers: ReadonlyMap<string, string>,
): boolean {
  if (
    key === "credential.name" ||
    key === "credential.provider" ||
    key === "credential.valueFile"
  ) {
    return answers.get("repository.auth") === "https-token";
  }
  if (key === "provider.oauthMethod") {
    return answers.get("provider.route") === "oauth";
  }
  if (key === "provider.baseUrl" || key === "provider.api") {
    return answers.get("provider.route") === "custom";
  }
  if (key === "provider.valueFile" || key === "provider.confirmCost") {
    const route = answers.get("provider.route");
    return route !== undefined && route !== "oauth";
  }
  if (key === "graph.packagePath") {
    return answers.get("graph.skip") !== "true";
  }
  return true;
}

/**
 * Run the interactive prompt loop. Walks the pinned order, skips keys
 * already present in the answers file or already prompted, skips keys
 * that are irrelevant given the current discriminants, and asks for the
 * rest with the 3-attempt limit. Returns the prompted map (to merge
 * into the answers text) or a hard error.
 */
async function collectInteractiveAnswers(
  answersText: string,
  prompt: SetupPrompt,
): Promise<InteractiveResult> {
  const errors: string[] = [];
  const fileEntries = scanAnswersEntries(answersText);
  const prompted = new Map<string, string>();
  // The "effective answers" for relevance decisions: the file's entries
  // overlaid with the prompted ones (prompted wins when both are set,
  // though that cannot happen — the loop never re-asks a prompted key).
  const effective = new Map<string, string>(fileEntries);

  for (const key of PINNED_KEY_ORDER) {
    if (effective.has(key)) continue;
    if (!isKeyRelevant(key, effective)) continue;

    let accepted = false;
    for (let attempt = 0; attempt < PROMPT_MAX_ATTEMPTS; attempt++) {
      const value = await prompt.ask(formatAskMessage(key));
      if (value === undefined) {
        errors.push("error: aborted");
        return { ok: false, prompted, errors };
      }
      const error = validateKey(key, value);
      if (error === null) {
        prompted.set(key, value);
        effective.set(key, value);
        accepted = true;
        break;
      }
      errors.push(error);
    }
    if (!accepted) {
      errors.push(`error: ${key}: too many invalid answers`);
      return { ok: false, prompted, errors };
    }
  }
  return { ok: true, prompted, errors };
}

/**
 * Rebuild the answers text: original text (with trailing newline) plus
 * one `<key>=<value>` line per prompted entry, plus a trailing newline.
 * The order of prompted lines mirrors the pinned ask order, which is
 * already the canonical key order.
 */
function mergeAnswersText(
  original: string,
  prompted: ReadonlyMap<string, string>,
): string {
  let text = original;
  if (!text.endsWith("\n")) text += "\n";
  for (const key of PINNED_KEY_ORDER) {
    const value = prompted.get(key);
    if (value === undefined) continue;
    text += `${key}=${value}\n`;
  }
  // `graph.bind.*` lines (if any) keep the original order; they were
  // present in the answers file (prompted=false) and need no merge.
  return text;
}

// ---------------------------------------------------------------------------
// Story 5 — closing output
// ---------------------------------------------------------------------------

/**
 * Append the four-line closing block to `stdout`. The block names the
 * project id, the readiness verdict (read-only — both probe flags are
 * false), and the exact next command. A rejecting `checkProject` yields
 * `readiness: unavailable` but keeps `exitCode: 0`.
 */
async function appendClosingOutput(
  stdout: string[],
  projectId: string,
  withWork: boolean,
  deps: RunSetupDeps,
): Promise<void> {
  stdout.push(`project id: ${projectId}`);

  try {
    const report = await deps.checkProject.execute({
      id: projectId,
      probeRepositories: false,
      probeProvider: false,
    });
    stdout.push(formatReadinessLine(report));
  } catch {
    stdout.push("readiness: unavailable");
  }

  stdout.push(
    `state: ${withWork ? "configured-with-work" : "configured-no-work"}`,
  );
  if (withWork) {
    stdout.push("next: kanthord run daemon");
  } else {
    // The user explicitly said `graph.skip=true` and the project has no
    // initiative yet; the next command names the graph-package directory
    // placeholder rather than a copy-pasteable `.`, per Story 5 §C.
    stdout.push(
      `next: kanthord import graph --create --dir <graph-package-dir> --project ${projectId}`,
    );
  }
}

/**
 * Format the readiness line. Only the four booleans are printed —
 * `checks[].detail` and `next.command` are never echoed (the latter
 * would otherwise leak `kanthord run daemon` into the no-work case).
 * `verified: null` renders as the literal string `null`.
 */
function formatReadinessLine(report: ReadinessReport): string {
  const verified = report.verified === null ? "null" : String(report.verified);
  return `readiness: configured=${report.configured} verified=${verified} operational=${report.operational} ready=${report.ready}`;
}
