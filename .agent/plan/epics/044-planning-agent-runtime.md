# 044 Planning Agent Runtime (exploratory, provider-pluggable)

> **Status: DRAFT (authored 2026-07-11, not debate-hardened).** Author intent
> captured; run the standard debate pass before locking/building.

## Outcome

kanthord gains a **separate planning execution surface**: an exploratory agent
takes a user's planning prompt, explores the repo with its **own** tools over
**arbitrary steps**, and emits a **plan artifact** the existing ring-1 TDD loop
then consumes. Two backends sit behind one `PlanningProvider` seam:

1. **Claude Agent SDK** — `@anthropic-ai/claude-agent-sdk` `query({ prompt,
   options })`, its own autonomous tool loop, run as an **isolated runtime**
   (subprocess).
2. **Async-response provider** — a provider that **fires a request and awaits a
   queued/file-written response later**, built on pi-ai's `createProvider` +
   `ProviderStreams.streamSimple` returning a `lazyStream`.

This path is **deliberately outside ring-1 governance and the in-process Agent
invariant**. Planning is bounded and does **not** mutate the governed product
tree; its output is **reviewed before any ring-1 implementation runs**. This is
the correct home for the two integrations the 019.4 review found unfit for the
*main* agentic system: the Claude Agent SDK's second tool loop and an async
service's internal autonomy both conflict with ring-1 governance when used as a
model provider, but are exactly what open-ended planning wants.

The 019.4 fidelity rule still holds where it applies: the **async backend reuses
pi-ai seams** (`createProvider` / `ProviderStreams` / `lazyStream`) and invents
nothing pi-ai provides. The **Claude Agent SDK is used as its own runtime**, NOT
wrapped as a pi-ai model provider (the review's rejected path).

## Decision Anchors

- **Ulrich (2026-07-11)** — after team discussion: the Claude Agent SDK and the
  async-response provider fit **planning** (arbitrary steps, heavily user-prompt
  driven, AI explores with its own tools), **not** the main agentic system.
  Author as **Epic 044** (043 stays account-switch). Execution model is a
  **separate non-ring-1 path** (confirmed 2026-07-11).
- **019.4 pi-ai fidelity review**
  (`.agent/plan/feedback/019.4-ai-provider-integration/pi-ai-fidelity-review.md`,
  [[phase2-epic-019-4-status]]) — the Claude Agent SDK is a subprocess engine
  running its own tool loop that **bypasses ring-1 `beforeToolCall`** and conflicts
  with the in-process + per-call-budget invariants, so it is **inadmissible as a
  main model provider** but **admissible as an isolated planning runtime**. The
  async-response provider **is** cleanly reusable via `createProvider` +
  `ProviderStreams.streamSimple` (sync return + `lazyStream` for the async wait);
  but if the remote service runs **its own** tools it carries the same governance
  conflict — which is why it, too, belongs on this planning path.
- **[[pi-sessions-in-process]] / AGENTS.md** — the main system is in-process, no
  subprocesses. Epic 044 is the **explicit, isolated exception** for planning; it
  must not leak subprocess/async execution into the governed ring-1 engine.
- **Epic 002 (plan-contract-compiler) + `.agent/authoring.md`** — the plan-artifact
  shape the planning output must target so the ring-1 TDD loop can consume it
  unchanged.
- **Epic 019.4** — the provider engine (accounts, credential custody, the pi-ai
  `createProvider` seam the async backend reuses).
- **Epic 019.5** — the audit timeline + typed provider-error taxonomy planning runs
  record against (per-call for the async backend; the SDK's own `result`/usage).
- **pi-ai 0.80.3 gold standard** — async backend: `createProvider`,
  `ProviderStreams`, `lazyStream`, honoring the abort / terminal-error /
  tool-call-event protocol.

## Stories

> First-cut slices; finalize during the debate pass.

- **PlanningProvider seam + isolation boundary** — one interface both backends
  satisfy; the boundary contract: no ring-1, product tree read-only (or a scratch
  worktree), output is a plan artifact (never direct edits to the governed repo).
- **Claude Agent SDK planning backend** — driven by `query()`, tool-enabled,
  isolated runtime; explores and produces a plan artifact.
- **Async-response planning backend** — pi-ai `createProvider` + custom
  `ProviderStreams.streamSimple` returning a `lazyStream` that fires the request
  and awaits a queue/file response; honors abort/error/tool-call protocol.
- **Plan-artifact hand-off** — map planning output to the Epic 002 / `.agent/plan`
  contract the TDD loop consumes; a human-review gate before ring-1 runs.
- **Budget + audit + typed-error integration** — meter planning runs; record on the
  019.5 timeline; map backend failures to the shared typed provider-error taxonomy.
- **Docs + hermetic gate + maintainer live proof.**

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green; zero-network guard green (both
  backends faked in the automated gate).
- **Seam:** the `PlanningProvider` interface dispatches to both backends; a caller
  selects a backend without knowing its internals.
- **Claude SDK backend (hermetic):** a fake `query()` loop drives an exploratory run
  to a plan artifact; the governed product tree is **not** mutated (read-only /
  scratch); the run uses **no** ring-1 `beforeToolCall` and **no** in-process
  pi-agent-core `Agent` (isolation asserted).
- **Async backend (hermetic):** a fake fire → queue/file → response round-trip
  produces a plan artifact via a **synchronously-returned** `lazyStream`; abort
  mid-wait terminates with a terminal **error** event (and signals remote-work
  cancellation); a backend failure becomes a terminal error event, never a throw
  after stream creation.
- **Hand-off:** the emitted plan artifact validates against the plan-contract shape
  the ring-1 TDD loop consumes.
- **Maintainer live proof (not automated):** one real Claude Agent SDK planning run
  and one real async-provider planning run (inside Podman, isolated credentials),
  each emitting a usable plan artifact.

## Dependencies

- **Epic 019.4** — provider engine + pi-ai `createProvider` seam (async backend).
- **Epic 019.5** — audit timeline + typed provider-error taxonomy.
- **Epic 002** — plan-contract shape the artifact targets.
- **`@anthropic-ai/claude-agent-sdk`** (isolated subprocess runtime) and
  **pi-ai 0.80.3** (`createProvider`/`ProviderStreams`/`lazyStream`).

## Non-Goals

- **Not the main implementation loop.** 044 does not let the planning agent commit
  to the governed repo or bypass ring-1; planning output is **reviewed** before any
  ring-1 governed implementation runs.
- **No wrapping the Claude Agent SDK as a pi-ai model provider** — the 019.4
  review's rejected path. The SDK is its own runtime here.
- **No leaking subprocess/async execution into the in-process ring-1 engine** — the
  isolation boundary is one-directional (planning may read; it does not run governed
  work).
- **No account/model switching** (Epic 043) and **no new ring-1 mechanism** — the
  planning path is intentionally outside ring-1.

## Findings Out

- `.agent/plan/feedback/044-planning-agent-runtime/` — the isolation mechanism
  chosen (subprocess vs scratch worktree), how the SDK's tool loop is bounded and
  kept read-only to the product tree, the plan-artifact mapping to the Epic 002
  contract, and abort semantics for in-flight async remote work. If none, `none`.
