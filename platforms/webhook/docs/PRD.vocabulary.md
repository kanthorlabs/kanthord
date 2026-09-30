# Webhook application vocabulary

Revised 2026-09-30. This sibling of [PRD.md](PRD.md) owns the names used by [API.md](API.md) and the [Cloudflare plan](../cloudflare/docs/IMPLEMENTATION.md). It introduces no daemon entities.

## Receive address

`POST /api/webhook/{platform}/{webhook_id}` identifies the delivery's platform and webhook. `webhook_id` is a secret UUIDv4 in that address; knowledge of it does not replace required signature verification. It is not the event ID, an HMAC key, or a credential for scanning the global log.

Example: platform `slack`, webhook ID `8e86bf86-358d-4aaf-bf5a-918514ebf129`. The UUID is public example data, not a production secret.

A receive address has no management row or registration requirement. Reusing a UUID with another supported platform records the different route label; no automatic provider ownership is inferred.

## Platform

`platform` is the literal name selecting a built-in platform adapter and its verification key. Initial names are `github`, `slack`, and `jira`. They are lowercase, case-sensitive enum values, not aliases or authenticated identities. No unsigned `generic` adapter exists.

An adapter verifies the native signature over raw request bytes, then classifies a validated JSON request as a normal delivery or a supported platform challenge and chooses its acknowledgement. It does not change the submitted payload or fetch arbitrary callback URLs.

## Global event log

The deployment's single ordered collection of retained event records, across all webhook IDs and platforms. Records are immutable until explicitly pruned. `GET /api/webhook/events` scans the log; `DELETE /api/webhook/events` prunes it. There is no per-webhook or per-platform scan API.

The example sender is `orders-sender`; the example global consumer is `audit-reader`. A human creates receive UUIDs and generates scan JWTs. Senders get receive URLs and use their platform's selected signing secret, not the master key or JWT signing key.

## Event record

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | String | Server-generated, deployment-global identity: `event_` followed by a canonical uppercase 26-character ULID. |
| `webhook_id` | String | Lowercase hyphenated UUIDv4 copied from the receive route. This field exposes a receive secret. |
| `platform` | String | The supported platform name copied from the receive route. |
| `event` | JSON value | The sender's parsed JSON request body, without merging fields into the outer record. |
| Custom query name | String or array of strings | Literal decoded POST query name and its values. One occurrence is a string; multiple occurrences form an ordered array. |

The fixed names `id`, `webhook_id`, `platform`, and `event` are reserved against POST query collisions. Those names remain valid inside the nested payload. Object member order is not significant.

No `webhookId`, `payload`, `params`, `receivedAt`, `items`, `nextCursor`, or public challenge-kind field exists. `record_json` in the implementation plan is a private serialization column, not a wire field.

Example event ID: `event_01ARZ3NDEKTSV4RRFFQ69G5FAV`.

## Challenge and acknowledgement

A **challenge** is a request recognized by the adapter selected by `platform`, under that adapter's declared protocol rule. An **acknowledgement** is the HTTP response after durable storage of the accepted request.

Slack recognition uses the submitted object's `type` field with exact value `url_verification` and a nonempty string `challenge`. In a stored record these are `event.type` and `event.challenge`, not new outer fields.

| Protocol field | Location | Meaning |
| --- | --- | --- |
| `type` | Slack request body | Selects Slack's URL-verification request when exactly `url_verification`. |
| `challenge` | Slack request body and HTTP 200 response body | The string echoed to Slack, unchanged. |

A Slack challenge response is `{"challenge":"..."}`, not an event record. The corresponding stored request is still visible through the global scan with the standard event shape. Ordinary receives return `201` and one event record.

## Scan controls and checkpoint

| Name | URL representation | Meaning |
| --- | --- | --- |
| `cursor` | Complete event ID string | Exclusive global lower bound; only IDs greater than it are returned. |
| `limit` | Decimal integer text | Maximum number of records requested in one scan. |

These names are GET controls only. On POST they are ordinary custom metadata. Neither `platform` nor `webhook_id` is a GET filter. A consumer saves one checkpoint per deployment-wide log, not one per webhook.

## Prune bounds and response

| Name | Location | Meaning |
| --- | --- | --- |
| `from` | DELETE query | Optional inclusive lower event-ID bound. Omission means no lower bound. |
| `to` | DELETE query | Required inclusive upper event-ID bound. |
| `deleted_count` | Successful DELETE response | Nonnegative integer count of event rows deleted by that request. |

Bounds are complete canonical event IDs and need not exist. Pruning removes matching retained rows across the whole deployment at the deletion transaction; it does not establish an ongoing retention filter. JWT authentication is the same as for scanning.

The private **ID high-water mark**, stored as `last_event_id` in the implementation plan, is the greatest event ID ever committed. Pruning never deletes or lowers it. This is ordering metadata, not a public field, event, user record, or consumer checkpoint.

## Master key and selected platform key

| Configuration name | Meaning |
| --- | --- |
| `masterKey` | The only required secret: 32 random bytes encoded in base64, unique to this deployment. Required even with platform overrides. |
| `WEBHOOK_SIGNING_KEY_GITHUB` | Optional exact-text override of the GitHub webhook signature key. |
| `WEBHOOK_SIGNING_KEY_SLACK` | Optional exact-text override of the Slack webhook signature key; native Slack requires its app-issued secret here. |
| `WEBHOOK_SIGNING_KEY_JIRA` | Optional exact-text override of the signed Jira webhook signature key. |

`WEBHOOK_SIGNING_KEY_<PLATFORM>` names the override pattern, using the uppercase supported platform enum. It is not a per-platform JWT setting or a way to enable an unknown adapter. An omitted variable selects derivation. A present override replaces the derived key for that platform, for every receive UUID. Empty, whitespace-only, and non-string values fail closed rather than selecting the default. A failed signature never causes a second key to be tried.

The **derived JWT key** is 32 raw bytes from HKDF-SHA256 under the exact label `webhook/jwt-hs256/v1`. A **derived platform secret** is the lowercase hex text of 32 HKDF-SHA256 bytes under `webhook/signature/<platform>/v1`. The **selected platform key** is the UTF-8 encoding of the override text when present, otherwise of the derived platform secret. The [API key profile](API.md#25-key-derivation-and-platform-overrides) owns the common input, salt, encoding, and selection rules.

All receive UUIDs of one platform share its selected key. Platform keys never authenticate scan/prune JWTs. A master-key change changes all derived keys, not independent overrides; an override change affects only its platform. Keys are not event fields, persisted derived-key records, or HTTP output.

## Provider signature headers

| Protocol name | Meaning |
| --- | --- |
| `X-Hub-Signature-256` | GitHub's `sha256=` prefix followed by a 64-hex-digit HMAC-SHA256 of the original body. |
| `X-Slack-Signature` | Slack's `v0=` prefix followed by a 64-hex-digit HMAC-SHA256 of its version/timestamp/body base string. |
| `X-Slack-Request-Timestamp` | Slack's signed Unix-seconds timestamp; the API permits at most 300 seconds of past/future skew. |
| `X-Hub-Signature` | Jira's `sha256=` prefix followed by a 64-hex-digit HMAC-SHA256 of the original body in the supported profile. |

Headers are transient verification inputs, not stored record fields. Header names are case-insensitive. Signatures authenticate possession of the selected key and the covered bytes, not custom query fields or the receive path. They do not deduplicate events; GitHub/Jira have no replay window here. Challenges must pass the same verification before their HTTP 200 response.

## Standard JWT and verifier configuration

`Authorization: Bearer <JWT>` carries a human-generated signed JWT for both scan and prune, using the dedicated derived JWT key. `WEBHOOK_JWT_ISSUER` and `WEBHOOK_JWT_AUDIENCE` are the expected issuer and audience. These are deployment settings, not request fields or hardcoded account identities. There is no separately configured JWT signing secret.

Use standard JWT verification through a maintained library. Tokens carry `sub`, `iss`, `aud`, and `exp`; verify signature, configured issuer/audience, expiry, and other applicable standard claims. Expired tokens are rejected and regenerated by the human. No custom JWT dialect, expiry bypass, user database, issued-token store, or refresh flow exists.

Tokens and claims are transient and are not attached to events or logged. “No stored user information” concerns authentication state; provider bodies remain unchanged even when they contain user data.

| JWT protocol name | Standard meaning |
| --- | --- |
| `alg` | Protected signing algorithm; this shared-secret deployment uses HS256. |
| `typ` | Token type, commonly `JWT`. |
| `sub` | Subject identified by the token, without a server-side user lookup. |
| `iss` | Issuer, validated against deployment configuration. |
| `aud` | Intended audience, validated using standard string/array semantics. |
| `exp` | Expiry, expressed as JWT NumericDate in Unix seconds. |
| `nbf` | Not-before time, honored when supplied. |
| `iat` | Issued-at time with its standard JWT meaning. |
| `jti` | JWT identifier; its presence creates no token database or custom revocation mechanism. |

## Error response

| Field | Type | Meaning |
| --- | --- | --- |
| `error` | Object | Fixed outer wrapper of an application-generated error response. |
| `error.code` | String | Stable code declared in the API error table. |
| `error.message` | String | Human-readable explanation; not a machine decision field. |

Errors never echo JWTs, the master key, derived keys, override values, computed HMACs, receive secrets, or payloads.

## Commit order and scan order

Commit order is the durable append order across the whole deployment. Scan order is ascending, case-sensitive ASCII lexicographic order of complete event IDs.

Aligning them is the proposed no-skipped-appends guarantee. Neither reconstructs the sender's original occurrence time. Independent per-webhook generators cannot establish deployment-global commit order, and pruning retained rows must not reset the durable high-water mark.
