# Webhook application: product requirements

Status: review draft. The two routes, UUIDv4 shared secret, query-parameter projection, event shape, and ascending ULID cursor come from the product request. The remaining behavior is a proposed completion of that request, not an approved ruling or implemented behavior.

## 1. Purpose

Provide a small webhook inbox. A sender posts a JSON payload to a secret URL. A consumer scans the stored events in ascending order and resumes from its last processed event.

The product exposes exactly two application operations:

| Operation | Route | Purpose |
| --- | --- | --- |
| Receive webhook | `POST /api/webhook/{id}` | Store one event, including custom URL query parameters. |
| Scan webhook | `GET /api/webhook/{id}` | Return an ascending page of events after an optional cursor. |

This document owns product scope. [API.md](API.md) defines the proposed wire contract. [PRD.vocabulary.md](PRD.vocabulary.md) owns the names used by both documents.

This is the application under `platforms/webhook`, not the daemon's Intake Service. These routes do not change `/hooks/<binding id>`, daemon authentication, or daemon pagination. In particular, this API intentionally returns a bare array and uses a plain, ascending event cursor rather than the daemon's pagination envelope.

## 2. Users and workflow

- **Sender:** an external application that knows the webhook URL and posts events.
- **Consumer:** an application or developer that knows the same URL and reads events.
- **Operator:** the person responsible for deployment, storage, and secret handling.

Example workflow:

1. A developer generates a UUIDv4 with a cryptographically secure generator and shares it with a sender and consumer.
2. The sender posts `{"id":1,"foo":"bar"}` to `/api/webhook/8e86bf86-358d-4aaf-bf5a-918514ebf129?param-1=X&param-2=Y&param-2=Z`.
3. The application durably stores one event with a server-generated `event_<ulid>` identity.
4. The consumer scans that webhook and receives the event, including the query parameters.
5. After processing the event, the consumer saves its outer `id` as its cursor.
6. Later scans use that cursor to request only greater event identities.

## 3. Requested requirements

### R1. Webhook identity and access

- The webhook identifier is a UUIDv4 and is also its shared secret.
- The same secret grants both receive and scan access. There is no separate read credential.
- The identifier in the route selects exactly one webhook inbox.
- Knowing an event identity alone grants no access to an inbox.

### R2. Receive and preserve an event

- Accept an event through `POST /api/webhook/{id}`.
- Store the submitted JSON value under the outer `event` field. Do not merge its fields into the outer record.
- Store custom query parameters as outer fields beside `id` and `event`.
- A parameter present once becomes a string; repeated occurrences become an array of strings in occurrence order.
- Generate the outer `id` on the server as `event_<ulid>`.
- A payload field named `id` remains inside `event` and never becomes the cursor.

For the request in the workflow, the scan result includes:

```json
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

### R3. Ascending cursor scan

- Accept scans through `GET /api/webhook/{id}?cursor=event_<ulid>&limit=100`.
- Return a bare JSON array, not an object containing `items` or `nextCursor`.
- Order events by their complete outer `id` in ascending lexicographic order.
- Treat `cursor` as an exclusive lower bound: return only events whose `id` is greater than it.
- Use the last processed event's outer `id` as the continuation cursor.

## 4. Proposed completion defaults

These defaults make the draft testable. They are proposals, not additional requirements attributed to the product owner.

| Area | Proposed behavior |
| --- | --- |
| Inbox setup | No creation endpoint or pre-registration. Any valid UUIDv4 addresses an inbox; its first successful POST stores its first event. GET on an unused inbox returns `[]`. |
| UUID representation | Accept the standard hyphenated UUIDv4 form case-insensitively; normalize to lowercase for inbox identity. Reject other UUID versions. |
| JSON input | Accept any valid JSON value with `Content-Type: application/json`, optionally with UTF-8 charset. Reject an absent body, invalid JSON, and duplicate object member names. |
| Receive response | Return `201 Created` with the stored event record, only after durable commit. |
| Field collisions | Reject POST query parameters named `id` or `event`, including percent-encoded equivalents. Never overwrite, silently discard, or rename them. |
| Query decoding | Decode URL form-style UTF-8 query parameters once. Keep empty values, case, and literal parameter names. Reject malformed encoding and empty names. |
| Duplicate delivery | Each successful POST creates a new record. No automatic deduplication or idempotency key is provided. |
| Scan bounds | Default `limit` to 100; accept integers from 1 through 1000. Omitted cursor starts at the beginning. |
| Scan controls | GET accepts only `cursor` and `limit`, each at most once. POST treats those same names as custom metadata. |
| Cursor validation | Require canonical `event_` plus uppercase ULID syntax. A valid cursor need not identify an existing event. It is a lower bound, not an authorization token. |
| Concurrent append | Require later commits in an inbox to have greater event IDs, so advancing a cursor cannot skip a later commit. See section 5. |
| Retention | No automatic expiry in this version. Events are immutable; scanning does not consume or delete them. |
| Input bounds | Maximum body: 1 MiB. Maximum encoded request target: 8 KiB. Maximum POST query parameter occurrences: 100. |
| Overload | Refuse new writes rather than evict acknowledged events. Return a retryable error when storage or service capacity is unavailable. |
| Transport | Require HTTPS outside local development. Return `Cache-Control: no-store` on success and error responses. |

These bounds are fixed for this proposed contract version. Deployments must not silently clamp `limit`, truncate input, shorten retention, or accept then discard an event.

## 5. Ordering requirement under review

ULIDs provide a sortable representation, not a guarantee of commit order. Random suffixes can reorder IDs generated in the same millisecond. Separate writers, a clock rollback, a restart, or an earlier allocation that commits late can also put a newly visible event behind a consumer's saved cursor.

The proposed requirement is: **for one inbox, every newly committed event has an ID strictly greater than every previously committed event, and scans expose only committed events.** It applies across concurrent writers, restarts, and backward clock changes. It is local to an inbox and does not promise global ordering or the sender's original event order.

A local monotonic ULID generator alone does not establish this guarantee. The implementation must coordinate ID allocation with durable append visibility. This PRD specifies the externally observable invariant, not a storage algorithm or an extra public field.

This is the first design item for owner confirmation. Until confirmed, the no-skipped-appends behavior in the API contract is a proposal, not a settled guarantee.

## 6. Reliability and consumer behavior

- A `201` means that the complete record is durable and available to a subsequent scan of the same inbox.
- A validation rejection stores no event. Never store only the query parameters or only part of the payload.
- A timeout, connection loss, or server failure can leave the sender uncertain whether a commit occurred. Retrying may create another event with another outer `id`.
- A consumer saves a cursor only after it successfully processes the corresponding event. A batch checkpoint must not pass an unprocessed event.
- A scan does not acknowledge processing. Several consumers can scan independently, each keeping its own cursor.
- An empty page means no matching committed events existed at that read. It does not mean the inbox is permanently finished.
- On an empty page or a failed request, the consumer keeps its previous cursor.
- Pagination is not a snapshot across requests. Later commits may appear on later scans.
- Storage must isolate inboxes even when two events have otherwise identical payloads or query parameters.

## 7. Security and privacy

The URL is a bearer credential. Anyone who receives it can both inject and read events. This product does not authenticate a sender's claimed identity or verify provider signatures.

- Generate webhook UUIDs with a cryptographically secure UUIDv4 generator. The example UUID in these documents is public test data, not a production credential.
- Redact the secret path segment from application, proxy, CDN, tracing, analytics, and error logs. Do not include raw query strings or bodies in routine logs.
- Disable response caching at every serving layer. GET responses contain private event data despite using a URL-based credential.
- Treat both custom field names and payloads as untrusted data. They must not mutate object prototypes, execute code, or inject markup into an inspection UI.
- Protect stored events and backups with deployment access controls and encryption at rest.
- Cross-origin browser access is not enabled by this contract. It is not an authorization boundary for non-browser clients.
- A leaked UUID compromises both directions. Using a new UUID creates a different inbox; it does not revoke access to the old one or move its events.
- There is no rotation or revocation API in this version. An operator must block a compromised inbox outside these two APIs if revocation is necessary.
- Retaining events without automatic expiry creates a storage and privacy obligation. The operator must provision capacity and not use this version where automatic deletion is required.

## 8. Out of scope

- Webhook creation, enumeration, deletion, rotation, or administration APIs.
- User accounts, separate read/write roles, OAuth, or API keys in addition to the URL secret.
- Provider signature verification and provider-specific event schemas.
- Raw-body byte preservation, binary uploads, multipart forms, and capture of request headers.
- Server-side deduplication, exactly-once processing, and consumer acknowledgements.
- Push delivery, forwarding, retries to downstream targets, long polling, or streaming.
- Full-text search, metadata filters, descending scans, offset pagination, or snapshot pagination.
- A dashboard, billing, or production throughput and latency SLOs. Those require a deployment workload and measurements.

## 9. Acceptance criteria

The proposed API is ready to implement only after review of its completion defaults. Implementation acceptance must demonstrate these behaviors, not merely match response strings.

| ID | Scenario | Expected result |
| --- | --- | --- |
| A1 | POST the documented payload and repeated query parameters. | One durable event has the documented shape; the nested payload `id` is unchanged. |
| A2 | Scan an unused UUIDv4 inbox. | `200` with `[]`; no creation step is required. |
| A3 | Address the same UUIDv4 using uppercase and lowercase hex. | Both requests select the same inbox. |
| A4 | POST a query key `id`, `event`, or `%69d`. | `400`; no event is stored. A nested payload field with the same name remains valid. |
| A5 | POST `tag=a&tag=a&flag&name=A+B&literal=A%2BB`. | `tag` is `["a","a"]`, `flag` is `""`, `name` is `"A B"`, and `literal` is `"A+B"`. |
| A6 | POST invalid JSON, duplicate JSON members, an absent body, or unsupported media. | The documented error is returned; no partial event exists. |
| A7 | POST the same valid request twice. | Two immutable records exist with different outer IDs. |
| A8 | Scan several pages, using each processed page's final ID. | IDs increase strictly and each existing event appears once in that traversal. |
| A9 | Scan with a syntactically valid cursor that is not stored. | Return the IDs strictly greater than that bound, or `[]`. |
| A10 | Submit a malformed cursor, duplicate GET control, unknown GET parameter, or out-of-range limit. | `400`; no coercion, clamping, or ignored control occurs. |
| A11 | Append within the same millisecond, concurrently, after restart, and after clock rollback. | Under the proposed ordering invariant, no newly committed record is behind an already returned cursor. |
| A12 | Scan during an append whose commit is delayed. | Under the proposed invariant, the append cannot become visible later with an ID below a previously visible event. |
| A13 | Scan two inboxes containing similar events. | Each response contains only the selected inbox's events. |
| A14 | Receive `201`, then restart the application. | The complete acknowledged record remains scannable. |
| A15 | Reach body, request-target, query-count, and page-size boundaries. | Exact maxima are accepted when otherwise valid; values beyond them fail with the documented errors. |
| A16 | Inspect response headers and routine logs for success and failure. | Responses forbid caching; the webhook secret and raw event data do not leak into logs. |
| A17 | Read repeatedly, including an empty page, then append. | Reads do not consume records; polling with the saved cursor discovers the append. |

The API document supplies exact validation, examples, errors, and the consumer continuation procedure.
