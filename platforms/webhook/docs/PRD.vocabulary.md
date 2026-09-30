# Webhook application vocabulary

Status: review draft. This is the vocabulary sibling of [PRD.md](PRD.md). It declares the names used by [API.md](API.md); it does not add operations to the daemon or its Intake Service.

## Webhook inbox

A collection of stored events addressed by one UUIDv4 shared secret. In route declarations, `{id}` names that UUID. It is not an event identity.

Example: `8e86bf86-358d-4aaf-bf5a-918514ebf129`. This is public example data only.

## Sender and consumer

The **sender** posts JSON to an inbox. The **consumer** scans that inbox and keeps its own processing cursor. Possession of the inbox UUID grants both capabilities.

The example sender is `orders-sender`; the example consumer is `audit-reader`.

## Event record

The immutable outer JSON object returned by receive and scan.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | String | Server-generated identity: the literal prefix `event_` followed by a canonical, uppercase, 26-character ULID. |
| `event` | JSON value | The sender's parsed request body, without merging its fields into the outer object. |
| Custom parameter name | String or array of strings | The decoded POST query values under their literal decoded name. One occurrence produces a string; repeated occurrences produce an ordered array. |

Example identity: `event_01ARZ3NDEKTSV4RRFFQ69G5FAV`.

The fixed fields are exactly `id` and `event`. The proposed contract rejects those names as POST query keys. A payload's own `id` or `event` remains nested and is not reserved there. Custom names are data, not aliases of domain fields.

There is no public `webhookId`, `payload`, `params`, `receivedAt`, `items`, or `nextCursor` field. JSON object member order has no meaning.

## Scan controls

| Name | Type on the URL | Meaning |
| --- | --- | --- |
| `cursor` | String | An exclusive lower bound containing the complete outer event `id`, including `event_`. |
| `limit` | Decimal integer text | Maximum number of event records requested in one scan. |

These are controls only on GET. On POST, the same names are custom query metadata. No parameter aliases exist.

## Error response

| Field | Type | Meaning |
| --- | --- | --- |
| `error` | Object | The fixed outer wrapper of a non-success JSON response. |
| `error.code` | String | Stable machine-readable error identifier declared in the API error table. |
| `error.message` | String | Human-readable explanation. Clients must not branch on its exact text. |

This wrapper appears only on errors. Successful scans return a bare array, and successful receives return one event record.

## Commit order and scan order

**Commit order** is the sequence in which records become durably committed and visible in one inbox. **Scan order** is ascending lexicographic order of event IDs, using case-sensitive ASCII comparison.

Their alignment is a proposed requirement under owner review. Ordinary ULID generation alone does not align them. Neither order claims to reconstruct the sender's event occurrence time.
