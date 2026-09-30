# Minimal Cloudflare webhook implementation plan

Status: proposed implementation plan, researched on 2026-09-30. Documentation only; no Cloudflare resources, DNS records, credentials, or application code have been changed.

Use **one Cloudflare Worker deployment with a SQLite-backed Durable Object class**, published at **`webhook.kanthorlabs.com`**. The Worker is the HTTP gateway. Each webhook inbox uses one Durable Object and its embedded SQLite database. No separate D1 database, queue, bucket, or server is needed.

This choice is for correctness and simplicity, not scale: the database owner can allocate an ordered event ID and insert the event in one synchronous transaction. That is harder with separate, concurrent Worker instances generating IDs before a D1 write.

## 1. Scope and authority

Ulrich's constraints:

- Implementation root: `platforms/webhook/cloudflare`.
- Cloudflare Free, one person, approximately 1,000 received events per day across the application.
- An existing domain, `kanthorlabs.com`; use a dedicated subdomain rather than replace its website.
- Use the installed `cf` command. Choose the fewest components needed for receive and scan.
- Plan the implementation now. Do not provision or deploy it in this task.

Owning documents:

- [PRD](../../docs/PRD.md): product requirements and proposed completion defaults.
- [API contract](../../docs/API.md): exact HTTP behavior, fields, errors, and limits.
- [Vocabulary](../../docs/PRD.vocabulary.md): `id`, `event`, `cursor`, `limit`, and the error envelope.

The parents remain review drafts. This plan implements their proposed behavior without treating the unanswered ordering question as an approved ruling. It does not amend their contract. In particular, provider compatibility changes must land in those documents first.

No daemon services, daemon schema, `engine`, or `apps` changes are required.

## 2. Components

| Component | Responsibility | Why it is needed |
| --- | --- | --- |
| Cloudflare Worker, proposed name `kanthor-webhook` | Public HTTP entry point, route and UUID validation, dispatch, response headers, and mapping infrastructure failures to contract errors where possible. | Replaces an API server and a separate API gateway. |
| `WebhookInbox` Durable Object class, exported by the same Worker | Own the receive and scan handlers for one inbox, strict body validation, ordered append, and reads. | Provides one storage owner and a synchronous transaction boundary. It also keeps payload parsing out of the gateway's small Free CPU budget. |
| SQLite storage attached to each `WebhookInbox` | Persist immutable event records and their primary keys. | This is the database, not a cache. It supports ordered range queries and atomic writes without another service. |
| Worker Custom Domain `webhook.kanthorlabs.com` | Map the hostname to the Worker and provision its DNS and HTTPS certificate. | Uses the existing domain without a machine, origin IP, tunnel, or separate TLS service. |
| `cf`, its generated Vite setup, and local tests | Build, simulate, type-check, and deploy the Worker. | Development tooling only; Vite is not a production web server or another Cloudflare component. |

Request path:

```text
GitHub / Jira / compatible JSON sender / audit-reader
  -> HTTPS webhook.kanthorlabs.com
  -> kanthor-webhook Worker
  -> INBOXES binding, keyed by normalized webhook UUID
  -> WebhookInbox + its private SQLite database
```

One class and one namespace serve all inboxes. A different UUID selects a different logical inbox automatically; no per-inbox deployment or management API exists. Both POST and GET must resolve the same normalized UUID to the same object.

### Alternatives considered

| Option | Useful advantage | Why it is not selected here |
| --- | --- | --- |
| Worker + D1 | Familiar centralized SQL administration and export tooling. D1's workload allowance easily covers this volume. | D1 transactions do not make a prior JavaScript ULID allocation atomic. Correct allocation would need a conditional-write protocol or another coordinator. Free also limits each D1 database to 500 MB. |
| Workers KV | Simple key-value API and inexpensive cached reads. | Eventual consistency cannot promise that a scan sees an acknowledged event. It also lacks the required multi-operation append transaction. |
| R2 | Better suited to large payload archives. | Adds a second persistence operation and still needs ordered metadata. Existing payloads fit SQLite's row bound. |
| Worker + Durable Object + D1 | Separates coordination from centralized storage. | Two storage services solve no requirement that the Durable Object's own SQLite cannot solve. |

Do not add Queues, Cron Triggers, alarms, Workflows, Access login, API Shield, a framework router, a dashboard, or a custom rate-limiter database. There is no asynchronous processing requirement. A queue acknowledgement is not the contract's durable, immediately scannable append.

## 3. Free-plan fit and finite capacity

The following are published limits checked on 2026-09-30, not a measurement of this account's remaining allowance. Workers Free and the zone's Free plan are separate settings; verify both before deployment. Other applications share account allowances.

| Resource | Published Free allowance or relevant bound | Planning consequence |
| --- | --- | --- |
| Worker requests | 100,000/day | Includes POST, GET, failed requests, and polling. |
| Gateway CPU and memory | 10 ms CPU/request; 128 MB/isolate | Keep the gateway thin and pass through request/response streams. |
| Durable Object requests | 100,000/day | One object request per valid API request. |
| Durable Object duration | 13,000 GB-s/day | No timers, WebSockets, or background polling inside the object. Let it become idle. |
| SQLite rows read | 5 million/day | Indexed cursor scans, not full-history scans. |
| SQLite rows written | 100,000/day | Roughly one event insert per delivery, plus index/internal overhead. Measure actual accounting. |
| SQLite storage | 5 GB total/account | Free storage is finite, even at a low daily event count. |
| Per-object storage | Budget conservatively for 1 GB on Free | The current limits page's general table says 10 GB, but its storage-full FAQ says 1 GB on Free. Do not promise 10 GB; verify the effective Free limit before deployment. |
| SQLite row size | 2 MB | Store the validated input JSON text without expanding its numeric spelling, plus the bounded outer fields; test worst-case escaping. |
| Durable Object CPU | Its limits page lists a 30-second default per invocation | This is distinct from the thin gateway's Free 10 ms budget. Confirm on the deployed Free account and test maximum requests. |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

### Working budget

Recommend `audit-reader` poll each active inbox every 30 seconds when caught up, with `limit=100`. This is client behavior, not a server timer or a contract restriction.

- One inbox: 2,880 idle polls/day + 1,000 POSTs = about 3,880 Worker requests and 3,880 Durable Object requests/day, before catch-up pages and failures.
- Three inboxes: 8,640 idle polls/day + 1,000 POSTs total = about 9,640 requests/day at each layer.
- One-second polling of even one inbox would use 86,400 GETs/day. It is unnecessary and leaves little headroom.
- If an object is active for a conservative 100 ms per request, 3,880 requests use about 50 GB-s at 0.128 GB. This is an estimate, not a latency promise; slow streaming clients keep objects active longer.
- The scan design reads up to one ID row and one payload row per returned event. Even reading each of 1,000 daily events through several consumers remains far below the daily row allowance. Dashboard measurements, not returned-row counts alone, settle actual usage.

### Retention is the main capacity constraint

The PRD says no automatic expiry. Preserve that rule. Do not quietly add a 7-day or 30-day cleanup job to make Free appear unlimited.

Raw payload estimates for 1,000 events/day concentrated in one inbox:

| Average stored event size | Approximate growth/day | Approximate days to 1 GB, before database overhead |
| --- | --- | --- |
| 10 KiB | 10.24 MB | 98 |
| 50 KiB | 51.2 MB | 20 |
| 100 KiB | 102.4 MB | 10 |

These sizes are examples, not claimed GitHub, Slack, or Jira averages. Measure representative payloads. Keys, query metadata, SQLite pages, and indexes shorten these estimates.

At capacity, return `503 webhook.unavailable` for writes where the application can catch the failure; keep existing records and preserve reads where the platform permits. Daily quota exhaustion can also prevent reads, and Cloudflare can return its own error before application code runs. A storage-full error does not clear at midnight.

For this minimal version, the operator checks usage in the dashboard and can export events using the existing scan API to a private local file. An export does not free storage. If remaining capacity becomes insufficient, stop intake until the owner rules a retention change or a different storage budget. No automatic eviction, paid upgrade, or archive pipeline belongs in this plan.

## 4. Gateway and domain

Proposed public base URL:

```text
https://webhook.kanthorlabs.com
```

Keep exactly:

- `POST /api/webhook/{id}`
- `GET /api/webhook/{id}?cursor=event_<ulid>&limit=100`

Use a Worker **Custom Domain**, not a route that forwards to an origin. Cloudflare manages the DNS record and certificate. Before attaching it, confirm the zone is active in the deployment account and that the hostname is unused. Do not overwrite an existing DNS record or change the apex website.

The gateway performs cheap path, method, request-target length, and UUID checks, then forwards the original body stream to the inbox. Put bounded body reading, strict JSON validation, and event construction in the Durable Object. Do not call `request.json()` in both places or buffer the response in the gateway.

Production configuration must disable the alternate `workers.dev` hostname and preview URLs. Keep `Cache-Control: no-store`; use neither the Cache API nor a cache-everything rule. Do not place browser challenges or an Access login in front of provider callbacks. Do not disable security for the whole domain to fix one callback.

Sources: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## 5. Database and ordered append

### Logical storage layout

Inside each inbox's private SQLite database, propose one event table:

| Private column | Meaning |
| --- | --- |
| `id` | The exact public `event_<ulid>` value, primary key, with binary text comparison. |
| `record_json` | Serialized JSON of the complete public event record, including `id`, `event`, and literal custom query fields. |

Construct `record_json` from JSON-encoded outer fields and the already validated original body text as the `event` value. Never insert unvalidated text. Do not parse and reserialize the payload merely to store it: a short number such as `1e20` can expand substantially under `JSON.stringify`, pushing an otherwise valid 1 MiB request beyond SQLite's 2 MB row bound. Keeping the validated JSON text bounds the stored body to the accepted input size. Query encoding expansion and the small outer envelope must also be included in the row-size test. Preserving spelling here is an internal choice, not a new public raw-body guarantee.

`record_json` is a private serialization column, not an API field or a renamed `event`. No adapter aliases are introduced. No public `webhookId`, `params`, timestamp, or continuation envelope is added. The owning vocabulary remains unchanged.

The Durable Object identity already scopes the inbox, so no webhook table, registry, credential table, or repeated webhook UUID column is required. Use the primary key for ascending range scans and for finding the greatest ID. Declare no SQL `CHECK` constraints and no non-unique indexes. Keep schema versioning in SQLite's schema-version metadata rather than introduce another application entity.

This is a proposed logical layout, not a ruled repository ERD. Do not populate `docs/reference/erd/` from this draft.

### Receive sequence

1. Validate the path and request target at the gateway, then select the inbox by normalized UUID.
2. Inside the inbox, read at most the permitted body size, rejecting invalid UTF-8, invalid JSON, duplicate JSON members, and non-finite numeric results. Apply the exact query projection and collision rules from the API document.
3. Enter `ctx.storage.transactionSync`. Read the greatest stored event ID using the primary key.
4. Allocate a canonical ULID greater than that ID and insert the complete event record in the same synchronous callback. Perform no `await`, network call, or asynchronous randomness operation between the read and insert.
5. Finish the transaction and await `ctx.storage.sync()`. Keep Cloudflare's output gates enabled; never use `allowUnconfirmed` or `waitUntil()` to acknowledge the write early.
6. Return `201` with the committed record. On failure, expose no partial record and use the existing error contract where possible.

The strict JSON requirement means plain `JSON.parse()` is not sufficient by itself: duplicate object members are otherwise discarded before validation. Use one reviewed, bounded parser or duplicate-key validation pass. Do not build provider-specific schemas.

### ULID allocation

Use the persisted greatest event ID as the ordering state, not a module global that resets on eviction.

- If the inbox is empty, generate a normal cryptographically randomized ULID for the current millisecond.
- If the wall-clock millisecond exceeds the last ID's timestamp, generate a new randomized ULID at that millisecond.
- Otherwise, retain the last ID's timestamp and increment its 80-bit suffix. This covers same-millisecond deliveries and clock rollback.
- If that suffix cannot be incremented, fail the append with `503 webhook.unavailable`; do not spin, wrap, or silently issue a smaller ID.
- Format the exact `event_` prefix and canonical uppercase ULID required by the API.

The synchronous transaction prevents another append in that object from separating allocation from insertion. Durable storage and output gates prevent a consumer from observing a successful response before persistence. Reading the greatest persisted ID on each append also handles object eviction and restart without a second state table.

Forbid deleting or rewriting event rows, renaming the deployed object namespace, changing its UUID-to-object mapping, or restoring it behind a consumer's saved cursor during ordinary operation. Those actions invalidate the append history. They require a separate owner-approved maintenance procedure, not an automatic recovery mechanism in this version.

Source: [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), including synchronous transactions, `sync()`, and output gates.

## 6. Scan without buffering a potentially huge page

The API permits 1,000 records per page and a 1 MiB body per event. A fully buffered page could approach 1 GiB, far above the isolate's 128 MB memory limit. Low daily volume does not remove this acceptance case. Do not silently reduce the contract's `limit` or add a response-byte cutoff.

Use a small ID snapshot and a streamed JSON array:

1. Validate the GET controls exactly as declared in the API. Reject unknown or repeated controls and a nonempty body.
2. In one synchronous SQL query, select only up to `limit` event IDs in ascending order, strictly greater than `cursor` when supplied. Fully consume this small ID cursor before any `await`.
3. Await storage synchronization before emitting a response, so selected IDs cannot represent an unconfirmed write.
4. Stream `[` followed by the selected records and separators, then `]`. Read one stored `record_json` by primary key per stream pull, completing each SQL cursor synchronously before yielding. Use backpressure and release each row buffer before reading the next.
5. Pass the response stream through the gateway unchanged. Stop work on cancellation; never pre-enqueue the whole page.

The captured ID list is the request's fixed result set. Records are immutable and never deleted, so later reads of those same IDs reconstruct the same committed view even if new events arrive. New IDs do not enter that page. This preserves the contract's per-request read view without a long-lived SQL transaction or another cursor field.

Cloudflare explicitly warns that a SQL cursor held across an `await` has no stable snapshot guarantee. Do not stream directly from an open, large SQL cursor. The ID list is at most 1,000 short strings; the active payload is roughly one event, not one whole page.

If storage fails or the connection ends after streaming starts, abort the stream. The server cannot replace an already-started `200` with a JSON error. `audit-reader` must treat an incomplete JSON array as a failed page and keep its prior checkpoint. Checkpoint only fully parsed, successfully processed records.

Test maximum pages on the actual Free runtime. Streaming solves memory growth, not unlimited CPU or wall time. Do not claim contract acceptance if the documented maxima consistently hit a platform limit; report that limitation before changing the parent bounds.

## 7. Provider compatibility

The application is a JSON inbox, not a verified provider integration. A URL secret authorizes both writing and reading. It does not prove that a request came from GitHub, Slack, or Jira.

| Source | Minimal setup | Compatibility limit |
| --- | --- | --- |
| GitHub webhook | Set Payload URL to the inbox URL; choose `application/json`. A custom parameter such as `provider=github` can label stored events. | Do not choose form encoding. The GitHub signature secret is not this URL UUID. This version neither verifies signatures nor stores headers such as the delivery ID or event-name header. Test ping and real deliveries. |
| Jira webhook | Use HTTPS with the JSON body included; for admin webhooks do not enable “Exclude body”. | Test the chosen Jira webhook mode against the contract's `201` response. Jira documents `200` in its response-code guidance; do not assert universal `201` compatibility or silently change the API. Registration renewal for some Jira modes remains provider setup, not a new server component. |
| Slack Events API over HTTP | Its event callbacks contain JSON that can be stored unchanged. | **Direct subscription setup is blocked by the current API response contract.** Slack first requires a URL-verification challenge response. Generic `201` plus an event record does not satisfy that handshake. |
| Slack slash commands or interactivity | Not part of this version. | These commonly use form encoding and response-specific semantics outside the JSON-only contract. |

GitHub, Jira, and Slack can send duplicate deliveries or payloads larger than the contract permits. Store each accepted retry as a separate event. Keep the 1 MiB rejection behavior; do not claim support for every possible provider payload. Select only the provider events needed for this personal inbox.

### First provider decision: Slack URL verification

Recommendation: if direct Slack Events API subscriptions are required for the first release, approve a narrow receive-response exception for Slack URL verification in the parent contract. Keep it in the same Worker/DO deployment; no relay, queue, socket server, or provider SDK is needed.

A proposed exception would persist the verification request normally, but reply with HTTP `200` and `{"challenge":"<received challenge>"}` instead of `201` and the event record. Ordinary deliveries would keep the existing response. The parent contract must define its exact recognition rule before coding it; an arbitrary payload field must not silently change generic receive behavior.

Alternative: keep the exact current contract and exclude direct Slack subscription setup from the first release. This avoids a provider exception but cannot be described as native Slack Events API support.

This plan does not implement or approve the exception. Also validate Jira's acknowledgement behavior before promising that integration; any required status change belongs in the parent contract.

Provider references:

- [GitHub: creating webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks).
- [Slack: HTTP request URLs and URL verification](https://docs.slack.dev/apis/events-api/using-http-request-urls/).
- [Jira Cloud: webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/).

## 8. Secrets, logs, and errors

- Generate UUIDv4 inbox secrets locally with a cryptographically secure generator. Do not use example UUIDs for production.
- Keep full callback URLs out of git, shell history, screenshots, and committed provider fixtures. Do not collect real payloads as repository fixtures.
- Disable Worker invocation logs, traces, and automatic request logging for production. Newly created Workers enable observability by default; query-string redaction alone does not hide the secret in the path.
- Start with `observability.enabled: false` and use aggregate dashboard request/error/storage metrics. Do not enable live tailing on real webhook URLs. Use synthetic inboxes for diagnostics.
- Never log the request object, URL, headers, body, raw database errors, or custom query values. Platform control-plane access still sees sensitive resources; restrict Cloudflare account access.
- Do not configure optional Logpush, tracing, analytics exports, or cache rules that capture the callback URL. Cloudflare remains a trusted processor and can retain platform/security telemetry outside application control; application settings cannot promise zero provider-side logging.
- Map caught storage-full, unavailable, or object-overload failures to `503 webhook.unavailable`; unexpected internal defects use `500 webhook.internal_error`. Reuse all parent validation errors unchanged.
- Do not introduce a `429` service merely because the API documents that response. If admission limiting is later enabled, it must include the required `Retry-After` behavior. Cloudflare-generated quota failures can have a different status or body, as the API already allows for intermediary failures.
- UUID possession does not prevent strangers from addressing new UUIDs and exhausting the account's quota. Accept that limitation of the no-registration contract for this personal deployment; do not promise abuse-proof free operation or secretly add an inbox allowlist.

Source: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), especially default observability and invocation URLs.

## 9. Implementation files and `cf` workflow

The installed CLI was inspected, not used to change the account:

- `cf --version`: `1.0.0-beta.5`.
- `cf init workers --help`: scaffolding, `--package-manager`, and `--no-install` are available.
- `cf deploy --help`: `--dry-run` builds and checks without uploading the Worker.
- The installed README and `@cloudflare/config` declarations confirm `cloudflare.config.ts`, the Vite scaffold, SQLite Durable Object exports, bindings, and Custom Domains.

Use that native configuration format rather than assume that `cf` is an alias for Wrangler. The package is beta; pin the tested tooling versions and inspect generated types before relying on a later CLI release.

Proposed file layout:

```text
platforms/webhook/cloudflare/
  docs/IMPLEMENTATION.md
  cloudflare.config.ts
  vite.config.ts
  package.json
  pnpm-lock.yaml
  tsconfig.json
  .gitignore
  src/
    index.ts           # Thin gateway; export WebhookInbox.
    inbox.ts           # SQLite initialization, append, and scan.
    contract.ts        # Exact validation, projection, and error definitions.
    event-id.ts        # Persisted-state ULID advancement.
  test/
    contract.test.ts
    inbox.test.ts
    streaming.test.ts
```

Use TypeScript, the generated Worker types, and Cloudflare's local runtime tests. No Hono, ORM, provider SDK, frontend, or dependency-injection framework is required. A reviewed ULID utility and strict JSON validation dependency are justified only if they reduce custom parsing code. Keep the project independent of the daemon and dashboard workspaces.

### Configuration intent

These are the installed `cf` configuration names, not Wrangler's snake-case keys:

| Setting | Planned value |
| --- | --- |
| `name` | `kanthor-webhook` |
| `entrypoint` | `./src/index.ts` |
| `compatibilityDate` | Pin a date verified by local and deployed tests; initially `2026-09-30`. |
| `domains` | `["webhook.kanthorlabs.com"]`, only after checking ownership and DNS conflicts. |
| `workersDev` / `previewUrls` | `false` / `false` in production. |
| `observability.enabled` | `false` in production. |
| `exports.WebhookInbox` | Declare with `exports.durableObject({ storage: "sqlite" })`. Never select the legacy KV backend, which is not available on Free. |
| `env.INBOXES` | Bind with `bindings.durableObject({ worker: "kanthor-webhook", exportName: "WebhookInbox" })`. |

Use the generated `defineConfig`/`defineWorker` structure and its type checker. Inspect the build output's namespace creation/migration before deployment. Cloudflare class migration and application table initialization are different operations; both must be repeatable without deleting event data.

### Scaffold safely

`cloudflare/` already contains `docs/`. In the installed CLI, `cf init` on a nonempty directory runs existing-project autoconfiguration, not the empty-directory hello-world scaffold. Do not assume `cf init .` will produce the desired new project here.

During implementation, generate into an empty temporary directory:

```sh
scaffold="$(mktemp -d "${TMPDIR:-/tmp}/kanthor-webhook.XXXXXX")"
cf init workers "$scaffold" --package-manager pnpm --no-install
```

Review and copy only the scaffold files into the implementation root, preserving `docs/`. Install project-local dependencies, keep the lockfile, and pin the tested CLI and package manager. Do not initialize another git repository or modify the root Makefile for this standalone project.

### Build and deploy sequence

Run from `platforms/webhook/cloudflare` after implementation:

```sh
cf dev
# In a separate terminal: run the project's typecheck and test scripts.
cf build
cf deploy --dry-run
```

These lines describe separate steps; stop the development server when finished. `cf dev` uses local simulated storage unless explicitly configured otherwise. Test data must never use a production binding.

For remote launch, after explicit deployment approval:

1. Confirm the intended `cf` authentication profile, account, active zone, Workers Free subscription, and unused hostname. Do not print tokens or persist credentials in the repository.
2. Review the dry-run output: only the intended Worker, SQLite Durable Object namespace, and Custom Domain may be created or changed. No paid products or existing DNS records may be altered implicitly.
3. Run `cf deploy` from the implementation root. This is the step that can mutate Cloudflare resources and DNS; it has **not** been run while writing this plan.
4. Wait for the domain certificate, then exercise POST, GET, cursor continuation, and errors using a new disposable UUID and synthetic bodies.
5. Confirm persistence after a redeploy and inspect secret-handling settings before installing real provider callbacks.

If CLI commands change, discover them with anonymous action/resource queries, for example `cf cli search "deploy worker project"`, then read the selected command's help. Never put the domain, UUIDs, account identifiers, or tokens in discovery searches.

Tooling references: [cf repository](https://github.com/cloudflare/cf) and [cf package README](https://github.com/cloudflare/cf/tree/main/packages/cli). Local inspection used `cf@1.0.0-beta.5` and its bundled `@cloudflare/config@0.20.0` declarations. Configuration details must be rechecked against the locked project dependencies when implemented.

## 10. Delivery steps and verification

This is an implementation sequence for the standalone platform, not daemon implementation epics and not permission to deploy now. Commit each completed, verified step using only its exact paths.

| Step | Deliverable | Acceptance before proceeding |
| --- | --- | --- |
| 1. Local skeleton | Generated `cf`/Vite configuration, Worker export, SQLite object binding, and TypeScript/test setup. | Build and dry-run succeed without account mutations. Only SQLite-backed storage is declared. No unrelated workspace or DNS changes. |
| 2. Generic receive | Strict request validation, safe query projection, atomic append, persisted-state ULID allocation, and durable `201`. | Cover PRD A1–A7, A11–A14, and relevant A15 boundaries. Invalid input writes nothing; concurrent same-millisecond requests and restart cannot reorder visible IDs. |
| 3. Generic scan | ID selection and bounded streamed array response. | Cover A2–A3, A8–A13, A15, and A17. Cursor is exclusive; no cross-inbox leakage; no cursor survives an `await`; large pages do not buffer whole payload sets. |
| 4. Platform safety | Error mapping, no-cache behavior, logging configuration, cancellation, and quota/storage-full handling. | Cover A14–A16. Fault injection proves no false durable acknowledgement, no silent eviction, and no URL/payload logging. Measure CPU and memory with maximum accepted input and page size. |
| 5. Approved deployment | Custom Domain and production binding on the confirmed Free account. | Explicit approval, synthetic smoke tests, persistence after redeploy, and dashboard checks. Verify effective storage/CPU limits, not just documentation tables. |
| 6. Provider setup | One real callback at a time, starting with a compatible JSON sender. | GitHub ping and real event pass. Jira's selected mode accepts the acknowledgement. Slack setup proceeds only after its parent-contract exception is ruled and tested. |

Additional concurrency and streaming checks:

- Pause validation of request A; commit request B; then complete A. IDs must follow append order, not network arrival order.
- Force a clock rollback, evict/restart the object, and append again. Compare against persisted IDs, not the old process's memory.
- Inject a transaction failure and a persistence failure; neither may produce a readable partial event or successful receive response.
- Start a slow scan, then append. Its captured ID list stays fixed, with no uncommitted rows and no extra late arrivals.
- Seed maximum-sized records locally and request the maximum page. Verify backpressure, bounded resident memory, and cancellation. Reconfirm resource behavior with a controlled deployed test before claiming full Free-plan compatibility.
- Test malformed UTF-8, percent escapes, duplicate JSON members, `__proto__`, repeated custom keys, reserved names, and encoding expansion at the storage-row boundary.
- Test database-full handling without deleting retained records. A retryable code is not permission to retry forever when capacity is permanently exhausted.

Definition of done: the two generic operations satisfy the parent acceptance criteria on the verified Free runtime, using only the selected components. Provider-specific support is reported separately and honestly. No test or deployment result is claimed by this planning document.
