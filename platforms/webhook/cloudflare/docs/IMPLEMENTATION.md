# Reusable Cloudflare implementation and deployment plan

Revised 2026-09-30. This plan targets a standalone checkout of the Webhook repository and any deployer's Cloudflare account. Names, domains, accounts, JWT issuer/audience, and secrets are deployment configuration. No original developer environment or superrepository is required.

Use **one Worker deployment and one SQLite-backed Durable Object instance**. The Worker exposes signed platform-aware receive, JWT-protected global scan, and JWT-protected range prune. Platform adapters are ordinary application code. No D1, R2, queue, user database, or separate gateway service is needed.

This is documentation, not implemented code or permission to deploy. Reference links and platform allowances were checked on 2026-09-30 and must be rechecked before deployment.

## 1. Scope and ownership

- [PRD](../../docs/PRD.md) owns behavior; [API](../../docs/API.md) owns exact routes, JWT verification, challenge responses, pruning, errors, and bounds; [vocabulary](../../docs/PRD.vocabulary.md) owns field names.
- Work from `cloudflare/` in a standalone checkout. A superrepository can mount the same project elsewhere without changing its files or requiring parent scripts.
- Baseline workload: one operator and about 1,000 accepted receive requests per day across all sources. Challenges and retries count too. This is a sizing example, not an account restriction.
- Target Cloudflare Free without automatically enabling paid products. The design does not pursue horizontal scale.
- The proposed no-skipped-appends invariant applies deployment-wide and survives explicit pruning. It does not prevent an authorized human from deleting unread events.

## 2. Minimal components

| Component | Responsibility | Why needed |
| --- | --- | --- |
| One Worker, name chosen by deployer | Route requests, validate cheap path bounds, verify JWTs for GET/DELETE, dispatch through a private binding. | Public HTTP gateway with no origin server. |
| Durable Object class `WebhookLog`, instance `global` | Receive validation, platform adapters, ordered append, scans, and atomic pruning. | One owner coordinates event IDs and durable mutations without distributed coordination. |
| Its embedded SQLite database | Retained event records plus one durable ordering-state row. | Range reads/deletes and atomic append/state updates; no second storage service. |
| Platform adapters | Verify native raw-body signatures, then select challenge versus ordinary acknowledgement by `platform`. | Normal receive behavior, not external services or SDKs. |
| Worker secret and configuration bindings | Required `masterKey`, optional platform signing-key overrides, and expected JWT issuer/audience. | Purpose-separated derivation and stateless verification; no credential database or issued-token store. |
| Custom Domain chosen by deployer | Public hostname, DNS, and TLS certificate. | No tunnel, machine, origin IP, or separate certificate service. |
| `cf`, generated Vite tooling, local tests | Build, simulate, validate, and deploy. | Development tools, not production components. |

```text
Providers -> POST /api/webhook/{platform}/{webhook_id}
Operator  -> GET /api/webhook/events + JWT
Operator  -> DELETE /api/webhook/events?from=...&to=... + JWT
                         |
                   Worker gateway
              [JWT verification on GET/DELETE]
                         |
             EVENT_LOG.getByName("global")
                         |
             WebhookLog + one SQLite database
              [provider verification before append]
```

Use one fixed object name for the whole deployment. Do not partition by webhook UUID, platform, JWT subject, or user. Independent inbox objects would require discovery, read merging, and coordination to preserve a global cursor. The fixed object is the simpler personal-use design.

### Alternatives not selected

| Alternative | Advantage | Additional cost or mismatch |
| --- | --- | --- |
| Worker + D1 | Familiar centralized SQL management and export. | JavaScript ULID allocation plus a separate insert needs conditional-write coordination. Free caps each D1 database at 500 MB. |
| Workers KV | Simple cached key-value reads. | Eventual consistency and missing multi-operation append transactions do not meet the read-after-acknowledgement contract. |
| R2 | Larger payload/archive storage. | Requires separate ordered metadata and another persistence operation. |
| Durable Object + D1 | Separates coordination and SQL management. | The object's own SQLite already provides both. |

Do not add Queues, Cron Triggers, alarms, Workflows, provider SDKs, an ORM, external authentication, browser Access login, or a custom rate-limit database. Pruning is an explicit authenticated API operation, not a cleanup daemon.

## 3. Portable deployment configuration

The implementation must read deployment-specific values rather than ship the author's account or domain.

| Setting | Supplied by deployer | Notes |
| --- | --- | --- |
| Cloudflare account/profile | The intended account and `cf` authentication profile. | Deployment credentials never become runtime JWT keys. |
| Worker name | A unique name in that account. | Reuse the same value in the Worker definition and its Durable Object binding. |
| Public hostname | An unused hostname in a zone the deployer controls, for example `webhook.example.com`. | Example only; no domain is shipped as a mandatory default. |
| `masterKey` | 32 cryptographically random bytes encoded in base64. | The only required secret; derive operational keys instead of using it directly. |
| `WEBHOOK_SIGNING_KEY_GITHUB` | Optional GitHub secret override. | Exact text; absence selects derivation. |
| `WEBHOOK_SIGNING_KEY_SLACK` | Optional Slack secret override. | Native Slack needs its app-issued secret here; a derived key cannot match Slack's own signatures. |
| `WEBHOOK_SIGNING_KEY_JIRA` | Optional signed-Jira secret override. | Exact text; absence selects derivation. |
| `WEBHOOK_JWT_ISSUER` | Expected standard JWT issuer. | Shared with humans generating tokens; not a stored user. |
| `WEBHOOK_JWT_AUDIENCE` | Expected standard JWT audience. | Shared by scan and prune. |
| Compatibility date | A date verified against the deployed runtime. | Pin in the deployment configuration; initial development reference is `2026-09-30`. |

Keep class `WebhookLog`, binding `EVENT_LOG`, and object name `global` stable once deployed. Worker/account changes can select a different namespace and therefore a different log; do not present a rename or account move as a data-preserving operation.

The repository must provide a sanitized configuration template and instructions for supplying these values. Provision `masterKey` and any overrides as private Worker secret bindings; local values live in ignored files. Cloudflare reads these names from the Worker environment bindings, not a required Node `process.env` API. There must be no dependency on a parent repository, its Makefile, its SSH aliases, or the original author's global package installation.

### Key derivation and selection

Follow the [API key profile](../../docs/API.md#25-key-derivation-and-platform-overrides) exactly. Use WebCrypto HKDF-SHA256 with decoded 32-byte master material, an empty salt, UTF-8 `info`, and 256 output bits. This is the same standard derivation pattern as Custody, but this standalone deployment has its own master key and no runtime dependency on the daemon.

- `webhook/jwt-hs256/v1`: use the 32 output bytes directly with the JWT library. Human signing uses the identical derivation; it never signs with master bytes or their base64 text.
- `webhook/signature/<platform>/v1`: encode the 32 output bytes as lowercase hex text and use that text's UTF-8 bytes as the default provider HMAC key. One key serves all UUIDs of the validated platform.
- If `WEBHOOK_SIGNING_KEY_<PLATFORM>` is present, select its exact UTF-8 text instead. Do not trim, decode, or derive it again. Reject empty, whitespace-only, or non-string values; do not mistake invalid for absent.
- A signature mismatch never triggers a retry with the derived key, an older key, or another platform's key. A platform override never changes JWT verification.
- Keep operational keys only in memory; do not add a credential table, secret HTTP endpoint, or encrypted-secret store. Never pass the master or JWT key to a provider.

Missing/invalid `masterKey` disables all operations, including overridden platforms. Invalid issuer/audience settings disable GET/DELETE; an invalid platform override disables only that platform's receive. Fail with `503 webhook.unavailable` before storage access. Deployment preflight should catch these configuration errors before publication.

Master-key replacement changes every derived key and invalidates old JWTs, but explicit overrides stay unchanged. Setting, replacing, or removing an override affects only its platform; removal resumes derivation. Document the required sender reconfiguration and JWT regeneration. Do not implement old/new key overlap or silent fallback.

## 4. Routing and standard JWT verification

Routes:

- `POST /api/webhook/{platform}/{webhook_id}`.
- `GET /api/webhook/events?cursor=event_<ulid>&limit=100`.
- `DELETE /api/webhook/events?from=event_<ulid>&to=event_<ulid>`.

Match the fixed global collection path explicitly. Only GET and DELETE operate there; receive paths accept POST. Removed UUID-only routes have no aliases.

For receive, check platform/UUID syntax, master-key configuration, and request-target bounds at the gateway, then pass the unmodified body stream and required signature headers through the private binding. In the object, select the one platform key, read at most 1 MiB, and verify the native signature before JSON parsing, challenge handling, ID allocation, or storage. Enforce media/encoding bounds without transforming the body. Perform subsequent strict JSON/query and challenge validation there so the thin Free gateway does not parse large bodies twice. Receive and challenges do not require the operator JWT.

For GET and DELETE:

1. Require complete verifier configuration. Missing/invalid configuration returns `503 webhook.unavailable`, never public access.
2. Read `Authorization: Bearer <JWT>` and verify using a maintained WebCrypto-compatible JWT library, such as `jose`.
3. Configure HS256 and the derived JWT key bytes, required `sub`, `iss`, `aud`, `exp`, and the expected issuer/audience. Use standard library validation for signature, expiry, `nbf`, audience strings/arrays, and other applicable JWT behavior. No handwritten decoder-as-verifier, ignored claims, non-expiring-token mode, or custom clock semantics.
4. Reject invalid or expired tokens with `401 webhook.unauthorized` and `WWW-Authenticate: Bearer`, before any database access. Humans generate replacement tokens themselves; no refresh endpoint exists.
5. Validate the operation's query parameters, then dispatch to `EVENT_LOG.getByName("global")`.

The subject is carried by the signed token, not looked up in a user database. A valid token permits both global reads and pruning. Store no JWT, user, subject, token issuance record, or per-user role. Do not use claims to partition or filter the event log. Verification occurs at request acceptance, not on every streamed row.

Never use token-supplied URLs, keys, or platform overrides instead of the derived JWT key. JWT verification settings are normal library configuration, not an application-specific token dialect. Master-key replacement invalidates old-key JWTs once active; expired tokens are regenerated by humans without changing event cursors or prune bounds.

Source: the [parent JWT contract](../../docs/API.md#23-standard-jwt-authentication-for-scan-and-prune).

## 5. SQLite and durable ID allocation

### Logical storage

| Private storage | Contents |
| --- | --- |
| Event table | `id` as a binary-comparison primary key; `record_json` with all public fields and custom query metadata. |
| Singleton ordering-state row | `last_event_id`, the greatest event ID ever committed, independent of retained rows. |

The event envelope includes exact `id`, `webhook_id`, `platform`, and `event`. Store the latter route metadata in every record; a global object no longer supplies per-inbox identity implicitly.

Build `record_json` from JSON-encoded fixed/custom fields plus the already validated original body text as `event`. Never concatenate unvalidated payload text. Avoid parsing/reserializing merely to store: repeated short numbers such as `1e20` can expand a valid input beyond the 2 MB SQLite row bound under `JSON.stringify`. Keeping validated input text bounds the body portion by received size. Test envelope/query escaping too.

Use only primary keys. No SQL `CHECK`, non-unique indexes, source-filter columns, webhook registry, user table, challenge table, token table, or consumer-checkpoint table is necessary. The ordering-state row is private metadata, not a second event or an audit record. Initialize it with the schema before receives; do not recreate it from remaining rows after pruning.

This is proposed logical storage, not a ruled superrepository ERD. The eventual implementation owns its migrations and schema tests within this standalone repository.

### Append transaction

1. Verify the native signature with the selected platform key over bounded raw bytes. Then validate JSON/query input and the platform's response behavior before writing.
2. Enter `ctx.storage.transactionSync` and read `last_event_id`.
3. If no ID has ever been issued, create a randomized ULID at the current millisecond. If time has advanced past the saved timestamp, use that time with a new random suffix. Otherwise keep the saved timestamp and increment its 80-bit suffix.
4. Insert the complete event and update `last_event_id` in the same synchronous transaction. Do not `await` between allocation and either write. Refuse suffix exhaustion rather than wrap or spin.
5. Commit and await `ctx.storage.sync()` with output gates enabled. Return the adapter-selected response only after durability.

Both writes commit or neither does. No independent per-webhook generator or in-memory-only counter exists. An ID cannot be reused after deleting its event. The high-water mark survives restarts, clock rollback, and pruning that empties the event table.

Do not acknowledge through `waitUntil()` or `allowUnconfirmed`. Forbid ordinary-operation changes to namespace/object identity, direct row updates, or restoration behind the durable high-water mark. Such maintenance requires an explicit migration procedure, not automatic recovery code.

Source: [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## 6. Platform adapters

Implement a small enum and dispatch table inside the same application. No dynamic registration service or unsigned `generic` fallback is allowed. The [API adapter contract](../../docs/API.md#44-platform-adapter-contract) owns exact header syntax, timestamp bounds, and refusals.

| Adapter | Verification before body parsing | Receive behavior after verification/validation |
| --- | --- | --- |
| `github` | `X-Hub-Signature-256`, HMAC-SHA256 of raw body bytes. | JSON deliveries and ping are ordinary. Configure `application/json` and the selected secret at GitHub. |
| `slack` | `X-Slack-Signature`, HMAC-SHA256 of `v0:<timestamp>:` plus raw body bytes; require `X-Slack-Request-Timestamp` within 300 seconds in either direction. Native Slack needs its issued key in `WEBHOOK_SIGNING_KEY_SLACK`. | For an object with `type: "url_verification"`, require a nonempty string `challenge`; store first, then return HTTP `200` with `{"challenge":"<received challenge>"}`. Other valid bodies are ordinary. |
| `jira` | `X-Hub-Signature`, HMAC-SHA256 of raw body bytes. Only the `sha256=` profile is supported. | Signed JSON delivery is ordinary. Configure the selected secret and test this Jira mode's acceptance of `201`. No Connect JWT or unsigned-mode claim is made. |

Use standard WebCrypto HMAC verification on the decoded 32-byte digest. Reject missing, duplicated/coalesced, malformed, or mismatched headers with `403 webhook.signature_invalid`; stale Slack timestamps use the same error. Do not compare signature strings with ordinary equality, trust legacy body tokens, choose an arbitrary digest algorithm, or include a computed HMAC in errors. Do not decode, parse, normalize, or reserialize body bytes before verification.

The path selects the adapter and key. A correctly signed Slack-shaped body on `github` is ordinary. Query fields named `type` or `challenge` remain unsigned metadata. GitHub/Jira signatures provide no replay window here; Slack's timestamp bounds age, not duplicate delivery. A copied valid signature can target another UUID on the same platform. Do not claim that signatures authenticate our query/path metadata or deduplicate events.

Adapters do not rewrite the payload, remove provider tokens, follow challenge URLs, or treat the platform label alone as verified sender identity. Persistent header capture, form-encoded commands, GET challenges, outbound verification, and other provider modes remain outside this contract. A future adapter's signature scheme and response belong in the API before code enables it.

Sources: [GitHub signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Slack signatures](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Slack HTTP URLs](https://docs.slack.dev/apis/events-api/using-http-request-urls/), [Jira webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/).

## 7. Bounded global scans and concurrent pruning

The API allows 1,000 events with bodies up to 1 MiB. Materializing a whole page can approach 1 GiB, above the isolate's 128 MB bound. Do not silently lower `limit`.

1. After JWT verification and control validation, select up to `limit` global IDs with `id > cursor`, ascending, or start from the beginning when no cursor is supplied.
2. Fully consume that bounded ID-only cursor synchronously before any `await`. Await storage synchronization before responding.
3. Stream the JSON array by loading one selected `record_json` per pull, finishing each point-query cursor synchronously and releasing each payload buffer before continuing. Preserve backpressure and cancellation.
4. If a selected row has been pruned before it is loaded, abort the response. Do not skip it, replace it with `null`, or finish a shorter successful array.
5. Pass the stream through the gateway unchanged. On any incomplete page, the consumer keeps its prior checkpoint and retries against the remaining log.

Retained rows never change, so a fully completed page represents the selected committed view even if some rows are pruned after their bytes are read. A prune cannot recall bytes already sent. The only new concurrent-mutation case is a missing selected row, which fails the scan instead of inventing a different successful snapshot. There is no reader registry or prune lock held by slow clients.

Cloudflare warns that SQL cursors crossing an `await` lack stable snapshot guarantees. Capture only IDs synchronously; do not hold an open result cursor while streaming. There is no snapshot across different requests.

Streaming bounds memory, not unlimited CPU. Test the published request maxima on the actual Free runtime before claiming compatibility.

## 8. Atomic range pruning

Use the same JWT guard as global scan. Validate only `from` and `to`, each at most once, using the parent contract. `to` is mandatory; supplied bounds are canonical event IDs and must satisfy `from <= to`. Bounds are inclusive and need not exist.

Inside one synchronous transaction, delete event rows with `id <= to` and, when supplied, `id >= from`. Obtain the affected-row count without materializing deleted payloads. Leave the ordering-state row unchanged. After durable synchronization return `200` with `deleted_count`.

No matches returns zero. Repeating a completed request with no intervening matching arrivals returns zero; later matching arrivals can make a subsequent request delete more rows. A future upper bound is not a standing deletion rule. Atomic failure never becomes a partial success, and a lost response is safe to retry.

Pruning is global, including stored challenges, and does not consult consumer progress. The human must choose a safe bound or accept deletion of unread events. Do not add soft deletion, an undo API, or a background prune worker.

A large delete consumes row-write allowance and must fit the platform's transaction/CPU limits. If it cannot, fail rather than silently commit a partial range; the human can request narrower ranges. Deleted pages may be reusable by SQLite without immediately shrinking the database's reported file size or provider billing. Do not promise instant physical-size reduction or erasure of external copies/backups.

## 9. Free-plan budget and retention

Published reference limits, not a claim about a particular account's available allowance:

| Resource | Free allowance / bound | Consequence |
| --- | --- | --- |
| Worker requests | 100,000/day | Includes receives, scans, pruning, failures, and polling. |
| Gateway CPU/memory | 10 ms CPU/request; 128 MB/isolate | Keep routing/JWT verification thin; pass streams through. |
| Object requests | 100,000/day | Includes receive verification failures after dispatch; unauthorized scans/prunes do not dispatch. |
| Object duration | 13,000 GB-s/day | No timers, sockets, or background polling; allow idle eviction. |
| SQLite reads | 5 million rows/day | Indexed ranges and point lookups, not full-history scans. |
| SQLite writes | 100,000 rows/day | Append writes an event and ordering state; pruning counts deleted rows as writes. Include index/internal accounting. |
| Account SQLite storage | 5 GB total | Shared account allowance, not necessarily usable in this one object. |
| Per-object storage | Conservatively budget 1 GB on Free | The limits page's table says 10 GB but its storage-full FAQ says 1 GB on Free. Verify the effective limit before launch. |
| SQLite row size | 2 MB | Preserve validated input text plus bounded envelope as described above. |
| Object CPU | Documented default 30 seconds/invocation | Verify on the actual Free account; distinct from gateway CPU. |

At one global poll every 30 seconds: 2,880 polls + 1,000 receives is about 3,880 requests/day at each layer, plus pruning/catch-up/failures. Extra platforms add no polling loops. An illustrative 100 ms of object activity per request gives about 50 GB-s/day at 0.128 GB, not a latency guarantee.

Raw growth before overhead at 1,000 events/day is about 10.24 MB/day for 10 KiB events, 51.2 MB/day for 50 KiB, and 102.4 MB/day for 100 KiB. A 1 GB budget fills in roughly 98, 20, or 10 days respectively. These are examples, not measured provider averages.

No automatic event expiry is added. An operator may export through the authenticated scan, verify the private export, and explicitly prune a safe range. An export alone frees no storage. At capacity, refuse new writes without automatic eviction or upgrade; preserve reads and prune where Cloudflare permits. Daily quota exhaustion can affect all operations, and storage-full does not reset at midnight.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## 10. Secret handling and public hostname

Use a Custom Domain for an unused hostname in the deployer's active zone. Cloudflare manages DNS and TLS. Never overwrite an existing record or modify the apex website implicitly. Disable the alternate `workers.dev` hostname and preview URLs in production.

Keep `Cache-Control: no-store`; do not use the Cache API or cache-everything rules. Do not put browser login or challenges in front of provider callbacks, and do not weaken the whole zone to accommodate one path.

Disable automatic invocation logs/traces in production; new Workers enable observability by default. Query-string redaction alone leaves UUID secrets in receive paths. Do not log JWTs, claims, the master key, derived keys, override values, Authorization/signature headers, computed HMACs, URLs, bodies, raw database errors, or scan responses containing receive UUIDs. Use aggregate dashboard metrics and synthetic diagnostics.

A JWT permits deletion and reading; a JWT-key leak also permits minting JWTs. A platform-key leak permits forged receives on that platform, not JWT issuance. A master-key leak compromises all derived keys, but not an independently supplied override. Rotation cannot undo deleted records or already disclosed receive secrets. No stored authentication users are needed, but unchanged provider payloads can contain user data.

Cloudflare remains a trusted processor and can retain platform/security telemetry and backups outside application control. No zero-logging or instant-erasure claim is made. Outsiders can still send invalid requests and consume verification quota, but they cannot store events merely by choosing a fresh UUID. A holder of a platform's signing key can sign receives for any UUID on that platform; there is no UUID registration database.

Sources: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

## 11. Project files and reproducible tooling

Reference tooling inspected during planning: `cf@1.0.0-beta.5` with `@cloudflare/config@0.20.0`. These are research versions, not a dependency on a globally installed binary. The implemented project must pin its tested versions, package-manager version, and lockfile and document installation for a fresh checkout.

```text
webhook-repository/
  docs/                       # Product, API, and vocabulary.
  cloudflare/
    docs/IMPLEMENTATION.md
    cloudflare.config.ts      # Sanitized deployer-configurable template.
    vite.config.ts
    package.json
    pnpm-lock.yaml
    tsconfig.json
    .gitignore
    src/
      index.ts                # Gateway and WebhookLog export.
      auth.ts                 # Standard library JWT verification.
      keys.ts                 # Master validation, HKDF profile, platform overrides.
      log.ts                  # SQLite events, high-water state, append/scan/prune.
      platforms.ts            # Native signature verification and challenge handling.
      contract.ts             # Domain/query validation and errors.
      event-id.ts             # High-water-based global ULID advancement.
    test/
      auth.test.ts
      keys.test.ts
      contract.test.ts
      platforms.test.ts
      log.test.ts
      streaming.test.ts
      prune.test.ts
```

Use generated Worker types, TypeScript, a maintained JWT library, and Cloudflare local-runtime tests. Avoid unnecessary frameworks and provider SDKs. Keep strict JSON duplicate-member detection: plain `JSON.parse()` alone discards duplicates before validation.

Native `cf` configuration intent, rather than Wrangler's snake-case keys:

| Setting | Value |
| --- | --- |
| `name` | The deployer's Worker name. |
| `entrypoint` | `./src/index.ts`. |
| `compatibilityDate` | Tested, pinned date. |
| `domains` | The deployer's hostname list, checked for ownership/conflicts. |
| `workersDev`, `previewUrls` | `false` in production. |
| `observability.enabled` | `false` in production. |
| `exports.WebhookLog` | `exports.durableObject({ storage: "sqlite" })`. |
| `env.EVENT_LOG` | `bindings.durableObject({ worker: workerName, exportName: "WebhookLog" })`, using the same configured Worker name. |
| Secret bindings | Required `masterKey` plus optional `WEBHOOK_SIGNING_KEY_<PLATFORM>` values, using exact vocabulary names. |
| JWT settings | Deployer-selected issuer and audience; no independently configured JWT key. |

Use generated `defineConfig`/`defineWorker` types and inspect namespace migration in build output. Cloudflare class migration differs from application table initialization; both must preserve events and the high-water mark. Do not create a KV-backed namespace, which is not available on Free.

### First scaffold during implementation

`cloudflare/` already contains documentation. The inspected `cf init` treats a nonempty directory as an existing project. Generate the initial scaffold in an empty temporary directory, then review and copy only the required files without replacing docs:

```sh
scaffold="$(mktemp -d "${TMPDIR:-/tmp}/webhook.XXXXXX")"
cf init workers "$scaffold" --package-manager pnpm --no-install
```

This is an implementation-author step, not something every deployer repeats. After implementation, a deployer clones the repository and installs the locked project instead of scaffolding it again. Local secret files must be ignored. No parent repository bootstrap is required.

## 12. Deployment runbook

After implementation, any deployer follows the same workflow:

1. Clone the Webhook repository directly, enter `cloudflare/`, install the documented runtime/package manager and locked dependencies, and use the project's pinned CLI. No organization-specific SSH alias is required; use the clone URL available to that deployer.
2. Authenticate `cf` to the intended account/profile. Verify Workers Free and the active zone. Choose an unused Worker name and hostname; fill the sanitized configuration and standard JWT issuer/audience values.
3. Generate a private 32-byte master key and encode it in base64. Supply optional exact-text platform overrides only where needed, including Slack's app secret for native Slack. Use separate ignored local credentials and local simulated storage for `cf dev`; do not bind development tests to production.
4. Run typecheck/tests, `cf build`, and `cf deploy --dry-run` with the pinned CLI. Review that only the intended Worker, SQLite namespace, Custom Domain, and settings change. No paid product or existing DNS record may be changed implicitly.
5. With the deployer's explicit approval, provision `masterKey` and any overrides through the CLI's private secret input and run `cf deploy`. If the Worker must exist before setting secrets, all three operations remain disabled without a valid master key; GET/DELETE also require valid issuer/audience settings. Never expose an unsigned or unauthenticated interval.
6. Wait for TLS. Derive the JWT key using the documented profile and generate a standard JWT with matching `sub`, `iss`, `aud`, and future `exp`. Exercise correctly signed synthetic receive and Slack challenge, forged/stale signature refusal, override precedence, mixed-source scan, invalid/expired-token refusal, and pruning on disposable events only.
7. Verify redeploy persistence, prune-to-empty followed by append, logging settings, actual Free limits, and the hostname before installing real callbacks. Configure each provider with its selected key; supply Slack's native secret through its override. Document local derivation/token generation without logging secrets, fresh JWT generation after expiry, and key-change effects.

These are future deployment steps, not commands executed by this document. `cf deploy --dry-run` is documented to check/build without uploading; real `cf deploy` can change resources and DNS.

For version-dependent commands, use anonymous discovery queries such as `cf cli search "set worker secret"`, then inspect the chosen command's help. Do not include domains, account IDs, JWTs, UUIDs, or signing keys in discovery searches.

Sources: [cf repository](https://github.com/cloudflare/cf) and [CLI README](https://github.com/cloudflare/cf/tree/main/packages/cli). Recheck beta configuration APIs against the implemented project's pinned versions.

## 13. Delivery and verification

| Step | Deliverable | Acceptance |
| --- | --- | --- |
| 1 | Portable configuration, singleton SQLite binding, types, local tests. | Fresh standalone checkout builds without author-specific settings or parent tooling. |
| 2 | Key derivation/selection, standard JWT guard, routes, common validation. | PRD A3–A6, A10, A13, A16, A20–A22, A32–A36. Deterministic purpose separation, strict override precedence, standard claims, no stored users. |
| 3 | Native verification, atomic append, high-water state, and platform adapters. | A1, A7, A11–A12, A14, A18–A19, A28–A31, A35. Signature refusal precedes parsing/storage; ordinary/challenge successes follow durable commit. |
| 4 | Global streamed scan and atomic range prune. | A2, A8–A10, A15, A17, A23–A27. Inclusive bounds, correct counts, high-water preservation, and honest concurrent-prune failures. |
| 5 | Platform error mapping, no-secret logging, resource tests, sanitized deployment guide. | No public protected endpoint, false acknowledgement, implicit eviction, or custom JWT behavior. |
| 6 | Deployer-approved launch and provider setup. | Synthetic smoke tests and disposable-data prune pass before real callbacks. Test the selected Jira mode's ordinary acknowledgement. |

Explicitly test: deterministic HKDF vectors, purpose/platform separation, raw-versus-text key encodings, omitted/valid/empty/invalid overrides, no second-key retry, master/override rotation isolation, native provider vectors, signature tampering, raw whitespace/Unicode differences, duplicate/malformed headers, Slack's exact timestamp boundaries, signed malformed JSON, and unsigned challenges. Provider HMAC unit vectors with non-JSON bodies test only the verifier; they do not bypass endpoint JSON validation.

Also test: wrong JWT key/algorithm/issuer/audience, missing required claims, expired tokens, future `nbf`, audience arrays, fresh replacement tokens, same-millisecond mixed-source appends, rollback/restart, transaction failures, duplicate JSON members, prototype-like keys, maximum bounds, streaming cancellation, prune during scan, prune retries, future/nonexistent bounds, and empty-log appends after pruning with clock rollback.

No runtime test, deployment, or implementation success is claimed here. Completion means the three operations satisfy the parent acceptance criteria on a verified Free runtime and the deployment guide works independently of the original developer's environment.
