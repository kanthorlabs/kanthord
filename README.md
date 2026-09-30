# kanthord

> Kanthor's agentic program does the work with an opinionated setup. The D mean daemon, same meaning in systemd :D

> We need to build a reliable system from unreliable components. - Chapter 8, Designing Data-Intensive Applications, Martin Kleppmann.

## Repositories

| Tooling alias | Submodule path | Purpose |
| --- | --- | --- |
| `engine` | `engine` | Node daemon. |
| `apps` | `apps` | Dashboard and client applications. |
| `webhook` | `platforms/webhook` | Standalone webhook log; currently documentation and deployment planning only. |

Run `make repo-bootstrap` in a fresh clone. It initializes all submodules, attaches them to `main`, and propagates the root Git identity. Runtime setup remains limited to engine and apps.

`make sync-all` publishes submodules before root gitlinks. Use `make sync-webhook` to synchronize only Webhook, or `make tree-new REPO=webhook BRANCH=docs/example` for its isolated worktree. Webhook worktrees need no parent links or runtime setup. `make test-submodules` verifies the tooling against disposable local repositories without touching live remotes.
