# TODO API mission fixture

This is a proposed implementation plan, not an implemented application or a report of passing tests. It targets a separate TODO application repository, not the KanthorD daemon. The app exercises KanthorD planning, dependency scheduling, execution, review and evidence through a realistic delivery workload.

Import only `plan/*.md`. Keep this guide and `kanthord-checks.md` outside the import set. The flat plan directory is deliberate: KanthorD references unique lowercase basenames, not paths. A task file names its node through `node`, not through directory nesting.

## Layout and graph

```text
todoapp/
  README.md                 operator instructions, not a node
  kanthord-checks.md         KanthorD acceptance checks, not a node
  plan/
    todo-api.md             report node
    foundation.md           change node with three foundation-* tasks
    persistence.md          change node with three persistence-* tasks
    authentication.md       change node with three authentication-* tasks
    todos.md                change node with three todos-* tasks
    operations.md           change node with three operations-* tasks
    acceptance.md           change node with three acceptance-* tasks
```

There are 25 plan files: one `report` node, six `change` nodes and eighteen tasks. Each task file names its `change` node with `node:`.

| Node           | Depends on        | Deliverable                                             |
| -------------- | ----------------- | ------------------------------------------------------- |
| foundation     | none              | Node 24, Express 5, configuration and HTTP conventions  |
| persistence    | foundation        | SQLite migrations and repository boundaries             |
| authentication | persistence       | Accounts, bearer sessions and role authorization        |
| todos          | authentication    | Owner-scoped REST API and optimistic concurrency        |
| operations     | foundation        | Error handling, secure middleware, logging and shutdown |
| acceptance     | todos, operations | OpenAPI, integrated tests and operations runbook        |

Operations and persistence can become available together. Tasks are unordered final-state requirements, not separately scheduled steps. The report node `todo-api.md` depends on all six change nodes, so it stays `Pending` until each one is `Completed`.

## Application choices

- Node.js 24.x, JavaScript ESM, Express 5.x and SQLite through `node:sqlite`. Commit an npm lockfile. Use Node's test runner, Supertest, ESLint and Prettier for reproducible verification.
- Express Router, `express.json`, Helmet, `cors`, `express-rate-limit`, Zod, Pino and `pino-http`. Use maintained Node-24-compatible versions locked by the implementation.
- Opaque bearer sessions backed by SQLite, not cookies or JWTs. Passwords use asynchronous `node:crypto` scrypt with unique salts. The database stores only session-token digests. Roles are `user` and `admin`; TODO ownership applies to both roles.
- Single API process and local persistent disk. WAL improves reader/writer coexistence but SQLite has one writer; do not promise multi-host writes or unlimited horizontal scaling. Keep SQL in repositories so a later database change does not rewrite HTTP handlers.
- No frontend, email verification, password reset, OAuth, team sharing, attachments or background jobs in this fixture. No public admin registration or HTTP role-management route.

### Contract carried into each node

Each change node includes its own requirements and tasks. A worker cannot rely on reading another node through Mission APIs. Only the report execution reads the outcomes and evidence of its direct dependencies. Completed dependencies contribute repository code and tests; this guide is operator context, not hidden worker input. Run change node and task verifications from the repository root. The report node uses `cd todoapp-repo`, because its evaluation checks out the base-branch head of each repository binding of its direct change dependencies.

The implementation exposes `npm run test:foundation`, `test:persistence`, `test:authentication`, `test:todos`, `test:operations`, `test:acceptance`, `test:e2e`, `lint`, `format:check` and `verify`. Each change node owns its suite. Each change node verification also appears in the verifications of one task of that node, because the execution worker runs only task verifications; the import refuses a change node verification that no task holds. Each requirement and criterion item of a change node that the coding agent can meet also stands in the Requirement or Criterion of one of its tasks, because the execution worker shows the agent only the content of one task. An item about the review stays on the node only. `verify` eventually runs all suites plus lint and formatting; every verification fails on missing tests, failures or skipped acceptance cases. Test files named in task commands are deliverables, not existing files. Each change node creates the source directories that hold its own code. The foundation requires only `src/config`, `src/http` and `src/db`. Authentication creates `src/modules/auth` and `src/modules/admin`, and todos creates `src/modules/todos`. No node adds an empty directory or a `.gitkeep` placeholder. Tests use isolated temporary databases, ephemeral ports and explicit cleanup, never an operator's database.

## Import preparation

`make e2e` runs every step below from `scripts/e2e/todoapp.json`. It reads the secrets from `engine/.env.e2e` and the SSH identity from `~/.ssh/config` of the host. Both agents run `claude-haiku-5-5` through the LLM credential `anthropic-subscription`, which `make e2e` does not create. Before the first run, create it with `kanthord llm credential login anthropic-subscription --name anthropic-subscription`.

1. Create a dedicated KanthorD project. Its mission is created with it; do not invent a mission-create command.
2. Configure an available repository binding named `todoapp-repo`, pointing to a disposable, initialized repository. Every change node names exactly this binding. Rename it consistently in the six change nodes and the report verification if your environment uses another name.
3. Configure execution and reviewer workers separately through project worker bindings. Enable the desired agent/provider/model explicitly. No worker binding belongs in a plan node's `bindings`. Configure the worker bindings before the import, because a node write refuses a node that no worker binding matches with `mission.node.requires_unmatched`. The fixture nodes require no trait, so a binding with `traits: []` matches them. Each worker declares both `change` and `report` in `declared_works`, as every released worker does.
4. Choose the repository strategy before import. This dependency chain needs completed work to be available on the base branch for later nodes. Prefer a supported landing strategy and a disposable remote repository. `todoapp.json` sets `landing: kanthord`, so kanthord merges each pull request after a passing review. Required external actions need the corresponding Intake/human-check capability. A node cannot complete while its requested action is unresolved. A no-action setup tests record flow only unless the operator separately makes dependency code available.
5. Create one GitHub poll inbound for the repository of `todoapp-repo`, after the binding set and before the import. It names the project, the kind `poll`, the platform `github`, the consumer `mission.delivery.admit`, the credential that the binding names (`kanthor-verify`) and `configuration.resource` set to `repository.github` of `todoapp.json`. A merge of a pull request then completes its node with no `mission node check`. The [merge detection](../../intake-service.impl.md#the-merge-detection-of-a-github-poll) states the mapping of a merged, a closed and a conflicting pull request.
6. Read the actual mission identity and version. Assemble the raw contents of all 25 `plan/*.md` files as `files: [{ filename, content }]`, using each basename. The Markdown payload holds `missionId` and `missionVersion`, with `format: markdown` and the operation's reason/apply controls. Do not put these controls in YAML front matter.
7. Preview the entire set, inspect violations and retirements, then apply with the returned `previewDigest` and the exact `confirmedRetirements`. A fresh project should retire nothing. Use the implemented Mission CLI/API contract; this fixture does not invent a directory-import command.
8. Save the returned filename-to-node identity map and immediately export the mission. Use that export, with `id` fields and a fresh mission version, for subsequent edits. Reapplying these original ID-free files is not an identity-preserving update.

An import is authoritative for the whole mission. Never submit a partial set or drop unrelated existing nodes. Editing a task modifies the revision of its node. Import modification requires the changed node, or the node of a changed task, to remain `Pending` or `Available` with attempt 0; a no-op export/import is distinct from a modification. Do graph-edit experiments in a separate disposable project before workers claim work.

## Design sources

- [Mission ownership, graph and review rules](../../mission-service.md).
- [Exact Markdown grammar and binding cardinalities](../../mission-service.impl.md#the-plan-file-grammar).
- [Vocabulary and plan example](../../mission-service.vocabulary.md#plan-file).
- [Planning ERD](../../../reference/erd/01-setup.md): nodes, revisions, dependencies and jobs.
- [Execution ERD](../../../reference/erd/02-execution.md): attempts, claims, evidence, assessments and outcomes.

The ERDs describe KanthorD's design, not proof of implemented capability. The app's users, sessions and TODO tables are separate from KanthorD's database. Run [the operator checks](kanthord-checks.md) to distinguish app correctness from KanthorD correctness.

## Check after each merge

After kanthord merges a pull request, `make e2e-watch` runs `make e2e-check RUN=<name>` once for that node. The check runs every suite, lint, the format check, the scratch-file check and the secret check on the head of the base branch. It prints one line per check. It exits with `RESULT pass` or `RESULT fail`. On `RESULT fail`, `make e2e-watch` pauses the project. The scratch-file check rejects any path that matches `(^|\/)\.kanthord|scratch|\.tmp$|\.log$|\.bak$|~$|\.orig$|(^|\/)\.env$|\.db$|node_modules/` (case-insensitive) in the diff from the fixture commit to the base branch head. The secret check rejects any added line that matches `gh[pousr]_[A-Za-z0-9]{20,}`, `github_pat_`, `sk-[A-Za-z0-9-]{20,}`, `AKIA[0-9A-Z]{16}`, `-----BEGIN [A-Z ]*PRIVATE KEY`, `xox[baprs]-` or `nvapi-`.
