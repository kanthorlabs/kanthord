# 10 Proto Schema & Codegen

Goal:             One gRPC schema (proto) whose shapes map to named pi-agent-core
                  types, with codegen producing the **TypeScript** wire types for
                  Core + the Web client. Swift codegen is deferred with the native
                  clients (Web-first).

Decision anchors: S5 (proto owns the RPC wire contract; shapes derived from
                  pi-agent-core; **no Zod on RPC**), S7 (buf for TS, connect-swift
                  for Swift), §3 RPC/Transport, D8 (one schema, many clients).

ACs:
- The schema defines a **minimal v1 RPC surface** sufficient for epics 11 and 12 —
  no more: (a) a **health/ping** unary RPC, and (b) **one server→client streaming**
  RPC carrying token-shaped messages (to exercise streaming over the transports).
  The full agent API is NOT built here.
- The generated **TypeScript** wire code **type-checks** under the epic-01 gate.
- **Derivation is concrete:** the proto message shapes correspond to **named
  pi-agent-core exported types** recorded in a mapping file, and a **type-level
  check** asserts the generated TS lines up with those pi types (so a schema
  unrelated to pi-agent-core fails, not just a round-trip).
- A message round-trips (serialize → deserialize equal) — plumbing check, on top
  of the mapping check above.
- **Server→client streaming** is expressible (agent tokens to the browser);
  client-streaming / bidi is not.
- **Swift codegen (connect-swift) is deferred** with the macOS/iOS clients
  (Web-first) — this milestone produces TypeScript only; the proto stays
  language-neutral so the Swift target can be added later without schema change.

Constraints:
- proto **is the wire source of truth**; its shapes must **map to named
  pi-agent-core exported types**, with drift **documented** (a mapping file +
  type-level compile check — not full drift automation, which would be fake
  precision until pi exposes machine-readable types) (S5). Do not invent a
  parallel schema; **no Zod on RPC messages** (S5).
- The `.proto` sources live in `proto/`; codegen = **buf** (TS) this milestone;
  **connect-swift** (Swift, S7) is deferred with the native clients. buf is a
  build-time Go CLI — allowed (D2 is about runtime native `.node`). The **TS
  Connect runtime** (e.g. connect-es / protobuf-es) is selected by the spike and
  must be **pure-JS / no native** (D2), passing the epic-03 guard.
- Serving the schema over gRPC / gRPC-Web / Connect is **epic 11** — this epic is
  schema + codegen only.

Spike?:           YES — shares the `pi-agent-core@0.80.2` source read with epic 09
                  (authoring rule 4): confirm the **exported types** the shapes map
                  to, and confirm the **buf + chosen TS runtime** pipeline produces
                  type-checking, native-free output. Do not assume the type shape
                  or toolchain output.

Verification:     `buf generate` runs in the build; generated TS type-checks
                  (`tsc --noEmit`); a `node:test` round-trips a message; the
                  mapping/type-level check ties shapes to named pi types; native
                  guard green on the generated TS runtime. (No Swift target this
                  milestone.)

Dependencies:     01 (workspace + native guard); shares the epic-09 pi-agent-core
                  source findings. Feeds 11 (serves this schema) and 12 (uses the
                  mapped types).

Findings out:     `.agent/milestone/01-infrastructure/plan/findings/10-schema-derivation.md`
                  — the proto↔pi-agent-core type mapping + the working buf/TS-runtime
                  pipeline + selected TS runtime. Epics 11 and 12 build on this.
