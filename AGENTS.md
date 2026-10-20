# AGENTS.md

Rules for every agent that works in the kanthord repository. Ulrich is the human owner.

## Work with Ulrich

- Raise ONE open item per turn, in prose, with the recommendation first. Apply the answer, report, then raise the next item.
- Never put more than one question into one `AskUserQuestion` call. An answer can close an item as a no-op.
- Discuss each open item or blocker with the `/explain` skill, in this order:
  1. The conclusion in one or two sentences.
  2. A numbered timeline of 4 to 8 steps that shows the failure without the fix. Use the names of the vocabulary siblings.
  3. The same timeline with the fix, marked "diverges at step N".
  4. The page changes, line by line.
  5. The recommendation first, then the alternatives with one-line trade-offs.
  6. Exactly one question.
- When Ulrich restates the problem, confirm or correct the restatement at once in three or four bullets.
- When a page already holds the rule, say so first. Then present the ruling as a repair with a confirmation question.
- Prefer to forbid a configuration change over a mechanism that handles the edge case of that change.
- When Ulrich approves a plan of several steps, run all steps in sequence. Do not ask for confirmation between steps. Verify and commit each step. Stop only for a real blocker or for an open item that needs a ruling.
- Open a report with two to four short prose paragraphs that state the conclusion. Put tables, metrics, per-item findings and blocker lists below, under `## Details`.
- Route each task by its kind:
  - Do a short task and a document edit yourself.
  - Send an ambiguous task to an Opus sub-agent at medium effort.
  - Send a task with clear instructions to a Sonnet sub-agent at high effort.

## Submodules

`kanthord` is a superrepo. Each submodule has its own repository, its own `main` and its own `AGENTS.md` or `README.md`.

| Path                | Repository                    | Responsibility                                                                                                                |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `engine`            | `kanthorlabs/kanthord-engine` | The kanthord daemon and CLI: Node 24, TypeScript, services, HTTP Gateway, worker application, shipped prompts and OpenAPI.    |
| `apps`              | `kanthorlabs/kanthord-apps`   | The React dashboard: pnpm, Vite, the mock daemon and the vitest suite. It talks to the daemon on port 31415.                  |
| `platforms/webhook` | `kanthorlabs/webhook`         | A self-hosted webhook event log on Cloudflare: signature checks, cursor scans and range pruning. It runs without the daemon.  |
| `platforms/homelab` | `kanthorlabs/homelab`         | The home server setup: Cloudflare Tunnel, nginx routes under `/s/<service-name>`, the stats timer and the kanthord container. |

The root repository holds the design set under `docs/`, the release scripts under `scripts/`, the `Makefile` and the submodule pointers.

## Before new work

Check the dirty work before you start any new work.

1. Run `git status --short` in the root repository.
2. Run `git submodule foreach --recursive git status --short`.
3. Run `git fetch origin` in the root repository and in each submodule. Count the commits of `main` that are not on `origin/main`.

Dirty work is an uncommitted change, an untracked file, a moved submodule pointer, or a commit that is not on `origin/main`.

- If no dirty work exists, pull the latest changes before you start:
  1. Run `git pull --ff-only` in the root repository.
  2. Run `git submodule foreach --recursive 'git checkout main && git pull --ff-only origin main'`.
- If dirty work exists, do not pull and do not start the new work. Investigate each change first:
  1. Read the diff and the `git log` of each dirty repository.
  2. Find the task that made the change. Another agent can own it, because agents share this working tree.
  3. Advise Ulrich to commit, stash or discard each change. Give the recommendation first and the reason for it.
  4. Wait for the ruling of Ulrich. Never discard or stash a change without that ruling.

## Design set

- The design set lives in `docs/brainstorm/`. Each service or shared component has a page `<name>.md`, a vocabulary sibling `<name>.vocabulary.md` and an implementation sibling `<name>.impl.md`.
- Open work lives in `docs/brainstorm/HANDOFF.md`.
- Phase 1 (design pages) is closed. Phase 2 writes the implementation siblings. Phase 3 (epics from the design) starts only when Ulrich closes Phase 2.
- Read the owning page before you take an item.

### Where a ruling goes

- Put a ruled mechanism into the root `.impl.md` of the owning page. Put a daemon-wide mechanism into `architecture.impl.md`.
- A submodule owns the documents that detail its own code. `engine/docs/cli/` holds the command table of each service group.
- A submodule document never overrides a page or a sibling. A conflict is a defect of the submodule document.
- An index row holds a path plus the sibling that owns the declaration. Never strip a declaration from its owner to centralize it.
- Custody, the Repository component and the Storage component are shared components with their own pages. No service owns them.
- Delete the HANDOFF item that carried the reasoning once its answer lands in a page. The page is the rule, and git history is the record.

### HANDOFF queue

- Take items in section order.
- Skip every item with an explicit `POSTPONED` marker. Never infer a postponement from wording such as "after the system runs live".
- Put a postponed item under the section of its owning component with `POSTPONED <date> by Ulrich until <condition>`. Never put it under a Next session list.
- Put a root tooling item under `### Root repository`.
- Remove an item from HANDOFF as soon as its write is verified. Do not keep it until the commit.
- B9 (failure and recovery) comes last. Never open a B9 item on your own initiative. Only Ulrich starts it.

### Protocol for one design item

Before you propose a rule or a mechanism, search the design pages, their siblings and the code for an existing rule or mechanism that covers the same concern or a related one. Name what you find in the proposal. Extend the owner of that rule. Do not propose a second mechanism in another service. Example: the Intake Service already checks external requests and forwards their results, so a check of external actions belongs to Intake and not to Mission.

1. Run `/explain` on the item.
2. Take the ruling from Ulrich.
3. Write the ruling into `docs/brainstorm/HANDOFF.md` under the owning component.
4. Apply the edits yourself with the exact old text and the exact new text.
5. Verify the diff yourself.

- Batch the mechanical items that need no ruling into one edit pass.
- After each ruling, grep the pages that you already wrote for sentences that touch the same actors. A rule phrased as "who performs an action" changes its meaning when a later ruling changes the actor. Re-check every earlier fix against the new ruling.

### Ruled decisions

The pages record only the decision. Read the owning page section before you propose a mechanism. Do not propose an alternative to a ruled decision.

## Contracts

- External contracts (YAML files, CLI input and output, HTTP payloads) use the exact field names of the domain entities in code.
- Never use a shortened alias, for example `deps` for `dependencies`. Never rename a field in an adapter.
- Diff every key of a new contract against the vocabulary sibling of the owning page.
- A divergence from the model is an explicit locked decision, never a naming convenience.
- A human override action takes the CLI flag `--force` and the body field `force: true`. No other flag or field name accepts a risk or bypasses a check.
- Every error code that the engine answers stands on the owning design page and on the `engine/docs/cli/` page of its command group.
- Every command page of `engine/docs/cli/` holds an error-code table with the HTTP status, the code and the condition of each code that its commands answer.

## Naming outside the code

- Write every name outside the code in snake_case. This covers a table, a column, a property inside a JSON column, a stored key or value name, each part of an operation id or an error code, each key of a configuration file such as `kanthord.yaml` or `cli.yaml`, and each field of an HTTP payload or a CLI output.
- Write every field of a domain entity schema in the code in snake_case, for example `agent_name`, so that a contract uses that name with no rename.
- Every other identifier inside the code, for example a local variable, a function or a type, follows the convention of its language.

## Database design

- Never declare a SQL `CHECK` constraint, for example `CHECK (kind IN ('repository','worker','storage'))`.
- Define every closed value set as an enum in code. The owning service validates the value before the write.
- Never declare an index that is not a unique index.
- The schema lives in `docs/reference/erd/` and records only ruled design. Keep HANDOFF items out of it.
- `project_id` is the second key column only in project-scoped tables.
- Write every table name, every column name and every property name inside a JSON column in snake_case. The name of an external library or protocol is no exception. Only a ruling of Ulrich that names the external requirement permits another case.
- An Intake inbound event stays until a human deletes it. No automatic retention exists.
- A rename of a table or a column also updates the map in `docs/reference/erd/README.md`.
- `docs/viewer.html` pins mermaid 11.17.2. Never pin a version below 11, because the ERD views use `classDef` in an `erDiagram`.

## Dashboard design

- A list row of a revisioned record shows its effective revision as `(v<revision>)` next to its name or identity.
- Show one revision per row. Never show a second revision field beside it.

## Worktrees, branches and pull requests

Several people and agents work in parallel. Each change has its own worktree, its own branch and its own pull request.

- Edit HANDOFF by quoted sentence only. Never revert a foreign change.
- Commit design pages per step. Commit a HANDOFF item with the change that adds, rules or removes it.
- Stage exact paths only. Never use `git add -A`. Never stage a file with the uncommitted edits of another agent.
- Do every change in its own git worktree. Never switch the branch of the root checkout, because a branch switch moves HEAD under the other agents.
- Create the worktree in `.dev/<name>` at the root of the repository, from `main`: `git worktree add -b <type>/<name> .dev/<name> main`. `.dev/` is ignored.
- Run `make bootstrap` in the worktree before a build, a test or a check. A new worktree holds no submodule and no dependency.
- Push the branch and open a pull request to `main`. Merge only after review.
- After the merge, remove the worktree and delete the branch.
- Write every commit subject in the format `<type>(<scope>): <subject>`. The `(<scope>)` part is optional.
- Write the subject in the present tense, for example `feat: add hat wobble`.
- Use only one of these types:
  - `feat`: a new feature for the user. A new feature for a build script is not `feat`.
  - `fix`: a bug fix for the user. A fix to a build script is not `fix`.
  - `docs`: a change to the documentation.
  - `style`: formatting, for example a missing semicolon. No production code change.
  - `refactor`: a change to production code that keeps the behavior, for example a variable rename.
  - `test`: a new test or a refactor of a test. No production code change.
  - `chore`: a change to build tasks or tooling. No production code change.

## Repository tooling

- `kanthord` is a superrepo. [Submodules](#submodules) maps each submodule and its responsibility.
- Every `make` target wraps `scripts/<category>/<command>.sh`.
- Run `make bootstrap` first in a clone. It is idempotent.
- `make dev` runs the engine with `node --watch` and the dashboard with Vite in the foreground. `Ctrl-C` stops both. It sets no `HOME` or `XDG_*` variable, so the Podman check of the `container` placement reads the host environment. An agent runs it as a background task. Before `kanthord upgrade`, it stops the old listener of each port. It waits up to 15 s for the old pid and its `node --watch` parent to exit. It fails with the pid that stays. The engine preloads `scripts/dev/upgrade.mjs`, so each start and each `node --watch` restart runs `kanthord upgrade` before `serve`. An engine update that edits a migration makes `kanthord upgrade` stop with `system.database.migration.schema_mismatch`. Run the [reset procedure](docs/reference/upgrade.md#reset-a-pre-release-database) before the next start.
- `make sync` publishes the submodules. It then pushes the parent to a branch `sync/<yymmdd-HHMM>` and opens a pull request with `gh pr create`, because the `main` ruleset refuses a direct push. It prints the pull request URL.
- `make e2e` prepares and starts a live e2e run in one step. It installs the engine dependencies from the lockfile and starts `make dev` in the background when the daemon is down, then runs `make e2e-start`. `RUN` defaults to `todoapp-<yymmdd-HHMM>`. `PLACEMENT=server|worker|container` (default `server`). `PLACEMENT=container` refuses a dev configuration without `worker.container_image: localhost/kanthord-dev-node` and prints that line. It then builds `localhost/kanthord-dev:<version>` and its Node layer `localhost/kanthord-dev-node:<version>` before the daemon starts. `make bootstrap` writes that key into a new dev configuration only.
- `make pi-tools-update TOOL=<tool> VERSION=<version>` pins one pi tool in `engine/static/pi-tools.json`. `make bootstrap`, `make release-build` and `make e2e` fetch the pinned tools.
- `make e2e-start RUN=<name>` starts a live e2e run against the daemon of `make dev`. `make e2e-watch`, `make e2e-stop`, `make e2e-restart`, `make e2e-resume` and `make e2e-scale` take the same `RUN`. The run files live in `.dev/e2e/<name>/`.
- `make e2e-start` takes `PLACEMENT=server|worker|container` (default `server`). At `server` placement it writes `placement: "server"` into each worker binding and starts no worker processes; the daemon pool manages the instances. At `container` placement it does the same with `placement: "container"`, the daemon pool launches a container for each instance, and `run.json` carries `image_id`, the id of `localhost/kanthord-dev-node:<version>`. At `worker` placement it writes `placement: "worker"` and `worker_instances` into each worker binding. It lists the dev instances of the worker, and it starts one `kanthord serve worker --instance <name>` for each listed instance without a running process. `run.json` carries `placement` and `config`, and `instances: [{ name, worker, pid, log }]` only at `worker` placement. It creates the SSH key `<ssh_credential>-<RUN>` through `POST /api/repository/credential/ssh/key` and pins the host key of the repository address. It adds the public key as a write deploy key with the title `kanthord-e2e <RUN>` to the repository through `gh api`. `run.json` carries `ssh_credential` and `deploy_key_id`. It creates the GitHub poll inbound of the repository after the binding set, with the credential of the repository binding. It pauses the project directly after its creation, so that no worker claims a node. `PAUSED=0` keeps it active. `make e2e-resume RUN=<name>` resumes the project. `make e2e-watch` prints project state, node changes and registration changes. A registration change holds `runtime_identity`, `placement`, `activity`, `draining`, `resource_identity` and `worker_name`. A registration that leaves prints `-> gone`. At `container` placement the watch also prints `image <id>` at the start and after each image change. At `worker` placement it also prints the connection changes and the process exits of each instance.
- `make e2e-stop RUN=<name>` at `server` and `container` placement pauses the project. `STOP=daemon` stops the daemon of `make dev` instead. At `container` placement, `STOP=daemon` then waits up to 20 s and fails when a container with the label `io.kanthord.owner` remains. At either placement, `STOP=daemon` deletes each deploy key of the repository with the title `kanthord-e2e <RUN>`. It refuses an endpoint that is not loopback. It stops only a kanthord dev daemon. A dev daemon is a listener whose parent is the `node --watch` of `scripts/dev/run.sh`. It is also an orphaned listener with parent pid 1. That listener runs `node … src/main.ts serve` in the `engine` directory of a kanthord checkout. Run `node --test scripts/e2e/*.test.mjs` after a change to `scripts/e2e/daemon.mjs`. At `worker` placement it stops the process of each instance of the run, and the instances persist. A concurrent run that lists the same instances also loses these processes. Start them again with `make e2e-restart`. `make e2e-restart RUN=<name>` at `server` placement waits up to 15 s for the old daemon of `make dev` to exit, then starts it again. At `container` placement it first rebuilds `localhost/kanthord-dev` and `localhost/kanthord-dev-node` and writes the new `image_id` into `run.json`, then restarts the daemon. A `node --watch` restart of `make dev` rebuilds no slot image. Run `make e2e-restart` after an engine change under a `container` run. At `worker` placement it restarts the process of each instance of the run on the current engine code.
- `make e2e-scale RUN=<name> BINDING=<binding> COUNT=<n>` changes the `instance_count` of a worker binding of a run. At `worker` placement it writes the first `n` dev instances of the worker into `worker_instances` and starts the missing processes. It writes no binding and prints the sign-in steps when a listed instance holds no live copy.
- The `worker` placement e2e uses persistent dev instances: `e2e-coder-<n>` for `coder@1` and `e2e-reviewer-<n>` for `reviewer@1`. Each instance has its configuration, data, state, process file and log `serve.log` in `.dev/e2e/instances/<name>/`. A missing server record removes the local configuration and creates the instance again. A live record of another key revision, or no local configuration, rotates the key. An archived instance stops the run, because its name stays taken. Concurrent runs share the instances and one process for each instance.
- Each dev instance holds its own `anthropic-subscription` copy, signed in through OAuth. It spends no API money. The `swe@1` and `re@1` enablements name that credential.
- When a dev instance holds no copy, `make e2e PLACEMENT=worker` stops before the SSH key. It prints one sign-in command for each such instance. The command is `kanthord llm credential login anthropic-subscription --name anthropic-subscription --holder <name>`. The instance processes stay active, because a sign-in needs a connected instance.
- Do one login at a time, because the server keeps one pending login for each platform and human. Open the address, then run `kanthord llm credential login-code <session_id> <code#state>`. Then run `make e2e PLACEMENT=worker` again.
- A database reset ends every copy. The first run after each reset thus asks for one sign-in for each dev instance.
- A copy that is not live cannot take a new login, because a login refuses an existing copy of the same holder. A key rotation of the instance or a revoke of the copy makes it not live. The run then prints that copy, and only a database reset restores the sign-in.
- `make release-smoke-container` builds `localhost/kanthord:<version>` with Podman, starts the release binary with `worker.container_image: localhost/kanthord`, applies one `container` binding and waits up to 120 s for the slot. It then stops the server and fails when a container with the owner label remains after 20 s. `IMAGE_FROM=docker` loads `kanthord:<version>` from Docker into Podman instead of a build; the `image` job of `release.yml` does that, and the runner user runs rootless Podman. The script links the `containers` directories of the real `XDG_CONFIG_HOME` and `XDG_DATA_HOME` into its disposable home, so that Podman keeps its connection and its image store.
- `make e2e-check RUN=<name>` clones the base branch `e2e/<RUN>` into `.dev/e2e/<RUN>/check/` of the main checkout. It runs every suite, lint, the format check, the scratch-file check, and the secret check. Each child process has a ten-minute limit. When a child exceeds the limit, the script kills it and reports `FAILED: timeout`. It prints one line per check and a final `RESULT pass` or `RESULT fail`. It exits non-zero on a failure. `make e2e-watch` runs the check at each node transition to `Completed`. It runs one check at a time. When a `Completed` event arrives during a check, the watch sets a pending flag. After the check ends, the watch starts one more check and clears the flag. The watch pauses the project on a check failure. It also pauses on a check error and prints a pause confirmation. The watch keeps its poll loop active during a check.
- An e2e script reaches a third-party platform only with a token of `engine/.env.e2e`. Every `gh` call uses `E2E_GH_TOKEN` as `GH_TOKEN`, never the `gh` login of the host. The token holds limited scopes. `E2E_GH_TOKEN` is a fine-grained token limited to `kanthorlabs/kanthord-verify`. It holds the permission "Administration: write" for the deploy key routes. That permission also permits a delete of the repository, so the token covers no other repository.
- Move the engine under a live e2e run only when no claim is in progress. Then run `make e2e-restart RUN=<name>` in the same step.
- The daemon listens on port 31415. The web app listens on port 27182 at `http://localhost:27182`.
- Check the web app in a browser with the `ego-browser` skill. The `chrome-devtools` MCP server cannot connect, because another Chrome holds port 9222.
- Emulate a phone width with `page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })`. Ask Ulrich for a human token when the saved instance refuses its token.
- Both submodules pin `pnpm@11.24.0`. Keep `minimumReleaseAge` in `.npmrc`.
- pnpm forwards `--` literally. Write `pnpm run X --flag`, not `pnpm run X -- --flag`.
- The `.githooks/pre-commit` hook refuses a root commit whose staged gitlink is not on the `origin/main` of that submodule. Move a root pointer only after the submodule commit is pushed.
