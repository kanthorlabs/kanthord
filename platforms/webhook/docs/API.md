# Webhook application API contract

Status: review draft, not an implementation claim. This document completes the two operations requested in [PRD.md](PRD.md). Additional defaults are proposals identified in that PRD; in particular, the commit-order guarantee in section 5.4 awaits owner confirmation.

Field names follow [PRD.vocabulary.md](PRD.vocabulary.md). The words MUST, MUST NOT, and SHOULD specify the proposed behavior within this draft, not approval of its pending decisions.

## 1. Scope and conventions

| Method | Path | Successful response |
| --- | --- | --- |
| `POST` | `/api/webhook/{id}` | `201 Created`, one event record |
| `GET` | `/api/webhook/{id}` | `200 OK`, an array of event records |

- The base origin is deployment-specific. Paths have no trailing slash.
- These are the only two application operations. There is no create, delete, event-get, or acknowledgement route.
- HTTPS is required except during local development.
- Request and response JSON uses UTF-8. JSON object member order is not significant.
- Responses, including errors, carry `Content-Type: application/json` and `Cache-Control: no-store`. A response to HEAD has no body, as required by HTTP, even though HEAD is not a supported operation.
- The UUID in the path is the only application credential. No `Authorization` header, cookie, or signature is required.
- The application MUST NOT put the UUID, raw query string, or payload in an error message or routine log.
- No CORS access is granted by this contract.
- This contract belongs to the standalone Webhook application. It does not inherit or change daemon routes, credentials, or pagination envelopes.

## 2. Identifiers and inbox lifecycle

### 2.1 Webhook path parameter: `id`

`id` MUST be a hyphenated RFC UUIDv4 with the UUID variant bits set. Validation is case-insensitive; storage and inbox lookup normalize hex letters to lowercase.

Validation pattern, with case-insensitive matching:

```text
^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

Braces, `urn:uuid:`, missing hyphens, surrounding whitespace, nil UUIDs, and other UUID versions are invalid. Invalid UUIDs return `400 webhook.id_invalid`.

The sender or developer generates the UUID using a cryptographically secure UUIDv4 generator. Anyone who knows it can POST and GET. The examples below use a public test UUID that MUST NOT serve as a production secret.

No pre-registration is required. Every valid UUIDv4 addresses its own logical inbox. The first accepted POST stores its first record. Scanning an unused inbox returns `200` with `[]` and does not create an event. There is no `webhook.not_found` response merely because an inbox is empty or unused.

Events do not expire automatically. Scans never delete or acknowledge them. This version has no API for deleting events, revoking a UUID, or moving records to a new UUID.

### 2.2 Event identity: `id` and `cursor`

An event identity consists of the literal, case-sensitive prefix `event_` and a canonical 26-character uppercase ULID. The first ULID character is `0` through `7`; the remaining alphabet excludes `I`, `L`, `O`, and `U`.

```text
^event_[0-7][0-9A-HJKMNP-TV-Z]{25}$
```

Example: `event_01ARZ3NDEKTSV4RRFFQ69G5FAV`.

The server generates event IDs; the sender cannot choose or overwrite them. IDs MUST be unique within an inbox. A duplicate allocation MUST NOT overwrite an existing record or be reported as a successful new append.

A cursor contains this complete identity, not a bare ULID, a timestamp, or a base64 encoding. Lowercase ULIDs, other prefixes, and surrounding whitespace are invalid. An event identity is not an authentication credential.

## 3. Event representation

Every successful receive returns one event record. Every successful scan returns an array of records with the same structure.

| Field | Required | JSON type | Meaning |
| --- | --- | --- | --- |
| `id` | Yes | String | Server-generated event identity. |
| `event` | Yes | Any JSON value | The parsed POST body. |
| Each custom POST query name | When supplied | String or array of strings | The decoded values for that query name. |

Example record:

```json
{
  "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "param-1": "X",
  "param-2": ["Y", "Z"],
  "event": {
    "id": 1,
    "foo": "bar"
  }
}
```

The outer `id` is the scan cursor. The nested `event.id` belongs to the sender and has no pagination meaning. A submitted array is one event payload, not a batch. Objects, arrays, strings, numbers, booleans, and `null` are valid payload values.

The application preserves the parsed JSON value, including nested arrays and objects. It does not promise preservation of whitespace, member order, numeric spelling, or escape spelling. Numbers use finite IEEE-754 binary64 semantics; send precision-sensitive values such as large integer identifiers as JSON strings. A number that overflows that representation is invalid input. Duplicate member names at any object depth are rejected rather than silently choosing one value.

## 4. Receive webhook

### 4.1 Request

```http
POST /api/webhook/8e86bf86-358d-4aaf-bf5a-918514ebf129?param-1=X&param-2=Y&param-2=Z HTTP/1.1
Host: webhook.example.com
Content-Type: application/json

{
  "id": 1,
  "foo": "bar"
}
```

- `Content-Type` MUST be `application/json`, optionally with `charset=utf-8`. Media type and charset matching is case-insensitive. Other media types, non-UTF-8 charsets, and other media-type parameters return `415 webhook.content_type_unsupported`.
- `Content-Encoding` MUST be absent or `identity`; compressed bodies are unsupported.
- The body MUST contain exactly one valid JSON value. Empty or whitespace-only input is invalid; the literal JSON value `null` is valid.
- The maximum body size is 1,048,576 bytes, inclusive. Count received body bytes before JSON parsing, including whitespace. Enforce the bound for streamed bodies as well as requests with `Content-Length`.
- The encoded request target, consisting of path plus optional `?` and query, MUST NOT exceed 8,192 bytes.
- The request MAY contain up to 100 query parameter occurrences, inclusive. Repeated keys each count toward the limit.

### 4.2 Query parameter projection

The application MUST construct the outer event record using these rules:

1. Split the raw query on `&`, and split each nonempty component at its first `=`. Ignore empty components. A missing `=` means an empty value; a semicolon is not a separator.
2. Convert literal `+` to space, then percent-decode each name and value exactly once as UTF-8. Reject invalid percent escapes and invalid UTF-8 rather than replacing them.
3. Reject an empty decoded name. Names are case-sensitive, are not trimmed, and are not Unicode-normalized.
4. Reject the decoded names `id` and `event` with `400 webhook.query_key_reserved`.
5. Group occurrences by the exact decoded name. One occurrence becomes a string. Two or more become an array of strings in their original occurrence order. Preserve duplicate values.
6. Store each group under that literal name beside the server `id` and the body under `event`. Do not infer numbers, booleans, nested objects, or arrays from value text or bracket notation.

All custom names, including `__proto__` and `constructor`, MUST remain inert data. Implementations MUST NOT assign untrusted names in a way that mutates prototypes or changes serialization behavior.

| POST query | Stored custom fields or rejection |
| --- | --- |
| `param-1=X&param-2=Y&param-2=Z` | `"param-1":"X", "param-2":["Y","Z"]` |
| `tag=a&tag=a` | `"tag":["a","a"]` |
| `flag&empty=` | `"flag":"", "empty":""` |
| `name=A+B&literal=A%2BB` | `"name":"A B", "literal":"A+B"` |
| `tag=a&%74ag=b` | `"tag":["a","b"]` |
| `a[b]=x` | `"a[b]":"x"`, not a nested object |
| `cursor=source-42&limit=10` | `"cursor":"source-42", "limit":"10"`; these are not POST controls |
| `id=sender-value`, `%69d=sender-value`, or `event=x` | `400 webhook.query_key_reserved` |
| `=x` or `%ZZ=x` | `400 webhook.query_invalid` |

No query parameters means the outer record contains only `id` and `event`.

### 4.3 Successful response

```http
HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store

{
  "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "param-1": "X",
  "param-2": ["Y", "Z"],
  "event": {
    "id": 1,
    "foo": "bar"
  }
}
```

Return success only after the entire record is durably committed. A subsequent scan of the same inbox MUST be able to see it, subject to the scan's cursor and limit. Do not acknowledge an in-memory-only record or a queued write that has not committed.

No `Location` header is required because there is no individual event retrieval route.

### 4.4 Atomicity and retries

- A successful POST creates exactly one immutable event record.
- Client-input errors store no event. Partial records MUST NOT become visible.
- Repeated valid POST requests create separate records with different IDs, even when their bodies and query parameters are identical.
- No idempotency header or provider delivery ID is interpreted by this API.
- A timeout, disconnected response, or `5xx` can have an uncertain outcome. The sender may retry, but MUST allow for duplicate records.
- On `429`, the sender SHOULD wait for `Retry-After`. On transient failures, it SHOULD use bounded exponential backoff with jitter rather than a tight retry loop.

## 5. Scan webhook

### 5.1 Request parameters

```http
GET /api/webhook/8e86bf86-358d-4aaf-bf5a-918514ebf129?cursor=event_01ARZ3NDEKTSV4RRFFQ69G5FAV&limit=100 HTTP/1.1
Host: webhook.example.com
```

| Parameter | Required | Default | Validation |
| --- | --- | --- | --- |
| `cursor` | No | No lower bound | Complete event identity defined in section 2.2. Empty is invalid. |
| `limit` | No | `100` | Decimal text matching `[1-9][0-9]*`, with value from 1 through 1000 inclusive. |

- GET uses the same query splitting and decoding rules as POST, but accepts only `cursor` and `limit`.
- Unknown query parameters and repeated controls return `400 webhook.scan_query_invalid`, even if the repeated values are identical. Parameters never act as filters.
- Malformed query encoding or an empty name returns `400 webhook.query_invalid`.
- `limit=0`, negative values, leading zeros, signs, decimals, exponent notation, whitespace, and values above 1000 return `400 webhook.limit_invalid`. No coercion or clamping occurs.
- An invalid event identity returns `400 webhook.cursor_invalid`.
- GET MUST NOT carry a request body. A nonempty body returns `400 webhook.scan_body_unsupported`.
- The same 8,192-byte request-target bound applies to GET.

A syntactically valid cursor need not exist in this inbox. A cursor from another inbox is only a scalar lower bound here: it does not trigger a lookup in that inbox or disclose any of its contents. A cursor greater than every stored ID returns `[]`. Consumers SHOULD therefore use only IDs actually processed from the same inbox.

### 5.2 Selection and response

At one consistent committed read view for the request:

1. Select only records from the inbox named by the normalized path UUID.
2. If a cursor is supplied, retain only records whose complete `id` is strictly greater than it.
3. Sort by `id` ascending using case-sensitive ASCII lexicographic comparison.
4. Return the first `limit` records, or all matching records if fewer exist.

There is no snapshot spanning multiple scan requests. A successful scan is always `200`, including when there are no matching records.

Example first page without a cursor:

```http
GET /api/webhook/8e86bf86-358d-4aaf-bf5a-918514ebf129?limit=1 HTTP/1.1
Host: webhook.example.com
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

[
  {
    "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "param-1": "X",
    "param-2": ["Y", "Z"],
    "event": {
      "id": 1,
      "foo": "bar"
    }
  }
]
```

After processing that record, continue with its outer ID:

```http
GET /api/webhook/8e86bf86-358d-4aaf-bf5a-918514ebf129?cursor=event_01ARZ3NDEKTSV4RRFFQ69G5FAV&limit=1 HTTP/1.1
Host: webhook.example.com
```

If another record exists with the next greater ID, the body can be:

```json
[
  {
    "id": "event_01ARZ3NDEKTSV4RRFFQ69G5FAW",
    "event": {
      "id": 2,
      "foo": "baz"
    }
  }
]
```

Otherwise the body is:

```json
[]
```

No `items`, `nextCursor`, total count, or continuation headers are added. Event records contain their original POST metadata; the GET cursor and limit are never added to them.

### 5.3 Consumer continuation

1. Start without a cursor, or load the cursor saved for this inbox by this consumer.
2. Request a page and process its records in response order.
3. After successfully processing a record, durably save its outer `id`. Do not checkpoint beyond an unprocessed record.
4. Request the next page with the saved ID. A full page does not prove that another page exists.
5. A short page means fewer than `limit` records matched at that read. An empty page means none matched. Either can be followed by later appends.
6. When caught up, poll at an appropriate bounded interval, keeping the saved cursor unchanged until another event is processed. On a failed scan, also keep it unchanged.

A consumer can reread a page after a crash or checkpoint failure. If duplicate processing matters, it must deduplicate side effects using the inbox identity and outer event ID. This does not deduplicate two separate POST deliveries, which have different event IDs.

### 5.4 Proposed concurrent-append guarantee

**Pending owner confirmation:** within an inbox, each newly committed event MUST have an ID greater than every previously committed event. A scan MUST NOT expose uncommitted records. This invariant MUST hold across same-millisecond appends, concurrent writers, application restarts, and backward clock changes.

Consequently, once a consumer has read a committed event with ID `C`, an event committed later cannot appear behind `C`. Provided the consumer starts at the beginning, advances only after processing, and continues polling successfully, a later append will not be skipped because of its ID.

Ordinary random ULID generation, or a monotonic generator local to each process, does not by itself satisfy this guarantee. Allocation order alone also fails when commits become visible out of order. The implementation must establish the invariant at the durable append boundary. This contract does not prescribe a database or lock mechanism.

The order is the application's append order, not the sender's timestamp, network arrival order, or a global order across inboxes. Consumers MUST treat event IDs as opaque ordering keys rather than derive event occurrence time from them.

## 6. Errors

All application-generated non-success responses with a body use this shape:

```json
{
  "error": {
    "code": "webhook.cursor_invalid",
    "message": "cursor must be a canonical event identity."
  }
}
```

`error.code` is stable. `error.message` is explanatory text and MUST NOT echo secrets or submitted values. There are no other error-envelope fields in this version.

| HTTP status | Code | Condition | Client action |
| --- | --- | --- | --- |
| 400 | `webhook.id_invalid` | The path identifier is not a UUIDv4 in the accepted form. | Correct the URL. |
| 400 | `webhook.query_invalid` | A query name is empty or query encoding is malformed. | Correct the query. |
| 400 | `webhook.query_key_reserved` | A POST query name decodes to `id` or `event`. | Remove or rename the custom parameter. |
| 400 | `webhook.query_limit_exceeded` | POST has more than 100 nonempty query components. | Reduce parameter occurrences. |
| 400 | `webhook.body_invalid` | POST has an absent, malformed, non-UTF-8, duplicate-member, or non-finite-number JSON body. | Correct the body. |
| 400 | `webhook.scan_query_invalid` | GET has an unknown parameter or repeated control. | Use only one occurrence of each supported control. |
| 400 | `webhook.cursor_invalid` | GET cursor is empty or has invalid event-identity syntax. | Supply the last processed event ID or omit the cursor. |
| 400 | `webhook.limit_invalid` | GET limit has invalid integer syntax or is outside 1 through 1000. | Correct the limit. |
| 400 | `webhook.scan_body_unsupported` | GET contains a nonempty body. | Remove the body. |
| 404 | `webhook.route_not_found` | The request does not match the application route. | Correct the path. |
| 405 | `webhook.method_not_allowed` | The matched route receives an unsupported method. | Use GET or POST; response includes `Allow: GET, POST`. |
| 413 | `webhook.body_too_large` | POST body exceeds 1,048,576 bytes. | Reduce the body. |
| 414 | `webhook.request_target_too_long` | Encoded path and query exceed 8,192 bytes. | Shorten the request target. |
| 415 | `webhook.content_type_unsupported` | POST Content-Type is missing or unsupported. | Send the documented JSON media type. |
| 415 | `webhook.content_encoding_unsupported` | POST Content-Encoding is neither absent nor `identity`. | Send an uncompressed body. |
| 429 | `webhook.rate_limited` | The deployment refuses a request under its admission limit. | Wait for `Retry-After`, then retry. |
| 500 | `webhook.internal_error` | An unexpected application failure prevents a normal response. | Back off; a POST outcome can be uncertain. |
| 503 | `webhook.unavailable` | Durable storage or service capacity is unavailable. | Back off; honor `Retry-After` when present. |

A `429` response MUST contain `Retry-After` as a positive integer number of seconds. A `503` MAY contain it when the application can recommend a delay. This contract sets no throughput quota or latency SLO; deployment limits must be communicated operationally.

Input validation errors and admission refusals MUST NOT append records. For `5xx`, transport failure, or a lost response, clients MUST NOT assume that no write committed.

If several input rules fail, the server may report any one applicable validation error. It MUST NOT silently accept or partially store the request.

The deployment SHOULD configure its ingress to honor these input bounds and error shapes. Connection failures and responses generated outside the application can lack this JSON envelope; clients must handle them as transport or intermediary failures rather than attempt to parse a success payload.

## 7. Compatibility

- Preserve the two route methods, bare scan array, `id` and `event` names, literal custom parameter names, and exclusive ascending cursor semantics.
- Do not flatten the payload, wrap scan results, rename fields in an adapter, silently discard parameters, or turn an event ID into a different cursor format.
- The fixed outer names `id` and `event` are reserved from this version. Arbitrary additional metadata fields would collide with previously valid custom parameters and therefore require an explicit contract revision.
- Reducing input bounds, adding expiry, changing duplicate-delivery behavior, or weakening the confirmed ordering guarantee also requires an explicit contract revision.

See the PRD acceptance table for the behavioral checks required of an implementation.
