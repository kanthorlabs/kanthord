# Webhook application: product requirements

Status: design revision of 2026-09-30. Requirements include platform-aware signed receive requests, HTTP 200 for verified platform challenges, a deployment-global scan, and explicit range pruning. Scan and prune require standard human-generated JWTs verified with a key derived from `masterKey`, without stored user information. This is documentation, not an implementation claim.

## 1. Purpose and scope

Provide one personal webhook event log. GitHub, Slack, Jira, and other supported senders post to platform-specific secret URLs. `audit-reader` scans all received events through one ascending cursor, without enumerating webhooks or keeping separate platform cursors.

| Operation | Route | Purpose |
| --- | --- | --- |
| Receive webhook | `POST /api/webhook/{platform}/{webhook_id}` | Handle the selected platform's challenge or normal delivery and store the accepted request. |
| Scan events | `GET /api/webhook/events` | Return one ascending page across all platforms and webhook identifiers in this deployment. |
| Prune events | `DELETE /api/webhook/events?from=event_<ulid>&to=event_<ulid>` | Permanently remove a global event-ID range; `from` is optional and `to` is required. |

Receive and scan replace the earlier UUID-only routes; prune is a third operation on the global collection. A platform adapter is part of receive, not another service or public endpoint.

This document owns product scope. [API.md](API.md) defines the wire contract. [PRD.vocabulary.md](PRD.vocabulary.md) owns names. [The Cloudflare plan](../cloudflare/docs/IMPLEMENTATION.md) derives the minimal deployment from them.

This is the standalone Webhook application. A superrepository may mount it at `platforms/webhook`, but it has no runtime or deployment dependency on that layout or on the daemon's Intake Service.

## 2. Identities and access

- `webhook_id` is a cryptographically generated UUIDv4 and remains the receive secret in the URL. It does not replace the required provider signature.
- `platform` selects a server-defined protocol adapter. It is not a secret or proof of sender identity.
- `id` is the server-generated `event_<ulid>` identity of one stored request. It is globally unique within this deployment and serves as the scan cursor.
- The same UUID can occur with different platform labels without a registration step. Each record preserves its actual route values. Prefer distinct secrets for distinct providers; the server does not enforce a UUID-to-platform registration.
- There is no public per-webhook read operation. Knowing a receive UUID must not grant access to the global event log.
- Global scan intentionally returns `webhook_id` and exposes receive URLs. A provider signature is still required to write. The same JWT also permits pruning, so it remains privileged operator access, not a read-only role.

### One master key and purpose-separated keys

`masterKey` is the deployment's only required secret: 32 cryptographically random bytes encoded in base64. Derive operational keys with HKDF-SHA256, an empty salt, and a distinct label per purpose. Never use the master key directly for JWTs or webhook HMACs, persist derived keys, or give it to a provider. Use a separate master key for each deployment, including the daemon if one exists.

JWT signing and verification always use the dedicated derived JWT key. Webhook signatures use the derived key for the path-selected platform unless the optional environment variable `WEBHOOK_SIGNING_KEY_<PLATFORM>` is present. The supported overrides are `WEBHOOK_SIGNING_KEY_GITHUB`, `WEBHOOK_SIGNING_KEY_SLACK`, and `WEBHOOK_SIGNING_KEY_JIRA`.

A present override replaces that platform's derived key for every receive UUID. An omitted override selects derivation; an empty/invalid override fails closed. Never try the derived key after an override signature fails, and never try another platform's key. These overrides do not affect scan/prune JWTs. No credential database or encrypted-secret store is added. The API defines exact derivation labels, encodings, and key selection.

### Standard JWT authentication

Every scan and prune requires `Authorization: Bearer <JWT>`. The operator configures `masterKey`, the expected `WEBHOOK_JWT_ISSUER`, and `WEBHOOK_JWT_AUDIENCE`. A human generates a standard HS256 JWT with `sub`, `iss`, `aud`, and `exp` using the dedicated derived JWT key and the deployment's issuer/audience values.

Use a maintained JWT library for signature and standard claim validation. Check the configured issuer and audience, reject expired tokens, and honor `nbf` when present. Keep standard `iat`, `jti`, audience-array, and other JWT semantics; do not build custom claim parsing or weaken the library's verification. When a token expires, the human generates a new one.

A valid token authorizes both global operations. The `sub` claim does not require a user lookup or stored user record. No account registration, role database, stored token, or refresh endpoint is needed. Absence of user storage does not mean bypassing standard claims.

Providers receive their callback URL and use only their platform's selected webhook secret, never `masterKey`, the scan JWT, or its signing key. Receive and challenge requests do not require a JWT. Do not accept a raw key, webhook UUID, or Cloudflare account token as a scan JWT.

Missing or invalid JWTs fail before reading or pruning the log. Missing issuer/audience settings disable both protected operations; a missing/invalid master key disables all three operations. Replacing `masterKey` invalidates previously issued JWTs and changes every derived webhook secret, but leaves explicit platform overrides unchanged. Setting, replacing, or removing an override changes only that platform's selected key. Reconfigure affected senders when keys change; no old-key overlap, token-issuance endpoint, user store, revocation list, or refresh flow is added.

## 3. Event representation

Every stored record contains these fixed outer fields:

| Field | Meaning |
| --- | --- |
| `id` | Server-generated, deployment-global `event_<ulid>`. |
| `webhook_id` | Normalized UUIDv4 from the receive path. This value is sensitive. |
| `platform` | Exact supported platform name from the receive path. |
| `event` | The submitted JSON value, without flattening its fields. |

Custom receive query parameters become additional outer fields. A name present once has a string value; repeated occurrences produce an ordered string array. Reserve `id`, `webhook_id`, `platform`, and `event` against query collisions. Nested payload fields with those names remain valid.

Example receive:

```http
POST /api/webhook/slack/8e86bf86-358d-4aaf-bf5a-918514ebf129?param-1=X&param-2=Y&param-2=Z HTTP/1.1
Content-Type: application/json
X-Slack-Request-Timestamp: <current Unix seconds>
X-Slack-Signature: v0=<HMAC for this timestamp and exact body>

{"id":1,"foo":"bar"}
```

An authorized global scan includes:

```json
[
  {
    "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "webhook_id": "8e86bf86-358d-4aaf-bf5a-918514ebf129",
    "platform": "slack",
    "param-1": "X",
    "param-2": ["Y", "Z"],
    "event": {"id": 1, "foo": "bar"}
  }
]
```

No `webhookId`, `params`, `payload`, `items`, or `nextCursor` aliases are introduced.

## 4. Provider verification and challenge handling

Every supported receive request requires provider-native HMAC verification, including challenge requests. Use the exact raw body bytes before JSON parsing, normalization, or storage. The selected webhook key is purpose-separated from UUID receive secrets and the JWT key. Reject missing/invalid signatures and stale Slack requests; invalid key configuration fails closed. Never return the computed signature in an error.

All receive URLs for one platform share its selected key, derived by default or supplied through its environment override. Configure GitHub and signed Jira webhooks with that key. Slack generates its own app secret, so native Slack delivery requires that value in `WEBHOOK_SIGNING_KEY_SLACK`. With no override, the same derivation rule applies, but the derived key cannot validate Slack's native signatures. Never bypass verification to make a challenge pass. Several Slack apps with different secrets cannot share this one platform configuration; use a separate deployment instead of trying multiple secrets.

Signature verification detects tampering and possession of the configured shared secret. It does not replace JSON/schema bounds or prove that query metadata was signed. GitHub/Jira HMACs cover the body; Slack additionally signs its timestamp. Their signatures do not bind our receive path or custom query fields. Do not treat those fields as authenticated provider assertions.

Challenge handling is a normal responsibility of the selected platform adapter, after signature verification. A successful challenge returns HTTP `200` with the response body and media type that the platform requires; an empty `200` is not universally sufficient.

Initial adapter set: `github`, `slack`, and `jira`. There is no unsigned `generic` fallback. An additional platform needs a declared verification scheme before it can be enabled. The API owns each adapter's exact signature and challenge rules.

- The `slack` adapter recognizes Slack's `url_verification` JSON request and echoes its string `challenge` in a JSON response with HTTP `200`.
- The adapter is selected by the receive path. The same payload, correctly signed for `github` or `jira`, does not invoke Slack behavior.
- Malformed requests that claim a supported challenge type fail validation, rather than receive a successful ordinary-delivery acknowledgement.
- Ordinary deliveries retain the proposed `201` response with their stored event record. The new HTTP `200` ruling applies to challenges; it does not silently change every POST response.
- Continue the proposed policy of storing accepted challenge requests as ordinary immutable event records before acknowledging them. Their global scan representation has the same fixed fields and preserves the original body. No separate challenge table, public record kind, or hidden filtering is added.
- A repeated challenge or normal delivery creates another event. No deduplication is promised.
- An adapter never follows a URL supplied by a challenge. Outbound verification protocols need a separately specified, reviewed adapter, not generic URL fetching.

A platform name does not promise every integration mode of that provider. This version covers signed JSON POST delivery and the explicitly specified verification/challenge rules. Unsigned provider modes, form-encoded Slack commands, and providers requiring GET verification need separate contract work. `GET /api/webhook/events` is never a verification callback.

## 5. Global scanning and ordering

- Scan every retained record in the deployment, including accepted challenge requests. Do not filter implicitly by platform, webhook, sender, or consumer.
- Preserve the bare JSON array response and exclusive ascending cursor: return only records with `id > cursor`, sorted by the complete ID.
- Omit `cursor` to start at the beginning of the global log. A valid cursor need not identify a stored event.
- Default `limit` to 100; accept integers from 1 through 1000. GET accepts no other query controls or filters.
- An empty global log or a caught-up cursor returns `200` with `[]` after authorization.
- `audit-reader` saves the last successfully processed outer `id`, irrespective of its `platform` or `webhook_id`. Consumers keep separate checkpoints of the same global log.
- Reads neither consume nor acknowledge records. Pagination has a consistent successful read view per request, not one snapshot spanning requests. Explicit pruning can remove records before a consumer reaches them; this is authorized deletion, not a cursor-ordering failure.

### Proposed no-skipped-appends invariant

Every newly committed event must have an ID greater than every previously committed event **across the whole deployment**. Scans expose only committed events. This extends the earlier proposed guarantee to the new global scope; it is still a completion proposal, not an explicit owner ruling.

ULIDs alone do not guarantee commit order, including within one millisecond. Independent per-webhook generators or stores do not satisfy a global cursor. The Cloudflare plan therefore proposes one global log owner that coordinates allocation and durable append, including concurrent requests from different platforms, restarts, and clock rollback.

The order is append order, not the provider's event occurrence time or network arrival order. Preserve the greatest issued ID separately from retained rows so pruning, including deleting every event, cannot reset allocation or invalidate a saved cursor.

## 6. Prune events

- `DELETE /api/webhook/events` uses exactly the same JWT authentication as global scanning. It needs no additional role or user record.
- `to` is required; `from` is optional. Both use complete event IDs, not timestamps or raw ULIDs.
- Bounds are inclusive: delete `from <= id <= to`. With no `from`, delete all retained records with `id <= to`.
- Bound IDs need not identify existing events. Reject malformed bounds, duplicate/unknown controls, an empty supplied bound, or `from > to` before deleting anything.
- Delete only matching rows committed at the prune operation's transaction. This is not a standing deletion policy; later arrivals are unaffected even when `to` is in the future.
- Complete the deletion atomically and durably, then return `200` with `{"deleted_count":42}`. No matches returns `{"deleted_count":0}`. Repeating the request removes no already-deleted rows.
- Pruning includes ordinary events and stored challenges across all platforms and webhook IDs. No soft delete, recoverable delete, hidden source filter, or per-consumer acknowledgement is added.
- Keep the durable ID high-water mark even when the event table becomes empty. Pruning never makes IDs reusable or places a new event behind a saved cursor.
- Pruning may remove events that a consumer has not processed. The human chooses the safe upper bound; the server stores no consumer checkpoints.
- A concurrent prune may invalidate an in-progress streamed scan. Abort that response if a selected record has disappeared; never silently omit it and return a successful altered page. The consumer retries from its prior checkpoint and sees the remaining records.

## 7. Other completion defaults

| Area | Proposed behavior |
| --- | --- |
| Setup | No webhook creation API. A supported platform, valid UUIDv4, valid master-key configuration, selected webhook key, and valid signature are required to receive. |
| UUID representation | Accept hyphenated UUIDv4 case-insensitively and store `webhook_id` in lowercase. Reject other UUID versions. |
| JSON input | Accept any valid JSON value under `application/json`, with optional UTF-8 charset. Reject missing bodies, duplicate object members, invalid UTF-8, and non-finite numeric results. |
| Query decoding | Form-style UTF-8 decoding once; keep literal names, empty values, repeated values, and occurrence order. Reject malformed encoding and empty names. |
| Durability | Ordinary `201` and challenge `200` responses follow complete durable append. No partial event or queued-only acknowledgement. |
| Input bounds | Body: 1 MiB. Encoded request target: 8 KiB. POST query occurrences: 100. Exact maxima are inclusive. |
| Retention | No automatic expiry or modification. Only an authenticated explicit prune deletes records. At capacity, refuse new writes instead of automatic eviction. |
| Transport | HTTPS outside local development. `Cache-Control: no-store` on success and error responses. |

These bounds are not silently clamped or truncated. A timeout, dropped response, or `5xx` can leave a POST outcome uncertain; retrying can produce a second record. An unsuccessful or incomplete scan leaves the consumer's checkpoint unchanged.

## 8. Security and non-goals

- Redact receive UUIDs, JWTs, `masterKey`, derived keys, override values, signature headers, request URLs, query strings, payloads, and scan responses from routine logs and traces. The returned `webhook_id` remains a credential, not harmless metadata.
- Disabling CORS and response caching does not replace scan authentication. Keep the global route private even when the log is empty.
- Treat custom names and payloads as inert data, including `__proto__` and `constructor`.
- A leaked receive UUID alone cannot bypass provider signature verification or authorize global operations. A leaked platform signing key enables forged requests to every UUID on that platform; a leaked valid JWT permits reading/deletion; a leaked JWT signing key permits minting tokens. A leaked master key compromises JWTs and every derived webhook key, but does not derive an independent override. Key replacement cannot undo disclosed receive UUIDs or completed pruning.
- There is no receive-secret revocation API. Using a new UUID does not block the old URL or remove its records. Operator intervention remains necessary after compromise.
- No user accounts, roles, OAuth server, provider SDKs, forwarding, downstream execution, exactly-once processing, search, provider filters, dashboard, or billing.
- No automatic provider registration or subscription renewal. GitHub and Jira body signatures alone do not prevent replay; Slack's signed timestamp bounds replay age, not duplicate delivery. Do not promise deduplication or complete replay prevention.
- No stored raw-body fidelity guarantee, persistent header capture, binary input, multipart input, long polling, server push, or snapshot pagination across requests. Streaming the HTTP array to bound memory is allowed and adds no new API.
- Finite Free storage is an operational constraint. No silent retention change or paid upgrade is authorized.

## 9. Acceptance criteria

These rows test the revised design, key selection, provider signatures, standard JWT verification, and the stated completion defaults. Receive fixtures have valid provider signatures unless the row tests their refusal. Events remain immutable until explicitly pruned.

| ID | Scenario | Expected result |
| --- | --- | --- |
| A1 | POST the documented validly signed Slack ordinary body with repeated custom parameters. | One record has exact `id`, `webhook_id`, `platform`, `event`, and projected parameter values. |
| A2 | An authorized scan reads an empty deployment. | `200` and `[]`, with no receive or registration prerequisite. |
| A3 | POST using uppercase and lowercase forms of the same UUID. | Both records store the same lowercase `webhook_id`; platform is taken only from each path. |
| A4 | POST query keys `id`, `webhook_id`, `platform`, `event`, or encoded equivalents. | `400`, no write, no overwrite. The same names inside `event` remain valid. |
| A5 | POST `tag=a&tag=a&flag&name=A+B&literal=A%2BB`. | Preserve duplicate strings, empty values, spaces, and literal plus signs correctly. |
| A6 | POST invalid JSON, duplicate members, invalid encoding, missing body, or unsupported media. | Documented refusal; no partial event exists. |
| A7 | Repeat a delivery or a valid challenge. | Each accepted POST stores a new record with a different global `id`. |
| A8 | Interleave deliveries for GitHub and Slack using different UUIDs; paginate globally. | One ascending traversal returns both sources, each once, without changing cursors by source. |
| A9 | Scan using a syntactically valid, nonexistent cursor. | Return only greater IDs, or `[]`. |
| A10 | Send malformed/repeated GET controls, filters such as `platform`, or invalid limits. | Reject them; never narrow or silently alter the global scan. |
| A11 | Concurrent appends from different platforms in the same millisecond, after restart, and after clock rollback. | Under the proposed invariant, no later commit falls behind an already returned global cursor. |
| A12 | Delay one append while another source commits. | IDs follow global append visibility, not independent allocation order. |
| A13 | Call scan or prune with a missing/malformed JWT, wrong signature/algorithm/issuer/audience, expired token, or future `nbf`. | `401` before storage access; nothing is read or deleted. Raw secrets and receive UUIDs are not JWTs. |
| A14 | Restart after an ordinary `201` or challenge `200`. | The complete acknowledged request remains globally scannable. |
| A15 | Exercise inclusive input maxima and maximum page size. | Accept valid maxima, reject excesses, and stream large pages without reducing `limit`. |
| A16 | Inspect success, challenge, error, and scan handling. | No caching or credential/payload logging; query names are inert data. |
| A17 | Scan repeatedly to an empty page, then append to a different platform/UUID. | The same saved global cursor discovers the new event. |
| A18 | Send a validly signed Slack `url_verification` with a nonempty string `challenge`. | Store the request, then return `200` with the exact challenge response; global scan includes the stored request. |
| A19 | Send a Slack-shaped body signed for GitHub through `github`, or a signed malformed challenge through `slack`. | GitHub stays ordinary; malformed Slack challenges return `400` and store nothing. |
| A20 | Use an unknown platform or the removed per-webhook routes. | No generic fallback or legacy alias is exposed. |
| A21 | Omit issuer/audience settings, omit/malform `masterKey`, or replace `masterKey`. | Protected operations fail closed without JWT configuration. Invalid master-key configuration disables all operations, even receives with overrides. Old-master JWTs fail after replacement. |
| A22 | A human supplies a valid standard JWT, then one missing a required claim; regenerate after expiry. | Standard valid claims authorize without stored users. Missing required claims fail. A newly valid token works with the same cursor. |
| A23 | Prune with only `to`, or with both bounds. | Delete the exact inclusive global range and return its count; include both boundary events and all sources. |
| A24 | Omit `to`, supply invalid/reversed bounds, repeated/unknown controls, or a body. | Documented `400`; delete nothing. A valid nonexistent boundary is not an error. |
| A25 | Prune an empty range, repeat a completed prune, or use a future `to` before another append. | Return the actual deletion count, including zero. Do not delete later arrivals automatically. |
| A26 | Prune every record, roll back the clock, restart, and append. | The new ID exceeds the preserved high-water mark; an old global cursor can discover it. |
| A27 | Prune during a streamed scan or inject a deletion transaction failure. | No successful page silently loses a selected record. A prune is all-or-nothing and never acknowledges an uncommitted deletion. |
| A28 | Omit/tamper with a signature, use the wrong provider key, modify raw whitespace, or send a stale Slack timestamp. | `403` before body parsing, challenge success, ID allocation, or storage. |
| A29 | Send correctly signed malformed JSON, or a request with invalid master-key/override configuration. | JSON returns `400`; invalid key configuration returns `503`. Neither stores an event. |
| A30 | Attempt an unsigned `generic` route or a legacy signature-algorithm fallback. | Reject it; there is no unsigned or weaker-algorithm escape hatch. |
| A31 | Exercise published provider signature vectors and valid signed challenge requests. | Exact raw-byte verification succeeds; a challenge is acknowledged only after verification and durable storage. |
| A32 | Omit platform overrides and derive keys twice from one test master key. | Results are deterministic, purpose-separated, platform-separated, and consistent with the API's byte/encoding profile. Valid derived-key signatures succeed. |
| A33 | Set a platform override, then submit signatures under the override and the default derived key. | Only the override signature succeeds. Other platforms and scan/prune JWTs retain their own keys. |
| A34 | Set an empty, whitespace-only, or non-string override instead of omitting it. | `503` for that platform; no fallback to derivation or unsigned admission. |
| A35 | Verify a native Slack fixture with and without its correct override. | The correct override succeeds; the default derived key does not validate Slack's issued-secret signature. |
| A36 | Replace `masterKey`; then set, replace, and remove one platform override. | Master-key replacement changes JWT and derived platform keys, not overrides. Override changes affect only their platform and never JWTs. |

The API document supplies exact platform recognition, JWT verification, validation, examples, and errors.
