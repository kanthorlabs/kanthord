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
