# 13 Capability Layer (framework; platform impls deferred)

Goal:             Build the **pure-TS capability framework** — one contract +
                  registry per capability, ownership-aware (host vs client),
                  selection by runtime mode, unsupported-default that throws.
                  Concrete platform impls are deferred; Web client capabilities
                  come first when the Web client is built (Web-first).

Decision anchors: D9 (capability layer; unsupported-default throws), §7 Capability
                  Layer.

ACs (the TS framework — the executable, CI-testable done-gate):
- Calling a capability with no implementation for the current platform **throws an
  explicit "unsupported"** error.
- **Selection behaves by named runtime mode:** `macos-native`, `macos-podman`,
  `linux-container`, `linux-vps`, `ci`. With all platform impls deferred, every
  mode resolves to **unsupported** for now — but the selection uses runtime-mode +
  feature probing (not bare `process.platform`), so a real impl slots in later
  without touching callers.
- The registry returns, per capability, the named fields **`exists`, `available`,
  `unavailableReason`, `enableAction`**.
- Capabilities carry an ownership tag **`host` vs `client`**; `client` entries
  (web, ios) are client-side only — **Core never runs on iOS**.

Constraints:
- Adopt Flutter's **shape** (one contract, many impls), **not** its machinery (no
  method channels / federated registration) (§7). Naming = **"host/client
  capabilities,"** distinct from the plugin system (§7).
- Unsupported-default **throws** until an impl exists (D9). Pure TS, no native
  `.node` (D2).
- **Server→client capability invocation** is DEFERRED (§7 known gap).
- **Web-first scope (resolves the §7 "build host/macos first" point):** the macOS
  Swift-helper host capability **and its IPC spike are deferred with the macOS
  client** — not built this milestone. The first real impls will be **web client
  capabilities** (browser APIs: clipboard / camera / share), landing with the Web
  client in **milestone 02**. So this epic ships the framework + unsupported
  defaults only.

Spike?:           none — pure-TS framework; the high-risk Swift-helper IPC spike is
                  deferred with the macOS client (a deliberate risk reduction under
                  the Web-first directive).

Verification:     `node:test` (CI): the unsupported-default throws "unsupported";
                  selection returns unsupported for each named runtime mode via the
                  runtime-mode + probe path (fakes the mode); the registry returns
                  the four named fields with correct values; the host/client
                  ownership tag is enforced.

Dependencies:     01 (workspace).

Findings out:     none (the Swift-helper IPC findings are deferred with the macOS
                  capability work).
