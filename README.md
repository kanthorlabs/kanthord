# kanthord
> Kanthor's agentic program does the work with an opinionated setup. The D mean daemon, same meaning in systemd :D
> We need to build a reliable system from unreliable components. - Chapter 8, Designing Data-Intensive Applications, Martin Kleppmann.

kanthord is a long-running daemon that executes software-engineering work
**across multiple repositories** on behalf of one engineer, reducing the
human's workload to only the work that requires a human. Single-repo agentic
coding is a commodity; kanthord's reason to exist is the **cross-repo feature
orchestration layer**. It is an execution engine for validated plans: planning
stays external (human or agent), and the interface between any planner and
kanthord is the **Plan Contract** — a typed document kanthord lints and
executes like a compiler.

Three ideas carry most of the design:

- **Markdown is the source of truth; SQLite is derived and disposable.** The
  daemon is the single writer; the database can be rebuilt from the files at
  any time.
- **Agents have no network and no credentials.** Every external side effect
  goes through one auditable, always-async broker with typed verbs.
- **Three security rings.** Deterministic policy (cannot be talked out of) →
  LLM risk classifier → human approval. Nothing bypasses them, including the
  dashboard.

## Reading order

| # | Document | What it gives you |
|---|---|---|
| 1 | This README | The pitch and the map |
| 2 | [`docs/md/glossary.md`](docs/md/glossary.md) | The project's invented vocabulary — read before anything else |
| 3 | [`.agent/plan/architecture.md`](.agent/plan/architecture.md) | Components, containers, C4 diagrams, operator routines |
| 4 | [`.agent/plan/phases.md`](.agent/plan/phases.md) | How the MVP is built: Frame → Bricks → Polish |
| 5 | [`.agent/plan/prd.md`](.agent/plan/prd.md) | The full PRD: every decision, trade-off, and assumption |
| 6 | [`.agent/plan/epics/`](.agent/plan/epics/) | Implementation-level epics (000–042) |

Developing? [`docs/md/development.md`](docs/md/development.md) covers the Podman dev
sandbox; [`AGENTS.md`](AGENTS.md) covers the TDD agent pipeline that builds
this repo.

## TODO

- **Modify an on-going TDD cycle (in-flight epic/story amendment).** Today the
  plan tree is locked once a `/work` cycle starts: engineers cannot touch the
  Epic/Story files, and a mid-cycle correction has to route through a review
  finding or a decision record. But in daily work the requirement can change at
  any time — a review can reveal a missing behavior (e.g. Epic 008's B2:
  the deploy executor was never wired to be scheduler-driven), or the human can
  decide to change scope while the cycle is running. We need a first-class,
  supported way to **amend an in-flight epic/story** and re-enter the loop
  without breaking the lane locks or the review/decision record — instead of
  ad-hoc appending a follow-up epic (as we do now with `008.1`). Requirement:
  a modification can be proposed, reviewed (debate), and merged into the active
  plan, and the running cycle picks it up as new RED work with a clear audit
  trail of what changed and why.

- **Internet Exposure.** Allow developers to visualize the app running on localhost
  from the internet. Options: tunnel solution (Cloudflare Tunnel, ngrok, etc.) or
  direct Cloudflare infrastructure to push a site for quick review.

- **Asset Preview.** Once Internet Exposure is available, publish markdown or HTML
  artifacts directly instead of plaintext — faster review turnaround, better UI/visual
  feedback for designs and documentation.

- **Context Engineer.** We should have a table mapping for feature we build,
  then AI can quickly understand the context of the project and provide better suggestions.
  Then we need to adapt Long-Term, Short-Term memory techniques because
  we need temporary context memory (Short-Term memory) while we build the feature,
  then later turn it into Long-Term memory for future reference.

- PR comments and review: provide both way to write review on a PR and also resolve comments on a PR