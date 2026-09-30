# Webhook application API contract

Revised 2026-09-30 for signed platform-aware receive, verified challenge responses, deployment-global scanning and pruning, master-key derivation with optional platform overrides, and standard human-generated JWTs. This is a design contract, not an implementation claim. The [PRD](PRD.md) identifies remaining completion defaults; [PRD.vocabulary.md](PRD.vocabulary.md) owns all domain and protocol field names.

## 1. Operations and common behavior

| Method | Path | Successful response |
| --- | --- | --- |
| `POST` | `/api/webhook/{platform}/{webhook_id}` | Ordinary delivery: `201` with one event record. Recognized platform challenge: `200` with the platform-defined challenge response. |
| `GET` | `/api/webhook/events` | `200` with an ascending array from the deployment's retained event log. Requires a valid JWT. |
| `DELETE` | `/api/webhook/events` | `200` with `deleted_count` after durable inclusive-range deletion. Requires the same valid JWT. |

- Paths have no trailing slash. The former UUID-only receive and per-webhook scan routes are removed, not aliases or redirects.
- Match the fixed `/api/webhook/events` route explicitly; it is never a platform name or receive UUID.
- These are the only application operations. No user, login, token-issuance, registration, source-filtering, or individual-event retrieval endpoint exists.
- Use HTTPS outside local development. All responses carry `Cache-Control: no-store`.
- Current success bodies and application errors are UTF-8 JSON with `Content-Type: application/json`. HEAD is unsupported and its HTTP error response has no body.
- JSON member order has no meaning. Never log request URLs, receive UUIDs, JWTs, signing secrets, raw queries, or payloads.
- No CORS access is enabled. Neither CORS nor knowledge of a receive UUID authorizes global scanning.
- These contracts belong to the standalone Webhook application, not the daemon or its Intake Service.

## 2. Authentication and identifiers

### 2.1 Receive capability: `webhook_id`

`webhook_id` is the secret UUIDv4 in the receive path. It is not the event `id`. It MUST have the standard hyphenated RFC UUIDv4 form and variant bits. Validate case-insensitively and store the lowercase form:

```text
^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

Reject braces, `urn:uuid:`, missing hyphens, surrounding whitespace, nil UUIDs, and other versions with `400 webhook.webhook_id_invalid`.

Any supported `platform` and valid UUIDv4 can receive a correctly signed request without pre-registration. There is no database of enabled receive secrets and no binding of a UUID to one platform. The human generates UUID secrets cryptographically and configures each provider's receive URL and selected signing key. The public example UUIDs in these documents MUST NOT be used in production.

POST, including a challenge, requires the provider signature but not a scan JWT. Knowing the URL alone does not bypass signature verification. Headers supplied by a sender never grant a global read or select another platform adapter.

### 2.2 Platform path parameter: `platform`

Initial supported values are the exact lowercase strings `github`, `slack`, and `jira`. Reject unknown or differently cased values with `400 webhook.platform_unsupported`; do not infer a platform from the body, headers, or query string. There is no unsigned `generic` fallback, even when an environment variable names it.

The path value selects the adapter and its verification key and becomes the outer record's `platform`. The label alone asserts no verified origin. A valid signature proves possession of the selected shared secret, not the identity of a person or every assertion in the payload.

### 2.3 Standard JWT authentication for scan and prune

Every GET or DELETE on `/api/webhook/events` requires:

```http
Authorization: Bearer <JWT>
```

A human generates a standard HS256 JWT with `sub`, `iss`, `aud`, and `exp` using the dedicated derived JWT key from §2.5, never the master key or a platform override. The server uses a maintained JWT library, such as `jose`, for signature verification and standard claim validation. Decoding a token is not verification.

| Deployment configuration | Purpose |
| --- | --- |
| `masterKey` | Required private base64 master key decoding to exactly 32 bytes; derive the HS256 key from it. |
| `WEBHOOK_JWT_ISSUER` | Expected `iss` value. |
| `WEBHOOK_JWT_AUDIENCE` | Expected audience of this API. |

The deployer chooses these values; no account name, domain, issuer, audience, or subject is hardcoded by the application. Signer and verifier use the same 32 derived JWT key bytes. The master key is cryptographically random and unique to this deployment. No independent JWT-secret setting or per-platform JWT verifier exists.

Configure the library to accept HS256, require the four named claims, verify the configured issuer and audience, reject expired tokens, and honor `nbf` when supplied. Use standard JWT claim types and audience-string/array semantics. Do not add handwritten claim parsing, an expiry bypass, a special non-expiring-token mode, custom clock rules, or a proprietary token format. Other registered claims retain their standard meanings. Token-provided key material or URLs do not replace the configured verifier key.

`sub` identifies the subject in the signed token; validation does not require a user account or lookup. A valid token authorizes both scanning and pruning globally. No role or per-platform authorization database exists. Tokens, claims, subjects, and issuance records are not persisted or added to events.

An expired or otherwise invalid JWT returns `401 webhook.unauthorized` with `WWW-Authenticate: Bearer`. The human generates another token and retries; there is no refresh or minting endpoint. The event cursor or prune bounds do not change when a token is regenerated.

Missing or invalid JWT configuration returns `503 webhook.unavailable` for both protected operations. Never fall back to unauthenticated access. Authenticate before parsing operation query controls or accessing storage. Receive UUIDs, raw signing keys, cookies, and query tokens are not alternatives to the Authorization JWT.

Master-key replacement invalidates old-key tokens once the new configuration is active. Platform overrides never change JWT signing or verification. There is no issued-token store, denylist, or individual-token revocation.

These are privileged operator credentials: they allow global deletion, and a scan also discloses receive UUIDs. Do not describe them as an effective read-only role.

Protocol references: [JWT, RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) and [jose](https://github.com/panva/jose). Required claims and expected issuer/audience are verifier configuration, not a replacement JWT implementation.

### 2.4 Event identity and cursor

An event identity is the literal, case-sensitive prefix `event_` plus a canonical uppercase 26-character ULID:

```text
^event_[0-7][0-9A-HJKMNP-TV-Z]{25}$
```

Example: `event_01ARZ3NDEKTSV4RRFFQ69G5FAV`.

The server generates IDs that are unique across the deployment, not merely within a webhook or platform. A duplicate allocation must not overwrite a record. Senders cannot provide the outer ID.

The cursor is the complete event ID, not a bare ULID, timestamp, or base64 wrapper. Reject lowercase ULIDs, wrong prefixes, overflowed first characters, and whitespace. A cursor is not an authentication credential.

### 2.5 Key derivation and platform overrides

`masterKey` is the only required secret. Validate its base64 encoding and exact decoded length of 32 bytes; reject missing/malformed values rather than defaulting, truncating, or treating a passphrase as a key. It is required even when platform overrides are present. Never use it directly for JWT/HMAC operations or share it with providers. Different deployments, including a separate daemon, must not share a master key.

The fixed derivation profile is HKDF-SHA256, with the decoded master bytes as input key material, an empty salt, UTF-8 `info`, and 32 output bytes. Use a standard crypto implementation, not an application-defined KDF.

| Purpose | Exact HKDF `info` | Use of the 32 output bytes |
| --- | --- | --- |
| Scan/prune JWT | `webhook/jwt-hs256/v1` | Raw bytes as the HS256 key for both human signing and server verification. |
| Default provider signature | `webhook/signature/<platform>/v1` | Encode as 64 lowercase hexadecimal characters. That text is the provider secret; use its UTF-8 bytes as the HMAC key. |

Replace `<platform>` with the validated lowercase enum value. One key serves all receive UUIDs on that platform; neither `webhook_id`, payload fields, nor JWT claims enter derivation. Distinct labels separate JWT, GitHub, Slack, and Jira keys. Labels are fixed protocol constants, not deployer-controlled strings. Humans configure a sender with its selected platform key, never the JWT key or master key. Do not persist derived keys in the event log, expose them through HTTP, or emit them in routine logs.

Select exactly one provider key before verification:

1. Validate the path's `platform`; map only that enum to its exact environment name below.
2. If the environment variable is absent, derive the platform secret as above.
3. If it is present, use that exact string as the secret, encoded in UTF-8. Do not trim it, base64/hex-decode it, or derive it again. Reject a non-string, empty, or whitespace-only value with `503 webhook.unavailable`; a bad configured value is not an omitted value.
4. Verify using only that selected key. Signature failure returns `403 webhook.signature_invalid`; never try the derived key, an older key, or another platform's override afterward.

| `platform` | Optional override |
| --- | --- |
| `github` | `WEBHOOK_SIGNING_KEY_GITHUB` |
| `slack` | `WEBHOOK_SIGNING_KEY_SLACK` |
| `jira` | `WEBHOOK_SIGNING_KEY_JIRA` |

Overrides follow `WEBHOOK_SIGNING_KEY_<PLATFORM>` with the enum rendered in uppercase. They are webhook signature keys, not JWT signing keys. Use high-entropy provider secrets; never reuse the master key, JWT key, or another platform's key. All receive UUIDs of one platform share its override. Multiple different keys for that platform require separate deployments, not header-based key selection or a key registry.

GitHub and signed Jira webhooks can be configured with the selected derived secret or override. Slack issues its own signing secret: native Slack delivery requires that exact value in `WEBHOOK_SIGNING_KEY_SLACK`. Without an override, selection still derives the default key, but real Slack signatures do not match it and return `403`. No unsigned challenge exception exists. Jira support here means secret-signed JSON webhooks, not Atlassian Connect JWT authentication or unsigned modes.

A missing/invalid master key returns `503 webhook.unavailable` for all three operations. An invalid platform override disables receive only for that platform; it does not affect JWT verification or other platforms. Missing/invalid issuer/audience settings disable scan/prune only. None of these refusals accesses event storage.

Replacing `masterKey` changes JWT and default platform keys, not independent overrides. Setting, replacing, or removing an override changes only that platform's selected key. Removing it resumes derivation, not a remembered older value. Changes take effect when deployment configuration becomes active; no old/new key overlap is supported. Reconfigure affected senders and regenerate JWTs as needed. These changes do not delete stored events or reset cursors.

## 3. Stored event representation

| Field | Required | JSON type | Meaning |
| --- | --- | --- | --- |
| `id` | Yes | String | Deployment-global event identity. |
| `webhook_id` | Yes | String | Normalized receive UUID from the path. |
| `platform` | Yes | String | Supported platform name from the path. |
| `event` | Yes | Any JSON value | Submitted request body, unchanged in structure. |
| Each custom POST query name | When supplied | String or array of strings | Values projected under their literal decoded name. |

```json
{
  "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "webhook_id": "8e86bf86-358d-4aaf-bf5a-918514ebf129",
  "platform": "slack",
  "param-1": "X",
  "param-2": ["Y", "Z"],
  "event": {"id": 1, "foo": "bar"}
}
```

The outer `id` is the cursor. `event.id`, `event.webhook_id`, and `event.platform`, if supplied, remain payload data and cannot override the outer fields.

Objects, arrays, strings, numbers, booleans, and `null` are valid ordinary payloads. An array is one event, not a batch. Preserve parsed JSON values; whitespace, numeric spelling, escape spelling, and member order are not guaranteed. Numbers use finite IEEE-754 binary64 semantics; precision-sensitive identifiers should be strings. Reject numeric overflow and duplicate object member names at every depth.

Accepted challenge requests use this same stored shape. Their HTTP acknowledgement may differ; there is no additional `kind` or `challenge` field at the outer event level.

## 4. Receive webhook

### 4.1 Ordinary request and response

```http
POST /api/webhook/slack/8e86bf86-358d-4aaf-bf5a-918514ebf129?param-1=X&param-2=Y&param-2=Z HTTP/1.1
Host: webhook.example.com
Content-Type: application/json
X-Slack-Request-Timestamp: <current Unix seconds>
X-Slack-Signature: v0=<64-hex-digit HMAC for this timestamp and exact body>

{"id":1,"foo":"bar"}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store

{
  "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "webhook_id": "8e86bf86-358d-4aaf-bf5a-918514ebf129",
  "platform": "slack",
  "param-1": "X",
  "param-2": ["Y", "Z"],
  "event": {"id": 1, "foo": "bar"}
}
```

The example is an ordinary JSON delivery on the Slack adapter because it is not a Slack URL-verification request. Signature placeholders are not valid signatures: compute the native signature over the actual timestamp and exact body bytes, including any trailing newline. No scan JWT is supplied to receive.

### 4.2 Common input validation

- Require `Content-Type: application/json`, optionally with `charset=utf-8`. Media type and charset matching is case-insensitive; other types, charsets, or parameters return `415 webhook.content_type_unsupported`.
- Require absent or `identity` Content-Encoding; otherwise return `415 webhook.content_encoding_unsupported`.
- Require exactly one valid UTF-8 JSON value. An absent or whitespace-only body is invalid; literal `null` is valid.
- Body maximum: 1,048,576 received bytes, including whitespace. Enforce it for streamed input, not just `Content-Length`.
- Encoded request-target maximum: 8,192 bytes for path plus optional `?` and query. The new platform segment counts toward this bound.
- POST query maximum: 100 nonempty components, including repeated names. Exact maxima are inclusive.

After cheap route, media, and size checks, select the verification key and read bounded raw bytes. Verify the provider signature before JSON decoding/parsing, challenge classification, ID allocation, or storage. Then complete JSON/query and challenge validation before any write. A valid HMAC does not make malformed JSON valid, and an invalid challenge is not an ordinary successful delivery.

### 4.3 Query parameter projection

1. Split the raw query on `&`; ignore empty components. Split each remaining component at its first `=`. A missing `=` means an empty value; semicolon is not a separator.
2. Replace literal `+` with space, then percent-decode each name and value exactly once as UTF-8. Reject malformed escapes and invalid UTF-8.
3. Reject empty decoded names. Names are case-sensitive, untrimmed, and not Unicode-normalized.
4. Reject decoded names `id`, `webhook_id`, `platform`, and `event` with `400 webhook.query_key_reserved`.
5. Group exact decoded names. One occurrence becomes a string; multiple occurrences become an array in occurrence order. Preserve duplicate values.
6. Store these fields beside the four fixed fields. Do not infer types, nested objects, or bracket-based arrays.

| Query | Result |
| --- | --- |
| `param-1=X&param-2=Y&param-2=Z` | `"param-1":"X", "param-2":["Y","Z"]` |
| `tag=a&tag=a&flag` | `"tag":["a","a"], "flag":""` |
| `name=A+B&literal=A%2BB` | `"name":"A B", "literal":"A+B"` |
| `tag=a&%74ag=b` | `"tag":["a","b"]` |
| `a[b]=x` | Literal `"a[b]":"x"`. |
| `cursor=source-42&limit=10` | Ordinary POST metadata, not scan controls. |
| `platform=github`, `webhook_id=x`, or `%69d=x` | `400 webhook.query_key_reserved`. |
| `=x` or `%ZZ=x` | `400 webhook.query_invalid`. |

Treat all custom names as inert data, including `__proto__` and `constructor`. They must not modify object prototypes or serialization behavior. With no custom query, a record contains exactly `id`, `webhook_id`, `platform`, and `event`.

### 4.4 Platform adapter contract

An adapter first verifies its native signature over bounded raw bytes using the one selected key from §2.5. Header names are case-insensitive; header value syntax and algorithm prefixes follow the table. Require exactly one of each listed header. Reject missing, duplicated/coalesced, malformed, wrong-length, or mismatched signatures. Never accept GitHub's legacy SHA-1 header or choose an arbitrary algorithm from sender-controlled text.

| `platform` | Required headers | Exact signature verification |
| --- | --- | --- |
| `github` | `X-Hub-Signature-256: sha256=<64 hex digits>` | HMAC-SHA256 over the original body bytes. |
| `slack` | `X-Slack-Signature: v0=<64 hex digits>` and `X-Slack-Request-Timestamp` | HMAC-SHA256 over UTF-8 `v0:` + the exact timestamp header text + `:` + the original body bytes. Require an unsigned decimal integer timestamp in Unix seconds, safely representable as an integer, within 300 seconds of server time in either direction. |
| `jira` | `X-Hub-Signature: sha256=<64 hex digits>` | HMAC-SHA256 over the original body bytes. Only this declared algorithm is supported; another Jira method fails closed until the adapter contract changes. |

Decode the received hex digest to 32 bytes and verify through a standard constant-time crypto primitive such as WebCrypto HMAC `verify` or Node's `timingSafeEqual` on equal-length buffers. Do not compare digest strings with ordinary equality, reserialize JSON, normalize text, or trust a legacy body token. A signature refusal, including a stale Slack timestamp, returns `403 webhook.signature_invalid`, stores nothing, and never includes the expected HMAC in its response.

GitHub/Jira signatures do not include a timestamp and provide no replay window here. Slack's timestamp limits replay age but does not deduplicate requests inside that window. None of these signatures covers this application's path or custom query metadata. Do not use those fields as authenticated provider assertions; a captured body/signature can be replayed to another receive UUID on the same platform. Retain the existing repeated-delivery semantics.

After signature and common input validation, the adapter classifies the request and selects a normal or challenge acknowledgement. It does not rewrite `event`, change path metadata, or perform outbound calls.

| `platform` | Recognition | Successful acknowledgement |
| --- | --- | --- |
| `github` | JSON webhook deliveries, including ping, are ordinary deliveries in this profile. No body-field challenge inference. | `201`, stored event record. |
| `slack` | A non-null, non-array object with top-level `type` exactly `url_verification` is a challenge candidate. It must contain a nonempty string `challenge`; otherwise reject with `400 webhook.challenge_invalid`. All other accepted bodies are ordinary deliveries. | Valid challenge: `200`, JSON object containing only the echoed `challenge`. Ordinary delivery: `201`, stored event record. |
| `jira` | JSON webhook deliveries are ordinary deliveries. No body-field challenge inference. | `201`, stored event record. Verify this acknowledgement against the selected Jira integration mode before claiming provider compatibility. |

A query parameter `challenge` or `type` is metadata, not a protocol selector. A Slack-shaped body received on another platform stays ordinary. The `platform` path segment prevents accidental cross-provider challenge handling.

Successful verified platform challenges return HTTP `200` with their required protocol body, not the ordinary event envelope. Future adapters must declare their signature scheme, key selection, replay rules, recognition, validation, response media type/body, and acceptance tests here before enabling another enum value. Providers requiring non-JSON input, a GET handshake, another signature protocol, or outbound verification are not automatically supported by receive.

Protocol references: [GitHub signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Slack signatures](https://docs.slack.dev/authentication/verifying-requests-from-slack/), and [Jira webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/).

### 4.5 Slack challenge example

```http
POST /api/webhook/slack/8e86bf86-358d-4aaf-bf5a-918514ebf129?environment=personal HTTP/1.1
Host: webhook.example.com
Content-Type: application/json
X-Slack-Request-Timestamp: <current Unix seconds>
X-Slack-Signature: v0=<64-hex-digit HMAC for this timestamp and exact body>

{"type":"url_verification","challenge":"example-slack-challenge"}
```

After successful signature verification, challenge validation, and durable storage:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"challenge":"example-slack-challenge"}
```

The same accepted request appears in global scans as:

```json
{
  "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAW",
  "webhook_id": "8e86bf86-358d-4aaf-bf5a-918514ebf129",
  "platform": "slack",
  "environment": "personal",
  "event": {
    "type": "url_verification",
    "challenge": "example-slack-challenge"
  }
}
```

Echo the decoded JSON string exactly, with normal JSON escaping. Do not include an event ID, wrap it under `event`, follow a challenge URL, or strip fields such as a provider's legacy verification token from the stored request. The signature proves possession of the selected Slack key. A legacy body token never substitutes for it.

### 4.6 Durability, atomicity, and retries

Both ordinary `201` and challenge `200` responses follow durable commit of one complete record. A subsequent authorized global scan can observe it, subject to cursor and limit. No partial, uncommitted, or queued-only record may be acknowledged successfully.

Each successful POST creates one immutable record. Every accepted retry, including a repeated challenge, creates a different global ID. No idempotency key, provider delivery ID, or hidden challenge deduplication is interpreted.

Timeouts, disconnected responses, and `5xx` can leave commit status uncertain. Retrying may duplicate a delivery. On `429`, honor `Retry-After`; use bounded backoff for transient failures. Never acknowledge a challenge early merely to meet a provider deadline while storing it in the background.

## 5. Global scan

### 5.1 Request

```http
GET /api/webhook/events?cursor=event_01ARZ3NDEKTSV4RRFFQ69G5FAV&limit=100 HTTP/1.1
Host: webhook.example.com
Authorization: Bearer <JWT>
```

| Parameter | Required | Default | Validation |
| --- | --- | --- | --- |
| `cursor` | No | No lower bound | Complete canonical event ID. Empty is invalid. |
| `limit` | No | `100` | Decimal text matching `[1-9][0-9]*`, with value 1 through 1000. |

After JWT verification, use the same query splitting/decoding rules as POST, but accept only these two controls, each at most once. Unknown parameters, including `platform` and `webhook_id`, and repeated controls return `400 webhook.scan_query_invalid`. No filters, token parameters, sorting options, or aliases exist.

Malformed encoding or empty names return `400 webhook.query_invalid`. Invalid cursor syntax returns `400 webhook.cursor_invalid`. Leading zeros, signs, fractions, exponent notation, whitespace, zero, and out-of-range limits return `400 webhook.limit_invalid`; no coercion or clamping occurs.

GET has no body. A nonempty body returns `400 webhook.scan_body_unsupported`. The 8,192-byte request-target bound still applies.

A syntactically valid cursor need not correspond to a stored event. It is only a lower bound in this deployment's log. A cursor greater than every stored ID returns `[]`. Consumers should use IDs they processed from this deployment; old per-webhook checkpoints must not be treated as globally complete history.

### 5.2 Selection and response

At one consistent committed read view:

1. Select from the entire event log, without a webhook or platform predicate.
2. If supplied, retain only records with complete `id` strictly greater than `cursor`.
3. Sort by case-sensitive ASCII lexicographic `id` ascending.
4. Return the first `limit` records, or all matching records if fewer exist.

A scan from the beginning can include different sources in the same array:

```http
GET /api/webhook/events?limit=100 HTTP/1.1
Host: webhook.example.com
Authorization: Bearer <JWT>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

[
  {
    "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "webhook_id": "8e86bf86-358d-4aaf-bf5a-918514ebf129",
    "platform": "slack",
    "param-1": "X",
    "param-2": ["Y", "Z"],
    "event": {"id": 1, "foo": "bar"}
  },
  {
    "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAW",
    "webhook_id": "52e8140c-16f9-4302-8f6c-0bf2d3d1a6a9",
    "platform": "github",
    "event": {"action": "opened"}
  }
]
```

Examples are independent fixtures. After processing both records in this scan, continue with `cursor=event_01ARZ3NDEKTSV4RRFFQ69G5FAW`, regardless of the next event's source.

The empty result is `[]` with HTTP `200`, never `204`. No `items`, `nextCursor`, total count, or continuation headers are added. Scan controls and JWT claims are never injected into stored records.

### 5.3 Consumer continuation

1. Load the saved global checkpoint for this deployment, or omit the cursor to start from the beginning.
2. Send a valid JWT with every request and process returned records in response order.
3. Save an outer `id` only after successfully processing that record. Never checkpoint past an unprocessed record.
4. Continue with that ID. A full page does not prove another page exists. A short or empty page only describes the matching committed records at that read.
5. When caught up, poll with the same cursor. A new event from any webhook or platform can appear next.
6. On an invalid JWT, transport failure, or incomplete streamed array, keep the prior checkpoint. A human can generate a replacement JWT without changing the event cursor.

Several consumers keep independent checkpoints of the same log. Rereading after a crash may duplicate processing; deduplicate side effects using the deployment identity and outer event `id` if needed. This does not merge separate POST retries.

### 5.4 Proposed global commit-order guarantee

The no-skipped-appends completion proposal now applies globally: every newly committed event ID exceeds every previously committed event ID across all webhook IDs and platforms in this deployment. Scans expose only committed records.

It must cover same-millisecond events, concurrent senders, restarts, backward clock changes, and pruning that leaves the log empty. Preserve a durable ID high-water mark independently of retained event rows. Independent per-webhook generators or resetting allocation after prune would break existing global cursors.

The order is append order, not sender occurrence time. IDs remain opaque ordering keys. A pruned event ID is still a valid cursor. Scans do not delete records, but an authorized prune can remove records before a consumer reads them; no consumer-delivery guarantee overrides explicit deletion.

If pruning removes a selected row before a streamed scan reads it, abort the response instead of silently skipping the row and producing a successful altered page. The client retries with its prior checkpoint. A successful page can contain rows read before a concurrent prune; deletion cannot recall bytes already sent. There is no snapshot spanning scan requests.

## 6. Prune events

### 6.1 Request and bounds

```http
DELETE /api/webhook/events?from=event_01ARZ3NDEKTSV4RRFFQ69G5FAV&to=event_01ARZ3NDEKTSV4RRFFQ69G5FAW HTTP/1.1
Host: webhook.example.com
Authorization: Bearer <JWT>
```

| Parameter | Required | Meaning |
| --- | --- | --- |
| `from` | No | Inclusive lower bound, as a complete canonical event ID. Omitted means no lower bound. |
| `to` | Yes | Inclusive upper bound, as a complete canonical event ID. |

Use the same JWT validation as GET, with no additional role, scope, or user record. Validate authorization before bounds or storage access.

- Decode query components using the common query rules. Accept only `from` and `to`, each at most once. Unknown or repeated controls return `400 webhook.prune_query_invalid`.
- Missing `to`, an empty supplied bound, malformed event IDs, or `from > to` return `400 webhook.prune_range_invalid`. Malformed query encoding or an empty name uses `400 webhook.query_invalid`.
- Both bounds are inclusive and use the same case-sensitive ordering as scan. `from == to` can delete that one event.
- Bounds need not exist in the database. A well-formed future or already-pruned ID is a valid boundary.
- DELETE has no body. A nonempty body returns `400 webhook.prune_body_unsupported`. The 8,192-byte request-target bound applies.

With no `from`:

```http
DELETE /api/webhook/events?to=event_01ARZ3NDEKTSV4RRFFQ69G5FAW HTTP/1.1
Host: webhook.example.com
Authorization: Bearer <JWT>
```

This deletes all currently retained records at or below `to`, across every webhook and platform, including stored challenges. It is not an automatic retention policy. Rows committed after the deletion transaction are unaffected, even when their IDs fall below a future `to` supplied to that earlier request.

### 6.2 Response and transaction

Perform one atomic deletion of the matching committed rows, preserve the durable ID high-water mark, and confirm durability before returning:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"deleted_count":2}
```

`deleted_count` is a nonnegative JSON integer: the number of event rows removed by this request. No matches returns `200` with `{"deleted_count":0}`. Do not count ordering metadata or return deleted payloads.

Prune physically removes matching event rows. There is no soft delete, undelete endpoint, or per-user deletion record. The human selects a safe upper bound; no stored consumer checkpoint prevents deleting an unread event.

An input or authentication failure deletes nothing. A transaction failure cannot partially delete the selected range. A lost response or `5xx` can leave the caller uncertain whether the atomic deletion committed; retrying the same bounds is safe. With no intervening matching arrivals, a completed prune followed by the same request returns zero. New matching rows can make a later retry's count nonzero.

Pruning does not revoke receive UUIDs or JWTs. It does not erase copies already delivered to consumers, downloaded exports, or Cloudflare-managed backup history. Keep using the same global cursor after deletion; the next append must exceed the preserved high-water mark even after restart or clock rollback.

## 7. Errors

Application errors with a body use:

```json
{
  "error": {
    "code": "webhook.unauthorized",
    "message": "A valid operator JWT is required."
  }
}
```

`error.code` is stable; clients must not branch on exact message text. Messages never echo supplied values or credentials.

| HTTP status | Code | Condition |
| --- | --- | --- |
| 400 | `webhook.webhook_id_invalid` | Receive UUID is not in the accepted UUIDv4 form. |
| 400 | `webhook.platform_unsupported` | Receive platform is not an exact supported enum value. |
| 400 | `webhook.query_invalid` | Empty query name or malformed percent/UTF-8 encoding. |
| 400 | `webhook.query_key_reserved` | POST query name decodes to `id`, `webhook_id`, `platform`, or `event`. |
| 400 | `webhook.query_limit_exceeded` | POST contains more than 100 nonempty query components. |
| 400 | `webhook.body_invalid` | POST has missing/malformed JSON, invalid UTF-8, duplicate members, or non-finite numeric results. |
| 400 | `webhook.challenge_invalid` | A Slack URL-verification candidate lacks a nonempty string `challenge`. |
| 400 | `webhook.scan_query_invalid` | GET has unknown parameters or repeated controls. |
| 400 | `webhook.cursor_invalid` | Empty or malformed event cursor. |
| 400 | `webhook.limit_invalid` | Invalid limit text or value outside 1 through 1000. |
| 400 | `webhook.scan_body_unsupported` | GET has a nonempty body. |
| 400 | `webhook.prune_query_invalid` | DELETE has unknown or repeated query controls. |
| 400 | `webhook.prune_range_invalid` | Required `to` is missing, a supplied bound is empty/malformed, or `from > to`. |
| 400 | `webhook.prune_body_unsupported` | DELETE has a nonempty body. |
| 401 | `webhook.unauthorized` | Scan/prune JWT is missing or fails standard signature, required-claim, issuer, audience, or time validation. Include `WWW-Authenticate: Bearer`. |
| 403 | `webhook.signature_invalid` | Required provider signature/timestamp header is missing, duplicated/coalesced, malformed, unsupported, stale, or fails verification with the selected key. |
| 404 | `webhook.route_not_found` | No route matches, including removed legacy routes. |
| 405 | `webhook.method_not_allowed` | Unsupported method on a matched path. Use `Allow: POST` for the receive path and `Allow: GET, DELETE` for the global collection path. |
| 413 | `webhook.body_too_large` | POST body exceeds 1,048,576 bytes. |
| 414 | `webhook.request_target_too_long` | Encoded path and query exceed 8,192 bytes. |
| 415 | `webhook.content_type_unsupported` | POST Content-Type is missing or unsupported. |
| 415 | `webhook.content_encoding_unsupported` | POST Content-Encoding is not absent or `identity`. |
| 429 | `webhook.rate_limited` | A deployment admission limit refuses the request. Include positive integer seconds in `Retry-After`. |
| 500 | `webhook.internal_error` | Unexpected application failure. |
| 503 | `webhook.unavailable` | Storage/service capacity is unavailable; master-key configuration is missing/invalid; scan/prune issuer/audience settings are invalid; or the selected platform override is present but invalid. |

Authentication failures reveal neither payloads nor log activity. Except for routing and coarse platform/transport bounds, scan/prune authentication precedes query validation and storage access. After authorization, multiple invalid inputs may produce any one applicable validation error.

Input and challenge validation failures, signature/configuration failures, authorization failures, and admission refusals append nothing. For `5xx` or a lost POST response, assume the outcome can be uncertain. A `503` may include `Retry-After` when a useful delay is known; permanent storage exhaustion is not fixed by waiting.

Cloudflare or another intermediary can refuse a request before application code runs and may not use this envelope. A stream failure after `200` headers must terminate the stream rather than append an error object to the event array. Clients must handle both as failed requests.

## 8. Compatibility and security boundary

This revision changes routes, credential scope, key configuration, cursor scope, and event shape. There is no silent backward-compatible alias. Senders must supply native signatures matching the selected platform key. Consumers must move to the global endpoint, supply a JWT signed with the derived JWT key, and establish a global checkpoint from the beginning if earlier per-webhook processing did not cover every source.

Preserve exact `webhook_id` spelling, the path-selected `platform`, all four fixed fields, the bare array, and exclusive ascending IDs. Never flatten the payload, filter the log implicitly, or use a receive secret as global authentication.

The four fixed outer names are reserved. Adding another fixed field can collide with valid custom metadata and requires a contract revision. Reducing bounds, adding automatic event expiry, changing retry behavior, changing JWT policy, or weakening global ordering also requires an explicit revision.

No users or authentication metadata are persisted. Provider payloads may themselves contain user information and are preserved as submitted; this is not an authentication user database.

See the PRD acceptance table and Cloudflare plan for implementation checks.
