// src/app/project/project-readiness.ts — EPIC 014 Story 1+2
// Pure (zero-I/O) project readiness report. Takes observed facts and returns a
// deterministic ReadinessReport. The caller does every read, every clock read,
// and every probe — this module is a pure function over its input.
//
// A test in the co-located suite asserts this file contains no `from "` and no
// `require(`, so the fact and report types are declared structurally here. No
// port, clock, fs, or storage dependency can sneak in: the report's truth comes
// from the facts the caller assembled, not from anything this file reads.
//
// Story 2 adds the `next` field: the first check whose status is in
// ACTIONABLE_STATUSES, looked up in a static table that names the user-facing
// action and the inputs the report cannot invent. The command is present iff
// every required value is already known (e.g. the lowest-id paused initiative
// for `initiative/paused`); otherwise the property is absent.

/** Status vocabulary for every configuration check. Closed. */
export const CONFIG_CHECK_STATUSES = [
  "ok",
  "unverified",
  "missing",
  "paused",
  "blocked",
  "failed",
  "unsupported",
] as const;
export type ConfigCheckStatus = (typeof CONFIG_CHECK_STATUSES)[number];

/** Status vocabulary for the daemon check only. Closed. */
export const DAEMON_STATUSES = ["running", "stopped", "multiple"] as const;
export type DaemonStatus = (typeof DAEMON_STATUSES)[number];

/** Check emission order. `checks[]` is always exactly this, in this order. */
export const CHECK_ORDER = [
  "database",
  "repository",
  "ai_provider",
  "initiative",
  "notification",
  "daemon",
] as const;
export type CheckName = (typeof CHECK_ORDER)[number];

/** Checks whose non-configured status makes `configured` false. */
export const CONFIG_CHECKS = [
  "database",
  "repository",
  "ai_provider",
  "initiative",
] as const;

/** Statuses that mean "kanthord does not have what it needs recorded". */
export const NOT_CONFIGURED_STATUSES = [
  "missing",
  "paused",
  "blocked",
] as const;

/** Statuses that mean "the user must do something to make progress". */
export const ACTIONABLE_STATUSES = [
  "missing",
  "paused",
  "blocked",
  "failed",
  "stopped",
] as const;
export type ActionableStatus = (typeof ACTIONABLE_STATUSES)[number];

export interface RepositoryFact {
  id: string;
  name: string;
  branch: string;
  auth: "ambient" | "https-token" | "ssh-agent";
  /** `auth.credentialId` for https-token, else null. */
  credentialId: string | null;
  /** True when a resource with `credentialId` exists in this project. */
  credentialExists: boolean;
  /** True when that resource's `type` is exactly `"credential"`. */
  credentialIsCredentialType: boolean;
}

export interface InitiativeFact {
  id: string;
  name: string;
  status: "building" | "landed" | "discarded";
  paused: boolean;
  /** Tasks under the initiative whose status is not completed/discarded. */
  incompleteTaskCount: number;
}

export interface ResolvedProviderFact {
  id: string;
  name: string;
  /**
   * How this member entered the chain: an explicit project assignment, or the
   * appended active global default. `resolveProviderChain` already filtered to
   * active, so every member here is active.
   */
  source: "assigned" | "default";
}

export interface AiProviderFacts {
  /**
   * The chain the DAEMON would resolve for this project, in daemon order,
   * including the appended active global default. Never a stricter view: a
   * report that says `missing` while the daemon would happily run is the same
   * class of lie as reporting a dead key as `ok`.
   */
  resolved: ResolvedProviderFact[];
  /** Count of explicit project assignments, whatever their state. Separates `blocked` from `missing`. */
  assignedCount: number;
}

export interface DaemonInstanceFact {
  instanceId: string;
  /**
   * Age in MILLISECONDS. Never negative — the caller clamps a backwards clock
   * jump to 0. Milliseconds, not seconds, because the threshold can be as small
   * as 2000ms via KANTHORD_HEARTBEAT_STALE_MS and second-truncation would make
   * the boundary comparison wrong by up to a second.
   */
  ageMs: number;
}

export interface ProbeRecord {
  resourceId: string;
  status: "ok" | "failed";
  detail: string;
}

export interface ReadinessFacts {
  projectId: string;
  database: { schemaVersion: number; expectedSchemaVersion: number };
  repositories: RepositoryFact[];
  aiProvider: AiProviderFacts;
  initiatives: InitiativeFact[];
  daemon: { instances: DaemonInstanceFact[]; staleMs: number };
  /** A key present means that probe family RAN this run. Absent means it did not. */
  probes: { repositories?: ProbeRecord[]; provider?: ProbeRecord[] };
}

export interface CheckRecord {
  name: CheckName;
  status: ConfigCheckStatus | DaemonStatus;
  blocking: boolean;
  detail: string;
  /** Present only on a check whose probe family ran this run. */
  probes?: ProbeRecord[];
  /** Present only on the `daemon` check. Null when no instance is live. */
  ageSeconds?: number | null;
}

/** A single recommended next action the user can take to unblock readiness. */
export interface NextAction {
  check: CheckName;
  action: string;
  requiresInput: string[];
  /**
   * Runnable shell command. Property-absent (not `undefined`) when
   * `requiresInput` is non-empty — `JSON.stringify` drops it. Present when
   * every value is already known, so the report never invents user decisions.
   */
  command?: string;
}

export interface ReadinessReport {
  projectId: string;
  configured: boolean;
  verified: boolean | null;
  operational: boolean;
  ready: boolean;
  checks: CheckRecord[];
  /**
   * First actionable check in CHECK_ORDER, or null when none qualify. The
   * selection walks the already-built `checks` array in order.
   */
  next: NextAction | null;
}

const DEFAULT_SUFFIX =
  " — resolving via the global default provider, not assigned to this project;" +
  " pin it with: kanthord assign ai-provider";

function ascBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K,
): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function isRepositoryConfigured(r: RepositoryFact): boolean {
  if (r.auth !== "https-token") return true;
  return (
    r.credentialId !== null &&
    r.credentialExists &&
    r.credentialIsCredentialType
  );
}

function evalDatabase(db: ReadinessFacts["database"]): CheckRecord {
  if (db.schemaVersion === db.expectedSchemaVersion) {
    return {
      name: "database",
      status: "ok",
      blocking: true,
      detail: `schema version ${db.schemaVersion}`,
    };
  }
  return {
    name: "database",
    status: "blocked",
    blocking: true,
    detail: `schema version ${db.schemaVersion}, expected ${db.expectedSchemaVersion} — run: kanthord db migrate`,
  };
}

function evalRepository(
  repositories: readonly RepositoryFact[],
  probes: ProbeRecord[] | undefined,
): CheckRecord {
  if (repositories.length === 0) {
    return {
      name: "repository",
      status: "missing",
      blocking: true,
      detail: "no repository resource in this project",
      ...(probes !== undefined
        ? { probes: ascBy(probes, (p) => p.resourceId) }
        : {}),
    };
  }
  const notConfigured = repositories.find((r) => !isRepositoryConfigured(r));
  if (notConfigured) {
    return {
      name: "repository",
      status: "blocked",
      blocking: true,
      detail: `repository ${notConfigured.name} uses https-token auth but its credential reference ${notConfigured.credentialId ?? "(none)"} is missing or is not a credential resource`,
      ...(probes !== undefined
        ? { probes: ascBy(probes, (p) => p.resourceId) }
        : {}),
    };
  }
  if (probes === undefined) {
    return {
      name: "repository",
      status: "unverified",
      blocking: true,
      detail: `${repositories.length} repository resource(s) recorded, not probed — run with --probe-repositories`,
    };
  }
  const sorted = ascBy(probes, (p) => p.resourceId);
  const failedCount = probes.filter((p) => p.status === "failed").length;
  if (failedCount > 0) {
    return {
      name: "repository",
      status: "failed",
      blocking: true,
      detail: `${failedCount} of ${probes.length} repository probe(s) failed`,
      probes: sorted,
    };
  }
  return {
    name: "repository",
    status: "ok",
    blocking: true,
    detail: `${probes.length} of ${probes.length} repository probe(s) reachable`,
    probes: sorted,
  };
}

function evalAiProvider(
  aiProvider: AiProviderFacts,
  probes: ProbeRecord[] | undefined,
): CheckRecord {
  const { resolved, assignedCount } = aiProvider;

  if (resolved.length === 0 && assignedCount > 0) {
    return {
      name: "ai_provider",
      status: "blocked",
      blocking: true,
      detail:
        "every assigned ai provider is logged out — run: kanthord login provider",
    };
  }
  if (resolved.length === 0) {
    return {
      name: "ai_provider",
      status: "missing",
      blocking: true,
      detail:
        "no ai provider resolves for this project — run: kanthord register ai-provider",
    };
  }

  // The default-suffix applies only when the chain actually resolves via the
  // global default — the implicit dependency that would otherwise stay
  // invisible to a project that has never run `assign ai-provider`.
  const isDefault = resolved[0]?.source === "default";
  const suffix = isDefault ? DEFAULT_SUFFIX : "";

  if (probes === undefined) {
    return {
      name: "ai_provider",
      status: "unverified",
      blocking: true,
      detail: `${resolved.length} ai provider(s) resolved, not probed — run with --probe-provider (billable)${suffix}`,
    };
  }
  const failed = probes.find((p) => p.status === "failed");
  if (failed) {
    return {
      name: "ai_provider",
      status: "failed",
      blocking: true,
      detail: `ai provider probe failed${suffix}`,
      probes,
    };
  }
  return {
    name: "ai_provider",
    status: "ok",
    blocking: true,
    detail: `ai provider probe succeeded${suffix}`,
    probes,
  };
}

function evalInitiative(initiatives: readonly InitiativeFact[]): CheckRecord {
  // Sort ascending by id first — every detail and the tie-break below is
  // deterministic only because of this ordering.
  const sorted = ascBy(initiatives, (i) => i.id);
  const candidates = sorted.filter((i) => i.status === "building");

  // Rule 1: a runnable candidate exists (lowest-id wins).
  const runnable = candidates.find(
    (i) => !i.paused && i.incompleteTaskCount > 0,
  );
  if (runnable) {
    return {
      name: "initiative",
      status: "ok",
      blocking: true,
      detail: `initiative ${runnable.name} has ${runnable.incompleteTaskCount} incomplete task(s)`,
    };
  }

  // Rule 2: no building initiative at all.
  if (candidates.length === 0) {
    return {
      name: "initiative",
      status: "missing",
      blocking: true,
      detail: "no building initiative in this project",
    };
  }

  // Rule 3: every candidate is paused (lowest-id wins).
  if (candidates.every((i) => i.paused)) {
    const first = candidates[0] as InitiativeFact;
    return {
      name: "initiative",
      status: "paused",
      blocking: true,
      detail: `initiative ${first.name} is paused`,
    };
  }

  // Rule 4: at least one non-paused candidate with no work — the lowest-id one
  // names the report's blocking detail.
  const nonPausedNoWork = candidates.find(
    (i) => !i.paused && i.incompleteTaskCount === 0,
  );
  if (nonPausedNoWork) {
    return {
      name: "initiative",
      status: "blocked",
      blocking: true,
      detail: `initiative ${nonPausedNoWork.name} has no incomplete task`,
    };
  }

  // Unreachable given the rules above: a non-empty candidate list that has no
  // runnable member, no all-paused members, and no non-paused zero-work
  // member cannot exist. Kept for type-safety of the descending union.
  return {
    name: "initiative",
    status: "blocked",
    blocking: true,
    detail: "no runnable initiative",
  };
}

function evalNotification(): CheckRecord {
  return {
    name: "notification",
    status: "unsupported",
    blocking: false,
    detail:
      "no notifier capability exists — follow progress with: kanthord list event --follow",
  };
}

function evalDaemon(
  instances: readonly DaemonInstanceFact[],
  staleMs: number,
): CheckRecord {
  const sorted = ascBy(instances, (i) => i.instanceId);
  // Boundary is inclusive: an age exactly at the threshold is live.
  const live = sorted.filter((i) => i.ageMs <= staleMs);

  if (live.length === 0) {
    return {
      name: "daemon",
      status: "stopped",
      blocking: true,
      detail: `no daemon heartbeat within ${staleMs}ms (${instances.length} stale instance(s)) — run: kanthord run daemon`,
      ageSeconds: null,
    };
  }
  if (live.length === 1) {
    const inst = live[0] as DaemonInstanceFact;
    const ageSeconds = Math.floor(inst.ageMs / 1000);
    return {
      name: "daemon",
      status: "running",
      blocking: true,
      detail: `daemon ${inst.instanceId} last beat ${ageSeconds}s ago`,
      ageSeconds,
    };
  }
  const minAgeMs = Math.min(...live.map((i) => i.ageMs));
  const ageSeconds = Math.floor(minAgeMs / 1000);
  return {
    name: "daemon",
    status: "multiple",
    blocking: true,
    detail: `${live.length} daemon instances are alive: ${live.map((i) => i.instanceId).join(", ")}`,
    ageSeconds,
  };
}

// ── Action table (Story 2) ──────────────────────────────────────────────────

/** A single row in the static action table. */
interface ActionRow {
  action: string;
  requiresInput: string[];
  /**
   * Static command, or a template with `{id}` for `initiative/paused`
   * (the lowest-id paused candidate's id is interpolated at lookup time).
   */
  command?: string;
}

type ActionTable = {
  [C in CheckName]?: {
    [S in ConfigCheckStatus | DaemonStatus]?: ActionRow;
  };
};

const ACTION_TABLE: ActionTable = {
  database: {
    blocked: {
      action: "apply the pending database migrations",
      requiresInput: [],
      command: "kanthord db migrate",
    },
  },
  repository: {
    missing: {
      action: "configure a repository for this project",
      requiresInput: ["name", "remoteUrl", "branch", "auth", "path"],
    },
    blocked: {
      action: "point the repository at an existing credential resource",
      requiresInput: ["credential"],
    },
    failed: {
      action: "fix remote access for the repository that failed its probe",
      requiresInput: ["remoteUrl", "auth"],
    },
  },
  ai_provider: {
    missing: {
      action: "register an ai provider",
      requiresInput: ["name", "provider", "model", "valueFile"],
    },
    blocked: {
      action: "re-authenticate the assigned ai provider",
      requiresInput: ["valueFile"],
    },
    failed: {
      action: "replace the credential of the assigned ai provider",
      requiresInput: ["valueFile"],
    },
  },
  initiative: {
    missing: {
      action: "create an initiative with at least one task",
      requiresInput: ["name"],
    },
    paused: {
      action: "resume the paused initiative",
      requiresInput: [],
      command: "kanthord resume initiative --id {id}",
    },
    blocked: {
      action: "add a task to the initiative",
      requiresInput: ["objective", "title", "instructions", "ac"],
    },
  },
  daemon: {
    stopped: {
      action: "start the daemon",
      requiresInput: [],
      command: "kanthord run daemon",
    },
  },
};

/**
 * Walk `checks` in CHECK_ORDER and return the first actionable one, looked up
 * in `ACTION_TABLE`. `unverified`, `unsupported`, `running`, and `multiple`
 * are not actionable and fall through. Returns null when nothing qualifies.
 */
function selectNext(
  checks: CheckRecord[],
  initiatives: readonly InitiativeFact[],
): NextAction | null {
  for (const check of checks) {
    if (!(ACTIONABLE_STATUSES as readonly string[]).includes(check.status)) {
      continue;
    }
    const row =
      ACTION_TABLE[check.name]?.[
        check.status as ConfigCheckStatus | DaemonStatus
      ];
    if (!row) continue;

    // The only template command is `initiative/paused` — interpolate the
    // lowest-id paused candidate's id (the same one `evalInitiative` already
    // named in its detail).
    let command: string | undefined = row.command;
    if (command !== undefined && command.includes("{id}")) {
      const paused = initiatives.find(
        (i) => i.status === "building" && i.paused,
      );
      if (paused) {
        command = command.replace("{id}", paused.id);
      }
    }

    const next: NextAction = {
      check: check.name,
      action: row.action,
      requiresInput: [...row.requiresInput],
    };
    if (command !== undefined) {
      next.command = command;
    }
    return next;
  }
  return null;
}

export function buildProjectReadiness(facts: ReadinessFacts): ReadinessReport {
  // Sort copies — never mutate the caller's arrays. The caller's input stays
  // byte-identical after this call, which the immutability test verifies.
  const repositories = ascBy(facts.repositories, (r) => r.id);
  const initiatives = ascBy(facts.initiatives, (i) => i.id);
  const probes = facts.probes;

  const checks: CheckRecord[] = [
    evalDatabase(facts.database),
    evalRepository(repositories, probes?.repositories),
    evalAiProvider(facts.aiProvider, probes?.provider),
    evalInitiative(initiatives),
    evalNotification(),
    evalDaemon(facts.daemon.instances, facts.daemon.staleMs),
  ];

  // Verdicts. `configured` is over the four CONFIG_CHECKS only — a probe
  // `failed` does not change configuration. `verified` is `null` when neither
  // probe key was present (never `true` by vacuous default). `operational` is
  // the daemon verdict alone. `ready` is the AND of all three.
  const statusOf = (name: CheckName): ConfigCheckStatus | DaemonStatus => {
    const c = checks.find((check) => check.name === name);
    return c?.status as ConfigCheckStatus | DaemonStatus;
  };

  const configured = CONFIG_CHECKS.every(
    (name) =>
      !(NOT_CONFIGURED_STATUSES as readonly string[]).includes(statusOf(name)),
  );

  const ranProbes = [
    ...(probes?.repositories ?? []),
    ...(probes?.provider ?? []),
  ];
  // `verified` is `true` ONLY when at least one probe actually ran and every
  // probe that ran passed. Zero probes — whether no key was passed at all, or
  // a key was passed but its family had nothing to probe — is `null`, never
  // `true`. A verdict nobody tested must not read as passing.
  const verified: boolean | null =
    ranProbes.length === 0 ? null : ranProbes.every((p) => p.status === "ok");

  const daemonStatus = statusOf("daemon") as DaemonStatus;
  const operational = daemonStatus === "running" || daemonStatus === "multiple";

  const ready = configured && verified === true && operational;
  const next = selectNext(checks, initiatives);

  return {
    projectId: facts.projectId,
    configured,
    verified,
    operational,
    ready,
    checks,
    next,
  };
}
