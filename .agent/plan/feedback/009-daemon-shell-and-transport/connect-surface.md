# SU4 Findings — Connect on Node 24 / ESM (Epic 000, maintainer spike)

Date: 2026-07-03. Spike run on **Node v24.12.0**, `@connectrpc/connect@2.1.2`,
`@connectrpc/connect-node@2.1.2`, `@bufbuild/protobuf@2.12.1` (ESM,
`"type": "module"`). All checks passed (`SPIKE CHECK OK`).

## Server bootstrap (the working pattern)

```js
import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { DaemonService } from "./src/generated/kanthord/v1/daemon_pb.js";

const rpcHandler = connectNodeAdapter({ routes: (router) => {
  router.service(DaemonService, { getStatus() { return { version, uptimeSeconds }; } });
}});
const server = createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200, {"content-type":"text/plain"}); res.end("ok"); return; }
  rpcHandler(req, res);
});
server.listen(0, "127.0.0.1");   // loopback ONLY — never 0.0.0.0
```

- `connectNodeAdapter` returns a plain `(req, res)` handler — it composes with
  `node:http.createServer` directly; no framework needed.
- **`/healthz` as a plain HTTP route on the same server: works** — branch on
  `req.url` before the adapter. Returned `200 ok` alongside live RPC handling.

## Loopback bind

`listen(port, "127.0.0.1")` binds loopback only. A probe against the machine's
LAN IPv4 address on the same port **fails** (connection refused/timeout) while
`127.0.0.1` serves — verified in the spike. For IPv6 add a second listener on
`::1`; do not use `0.0.0.0`/`::`.

## Generated import path + descriptor name

- Import path: `src/generated/kanthord/v1/daemon_pb.js` (committed output of
  `npm run generate:proto`; `buf.gen.yaml` targets `js+dts`,
  `import_extension=js` — plain ESM JS, no type-stripping concerns).
- Descriptor: `DaemonService` with `typeName === "kanthord.v1.DaemonService"`;
  methods live in `DaemonService.method` (an object keyed by localName, e.g.
  `.method.getStatus`, each with `.name`, `.methodKind`).
- Response `int64` fields are **BigInt** on the wire type (`uptimeSeconds:
  BigInt`); handlers must return BigInt for int64.

## Registered-method introspection (for ring/read-only enforcement)

Wrap the `routes` fn: after `router.service(...)`, **`router.handlers`** is an
array of handler entries, each exposing `.service.typeName`, `.method.name`,
`.method.methodKind`, and `.requestPath`
(`/kanthord.v1.DaemonService/GetStatus`). Spike output listed exactly one
registered method — this is the inspection surface a gate/test can assert
read-only-ness against.

## Client round-trip

`createConnectTransport({ baseUrl, httpVersion: "1.1" })` (from
`@connectrpc/connect-node`) + `createClient(DaemonService, transport)` →
`await client.getStatus({})` returned the handler values. Note the transport
**requires an explicit `httpVersion`** on Node.

---

## 2A control surface (Epic 011 SU6)

Date: 2026-07-05. `DaemonService` extended and stubs regenerated
(`npm run generate:proto`, buf lint clean). Verified: import ok; descriptor local
names are **exactly** `{getStatus, listInboxItems, respondToEscalation,
respondToApproval}`, all `methodKind === "unary"`, `typeName ===
"kanthord.v1.DaemonService"`.

### Rule supersession (explicit, not a silent edit — debate finding)

Epic 000 SU3 froze the service as **read-only** (proto header + the introspection
gate below). **SU6 supersedes that rule for Phase 2A only**, adding the named inbox
control surface — nothing broader; the full control-plane API is Phase 2B (Epic
026). The proto header was updated to state this. These methods are an **interface
hypothesis**: Epic 017 owns their behavior and may force a re-gen (decision record)
if the shapes are wrong.

### Method classification (reads vs controls — debate finding)

The read-only gate is no longer "assert one method"; it is "**assert the descriptor
is exactly this allowlist, by local name + method kind + read/control class**":

- **Phase-1 read:** `GetStatus`.
- **Phase-2A read:** `ListInboxItems` — one durable inbox; each `InboxItem` is tagged
  by `kind` (`escalation` | `approval`), per Epic 017's unified-inbox model (chosen
  over two split list methods — debate finding).
- **Phase-2A control (mutations):** `RespondToEscalation`, `RespondToApproval`.

Epic 026 will depend on descriptor-level method-by-method checks (kind + class), not
just names — the gate asserts kinds now so that dependency is already satisfied.

### Message shapes are minimal by intent (debate finding)

SU6 is codegen plumbing; Epic 017 owns behavior. So the messages deliberately
**omit pagination, RPC-level idempotency keys, and behavior-rich fields**:

- No pagination — this is a local loopback operator surface for the 2A proof (no
  auth, no web client). Add only if Epic 017 needs it.
- No RPC-level idempotency key — exactly-once for a recorded decision comes through
  the **Epic 005 op idempotency** mechanism keyed on the deterministic inbox
  `item_id`, not a separate client retry token (Epic 017 authoring). Adding one here
  would be redundant or conflicting.
- `InboxItem` = `{ id, kind, feature_id, summary }`; respond requests carry the
  `id` + the minimal decision (`response` for escalation; `approve` + `reason` for
  approval); respond responses carry a resulting `status`. Epic 017 refines fields.

---

## Phase-2B control-plane surface (Epic 020 SU6, 2026-07-14)

Epic 020 SU6 extends the descriptor with the full Phase-2B control-plane surface
for Epic 026. Same protocol as the 2A section: **the gate asserts the descriptor is
exactly the allowlist, by local name + method kind + read/control class**
(`src/daemon/status-server.test.ts`). Regenerated with `npm run generate:proto`;
`buf lint` clean. **These 2B messages are an INTERFACE HYPOTHESIS** — Epic 026's
stories own behavior; any mismatch is a decision-recorded re-gen appended **here**.

### Method map (logical surface → RPC local name → kind → class)

| Epic 026 surface | RPC (local name) | kind | class |
|---|---|---|---|
| `features.list` | `listFeatures` | unary | read |
| `features.get` | `getFeature` | unary | read |
| `broker.operations` | `listBrokerOperations` | unary | read |
| `broker.verbs` | `listBrokerVerbs` | unary | read (registry view; **no write method**) |
| `slots.list` | `listSlots` | unary | read |
| `budgets.get` | `getBudget` | unary | read |
| `daemon.status` | `getDaemonStatus` | unary | read |
| `audit.taskTimeline` | `getTaskTimeline` | unary | read |
| audit session-event stream | `subscribeSessionEvents` | **server_streaming** | read (subscription) |
| `daemon.verify` | `triggerVerify` | unary | **read-with-single-write** (the report record; excluded from the zero-write read list — debate finding) |
| `plan.signOff` | `signOffPlan` | unary | control |
| `task.halt` | `haltTask` | unary | control |
| `feature.halt` | `haltFeature` | unary | control |
| `plan.approveReplan` | `approveReplan` | unary | control |
| `budget.override` | `overrideBudget` | unary | control (sole ring-1 exception — PRD §4) |

Full descriptor after SU6 = **19 methods** (4 Phase-1+2A + 15 Phase-2B). The gate
test asserts this exact set, the streaming kind on `subscribeSessionEvents`, and
that broker write verbs (`mergePr`/`createIssue`/`enqueue`/`lease`/`registerVerb`)
are **never** RPC methods (they flow through the broker registry, not the descriptor).

### Hypotheses carried (to confirm or re-gen in Epic 026)

- **Naming:** logical dotted names map to verb-first PascalCase RPCs
  (`features.list` → `ListFeatures`), matching the existing proto style. If Epic
  026 tests want the dotted names surfaced differently, that is a re-gen decision.
- **`audit.taskTimeline` + session-event stream are thin wiring only** — the
  timeline logic, per-call record, and SIGNAL_MAP live in Epic 019.5; 026 exposes
  them. `SubscribeSessionEventsResponse` wraps a `SessionEvent` (the wrapper only
  satisfies buf's RPC-response-name rule; the semantic payload is `SessionEvent`).
- **`plan.approveReplan` diff = authored-file edit set** (`FileEdit{path,new_content}`)
  + `base_generation` for the conflict check — never the compiled plan (PRD §7.1.1).
- Field-level shapes (budget cost unit, breaker-state vocabulary, timeline event
  types, verify report body) are placeholders pending Epic 026's golden fixtures.
- `int64` fields cross the wire as BigInt (unchanged from the 2A note).
