# TODO API mission fixture

This is a proposed implementation plan, not an implemented application or a report of passing tests. It targets a separate TODO application repository, not the KanthorD daemon. The app exercises KanthorD planning, dependency scheduling, execution, review and evidence through a realistic delivery workload.

Import only `plan/*.md`. Keep this guide and `kanthord-checks.md` outside the import set. The flat plan directory is deliberate: KanthorD references unique lowercase basenames, not paths. Containment lives in `parent`, not in directory nesting.

## Layout and graph

```text
todoapp/
  README.md                 operator instructions, not a node
  kanthord-checks.md         KanthorD acceptance checks, not a node
  plan/
    todo-api.md             initiative
    foundation.md           objective with three foundation-* tasks
    persistence.md          objective with three persistence-* tasks
    authentication.md       objective with three authentication-* tasks
    todos.md                objective with three todos-* tasks
    operations.md           objective with three operations-* tasks
    acceptance.md           objective with three acceptance-* tasks
```

There are 25 plan files: one initiative, six objectives and eighteen tasks. All six objectives belong to `todo-api.md`.

| Objective | Depends on | Deliverable |
| --- | --- | --- |
| foundation | none | Node 24, Express 5, configuration and HTTP conventions |
| persistence | foundation | SQLite migrations and repository boundaries |
| authentication | persistence | Accounts, bearer sessions and role authorization |
| todos | authentication | Owner-scoped REST API and optimistic concurrency |
| operations | foundation | Error handling, secure middleware, logging and shutdown |
| acceptance | todos, operations | OpenAPI, integrated tests and operations runbook |

Operations and persistence can become available together. Tasks are unordered final-state requirements, not separately scheduled steps. The initiative waits for its child objectives; it does not depend explicitly on them, and no objective depends on its own initiative.

## Application choices

- Node.js 24.x, JavaScript ESM, Express 5.x and SQLite through `node:sqlite`. Commit an npm lockfile. Use Node's test runner, Supertest, ESLint and Prettier for reproducible verification.
- Express Router, `express.json`, Helmet, `cors`, `express-rate-limit`, Zod, Pino and `pino-http`. Use maintained Node-24-compatible versions locked by the implementation.
- Opaque bearer sessions backed by SQLite, not cookies or JWTs. Passwords use asynchronous `node:crypto` scrypt with unique salts. The database stores only session-token digests. Roles are `user` and `admin`; TODO ownership applies to both roles.
- Single API process and local persistent disk. WAL improves reader/writer coexistence but SQLite has one writer; do not promise multi-host writes or unlimited horizontal scaling. Keep SQL in repositories so a later database change does not rewrite HTTP handlers.
- No frontend, email verification, password reset, OAuth, team sharing, attachments or background jobs in this fixture. No public admin registration or HTTP role-management route.

### Contract carried into each objective

Objectives include their own requirements and tasks. A worker cannot rely on reading a sibling objective through Mission APIs. Completed dependencies contribute repository code and tests; this guide is operator context, not hidden worker input. Run objective and task verifications from the repository root. An initiative uses `cd todoapp-repo` because it derives its checkout from its objective bindings.

The implementation exposes `npm run test:foundation`, `test:persistence`, `test:authentication`, `test:todos`, `test:operations`, `test:acceptance`, `test:e2e`, `lint`, `format:check` and `verify`. Each objective owns its suite. Each objective verification also appears in the verifications of one task of that objective, because the execution worker runs only task verifications; the import refuses an objective verification that no task holds. `verify` eventually runs all suites plus lint and formatting; every verification fails on missing tests, failures or skipped acceptance cases. Test files named in task commands are deliverables, not existing files. Tests use isolated temporary databases, ephemeral ports and explicit cleanup, never an operator's database.

## Import preparation

1. Create a dedicated KanthorD project. Its mission is created with it; do not invent a mission-create command.
2. Configure an available repository binding named `todoapp-repo`, pointing to a disposable, initialized repository. Every objective names exactly this binding. Rename it consistently in the six objectives and the initiative verification if your environment uses another name.
3. Configure execution and reviewer workers separately through project worker bindings. Enable the desired agent/provider/model explicitly. No worker binding belongs in a plan node's `bindings`.
4. Choose the repository strategy before import. This dependency chain needs completed work to be available on the base branch for later objectives. Prefer a supported landing strategy and a disposable remote repository. Required external actions need the corresponding Intake/human-check capability; an objective cannot complete while its requested action is unresolved. A no-action setup tests record flow only unless the operator separately makes dependency code available.
5. Read the actual mission identity and version. Assemble the raw contents of all 25 `plan/*.md` files as `files: [{ filename, content }]`, using each basename. The Markdown payload holds `missionId` and `missionVersion`, with `format: markdown` and the operation's reason/apply controls. Do not put these controls in YAML front matter.
6. Preview the entire set, inspect violations and retirements, then apply with the returned `previewDigest` and the exact `confirmedRetirements`. A fresh project should retire nothing. Use the implemented Mission CLI/API contract; this fixture does not invent a directory-import command.
7. Save the returned filename-to-node identity map and immediately export the mission. Use that export, with `id` fields and a fresh mission version, for subsequent edits. Reapplying these original ID-free files is not an identity-preserving update.

An import is authoritative for the whole mission. Never submit only one objective directory or drop unrelated existing nodes. Editing a task modifies its objective's revision. Import modification requires the applicable initiative/objective to remain `Pending` or `Available` with attempt 0; a no-op export/import is distinct from a modification. Do graph-edit experiments in a separate disposable project before workers claim work.

## Design sources

- [Mission ownership, graph and review rules](../../mission-service.md).
- [Exact Markdown grammar and binding cardinalities](../../mission-service.impl.md#the-plan-file-grammar).
- [Vocabulary and plan example](../../mission-service.vocabulary.md#plan-file).
- [Planning ERD](../../../reference/erd/01-setup.md): nodes, revisions, dependencies and jobs.
- [Execution ERD](../../../reference/erd/02-execution.md): attempts, claims, evidence, assessments and outcomes.

The ERDs describe KanthorD's design, not proof of implemented capability. The app's users, sessions and TODO tables are separate from KanthorD's database. Run [the operator checks](kanthord-checks.md) to distinguish app correctness from KanthorD correctness.
