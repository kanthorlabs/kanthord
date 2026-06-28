# 11 Transport (HTTP/Connect — gRPC-Web; UDS deferred)

Goal:             Serve the one gRPC schema over **HTTP/Connect (gRPC + gRPC-Web)**
                  for the Web client, forwarding the `authorization` metadata to
                  Core's auth with no per-transport session. UDS is deferred until
                  a native client exists (Web-first).

Decision anchors: D8 (one schema; HTTP transport is a **Core module**, not a
                  separate tier), B4 (auth metadata forwarded; no per-transport
                  session; no app-level TLS), §2 Architecture, §9.D Web hosting,
                  Client/Transport Architecture (01-plan-revise).

ACs:
- A **gRPC-Web** client (browser) invokes the health RPC (epic 10) successfully.
- The server→client streaming token RPC (epic 10) **streams over gRPC-Web** to the
  browser.
- **Auth (per epic 08):** on the remote path a valid `authorization` credential
  authenticates and an invalid one is rejected; loopback dev may run without it
  (dev override). The transport keeps **no session of its own**.
- The HTTP transport's **dev default bind is `127.0.0.1:7777`**; the remote/VPS
  bind address is configurable and owned by deployment.
- **No app-level TLS** — h2c acceptable; the VPN tunnel encrypts (D6/B4). nginx
  serves the static SPA and reverse-proxies `/api` → Core's gRPC-Web endpoint
  (§9.D, deployment concern — Core serves gRPC-Web only).
- **UDS is deferred** (see Notes): not built this milestone; the schema/handlers
  stay transport-neutral so a UDS listener can be added later without change.

Constraints:
- One generated schema + one RPC handler implementation; the HTTP transport is a
  **Core module, not a separate tier** (D8). Serve gRPC + gRPC-Web + Connect from a
  **pure-JS Connect server (no native, D2)** (§3).
- **Auth boundary:** epic 08 owns credential parse / verify / rotate / store; epic
  11 only **passes the `authorization` metadata into that verifier** — no
  per-transport session (B4). Auth checked at RPC start (per-stream-open for
  streams); mid-stream revocation out of scope.
- No app-level TLS (D6/B4). Out of scope: nginx config itself, remote bind policy,
  session/revocation design.
- **UDS deferred (flagged for Ulrich):** D8 names two transports, but UDS serves
  only local native clients (macOS app / CLI-over-UDS) + Core-native-on-Mac — all
  deferred by the Web-first directive. Deferring UDS also drops the host→VM
  virtiofs dual-listener risk. The single schema/handler keeps it cheap to add
  back when a native client lands.

Spike?:           light — confirm the chosen Connect server serves **gRPC-Web +
                  server-streaming to a browser** (incl. through an nginx
                  reverse-proxy locally) on Node, pure-JS (authoring rules 3+4).

Verification:     integration test: a gRPC-Web client calls health (success) and
                  receives the streamed tokens; valid vs invalid `authorization`
                  behaves per epic 08; HTTP on `127.0.0.1:7777`; the browser→nginx
                  `/api`→Core path works locally (`make up` + local nginx).

Dependencies:     01 (workspace), 08 (auth verifier), 10 (schema + generated
                  server + shared handlers), `02-development-setup.md` (port /
                  local-run findings).

Findings out:     `.agent/milestone/01-infrastructure/plan/findings/11-grpcweb-streaming.md`
                  — confirmed gRPC-Web server-streaming behavior (incl. through
                  nginx). The Web client (milestone 02) builds on this.
