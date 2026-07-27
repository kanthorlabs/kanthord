# Story 1 — `ProjectReadiness`: the pure, zero-I/O report

Epic: `.agent/plan/epics/014-project-readiness-check.md`

## Change

### 1. New file `src/app/project/project-readiness.ts`

Zero I/O: no import from `../../storage/port.ts`, no `Date.now()`, no `node:*`
import, no class. One exported function over structural fact types. Mirror the
style of `src/domain/resolve-provider-chain.ts` (header comment naming the epic +
story, structural input types, no port dependency).

**Closed vocabularies (exported as `as const` arrays so tests can assert
closure):**

```ts
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
```

**Fact types (all injected; the caller does every read and every clock read):**

```ts
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
   * appended active global default. `resolveProviderChain`
   * (src/domain/resolve-provider-chain.ts) already filtered to active, so every
   * member here is active.
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
```

**Report types:**

```ts
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

export interface ReadinessReport {
  projectId: string;
  configured: boolean;
  verified: boolean | null;
  operational: boolean;
  ready: boolean;
  checks: CheckRecord[];
  /** Story 2 fills this. This story always emits null. */
  next: null;
}

export function buildProjectReadiness(facts: ReadinessFacts): ReadinessReport;
```

### 2. Determinism — pin these exactly

- Before evaluating, sort `facts.repositories` and `facts.initiatives` ascending
  by `id`, and `facts.daemon.instances` ascending by `instanceId`. Sort a copy;
  never mutate the input arrays.
- `checks` is always length 6, always in `CHECK_ORDER`. Never omit a check.
- Every `detail` is a fixed template — no `Date`, no random, no environment read.

### 3. Per-check rules — pin exactly

**`database`** — `blocking: true`. `probes` absent. Not a probe: it never reads
`unverified`.

| condition                                 | status    | detail                                                                                          |
| ----------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `schemaVersion === expectedSchemaVersion` | `ok`      | `schema version ${schemaVersion}`                                                               |
| otherwise                                 | `blocked` | `schema version ${schemaVersion}, expected ${expectedSchemaVersion} — run: kanthord db migrate` |

**`repository`** — `blocking: true`. A repository is _configured_ iff
`auth !== "https-token"`, **or** (`credentialId !== null && credentialExists &&
credentialIsCredentialType`). Evaluate in order:

| #   | condition                                                       | status       | detail                                                                                                                                             |
| --- | --------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `repositories.length === 0`                                     | `missing`    | `no repository resource in this project`                                                                                                           |
| 2   | some repository is not configured (take the lowest-id one, `r`) | `blocked`    | `repository ${r.name} uses https-token auth but its credential reference ${r.credentialId ?? "(none)"} is missing or is not a credential resource` |
| 3   | `probes.repositories === undefined`                             | `unverified` | `${n} repository resource(s) recorded, not probed — run with --probe-repositories`                                                                 |
| 4   | some probe has `status === "failed"`                            | `failed`     | `${k} of ${n} repository probe(s) failed`                                                                                                          |
| 5   | otherwise                                                       | `ok`         | `${n} of ${n} repository probe(s) reachable`                                                                                                       |

When `probes.repositories !== undefined`, set `probes` on the record to that
array **sorted ascending by `resourceId`**. In rules 1 and 2 `probes` is set only
if the key was present.

**`ai_provider`** — `blocking: true`. The verdict is over the **resolved chain**,
i.e. exactly what the daemon would run on. Evaluate in order:

| #   | condition                                     | status       | base detail                                                                                     |
| --- | --------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| 1   | `resolved.length === 0 && assignedCount > 0`  | `blocked`    | `every assigned ai provider is logged out — run: kanthord login provider`                       |
| 2   | `resolved.length === 0`                       | `missing`    | `no ai provider resolves for this project — run: kanthord register ai-provider`                 |
| 3   | `probes.provider === undefined`               | `unverified` | `${resolved.length} ai provider(s) resolved, not probed — run with --probe-provider (billable)` |
| 4   | some provider probe has `status === "failed"` | `failed`     | `ai provider probe failed`                                                                      |
| 5   | otherwise                                     | `ok`         | `ai provider probe succeeded`                                                                   |

Then, for rules 3-5 only, when `resolved[0].source === "default"` append this exact
suffix to the base detail:

```ts
const DEFAULT_SUFFIX =
  " — resolving via the global default provider, not assigned to this project;" +
  " pin it with: kanthord assign ai-provider";
```

That suffix carries both literal substrings Proof phase C2 asserts — `default` and
`assign` — and it applies uniformly to `unverified`, `failed` and `ok`, so the
implicit dependency on a global default never becomes invisible just because a
probe ran. Rules 1 and 2 have an empty chain, so no suffix applies.

Set `probes` from `probes.provider` when that key is present.

**`initiative`** — `blocking: true`, `probes` absent. A _candidate_ is an
initiative with `status === "building"`. Evaluate in order:

| #   | condition                                                        | status    | detail                                                                                                                                  |
| --- | ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | some candidate has `paused === false && incompleteTaskCount > 0` | `ok`      | `initiative ${i.name} has ${i.incompleteTaskCount} incomplete task(s)` where `i` is the lowest-id such candidate                        |
| 2   | `candidates.length === 0`                                        | `missing` | `no building initiative in this project`                                                                                                |
| 3   | every candidate has `paused === true`                            | `paused`  | `initiative ${i.name} is paused` where `i` is the lowest-id candidate                                                                   |
| 4   | otherwise                                                        | `blocked` | `initiative ${i.name} has no incomplete task` where `i` is the lowest-id candidate with `paused === false && incompleteTaskCount === 0` |

**`notification`** — always `status: "unsupported"`, `blocking: false`,
`probes` absent, detail exactly:
`no notifier capability exists — follow progress with: kanthord list event --follow`

**`daemon`** — `blocking: true`, `probes` absent, `ageSeconds` always present.
`live = instances.filter((i) => i.ageMs <= facts.daemon.staleMs)`
(inclusive — an age exactly at the threshold is live).
`ageSeconds` on the record is `Math.floor(ageMs / 1000)` of the chosen instance —
the comparison is in ms, only the reported field is in seconds.

| #   | condition           | status     | ageSeconds                                    | detail                                                                                                       |
| --- | ------------------- | ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | `live.length === 0` | `stopped`  | `null`                                        | `no daemon heartbeat within ${staleMs}ms (${instances.length} stale instance(s)) — run: kanthord run daemon` |
| 2   | `live.length === 1` | `running`  | `Math.floor(live[0].ageMs / 1000)`            | `daemon ${live[0].instanceId} last beat ${ageSeconds}s ago`                                                  |
| 3   | `live.length > 1`   | `multiple` | `Math.floor(minimum ageMs among live / 1000)` | `${live.length} daemon instances are alive: ${live.map((i) => i.instanceId).join(", ")}`                     |

### 4. Verdicts — pin exactly

```ts
configured = CONFIG_CHECKS.every(
  (name) => !NOT_CONFIGURED_STATUSES.includes(statusOf(name)),
);
// A probe failure (`failed`) therefore does NOT make `configured` false.

const ranProbes = [
  ...(facts.probes.repositories ?? []),
  ...(facts.probes.provider ?? []),
];
verified =
  facts.probes.repositories === undefined && facts.probes.provider === undefined
    ? null
    : ranProbes.every((p) => p.status === "ok");

operational = daemonStatus === "running" || daemonStatus === "multiple";

ready = configured && verified === true && operational;
```

A probe family key present but its array empty (e.g. `--probe-repositories` with
zero repositories) means the family ran and vacuously passed: `verified === true`.

## Constraints

- `src/app/project/project-readiness.ts` must contain **zero** imports: every
  fact type is declared in the file itself, structurally. A test asserts the
  source contains no `from "` and no `require(` (see Verify).
- Do not create a class. `buildProjectReadiness` is a plain exported function so
  it can be called with no construction (mirrors
  `src/domain/resolve-provider-chain.ts`).
- `next` is literally `null` in this story. Do not invent a partial `next`;
  Story 2 owns it.
- Do not add anything to `src/storage/port.ts`, `src/composition.ts`,
  `src/apps/cli/**` or `src/domain/**` in this story.
- Nothing here reads `KANTHORD_HEARTBEAT_STALE_MS`; the threshold arrives as
  `facts.daemon.staleMs`.

## Verify

- `node --test src/app/project/project-readiness.test.ts` — new file, no
  database, no clock, no git, no fakes-with-behaviour (literal fact builders
  only, mirroring `src/domain/resolve-provider-chain.test.ts:11-40`). It must
  assert:
  - **Vocabulary closure**: `CONFIG_CHECK_STATUSES` deep-equals the seven
    literals in the order given; `DAEMON_STATUSES` deep-equals
    `["running","stopped","multiple"]`; `CHECK_ORDER` deep-equals the six names
    in order; every emitted `status` is a member of
    `[...CONFIG_CHECK_STATUSES, ...DAEMON_STATUSES]`.
  - **Shape**: `checks.length === 6` and `checks.map((c) => c.name)` equals
    `CHECK_ORDER`, for a fully-empty fact set and for a fully-populated one.
  - **`database`**: `ok` when versions match; `blocked` with a detail containing
    `db migrate` when `schemaVersion < expectedSchemaVersion`.
  - **`repository`**: `missing` for `[]`; `unverified` for one `ambient`
    repository and no probe key; `blocked` for `https-token` with
    `credentialExists: false`; `blocked` for `https-token` with
    `credentialExists: true, credentialIsCredentialType: false`; `unverified`
    for `ssh-agent` and for `ambient` (no credential required); `ok` when the
    probe key is present and all probes are `ok`; `failed` when one probe is
    `failed`; `probes` absent when the key is absent and present (sorted by
    `resourceId`) when it is.
  - **`ai_provider`**: `missing` with a detail containing `register` for
    `{resolved: [], assignedCount: 0}`; `blocked` with a detail containing
    `login` for `{resolved: [], assignedCount: 1}` (assigned but every one logged
    out — an empty chain alone must not read `missing`); `unverified` for one
    `source: "assigned"` member and no probe; `ok`/`failed` from the provider
    probe.
  - **The default fallback is never stricter than the daemon**: for
    `{resolved: [{source: "default"}], assignedCount: 0}` the status is
    `unverified` — **not** `missing` — and the detail contains both `default` and
    `assign`. Assert the same suffix is present when the status is `ok` and when
    it is `failed`, and **absent** when `resolved[0].source === "assigned"`.
  - **`initiative`**: `missing` for `[]`, and for a single `landed` initiative
    with incomplete tasks; `blocked` for one building, non-paused initiative with
    `incompleteTaskCount: 0`; `paused` for one building, paused initiative with
    `incompleteTaskCount: 1`; `ok` for one building, non-paused initiative with
    `incompleteTaskCount: 1`; `blocked` for the mixed case (one paused candidate
    with work + one non-paused candidate without work — not _every_ candidate is
    paused).
  - **Lowest-id tie-break**: two `ok`-qualifying candidates given in
    descending-id input order → the detail names the lowest-id one; same for the
    `paused` and `blocked` details.
  - **`notification`**: status exactly `unsupported`, `blocking === false`,
    detail contains `list event --follow`, and it never affects `configured`.
  - **`daemon`** (all with `staleMs: 6000`): `stopped` + `ageSeconds === null` for
    zero instances; `running` + `ageSeconds === 5` for `ageMs: 5999`; `running` at
    exactly `ageMs === 6000` (boundary, inclusive) with `ageSeconds === 6`;
    `stopped` at `ageMs: 6001`; `multiple` with both instance ids in the detail and
    `ageSeconds` from the smaller `ageMs`, for two live instances; `running` when
    one instance is live and one is stale; `ageSeconds === 0` for `ageMs: 0`.
  - **`configured`**: `false` when any of the four config checks is
    `missing`/`paused`/`blocked`; `true` when `repository` and `ai_provider` are
    `unverified` and `initiative` is `ok` and `database` is `ok`; **`true` when a
    repository probe `failed`** (a probe result must not change `configured`).
  - **`verified`**: `null` when both probe keys are absent (never `true`);
    `true` when only the repositories key is present and all are `ok`; `false`
    when one of several probes is `failed`; `true` when a probe key is present
    with an empty array.
  - **`operational`**: `false` for `stopped`, `true` for `running`, `true` for
    `multiple`.
  - **`ready`**: `true` only for `configured && verified === true &&
operational`; explicitly `configured: true, operational: false,
ready: false` for a perfect config with a stopped daemon; and
    `configured: true, verified: null, operational: true, ready: false`.
  - **`next` is `null`** in every case in this story.
  - **Purity/immutability**: passing an unsorted `repositories`/`initiatives`
    array leaves the caller's array order unchanged after the call, and calling
    `buildProjectReadiness` twice with the same facts object returns deeply equal
    reports.
  - **Zero-import guard**: read `src/app/project/project-readiness.ts` with
    `readFileSync` and assert the source contains no `from "` and no
    `require(` — the module imports nothing.
- `npm run verify` exits 0.
- Proof: none directly. Delivers the report body that Proof phases B, C, E, G, H
  assert once Story 6 wires it.
