# Operator Surface — Phase 2A Approval Inbox

The minimal 2A human-loop surface (Epic 017) **is this documented call set**. There
is no web/CLI client in 2A; a human operator drives the inbox with plain `curl`
against the daemon's Connect API (HTTP/JSON). This document is the "minimal CLI"
deliverable named in the EPIC Verification Gate.

## Connect HTTP/JSON conventions

The daemon serves Connect RPC over a single `node:http` server (see
`src/daemon/status-server.ts`). Every call is:

- **Method:** `POST`
- **URL:** `http://<host>:<port>/kanthord.v1.DaemonService/<RpcMethod>`
- **Header:** `Content-Type: application/json`
- **Body:** the request message as JSON (`{}` for empty requests)
- **Success:** HTTP `200` with the response message as a JSON body
- **Error:** a Connect error — non-200 HTTP status with body `{"code": "<code>", "message": "<text>"}`

### Loopback-only bind (2A safety gate)

The server binds `127.0.0.1` by default (never `0.0.0.0`). The **control
methods** (`RespondToEscalation` and `RespondToApproval`) additionally refuse to
serve when the server is configured on a non-loopback bind — they return
`permission_denied` (HTTP `403`). Read methods are unaffected. This is the
only access control in 2A (PRD §9 "VPN-only"; auth/TLS arrive in Epic 026).

`<host>:<port>` below is whatever the daemon reports at listen time (the port is
OS-assigned in tests; in the daemon it comes from config).

---

## 1. List inbox items — `ListInboxItems` (read)

Returns every **open** inbox item (escalations and approvals in one durable
inbox), oldest first. Resolved/expired items do not appear.

**Request:** `ListInboxItemsRequest` — empty, `{}`.

**Response:** `ListInboxItemsResponse`

| Field   | Type              | Meaning                                   |
|---------|-------------------|-------------------------------------------|
| `items` | `InboxItem[]`     | Open items; each carries the fields below |

`InboxItem`:

| Field       | Type   | Meaning                                        |
|-------------|--------|------------------------------------------------|
| `id`        | string | Stable, deterministic item id (used to respond) |
| `kind`      | string | `"escalation"` or `"approval"`                 |
| `featureId` | string | Owning feature (may be empty in 2A)            |
| `summary`   | string | Human-readable summary (may be empty in 2A)    |

**Example**

```sh
curl -sS -X POST \
  http://127.0.0.1:7777/kanthord.v1.DaemonService/ListInboxItems \
  -H 'Content-Type: application/json' \
  -d '{}'
```

```json
{
  "items": [
    { "id": "inbox-esc-a1b2c3", "kind": "escalation", "featureId": "", "summary": "" }
  ]
}
```

An empty inbox returns `{"items": []}`.

---

## 2. Respond to an escalation — `RespondToEscalation` (control, loopback-only)

Records a human response to an **escalation** item and acts through the existing
scheduler seam:

- `resume` → the parked task returns to `pending` (cleared `blocked_on`) so the
  scheduler re-dispatches it.
- `halt` → the task is marked `halted` and is not re-dispatched.

Either way the response is journaled (actor + timestamp in
`escalation_responses`) and the inbox item is resolved as durable state — a
restart never re-opens it.

**Request:** `RespondToEscalationRequest`

| Field      | Type   | Meaning                                  |
|------------|--------|------------------------------------------|
| `id`       | string | Target escalation item id (from `ListInboxItems`) |
| `response` | string | `"resume"` or `"halt"`                   |

**Response:** `RespondToEscalationResponse`

| Field    | Type   | Meaning                              |
|----------|--------|--------------------------------------|
| `status` | string | Item status after the response — `"resolved"` |

**Example**

```sh
curl -sS -X POST \
  http://127.0.0.1:7777/kanthord.v1.DaemonService/RespondToEscalation \
  -H 'Content-Type: application/json' \
  -d '{"id": "inbox-esc-a1b2c3", "response": "resume"}'
```

```json
{ "status": "resolved" }
```

**Error shapes**

| Condition                              | Connect code        | HTTP | Body `message`                                                   |
|----------------------------------------|---------------------|------|------------------------------------------------------------------|
| Item id does not exist                 | `not_found`         | 404  | `inbox item not found: <id>`                                     |
| Server on a non-loopback bind          | `permission_denied` | 403  | `respondToEscalation is restricted to loopback binds in phase 2A` |

```json
{ "code": "not_found", "message": "inbox item not found: inbox-esc-zzz" }
```

---

## 3. Respond to an approval — `RespondToApproval` (control, loopback-only)

Records a human approve/deny decision on an **approval** item and acts through
the existing broker seam:

- `approve: true` → records a **durable approval decision first**, then dispatches
  the parked op to the verb adapter's `submit` (Epic 005 state model; the op's
  idempotency key makes the effect fire exactly once even across a crash between
  the decision and the submit).
- `approve: false` → resolves the op `failed` (reason `denied`); the adapter never
  runs.

Either way the response is journaled and the inbox item is resolved as durable
state. An approval item whose op has passed per-verb expiry cannot be approved —
it auto-resolves `expired` and the transition is journaled.

**Request:** `RespondToApprovalRequest`

| Field     | Type   | Meaning                          |
|-----------|--------|----------------------------------|
| `id`      | string | Target approval item id          |
| `approve` | bool   | `true` = approve, `false` = deny |
| `reason`  | string | Reason for the decision          |

**Response:** `RespondToApprovalResponse`

| Field    | Type   | Meaning                                       |
|----------|--------|-----------------------------------------------|
| `status` | string | Item status after the decision — `"resolved"` |

**Example**

```sh
curl -sS -X POST \
  http://127.0.0.1:7777/kanthord.v1.DaemonService/RespondToApproval \
  -H 'Content-Type: application/json' \
  -d '{"id": "inbox-appr-d4e5f6", "approve": true, "reason": "looks good"}'
```

```json
{ "status": "resolved" }
```

**Error shapes**

| Condition                                    | Connect code         | HTTP | Body `message`                                                  |
|----------------------------------------------|----------------------|------|------------------------------------------------------------------|
| Item id does not exist                       | `not_found`          | 404  | `inbox item not found: <id>`                                    |
| Item is not an approval item (kind mismatch) | `invalid_argument`   | 400  | `item <id> is not an approval item`                             |
| Server on a non-loopback bind                | `permission_denied`  | 403  | `respondToApproval is restricted to loopback binds in phase 2A` |
| Op past per-verb expiry                      | (typed expiry error) | —    | approval rejected; item auto-resolves `expired`                 |

---

## Action-kind compatibility

The inbox is one queue but actions are kind-typed:

- `resume` / `halt` apply only to `escalation` items.
- `approve` / `deny` apply only to `approval` items.

A mismatched action (e.g. approving an escalation item) is a typed error at the
domain boundary (`approveItem` rejects a non-approval item). List an item's
`kind` first to choose the correct respond call.
