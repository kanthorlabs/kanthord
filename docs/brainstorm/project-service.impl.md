---
title: Project Service Implementation
---

# Project Service Implementation

This file holds the implementation rulings for the mechanisms that realize [project-service.md](project-service.md).
This file is not a design document, and `project-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the binding store, the protected facility or custody.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.
The installed set provides `node:sqlite` `DatabaseSync`, `node:crypto` `hkdfSync`, `createCipheriv`, `createDecipheriv`, `createHmac`, `createHash`, `randomBytes` and `timingSafeEqual`.
It also provides `zod` at 4.4.3 and `ulid`.
The first version holds one platform entry, GitHub.
Slack, Telegram and Jira hold no platform entry until their design lands.
A credential type is no platform, because an API key spans platforms.
The GitHub action catalog holds exactly two actions.

- `pull_request` opens a pull request from the node branch into the base branch. It requires the platform action capability. Its expected end state is the merge of that pull request.
- `merge_push` merges the node branch into the base branch and pushes. It requires the network git write capability. Its expected end state is the push to the base branch.
- Each action implies its expected end state and takes no parameter.
- A repository strategy holds at most one action, because a policy configures one external action.

## The binding store

The Project Service owns its tables in the operational database, and [architecture.impl.md](architecture.impl.md) rules that file and its driver.
It reads no table of another service.
The tables are below.

- `project_project(id, name, binding_set_version, created_at)` holds the identity of a project and the version of its binding set.
- A new project takes binding-set version 1 in `binding_set_version`.
- Its first write names version 1 and commits version 2.
- `project_binding(id, project_id, name, kind, resource_identity, current_revision, created_at, removed_at)` holds the identity of a binding.
- `project_binding_revision(id, project_id, binding_id, revision, config, created_at)` holds one immutable row for each revision, and `config` holds the configuration as the canonical JSON that [architecture.impl.md](architecture.impl.md) rules.

Every table above holds `id` as its first column and `project_id` as its second column.
The credential store sits in the shared table `credential`, which [architecture.impl.md](architecture.impl.md) rules with its envelope and its cipher key.
The Project Service owns that table through custody, and a binding names one of its records with a credential reference.
A project creation inserts the `project_project` row and calls the Mission collaboration `createMission` inside the same transaction, which [architecture.impl.md](architecture.impl.md) rules.

The constraints are below.

- A unique index over `project_project.name` enforces the uniqueness of a project name, and the name is the natural key of the project creation.
- A project name follows the form of a binding name.
- A creation or a rename to a name that another project holds returns 409 with code `project.name_conflict` and the identity of that project in `error.details`.
- A rename commits in one transaction, and the last write wins.
- The Project Service keeps a removed binding and every revision for the life of the project, and no sweep deletes them. Only a human edit adds a row, so the tables grow with human edits alone.
- The primary key of `project_binding` is `id`, an identity of the convention that [architecture.impl.md](architecture.impl.md) rules, so a binding identity is unique across the server and satisfies the rule of `project-service.md` that it is unique inside its project.
- `project_binding.current_revision` carries a composite foreign key to `project_binding_revision`, whose own real key is the pair of the binding and the revision under a unique index.
- A partial unique index over `project_id` and `name` where `removed_at` is absent enforces the uniqueness of a binding name among the current bindings, so a removed binding releases its name.
- `project_binding.resource_identity` names the resource that the binding allocates, and a partial unique index over `project_id` and `resource_identity` where `removed_at` is absent enforces the cardinality of the kind, so a project binds a resource again after its removal. The section below gives its form. A worker binding holds no resource identity, because a project holds any number of bindings of one worker, and SQLite treats two absent values as distinct. `kind` stays a plain column that the validation reads.
- A credential reference and a reference to another binding sit inside `config`, and the write validates each one against `project_binding`. SQLite enforces no foreign key inside JSON.
- A binding name holds 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens.
- A new binding takes revision 1.

A binding identity and a project identity follow the identity convention of [architecture.impl.md](architecture.impl.md).

## The identities of the Project Service

- A binding identity is `binding_<ulid>` for every binding kind, because the entity kind is the binding and `kind` is a column.
- A credential record identity is `credential_<ulid>`.
- Validation of the `binding` claim of a machine JWT checks the `binding_` prefix and the canonical ULID portion.
- [gateway-service.impl.md](gateway-service.impl.md#the-jwt) rules that JWT.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.

## The resource identity

`resource_identity` holds the normalized identity of the resource that a binding allocates, in three colon-separated parts, `<platform>:<resource kind>:<identifier>`.
It names the resource that the binding allocates, and `credential.remote_identity` names the identity that a credential acts as at a remote. The two hold the same form and never the same subject.
A per-kind function derives it from the binding configuration on every write, so a human enters it never and it disagrees with that configuration never.
The values of the first version are below.

- `github:repository:kanthorlabs/kanthord` for the repository binding with the SSH address `git@github.com:kanthorlabs/kanthord.git`.
- `openai:account:org-kanthorlabs` for the provider account binding of that account.
- `github:webhook:kanthorlabs/kanthord` for the source binding of the GitHub webhook of that repository.
- A worker binding holds no value.

The middle part names the resource and not the binding kind, so a GitHub webhook and a source of another platform hold different values under the one kind `source`.
Normalization decides a revision against a replacement.

- A repository identity derives from its SSH address alone.
- Every provider account has the resource identity `<provider>:account:<account>`.
- For a built-in provider, the account is the trimmed `account` field. The service keeps it verbatim with no case folding, because provider account ids are case-sensitive.
- For `openai-compatible`, the account is the lower-cased host of the base URL. It holds no scheme, no port, no path and no version.
- The base URL `https://llm.atlas.internal/v1` gives `openai-compatible:account:llm.atlas.internal`.
- A host change replaces the binding.
- A change of the scheme, the port, the path or the model list creates a revision.
- The base URL scheme is `https` or `http`. A query or a fragment refuses the write.

## The write of a binding set

A write submits the complete binding set of the project as one object keyed by binding name.
The submission names the version of the binding set that the client read.
The write checks custom providers before the `BEGIN IMMEDIATE` transaction.

- The write calls `GET <baseUrl>/models` once for each `openai-compatible` binding that the edit adds or whose configuration changes.
- The call uses custody `use` with a 10 s deadline.
- A connection other than `ok` refuses the write with `project.bindings.provider.unreachable`. The error names the connection value.
- A model id absent from the answer refuses the write with `project.bindings.provider.model_unknown`. The error names the id.
- An unchanged binding makes no call.
- The resolution makes no network call.

One `BEGIN IMMEDIATE` transaction holds the read of `project_project.binding_set_version`, the comparison, the difference and every write of the edit.
The transaction refuses a submission that names another version, so two concurrent writes never interleave.
It increments that column on every write that it commits.
The transaction spans no `await`, no network call and no nested transaction, because one synchronous connection serves four services.
The current binding set is the set of the rows of `project_binding` that hold no `removed_at`.
A reference inside a submission names a binding name of that submission. The transaction resolves each reference to the identity that the name holds after the write, and it stores that identity in the configuration. A stored reference always holds an identity.
The transaction compares the canonical JSON of each configuration, so a reordered property of the submission creates no revision.
The outcomes of the comparison by binding name are below.

- A name with an unchanged configuration keeps its identity and its revision.
- A name whose configuration changed and whose named resource stays keeps its identity and takes a new revision, and the transaction inserts one `project_binding_revision` row.
- A name whose named resource changed takes a new identity, and the transaction sets `removed_at` on the binding that held the name.
- A new name adds a binding with a generated identity at revision 1.
- A name that the submission omits takes `removed_at`, and the transaction keeps its rows.
- A worker binding whose worker changed under the same name is refused.
- A submission equal to the stored set increments the version and changes no binding.

A dependent reference follows the name, so a new identity under a name repoints every dependent reference in the same edit and gives each dependent binding a new revision.
Validation refuses a set that references a binding name that the submission does not hold.
The invocation chain records the answer of the edit in memory after the commit, which [gateway-service.impl.md](gateway-service.impl.md#idempotency-of-a-mutation) rules, and a repeat of the edit after a restart runs the handler again against the same submitted set.

## Revision, disablement and rotation

A revision is the unit of a configuration change.
The local disablement of a binding is a field of the configuration, so a disablement creates a revision.
A resolution reads `current_revision` of the binding row, so a disablement takes effect at the next resolution and cancels no operation in flight.
A change to the secret material behind a credential record creates no revision, because a reference names the record and never its content.
A rotation therefore updates one `credential` row in place and creates a revision nowhere.
A rotation commits in one transaction, and the last write wins.
An `oauth` record obtains material through the refresh of pi-ai, which runs inside `modify` under the credential store lock.
That refresh updates the row in place and creates no revision.
A rotation keeps the remote identity of the record. Material for another remote goes into a new record.

## Validation

One `zod` schema at 4.4.3 covers each binding kind, and a discriminated union on the kind covers the set.
A schema validates the shape, and a `superRefine` validates the relations of the whole set.
The validation of the whole set runs at the write, and the validation of one binding with its dependencies runs again at each resolution.
A rejected configuration prevents use, so a resolution that fails validation refuses the operation.
The write refuses a submission that changes the worker of an existing worker binding under the same binding name.

- The provider id is a member of `getBuiltinProviders()` of `@earendil-works/pi-ai` at 0.86.0, or `openai-compatible`.
- A model identifier is a member of `getBuiltinModels(provider)`, or of the model list of the binding for `openai-compatible`.
- The write and the resolution check both catalogs. A pi version bump changes both catalogs.
- Suitability requires that the record type is an auth type of the provider. `apiKey` maps to `api_key`, and `oauth` maps to `oauth`.
- The `account` field is required for a built-in provider and forbidden for `openai-compatible`.
- The `baseUrl` and `models` fields are required for `openai-compatible` and forbidden for every other provider.
- Each custom model requires an `id` from the check answer at approval, a positive integer `contextWindow` and a positive integer `maxTokens`.
- The `maxTokens` value is at most `contextWindow`.
- The optional boolean `reasoning` defaults to `false`. The optional `input` is a subset of `text | image` and defaults to `["text"]`.
- A custom model entry holds no cost.
- An agent entry holds optional `reasoningEffort`; absence selects the template default.
- Its values are `off | minimal | low | medium | high | xhigh | max`.
- The reasoning effort of an effective configuration is a member of `getSupportedThinkingLevels` of the effective model.
- The write and the resolution check that level. An unsupported level refuses the write with `project.bindings.worker.reasoning_effort_unsupported` and prevents resolution.
- The `instanceCount` field is an integer from 0 to 64. A value outside that range refuses the write with `project.bindings.worker.instance_count_range`.
- An instance count of 0 makes the worker binding unavailable. A worker binding holds no `available` field.
- The repository, provider account, source and storage kinds keep `available`.
- A `projectPrompt` above 32768 UTF-8 bytes refuses the write with `project.bindings.repository.project_prompt_too_large`.
- Every repository binding names exactly one `credential` of type `api_key` of its platform. An absent credential refuses the write.
- An HTTPS repository address refuses the write.
- A strategy with more than one action refuses the write.

## Storage configuration

The `storage` binding names one S3-compatible bucket of a project.
A project holds at most one current storage binding.
The set validation and a partial unique index on `project_id` for current `storage` rows enforce that cardinality.
The configuration holds these fields beside `available`:

- `endpoint`: required URL of the S3-compatible service.
- `bucket`: required nonblank bucket name.
- `region`: required nonblank region.
- `prefix`: required text for the object-key prefix.
- `credential`: required reference to a custody record, never inline secret material.

The credential record type follows the [HANDOFF Mission item](HANDOFF.md#mission-service); this configuration declares no record type.
Validation checks the field types, the endpoint URL, the custody reference and project cardinality at write and resolution.
An absent field, invalid value or second storage binding refuses the write.
The binding write probes no store capability or version support.
The store controls object versioning; kanthord enforces no object immutability.
A human who disables versioning accepts that choice.
Without a storage binding, the Mission Service accepts only inline evidence content, not object uploads.

Tests reject absent fields, invalid values, an unknown custody reference and a second storage binding.
Tests assert that binding writes make no capability probe and that stores without versions remain valid.
Tests preserve the storage binding revision in each object evidence record.

## The worker template registry

A worker template is a static module of the server.
The registry maps a worker name to its template, and it loads no runtime plugin.
A template declares its agents, the default configuration of each agent, the options that a project overrides and the constraint of a whole configuration.
The template expresses the options as a `zod` schema and the constraint as a `superRefine` of that schema.
The registry holds `general@1` and `reviewer@1`, which [worker-service.impl.md](worker-service.impl.md) names as the workers of the first version.

- `general@1` and `reviewer@1` declare no further option, so their option schema is empty.

## The resolution of a binding

An execution calls the resolution at the moment that it needs the resource.
One read resolves the dependency chain of the binding.
For a worker binding the chain holds the binding, its revision, the entry of the agent, the provider account binding that the entry names and the default account of the provider that the default configuration names.
The resolution merges the entry over the default configuration, adds the provider account, and parses the result against the schema of the template.
It checks the disablement of every binding of the chain, and a disabled or removed member refuses the operation.
The resolution records the revision of every binding of the chain, and not the revision of the worker binding alone.
It performs no cache, because `DatabaseSync` reads the local file synchronously.
A recorded revision authorizes nothing, so the next operation resolves the chain again.

## The credential store record

A record holds one secret of one type.

- A credential store record holds its credential name in `name`, with 1 to 63 characters.
- The name starts with a lower-case letter, then uses lower-case letters, digits and hyphens.
- A unique index holds `name`.
- The credential name is the natural key of `credential create` and of an OAuth login.
- A taken name answers 409 `project.credential.name_conflict` with the holder identity in `error.details`.
- A login session takes the credential name at its start, checks it at the start and checks it again at the commit.
- A rotation keeps the credential name and the remote identity.

The types are below, and each one names the class of operation that it performs.

- **api_key**: `{type:"api_key", key}` of pi-ai. For a git platform the key is a personal access token, classic or fine-grained. The key of a git platform performs a platform action only. For a provider account the key performs a model inference call. API key providers include `openai` and `anthropic`.
- **oauth**: `{type:"oauth", refresh, access, expires}` of pi-ai. It performs a model inference call for a provider whose pi-ai provider carries OAuth: `anthropic`, `openai-codex`, `github-copilot` and `openrouter`.

The first version registers those two types and no other.

- Suitability is a pure function of the type, the capability and the provider, over the table above.
- Coverage checks the required capabilities and the credential references of the binding.
- Coverage requires one `api_key` credential reference on every repository binding.

The two functions are the whole validation of a credential reference, and neither one reads secret material.

## The remote identity of a record

`remote_identity` holds one string in three colon-separated parts, `<platform>:<identity kind>:<identifier>`.
The identifier is the login, the slug or the path that the remote displays, and no numeric identity.
The identity kind holds `user` and `organization` in the first version, and a new platform adds its own values.
The server never asks the remote to confirm the value, so the field records an intent that a human wrote and that a human reads when selecting a record.
The values of the first version are below.

- `github:user:ulrich` for a classic personal access token of that account.
- `github:organization:kanthorlabs` for a fine-grained personal access token that the organization owns.
- `openai:organization:org-kanthorlabs` for a key of that account at OpenAI.

Custody logs each human creation or update of a record with the human identity of the caller and the record identity.
The record names no such actor itself, so that log is the whole attribution.

## The keys of the Project Service

[architecture.impl.md](architecture.impl.md) holds the field `masterKey` of the configuration file, the rule that a service derives its keys from it and never uses it directly, and the cipher key of the `credential` table.
The Project Service derives its keys with `crypto.hkdfSync`, SHA-256 and an empty salt.

- `HKDF(masterKey, info = "webhook/<binding id>/<rotation>")` is the verification secret of one source binding.

It derives that secret at the moment that it needs one, so no webhook secret sits in the store.
A hand replacement of `masterKey` makes every stored credential unreadable, so a human enters each secret again into the record that holds its identity, and every binding that names that record stays valid.
The same replacement invalidates every derived webhook secret, so a human pastes a new value at the platform for every source binding.

## The protected facility

The protected facility is one module of the Project Service.
For an operation grant, it exposes one authorization function and one use function, and neither function returns secret material.
The authorization function takes the identity of the requester, the binding and the requested capability, and it returns a grant or a refusal.
The grant is a frozen value that a module-private `WeakSet` records, as [gateway-service.impl.md](gateway-service.impl.md) records a human identity, so no caller fabricates one.
The grant serves one operation, and custody consumes it at the first use.
A disablement therefore reaches every later operation, because a consumed grant authorizes none.
That grant is the operation grant.
The acquisition grant of the section below is the second grant kind, and it serves one session.
The facility resolves each identity as below.

- A human identity passes `isHumanIdentity` of [gateway-service.impl.md](gateway-service.impl.md), and the facility authorizes it for the operation.
- A machine identity passes `isMachineIdentity` of [gateway-service.impl.md](gateway-service.impl.md), and it names the client identity, the worker binding and the project that the verification of its JWT resolved.
- An execution identity resolves to the node of its claim through a call into the Scheduler Service module, and the facility refuses an operation that names another node.
- A service identity passes `isServiceIdentity` of the kernel, which [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules.
- The facility permits each service its own classes: the Scheduler Service the read of an external object, and the Intake Service the acquisition classes.
- The acquisition classes act on a source binding.
- The facility resolves the external object through its own store to the repository binding, the project and the node.
- It takes no association from the caller.

An operation of an execution that an external harness hosts presents the machine identity and the execution identity together.
The facility proves the whole chain: the JWT authenticated the client identity, the JWT names its worker binding, the machine identity names a live registration, the claim of the execution names that worker binding and that instance, the claim is live, and the node of the claim is the node of the operation.
A break at any link refuses the operation.
The facility consults custody after the check, so a refusal reads no ciphertext.

## The use of a secret

Custody exposes `use(grant, request)`.
The request names the operation and its parameters, and it names no destination.
Custody derives the destination from the binding that the grant checked, so a caller reaches no remote of its own choice.
Custody performs the operation, and it returns the result of the operation and no material.
The material leaves the server only through a credential handover.
A child process that the server spawns, configures and reaps is part of the server, so the material that reaches `git` stays inside the server.
The material enters no log record, no workspace file, no transcript, no tool result and no error body.
`pino` redacts the paths of the material, and a test asserts each path.
Custody fills its plaintext buffer with zeroes when the operation returns.
That cleanup is best effort, because a parsed string and a cached token outlive the buffer in this runtime.
[worker-service.impl.md](worker-service.impl.md) owns the trust boundary of the host, including the host of every `worker` application.
Custody defends the material against a record of the system, and it defends nothing against a party that controls that host.

## Presigned storage grants

Custody mints a presigned storage grant inside `use` after the protected facility authorizes the operation.
Custody derives the endpoint, bucket and credential from the storage binding.
The Mission Service supplies the server-generated object key, never an agent-selected destination.
A PUT grant authorizes one object upload and expires after 1 hour.
It requires the checksum header only when begin supplies a SHA-256.
Custody also provides the object metadata check for complete and a presigned GET for an authorized reader's kanthord component.
The GET addresses the recorded version when one exists.
Each grant authorizes one operation on one object for a bounded time.
The API answer carries the URL directly to the component, never through the credential handover.
The storage credential stays in server custody at every placement and every co-location.
The component keeps the grant outside the context of an agent.
kanthord cannot prove that a harness keeps it out of the model context; the single-object scope bounds that risk.

Tests assert authorization before custody use and derive the destination only from the checked binding and server-generated key.
Tests assert the 1 hour PUT expiry, optional checksum header and authorized GET for the recorded object version.
Tests assert that no storage credential or presigned URL enters the handover, logs or agent context.
Tests refuse grants for unauthorized readers or executions without a live claim.

## The credential store of an execution

- Custody implements the `CredentialStore` contract of `@earendil-works/pi-ai` at 0.86.0: `read(providerId)`, `list()`, `modify(providerId, fn)` and `delete(providerId)`.
- A provider account binding names its pi provider id from `getBuiltinProviders()` of `@earendil-works/pi-ai` at 0.86.0, or the id `openai-compatible`. The write and the resolution reject an unknown id.
- Custody builds one store view for each execution. `read(providerId)` maps the pi provider id of the agent's provider account binding to the one credential store record that the binding names. It answers `undefined` for every other id, and the store holds one credential per pi provider id.
- `list()` returns the one non-secret pair of provider id and credential type. `modify()` serializes on the record and writes the result of pi-ai in place. The view refuses `delete()`.
- At the `server` placement the view reads custody directly and the plaintext never leaves the process.
- At the `worker` placement the view is the decrypted handover.
- Custody drops the view when the execution ends.

The resolution builds a custom provider from the resolved revision.

- It calls `createProvider` with the id `openai-compatible`, the binding name as its name and the base URL of the binding.
- It supplies `auth: { apiKey: envApiKeyAuth("<binding name> API key", []) }` and `api: openAIResponsesApi()`.
- The environment variable list is empty, so the key comes only from the custody record that the provider account binding names.
- Each model of the binding becomes a pi model with `provider: "openai-compatible"` and the base URL of the binding.
- The model carries `api: "openai-responses"`, its `contextWindow` and its `maxTokens`.
- Its `reasoning` defaults to `false`, its `input` defaults to `["text"]` and its cost rates are zero.
- The model list goes to `createProvider`, and `setProvider` registers the provider.
- The resolution builds the models rather than reuses them, because a request uses the base URL of its model.
- Every model of `OPENAI_MODELS` carries `provider: "openai"` and `baseUrl: "https://api.openai.com/v1"`. Its reuse sends the request and the key to OpenAI.

## The credential handover

- The handover is the answer of `worker.handover` of the Worker Service, which [worker-service.impl.md](worker-service.impl.md#the-credential-handover) declares. This `client` operation has `unary` lifetime and requires a live execution.
- The payload holds the canonical JSON list of the platform key and the provider credential that the execution requires.
- Each entry holds its record identity, its pi provider id or its git platform, and its pi-ai credential.
- The envelope uses AES-256-GCM under `HKDF(masterKey, info = "handover/aes-256-gcm/v1")`, a 12-byte random nonce and a 16-byte tag. The additional authenticated data concatenates the length-prefixed execution identity and runtime identity of the instance.
- The value contract of [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) names the handover as one of the two operations whose answer carries credential material.
- The `worker` application holds the same `masterKey` and derives the same key.
- The report uses `worker.credential`, a `client` mutation that requires a live execution. Its body holds one refreshed credential under the same envelope, and its handler writes the record in place.
- Custody marks a record as handed over while a live execution at the `worker` placement holds it. It refreshes no such record itself, and the mark ends with the execution.
- Two executions may hold one record at once. The epic determines whether each provider rotates the refresh token on refresh and invalidates the other holder.
- Custody emits one log record on each handover and report, naming the execution identity and the record identity and no material.
- `pino` redacts the payload paths, and a test asserts each path.

## The OAuth login

- Custody runs `models.login(providerId, "oauth", interaction)` of `@earendil-works/pi-ai` at 0.86.0 over its own credential store. The credential lands in a `credential` record through `modify` and never leaves the server.
- A login session is a runtime record of the Project Service with identity `login_session_<ulid>`, provider id, mode and the initial human identity. It holds the credential name and the remote identity that the human names for the credential store record. It also holds its state, emitted address and code, failure reason and expiry. The expiry falls 15 minutes after the start.
- The interaction adapter answers a `select` prompt with the session mode, `browser` or `device_code`. It fails the session for an option outside those two. It records an `auth_url` notification as the address and a `device_code` notification as the code and address. It records `info` and `progress` notifications as the last message of the session. It suspends a `manual_code`, `text` or `secret` prompt until the second operation supplies the value. It fails the session when the expiry arrives first.
- All operations use the `human` access policy. `project.credential.login` is a `unary` mutation with provider id, mode, credential name and remote identity as input. Its output holds the session identity, address, code and expiry. `project.credential.login_code` is a `unary` mutation with session identity and value as input. It answers 409 when the session awaits no value. `project.credential.login_status` is a `unary` read keyed by session identity. It returns state, last message and failure reason. A provider that offers one mode ignores the input mode.
- The login operation checks the credential name at the start and at the commit under [the credential store record](#the-credential-store-record) rule. A taken name answers 409 `project.credential.name_conflict` with the holder identity in `error.details`.
- In browser mode, pi-ai opens a callback listener on the server host loopback for the duration of the session. OpenAI Codex uses `127.0.0.1:1455`, and Anthropic uses port `53692`. The environment variable `PI_OAUTH_CALLBACK_HOST` changes the host. The server sets no `PI_OAUTH_CALLBACK_HOST`. The listener belongs to pi-ai and serves no kanthord operation. The Gateway registers no route for it. A browser on the server host completes the callback. A browser on another machine fails it, and the human returns the redirect URL or code through `project.credential.login_code`.
- The device mode needs no listener. pi-ai polls the provider until success, failure or expiry.
- Custody holds at most one pending session per provider id and human identity. A second start answers 409. A completed session writes the record and ends. The session record holds no token at any time.
- Every operation outputs the address and code in plain text because the human needs them. It outputs no token. `pino` redacts nothing of the address and code and everything of the credential.

## The acquisition grant

- The operation is `project.acquisition_grant`, a `unary` mutation under the `service` access policy, reachable through the direct adapter alone. Its input holds the source binding identity, the kind from `webhook-register`, `poll` and `stream-open`, and the subscription identity. Its caller is the service identity of the Intake Service, and the facility refuses every other service identity for this operation.
- The facility resolves the source binding to its project and credential record. The source binding configuration names that record for its platform. The facility checks the disablement of the binding and refuses a disabled or removed binding.
- The answer holds the grant identity `acquisition_grant_<ulid>`, the acquisition material, the platform, the remote identity of the record and the expiry. The acquisition material is the record's pi-ai credential value or platform token. The value contract of [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) names this operation as one of the two whose answer carries credential material. [intake-service.md](intake-service.md#boundary) requires that material in the memory of the Intake Service. For `webhook-register`, the answer also holds the current verification secret of the source binding. The log and the idempotency component redact the answer, and no HTTP route reaches the operation.
- The table `project_acquisition_grant(id, project_id, source_binding_id, subscription_id, kind, service, credential_id, issued_at, expires_at, ended_at, end_reason)` records every grant. `end_reason` is one of `session_end`, `binding_disabled`, `binding_removed`, `credential_rotated`, `expired`. The row holds no material.
- The code fixes the maximum lifetime at 24 hours from `issued_at`, and a sweep every minute ends an expired grant.
- A grant ends through `project.acquisition_grant_end`, a `unary` mutation under the `service` policy. The Intake Service calls it with the grant identity when its session ends, and the facility writes `session_end`.
- The facility revokes a grant when a binding set edit commits a disablement or removal of its source binding. It also revokes the grant when the material of its credential record changes and at its expiry. The revocation writes `ended_at` and `end_reason` in the same transaction as the cause where one exists. After the commit, the facility calls `intake.grant_revoked` of the Intake Service with the grant identity and the reason. That operation is a `unary` mutation under the `service` policy. The facility retries a lost answer with backoff until the Intake Service acknowledges, because the Intake Service closes the acquisition at once on receipt.
- The facility refuses `use` for an acquisition grant, because the Intake Service performs its acquisition itself with the material.
- A registration of a webhook, a poll and a stream open each consume one grant of their kind. A subscription holds at most one open grant at a time.

## The network git operations

Custody performs a network git read and a network git write through the repository connector of the Worker Service, which runs the git CLI.
Custody requires git 2.40 or later and OpenSSH 9.0 or later on the host, and it stops the start when the host holds neither.
It passes no secret on the command line of a child, because the command line of a process is readable by every user of the host.

- Custody supplies no material for git.
- The `git` child inherits the SSH environment of the user that runs the hosting application.
- That environment includes `SSH_AUTH_SOCK`, and SSH uses the host files `~/.ssh/config` and `~/.ssh/known_hosts`.
- Custody sets no `GIT_SSH_COMMAND` and no `GIT_SSH`.
- At every repository binding write, custody runs one `git ls-remote` of that repository through the repository connector.
- The read precedes the `BEGIN IMMEDIATE` transaction.
- A deadline of 30 s bounds that read.
- A failed or timed-out read refuses the write with the error code `project.bindings.repository.ssh_unreachable`.
- Custody attributes a network git operation to no credential record.

## The platform action

Custody attaches the credential to the request of a platform implementation inside `use`.
An api key of a git platform travels in the `Authorization` header of that request, and custody builds that header and returns it to no caller.
Custody mints no token and caches no token for a platform action, because that capability uses an API key in the first version.
A request that the remote refuses fails the operation closed, and custody records the failure against the record.

## The provider check

- `project.provider.check` is a server-wide read operation with `human` access, no project and no binding.
- Its route is `POST /api/project/provider/check`, and its body is `{ baseUrl, credential }`.
- The base URL scheme is `https` or `http`. A query or a fragment is invalid input.
- Custody builds the `Authorization: Bearer` header inside `use`, caches nothing and records the call against the record.
- The server calls `GET <baseUrl>/models` with a 10 s deadline.
- HTTP 200 holds `connection` with one of four values.
  - `ok`: the remote returns the OpenAI list shape.
  - `unauthorized`: the remote returns 401 or 403.
  - `unreachable`: a network failure or the deadline prevents the answer.
  - `invalid_response`: the answer does not have the OpenAI list shape.
- The answer holds `models` only with `ok`. Each model holds `id`, `ownedBy` and `created`.
- HTTP 400 answers invalid input or a record type other than `api_key`.
- HTTP 404 answers an unknown credential.
- The answer holds no key material.
- The check pre-fills model ids only. The OpenAI answer holds `id`, `object`, `created` and `owned_by`, not model limits.
- The human enters `contextWindow` and `maxTokens` at review.
- The human configures the base URL and the credential record, checks for `ok`, approves models and submits the binding.

## The resource healthcheck

The [resource healthcheck rule](architecture.md#resource-healthcheck) governs the checks that the Project Service owns.
The [Gateway Service](gateway-service.impl.md#the-resource-healthcheck-report) bounds the checks and groups their entries.

- A GitHub platform API key record reads `GET /rate_limit` with its credential.
- This call spends no rate limit and reports the capability `rate-limit read`.
- A provider account binding reads `GET /models` of its provider with its credential.
- It reuses the model-list call of [the provider check](project-service.impl.md#the-provider-check), not its API-key-only input contract.
- The call spends one request and no inference token, and it reports the capability `model-list read`.
- A repository binding runs the SSH read of [the network git operations](project-service.impl.md#the-network-git-operations).
- That read answers `project.bindings.repository.ssh_unreachable` on failure and reports the capability `network git read`.
- The resource healthcheck deadline replaces the binding-write deadline for this read.
- The target rule permits one read per repository address in a request.
- A check never refreshes an OAuth record.
- An OAuth record whose access token is expired reports `unknown` without a remote call.
- Custody records each credential check call against the credential store record, as in the provider check.
- The network git operation keeps its existing attribution rule.
- The call record holds no check result.

## The model inference call

Custody serves the model inference call through the credential store of the execution.
[worker-service.impl.md](worker-service.impl.md) owns the runtime that consumes it.

## The client identity

The Project Service holds no table of client identities and no secret of a client identity.
[gateway-service.impl.md](gateway-service.impl.md#the-jwt) generates the client identity inside a machine JWT, and its verification asks the Project Service whether the worker binding of that JWT exists and is available.
The answer resolves the project of the worker binding from the current revision of the binding configuration.

## The verification of a delivery

The delivery route is `/hooks/<binding id>`, inside the path group that [gateway-service.impl.md](gateway-service.impl.md) reserves.
The path names the binding, because a signature does not say which source sent the delivery, and a binding identity is unique across the server.
The path holds no secret.

Custody exposes `verifyDelivery(sourceBindingId, bytes, headers)`.
The function derives the verification secret of that source binding, and it reads no stored secret.
The configuration of the source binding holds one integer, `webhookSecretRotation`, which enters the derivation.
An increment of that integer produces a new secret and creates a revision of the binding, and a human pastes the new value at the platform.
A `GET` route of the source binding returns the current secret, so a human reads it again at any time. `GET` is no mutation, so the idempotency middleware of the Gateway Service records no secret.
For a GitHub delivery the function requires exactly one `X-Hub-Signature-256` header.
It rejects a missing header, a duplicate header, a value without the `sha256=` prefix, a value that is not hexadecimal and a value of another length, before any comparison.
It computes the HMAC with `crypto.createHmac` and SHA-256 over the exact bytes, and it compares two 32-byte digests with `timingSafeEqual`.
The signature of the platform over the exact bytes stays the proof of authenticity of a delivery, which [gateway-service.impl.md](gateway-service.impl.md) requires of an untrusted ingress.
[gateway-service.impl.md](gateway-service.impl.md) states that the Gateway Service passes the exact bytes, so the function re-serializes nothing.
The function names no requester identity, and it returns a boolean and no secret.
A valid HMAC proves the possession of the secret alone.
It authenticates no other header, it establishes no repository, and it detects no replay.
The GitHub implementation of [worker-service.impl.md](worker-service.impl.md) associates the payload with its repository, and the Scheduler Service owns the duplicate effect of a repeated delivery.
This sibling states no replay window.

## Repository layout, build, test and release

The Project Service source sits under `src/project/` of the `engine` repository.
A test file sits beside its source as `*.test.ts`.
`node --test` runs the tests.
`tsc -p tsconfig.build.json` builds into `dist/`.
The `kanthord` bin of `package.json` releases it.

## Tests

- A test covers a credential create and an OAuth login with a taken credential name. It asserts 409 `project.credential.name_conflict` and the holder identity in `error.details`. It checks the login refusal at the start and at the commit.
- A test covers a credential create retry after a restart. It asserts one credential store record for the credential name.
- A test covers a rotation. It asserts that the credential name and the remote identity stay unchanged.
- A test covers a creation and a rename to a taken project name, and it asserts 409 with the identity of the holder.
- A test covers a project creation whose mission insert fails, and it asserts that no project row remains.
- A test covers SSH-only coverage and suitability for every type, capability and provider. It refuses an absent platform key and an HTTPS repository address.
- A test covers the provider and model catalogs at the write and the resolution.
- A test covers the custom provider build. It asserts the base URL on every model, zero cost rates and the empty environment variable list.
- A test covers every provider check answer, status and model field. It asserts the deadline and the absence of key material.
- A resource healthcheck test asserts the GitHub rate-limit read with the record credential and no other call.
- A test asserts the provider model-list read with its credential and no inference call.
- A test covers successful reads, remote refusals and invalid answers, and checks the resource status and capability.
- A test asserts one SSH read per repository address, its failure code and the resource healthcheck deadline.
- A test covers an expired OAuth access token and asserts `unknown`, no remote call and no refresh.
- A test asserts the custody call record and no stored check result.
- A test asserts that the repository check names no credential store record in its attribution.
- A test covers the write-time call for each added or changed custom provider before the transaction. It asserts both error codes and their details.
- A test asserts no call for an unchanged custom provider and no network call at resolution.
- A test covers built-in account case preservation and custom-provider host normalization. It checks replacement against revision for each base URL part.
- A test covers the reasoning-effort check against the effective model at the write and the resolution.
- A test covers integer instance counts from 0 to 64, invalid counts and the error code. It checks that 0 makes the binding unavailable.
- A test covers the project prompt bound in UTF-8 bytes and its error code.
- A test covers both GitHub actions, their capabilities and their implied expected end states. It refuses more than one action.
- A test covers each of the five changes, and it asserts the revision that each one creates.
- A test covers a disablement that takes effect at the next resolution, and a consumed grant that authorizes no second operation.
- A test covers an omitted name, a name whose resource changed, a set that references a name absent from the submission, and a dependent reference that follows a new identity under its name.
- A test covers a worker change under the same name, and it asserts that the write refuses the change.
- A test covers the reuse of a name after its removal.
- A test covers a stale binding-set version and a submission equal to the stored set.
- A test covers two concurrent writes of one binding set, and it asserts that the second one is refused.
- A test covers a reordered JSON property that creates no revision.
- A test covers a resolution of the whole dependency chain, and it asserts the recorded revision of each member.
- A test covers the derivation of a webhook secret, and it asserts that two labels produce two different secrets.
- A test covers a `masterKey` that decodes to other than 32 bytes.
- A test covers an execution identity that names another node, a machine identity that names no live registration, and a client identity whose worker binding is not the worker binding of the claim.
- A test covers a repository binding whose network git read fails. It asserts that the Project Service refuses the write with its error code.
- A test covers a worker binding that is absent, removed or unavailable, and it asserts that the verification of a machine JWT that names it fails.
- A test covers a missing, a duplicate, a malformed and a wrong-length delivery signature, and a valid signature over the exact bytes.
- A test covers an increment of `webhookSecretRotation`, and it asserts that a delivery signed with the previous secret fails.
- A test asserts that no log record and no error body holds secret material.
- A test covers the round trip of a handover envelope, a payload moved to another execution identity, and a truncated payload.
- A test covers a store view that answers `undefined` for a provider id outside the binding of the execution. It covers a refresh through `modify` that updates the row in place and creates no revision.
- A test covers a report of a refreshed credential for an execution that is not live, and it asserts 403.
- A test covers a login session in device mode against a scripted pi-ai provider. It asserts the output address and code, completion and stored record.
- A test covers a browser login session whose callback never arrives. It supplies a value through the second operation and asserts completion.
- A test covers a second start for the same provider and human, and it asserts 409.
- A test covers an expired session, and it asserts the state `expired` and no record.
- A test asserts that no output and no log record of a login session holds a token.
- A test covers an acquisition grant for a disabled source binding, and it asserts the refusal.
- A test covers a binding set edit that disables a source binding with an open grant. It asserts the `binding_disabled` row and the revocation call.
- A test covers a grant beyond 24 hours, and it asserts the `expired` row and the revocation call.
- A test asserts that the answer of `project.acquisition_grant` reaches no HTTP route and appears redacted in every log record.
- A test covers a call of `project.acquisition_grant` under the service identity of the Scheduler Service, and it asserts the refusal.

## Open decisions of an epic

- The shape of the RESTful API of the binding set, which [gateway-service.impl.md](gateway-service.impl.md) registers as routes.
- The replacement of `masterKey`, which makes every stored ciphertext unreadable and every webhook secret stale, and which no command performs today.
- The record of the failure of a credential.
- The model-list read of a built-in provider whose API offers no model list, or whose OAuth account rejects it.
- The rotation behaviour of the refresh token of each OAuth provider under two concurrent holders.
