---
title: Architecture Implementation
---

# Architecture Implementation

This file holds the implementation rulings for the mechanisms that realize [architecture.md](architecture.md).
This file is not a design document, and `architecture.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the startup of the server.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.

## Named comparison values

- Every comparison against a fixed string or numeric value uses an enum member or a named constant, never a bare string or number literal.
- This rule covers equality and inequality checks, ordering and threshold checks, `switch` cases, and test assertions.
- The name expresses the meaning of the value, not merely its text or number. The owning module declares it, and callers reuse that declaration rather than duplicate the literal or define competing constants.

## The runtime

- The supported range of Node.js is `>=24.15.0 <25`. The floor is the version that the installed set needs, and the ceiling excludes a major that no human tested.
- A later major enters the range by a deliberate edit after a test.
- `engines` of `package.json` carries the same range. Its enforcement depends on the package manager and its settings, so it is a declaration and no gate.
- The gate is the launcher of the `kanthord` bin. It compares `process.versions.node` with the range, it prints one line to standard error for a version outside it, and it exits with a non-zero status.
- The launcher imports the real entry with a dynamic import, because a static import loads a module before the comparison runs.
- The launcher uses only syntax that a runtime below the floor parses, so a rejection reaches a human instead of a syntax error.
- Every supported launch route passes through the launcher. A route that runs a source entry directly is a development convenience and no supported route.

## The listening ports

The submodules use these default listening ports.

| Submodule | Port | Meaning |
| --- | --- | --- |
| `engine` | `31415` | The first five digits of π (pi), `3.1415`, with the decimal point removed. |
| `apps` | `27182` | The first five digits of Euler's number e, `2.7182`, with the decimal point removed. |

The [Gateway Service configuration](gateway-service.impl.md#configuration) declares the engine listener settings.

## The configuration file

- The server reads one configuration file in YAML.
- `yaml` at 2.9.0 parses the file, and `convict` at 6.2.5 receives that parser through `convict.addParser` for the `yaml` and the `yml` extension.
- The parser rejects a duplicate key and a second document, so the file is one mapping document.
- This file replaces `kanthord.config.json` of the engine checkout, which the repository ignores, and the implementation epic deletes that local file.

## Schema and validation

- One `convict` schema declares every field with its documentation, its format and its default.
- The server calls `validate({allowed: "strict"})` at startup, so an undeclared field stops the start.
- `convict` is the configuration mechanism of the server, and `zod` stays the request-validation mechanism of the Gateway Service.
  This is because a request arrives at each call and the configuration arrives once.

## The directories of the server

- The server follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/).
- It derives four directories, and each one is the `kanthord` subdirectory of a directory of the specification.
- The configuration directory is `kanthord` inside `XDG_CONFIG_HOME`, and that variable defaults to `$HOME/.config`.
- The data directory is `kanthord` inside `XDG_DATA_HOME`, and that variable defaults to `$HOME/.local/share`.
- The state directory is `kanthord` inside `XDG_STATE_HOME`, and that variable defaults to `$HOME/.local/state`.
- The cache directory is `kanthord` inside `XDG_CACHE_HOME`, and that variable defaults to `$HOME/.cache`.
- A variable of the specification that holds a relative path is invalid, so the server uses the default of that variable.

## The kind of file of each directory

- The configuration file uses the configuration directory.
- A database uses the data directory, including the operational database used by the Gateway Service.
- A log, a history and a session record use the state directory.
- A rebuildable artifact uses the cache directory, because the deletion of that directory costs nothing.
- The state directory holds the per-operation socket directory of custody, which [project-service.impl.md](project-service.impl.md) rules, and it holds the log file under the `file` destination.
- The server writes no file in the cache directory today.
- A later mechanism places each of its files by this rule, and it adds no directory of its own.

## The file index

- Every file that the server or its CLI owns appears below with the sibling that holds its declaration. A row gives no mode, no schema and no retention, because the permissions section, the log section and the custody section hold those.
- A row is a default expansion, an effective path or a path template. A variable of the specification moves a default expansion, the resolution rule of the configuration file selects an effective path, and a runtime identity completes a path template.
- `kanthord.yaml` of the configuration directory, an effective path that this sibling declares. Its default expansion is `$XDG_CONFIG_HOME/kanthord/kanthord.yaml`, and the default of that variable makes it `~/.config/kanthord/kanthord.yaml`.
- `kanthord.db` of the data directory with its `-wal` and `-shm` files, a default expansion of `$XDG_DATA_HOME/kanthord/kanthord.db` that this sibling declares.
- `tracking.db` of the data directory, a default expansion that [tracking-service.impl.md](tracking-service.impl.md) declares.
- The known-hosts file of the server, of the data directory, a default expansion that [project-service.impl.md](project-service.impl.md) declares.
- `kanthord.log` of the state directory, a default expansion that this sibling declares under the `file` destination of the log.
- The per-operation directory of custody and the public key inside it, of the state directory, a path template that the identity of the operation completes and that [project-service.impl.md](project-service.impl.md) declares.
- `cli.yaml` of the configuration directory, a default expansion that this sibling declares under the client configuration. The CLI owns that file, and the server reads it never.
- The index holds no row for the workspace root of an execution, because no page places it.
- The index holds no row for the local store of an external harness, because that store sits on the machine of the harness and in no directory of the server.

## The operational database

- The server holds one operational database, the file `kanthord.db` of the data directory.
- The Gateway Service, the Project Service, the Mission Service and the Scheduler Service use that database.
- The Tracking Service uses its own file, and [tracking-service.impl.md](tracking-service.impl.md) rules that file, its migration record and the phase in which it appears.
- `node:sqlite` `DatabaseSync` opens the operational database in WAL mode, and one store module owns that connection.
- A service owns its own tables, and it reads no table of another service.
- The name of a table carries the prefix of its service, so no two services collide.
- A table that more than one service uses carries no prefix. It names one owning service, and every other service reaches a row through that service and never through a read of the table.
- The table `credential(id, type, remote_identity, nonce, ciphertext, created_at, updated_at)` is such a table. The Project Service owns it through custody, and the section below rules its envelope.
- The table `migration(service, version, applied_at)` records each migration that ran.
- The migrations run at startup, in a fixed order of the services.
- One file gives a write of two services one transaction, because a transaction across attached files holds no atomic commit in WAL mode.

## The connection and the transaction

- The server opens each database file with `locking_mode=EXCLUSIVE`, and it sets that pragma before the first read of the file, because SQLite fixes the mode at that point.
- It takes the write lock of each file before the migrations run.
- A start that meets `SQLITE_BUSY` stops with a non-zero status and prints the path of the file, so one server owns the data directory and a second start fails instead of sharing it.
- No external tool reads a database file while the server runs, so an inspection stops the server first.
- The pragma set holds no `busy_timeout`, and the server retries no statement, because one process holds one connection to each file.
- `foreign_keys` is `ON`.
- `synchronous` is `FULL`, so a commit survives a crash of the operating system. The write volume of the server makes the cost of the added `fsync` irrelevant.
- `journal_size_limit` is 64 MiB, so a large transaction leaves no large write-ahead log behind it.
- Every write runs inside a `BEGIN IMMEDIATE` transaction.
- `DatabaseSync` performs synchronous input and output, so a transaction runs inside one synchronous function and it awaits nothing.
- One transaction holds one owner, the handler of the operation. A service function that participates in that transaction receives it as an explicit caller argument, and it opens no transaction of its own and commits none.
- SQLite commits no remote effect together with its local transaction. One commit holds a change and its recorded answer inside the operational database alone, and it holds that answer only where the owning operation writes both inside one transaction.
- A remote effect that succeeded before a crash needs a reconciliation that the sibling of the owning service states. This sibling settles no such recovery.

## The migration

- Each service holds an ordered list of migrations, numbered from 1 with no gap. A migration is a function that receives the open connection and runs its statements.
- A published migration is immutable. A correction appends a migration, and it never edits a migration that a database recorded. Two divergent histories share no data directory.
- The runner validates the whole recorded history of every participating database before it applies any migration. It rejects a service that the binary does not know, a duplicate version, a gap in the recorded versions, and a recorded version above the highest version that the binary holds.
- The uniqueness of a record is the pair of the service and the version.
- The runner owns the transaction and the insert of the `migration` row, so one commit holds a migration and its record.
- A migration changes its own database alone. It performs no filesystem write, no network call and no write through a second connection, because a rollback of SQLite undoes none of those.
- A migration of one service reads no migration state of another service, so the runner needs no dependency resolution.
- The migration is forward only, and the server holds no reverse migration. A committed migration stays committed after a later failure, so the next start resumes from that prefix.
- A downgrade needs a consistent backup that a human took before the upgrade.
- That backup captures the effective configuration file and the whole data directory, with the server stopped, and neither source changes during the capture.
- A clean close checkpoints the write-ahead log and can remove the sidecar files, and `-shm` is reconstructible. A sequential copy of three live files is not consistent, so the contract names the stopped server and no list of files.
- The function form serves a data migration that runs cryptography, for example an upgrade of the envelope or of a label under an unchanged `masterKey`, where the old key stays derivable. It implies no rotation of a secret.

## The identity and the time

- A timestamp that the server defines holds a SQLite `INTEGER` of Unix milliseconds in UTC, and its field of the RESTful API holds a JSON integer.
- The value fits `Number.MAX_SAFE_INTEGER`, so no field of the server uses a `BigInt`.
- No service overrides that representation.
- One shared scalar carries the rule, and a schema that a service owns composes that scalar. The emitted description of the scalar names the epoch and the unit, because an integer alone does not distinguish a second from a millisecond.
- Neither a timestamp nor an identity establishes a causal order. A millisecond reduces a tie and removes none, a correction of the wall clock reverses an order, and a ULID promises no order inside one millisecond.
- An operation that needs a causal order uses the revision or the ordering contract of the service that owns the record.
- A duration uses a monotonic clock, and never the difference of two wall-clock timestamps.
- Every opaque identity that the server generates for an entity of its own, including a request, has the form `<prefix>_<ulid>`.
- The prefix names the entity kind in singular, lower-case words, with underscores between words. Each kind holds one stable prefix, and two kinds share no prefix, so the identity reveals what it identifies.
- A request uses `request_<ulid>`, a project uses `project_<ulid>`, and a mission uses `mission_<ulid>`. Every other entity kind follows the same rule, and the implementation sibling of its owning service declares its prefix.
- The `<ulid>` portion is a ULID in its canonical 26-character uppercase form, and `ulid` at 3.0.2 generates that portion.
- The complete prefixed identity is stored as text and retained in API fields, references and logs. Validation checks both the expected entity prefix and the canonical ULID portion; a bare ULID or a prefix of another entity kind is invalid.
- That convention covers an opaque entity identity alone. It excludes a protocol-defined identity, a natural key and a composite key.
- A protocol-defined representation stays with its protocol, and the sibling of the service that speaks that protocol names the representation.
- A remote identity follows the normalization of [project-service.impl.md](project-service.impl.md), which derives it from the binding configuration on every write.

## The canonical form and the digest

- Canonical JSON is [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
- The server sorts the member names of an object by UTF-16 code unit and emits the members itself. It writes the opening brace, then the quoted name, the colon, the canonical value of the member and the separating comma, then the closing brace.
- The server never rebuilds an object and calls `JSON.stringify` on it, because JavaScript enumerates an array-index name numerically, so a member name of `10` reaches the output after a member name of `2` and the bytes stop conforming.
- It uses `JSON.stringify` for a string and for a finite number, because that function already produces the form that the specification requires.
- The accepted domain is JSON data. It admits an object, an array, a string, a finite number, a boolean and `null`.
- It rejects `NaN`, `Infinity`, `undefined`, a lone surrogate in a string or in a member name, a sparse array, and an object that carries `toJSON`.
- The function accepts a validated JSON value and no JSON text, because `JSON.parse` discards a duplicate member name before a check can see it. The ingress validation of a route owns the text.
- A digest reads exact bytes. Canonical JSON reaches it as UTF-8, with no byte-order mark and no trailing newline.
- The algorithm is SHA-256 through `crypto.createHash`, and the text rendering of a digest is lower-case hexadecimal.
- This convention replaces no binary credential hash of [project-service.impl.md](project-service.impl.md) and no protocol-defined representation.
- [mission-service.md](mission-service.md) stays authoritative for the content address of evidence, and this section states no second algorithm for it.

## The credential table

- `credential` holds one record for one secret, and it holds no project identity, because a record serves more than one project.
- Several services use a credential, and each one reaches a record through the Project Service, so the envelope of this table is a server-wide mechanism and no mechanism of one service. The Project Service authorizes the use of a record.
- The column `type` is an opaque string at this level. The service that registers a type owns its meaning, and [project-service.impl.md](project-service.impl.md) names the types of the Project Service.
- The column `remote_identity` records the identity that the secret acts as at its remote. The server enforces nothing from it, so it sits outside the authenticated data below.
- `crypto.createCipheriv` encrypts the material with AES-256-GCM, a 12-byte nonce from `crypto.randomBytes` and a 16-byte tag.
- The plaintext is the JSON of the material of the type, so one record holds several fields under one ciphertext.
- The column `nonce` holds the nonce as 12 bytes, and the column `ciphertext` holds the ciphertext followed by the 16-byte tag. A read that meets another length fails the record.
- The additional authenticated data is the concatenation of two length-prefixed fields, the record identity and the type, so the encoding admits no second reading.
- `createDecipheriv` verifies the tag before any caller reads the plaintext.
- The cipher key is `HKDF(masterKey, info = "custody/aes-256-gcm/v1")`. The server derives it at startup and holds it for the life of the process.
- A nonce is random for each write of a record, and the count of the writes of this server stays far below the birthday bound of a 12-byte nonce.
- AES-256-GCM detects a modified record and a record moved to another identity. It detects no restoration of an older valid record under the same identity, so the server claims no freshness.
- The record carries no version of the cipher and no version of the key, because one key and one envelope serve every record. A change of either one re-wraps every row in one transaction at the first start of the new binary, and a tag failure identifies a row that the change did not reach.
- A backup of the operational database is useless without the configuration file of the same server. The encryption protects a copy of the database that carries no configuration file, and it protects nothing against a party that holds both files or that controls the host of the server.

## The path of the configuration file

- The server resolves the path in this order: the `--config` option, the `KANTHORD_CONFIG` environment variable, then `kanthord.yaml` inside the configuration directory.
- A relative value of the `--config` option and a relative value of `KANTHORD_CONFIG` resolve against the working directory of the process, so the resolution gives an absolute path.
- A relative path inside the configuration file resolves against the data directory.

## Precedence

- A value resolves from the file, then from the default of the schema.
- No environment variable and no command-line option sets a value. The environment locates the file and its directories, and the file configures the server.
- The CLI parses the command line with `commander` at 15.0.0, and `--config` is its one option that reaches the configuration.
- `KANTHORD_CONFIG` and the four variables of the specification keep their role, because each one locates a path and sets no value.

## One source for a secret

- A secret field declares no usable default, so no default supplies a secret.
- The file is the only source of a value, so it is the only source of a secret.
- An absent secret field stops the start, so no other source supplies a secret silently.

## The server writes no configuration file

- The server reads the configuration file and writes it never.
- An absent file stops the start, and the server prints the resolved path and the command of the CLI that creates one.
- An invalid file stops the start, and the server prints one record for each invalid field.
- Each of those two starts exits with a non-zero status.
- Neither the start of the server nor a command of the CLI repairs a file.
- This rule covers the configuration file.
  The server writes its databases. JWT issuance is an explicit local command, which [gateway-service.impl.md](gateway-service.impl.md#local-jwt-issuance) rules.

## Permissions and the opened file

- A regular file that the server owns holds mode `0600`, a directory holds mode `0700`, and a socket holds mode `0600`.
- The owner of every such object is the running user, and a setuid bit, a setgid bit and a sticky bit are rejected.
- The mode is exact, so a mode wider than the stated mode and a mode narrower than it both stop the start.
- The audit set names each target with its expected type. It holds the configuration file, the configuration directory, the data directory, the state directory, and every file that the expansion of a row of the file index gives, including the `-wal` and the `-shm` file of a database.
- The server infers the expected type from nothing that it finds, so a directory at the path of a database stops the start even when that directory holds a valid directory mode.
- The audit uses `lstat`, so a symlink at an audited path stops the start.
- Absence is accepted only where the owning mechanism permits a creation or a nonexistence. The configuration file must exist.
- An operation reuses no existing per-operation directory, so a directory that a crash left behind authorizes no reuse and blocks no start.
- The server establishes umask `077` before it creates any owned object and before it launches any child, and it changes that umask never during an operation.
- A call that receives a mode is still masked, so `open` with `0600` and `mkdir` with `0700` both survive that mask.
- Where a call takes a mode, the server passes it. Where a call takes no mode, the server names the barrier: it validates an existing database file before it opens the database, and it checks the created file and each sidecar at the point where that file first appears.
- The server opens the configuration file with the `O_NOFOLLOW` flag, checks the mode with `fstat` on that descriptor, and reads the same descriptor, so no replacement of that file happens between the check and the read.
- The logger receives the same descriptor that passed its validation, opened for append and without truncation, so the logger opens no pathname of its own.
- A failed validation of a reopen of the log starts the stop, and the server changes no configured destination of its own.
- The server repairs no owned object, so it changes no mode and no owner of an object that it did not create in that step.
- The server checks an audited object and not the ancestry of its path. An untrusted ancestor, and a concurrent replacement of a directory of that path, sit outside the supported configuration. The checks apply on a POSIX filesystem, and the server states that assumption.

## Reload

- The server reads the file at startup only.
- A change of the file takes effect at the next start.

## The sections of the file

- The file holds the shared section `log` and the field `masterKey`, and one section for each service, named by that service.
- The schema holds no directory field, because the specification and its variables carry that override.
- This sibling names the fields of the shared section, and the implementation sibling of a service names the fields of the section of that service.
- This sibling indexes every field of every section, and the owning sibling holds the format and the default of each field that it declares.
- This is the configuration of the server process.
  It is not the project configuration that `overview.md` describes.

This sibling declares the fields below.

- `log.level` holds the level of the `pino` logger, as one of `trace`, `debug`, `info`, `warn`, `error` and `fatal`, and it defaults to `info`.
- `log.destination` holds the destination of the log, as one of `stderr` and `file`, and it defaults to `stderr`.
- `masterKey` holds 32 bytes encoded in base64, it carries `sensitive: true`, it holds no default, and the format rejects a value that decodes to another length.

`masterKey` is the one secret of the server.

- A service derives every key that it needs from `masterKey`, and it uses `masterKey` directly for nothing.
- The derivation is `crypto.hkdfSync` with SHA-256, an empty salt and one label for each purpose.
- A label is unique across the server.
- The implementation sibling of a service names a label of that service, and this sibling names a label of a server-wide mechanism.
- The Gateway Service derives its JWT signing key, and the Project Service derives every webhook secret of a source binding.
- The server derives the record cipher key of the `credential` table, because the envelope of that table is a server-wide mechanism.

## The field index

- Every field of the configuration file appears below with the sibling that owns it. A row gives no format and no default.
- A dotted path determines the nesting of the document, so the index determines the shape of the file.
- `kanthord config init` writes the whole document with every default, so this sibling holds no example.
- `masterKey`, which this sibling declares.
- `log.level`, which this sibling declares.
- `log.destination`, which this sibling declares.
- `gateway.bind`, which [gateway-service.impl.md](gateway-service.impl.md) declares.
- `gateway.port`, which [gateway-service.impl.md](gateway-service.impl.md) declares.
- `gateway.allowedHosts`, which [gateway-service.impl.md](gateway-service.impl.md) declares.
- `gateway.allowedOrigins`, which [gateway-service.impl.md](gateway-service.impl.md) declares.
- `gateway.tokenLifetime`, which [gateway-service.impl.md](gateway-service.impl.md) declares.
- A row that its owning sibling does not declare is a defect, and a declaration without a row is a defect.

## The log

- `pino` at 10.3.1 writes one JSON record for each line. The server installs no pretty printer, and a human pipes the output through a printer of their own.
- Under the `stderr` destination the server writes every record to standard error.
- Standard output carries one-time human text alone, so no record of the log shares a stream with it.
- Under the `file` destination the server appends every record to `kanthord.log` of the state directory through `pino.destination`, and that file holds mode `0600`.
- The schema holds no path field for the log, because the state directory of the specification carries that override.
- A destination that the server cannot open stops the start, and the start prints the resolved path.
- `SIGHUP` makes the server reopen the destination. The reopen opens the path with `O_NOFOLLOW`, `O_CREAT`, append and mode `0600`, and the permissions section rules the validation of that descriptor.
- The server rotates no file, it deletes no file and it states no retention. The operator owns the rotation and the retention of the log.
- The log is operational, and telemetry is the product data of the [Tracking Service](tracking-service.md). No record of the log is telemetry, and no telemetry record reaches the log.

## The error codes

- Every error code that the server or its CLI defines has at least three nonempty, dot-separated parts: `<namespace>.<component>[.<component>...].<error>`.
- The namespace is the owning service name, `system` for a server-wide mechanism, or `cli` for a CLI-local failure.
- At least one component follows the namespace. A deeper location adds component parts from the broadest to the most specific, so the code identifies where the failure happens.
- The final part names the failure condition, not another component.
- Each part uses lower-case words, with underscores between words. Dots separate parts, and no part is empty.

Examples:

- `system.startup.unknown`
- `system.startup.permission_denied`
- `cli.config.not_found`
- `gateway.database.<error>`, where `<error>` is the failure condition.
- `project.bindings.llm.openai.quota_exceeded`

## The service lifecycle and Context

- Every service implements `Service`: `start()` acquires resources, `run(context)` starts and joins its lifetime, `stop()` performs graceful shutdown, and `healthcheck()` reports the components it owns.
- `start`, `stop` and `run` return `Promise<Error | null>`. Success returns `null`; failure returns an `Error` that the caller can inspect. A lifecycle failure does not reject the returned promise. A caller checks the result, and the CLI turns a failure into a non-zero exit.
- Concurrent calls to `start` or `stop` join the same operation. A stopped instance cannot start again.
- `healthcheck()` returns `Promise<Record<string, number>>`, keyed by owned component name. An integer code of `200` means healthy and `503` means unavailable. An aggregate is healthy only when its nonempty component map is entirely healthy.
- Cancellation uses the Go-inspired `Context` interface in `src/context.ts`. It exposes `deadline()` as Unix milliseconds or `null`, `done()` as a promise that resolves on cancellation, `err()` as the cancellation error or `null`, and `onCancel()` as an immediately effective, removable subscription.
- `background` is the uncancelled root. `CancellationContext` is the concrete implementation; its owner cancels it, cancellation is idempotent, a child inherits parent cancellation and the earlier deadline, and cancelling a child leaves its parent and siblings running.
- Service and component collaborators receive `Context`, not a native `AbortSignal`. Native signals are bridged at transport boundaries. The owner releases a context's subscriptions and deadline timer when its work finishes.
- A cancellation listener never throws. A throw from a listener becomes an `uncaughtException` on both paths, the registration on an already-cancelled context and the cancellation itself, so the process terminates, and every other listener of that cancellation still runs first.
- A child that inherits the deadline of its parent arms no timer of its own. The parent cancels it, so the child holds the error instance of the parent.
- Every service and component implements graceful shutdown for the work and resources it owns. Long-running work cooperates with its context; a synchronous component completes its current operation before its owner releases it.
- Shutdown first stops admission, then cancels waiting work and streams through child contexts, then joins in-flight work, and finally releases resources in reverse acquisition order. Cancellation requests a stop; it does not prove that work has finished and it undoes no committed effect.
- A cancelled `run(context)` joins cleanup before returning its cancellation error. Explicit `stop()` and operating-system shutdown signals return `null` after successful cleanup. A cleanup failure takes precedence over cancellation, and all remaining releases still run.
- A service owns the stop of its components. It keeps shared resources alive until every component using them has drained; in particular, the gateway drains before the server closes the store and the log.

## The start and the stop

The start runs the steps below in this order. Each step names the sibling that owns its mechanism, and this sibling owns the order alone.

- Resolve the path of the configuration file, then read that file.
- Validate the document with `validate({allowed: "strict"})`.
- Derive the key of each purpose from `masterKey`, where the sibling of a service owns the labels of that service.
- Open the destination of the log.
- Take the write lock of each database file.
- Run the migrations, in a fixed order of the services.
- Sweep the dead idempotency records and the expired entries of the session denylist, which [gateway-service.impl.md](gateway-service.impl.md) owns.
- Register the routes of every service, which [gateway-service.impl.md](gateway-service.impl.md) owns.
- Open the listener.

The barriers of the start are below.

- The migrations complete before a service reads a table.
- Every registration completes before the server admits a request.
- The listener binds before the server admits a request. Startup issues and displays no JWT and requires no terminal.

A failed start exits as below.

- A step that fails stops the start. The server prints one diagnostic, and the process exits with a non-zero status.
- The server releases every resource that it acquired, in the reverse order of the acquisition. The close of a database file releases its exclusive lock.
- A failure of one release does not skip the remaining releases.
- A signal that arrives during the start enters this path.
- The cleanup is no rollback. It undoes no committed transaction and revokes no JWT that already reached its recipient.

The stop runs as below.

- `SIGINT` and `SIGTERM` start the stop, and the deadline of 10 s starts with it. The deadline holds the event loop, so an empty loop exits the process never before the deadline.
- The server stops the admission of a request, and that step waits for no connection to drain.
- It cancels every waiting work pull and every MCP stream through `Context`.
- It joins the handlers in flight inside the remaining deadline.
- The store module that owns a connection closes that connection after the join.
- An expired deadline exits the process and closes nothing, and the exit releases every lock.
- The stop satisfies the rule of [scheduler-service.md](scheduler-service.md), because it stops every new claim and it preserves every accepted obligation.

A fatal error runs as below.

- An `uncaughtException` and an `unhandledRejection` are fatal. The termination is mandatory and the diagnostic is best effort.
- The one-process rule of [architecture.md](architecture.md) already ends every service with the process, so this states a mechanism and no new design rule.
- The server installs the two hooks before it reads the configuration file and before any service initializes. A failure before the hooks exist reaches the default behaviour of Node.js.
- The fatal path runs no stop and no failed-start release, because the state of the process is unknown.
- An expected failure of a start step keeps the reverse-order release. An uncaught failure during the start, during that release, or during the stop takes the fatal path instead.
- The fatal record holds fixed fields: the kind of the fatal event, the constructor name of the error, and the stack frames with the message line removed. It serializes no rejection reason, and a reason that is no `Error` contributes its type alone.
- The record holds no request identity, because a failure of a background step has none.
- The fatal writer uses the destination that the log already opened, with a synchronous write. A failure before that destination opened writes to standard error, which is the one exception to the destination rule.
- A synchronous write can fail, it can write fewer bytes and it can block, and its completion is no durability. The exit follows the attempt in every case, and this sibling claims no bound on the wall-clock time of the exit.
- The exit closes every descriptor, so it releases the exclusive lock of each database file. It rolls back no interrupted operation, because a transaction runs inside one synchronous function, so a committed write of that operation stays committed.
- The recovery of the remaining work belongs to the owning service. [gateway-service.impl.md](gateway-service.impl.md) sweeps an in-progress idempotency record at the next start, and a route that returns a secret replays 409 and never the lost answer.
- The server restarts nothing, and the process manager of the operator owns a restart.

## Secret material and the diagnostic contract

- A secret of the server is a field of the configuration file and no row of a database.
- Every secret field carries `sensitive: true`, so `convict.toString()` masks it.
- A diagnostic names the path of a field and the reason of the failure, and it prints no value and no excerpt of the file.
- This contract covers a parse error, a validation error, a failed start, every log record, and the `config validate` and `config show` commands.
- A display of a secret value requires a terminal on standard output. The check rejects a file and a pipe, and it detects no terminal recorder, so a recorded session is the responsibility of the operator.
- The explicit `jwt` command of [gateway-service.impl.md](gateway-service.impl.md#local-jwt-issuance) holds that exception. It prints a token only to terminal standard output and reads no terminal input.
- The exception covers that token display alone, so no diagnostic and no log record holds a secret value. `config init` writes generated secrets to the private configuration file and prints only its path.
- The CLI holds no rotation command, and the server rotates no secret.
- A rotation of a secret is a hand edit of the file and a restart of the server.
- A rotation of `masterKey` invalidates every issued JWT, so a human obtains a newly generated token. It makes every credential store record of the Project Service unreadable, and it makes every derived webhook secret stale.

## Scope

- This sibling specifies the configuration of the server process.
- This sibling specifies the command surface of the `kanthord` bin, and the implementation sibling of a service specifies the command table of its own group.
- The custody of a credential of a resource that a project binds belongs to the Project Service, and [project-service.md](project-service.md) governs it.

## The command surface

- Every CLI command is non-interactive. It declares its positional arguments and named options explicitly, including required values, validation and defaults in its help.
- A command reads no prompt, confirmation, password or other input from a terminal. Missing required arguments or options and unknown arguments or options produce a diagnostic and a non-zero exit before the command performs work.
- Documented configuration files and environment variables supply only their declared values. They never trigger an interactive fallback.
- The `kanthord` bin exposes one program, and the launcher of the runtime section is the entry of every invocation.
- A top-level name of that program belongs to one of two closed sets.
- The first set holds the global commands that this sibling declares, and it holds `config`, `serve` and `jwt`.
- The second set holds one group for each service of [architecture.md](architecture.md), named by that service in lower case, and it holds `project`, `mission`, `scheduler`, `worker`, `tracking` and `gateway`.
- The two sets are disjoint, so the group of a service collides with no global command. A top-level name outside the two sets is a defect.
- This sibling declares the two sets and the shape of the surface. The implementation sibling of a service declares the command table of its own group, and it declares no top-level name.
- A command table holds one row for each command of the group. A row names the command, then the operation of the RESTful API that it calls with the access policy of that route, or the statement that the command runs locally and calls no route.
- A command that names an operation which no route of the published contract serves is a defect.
- `serve` takes one [application](architecture.vocabulary.md#app) as its operand, and it accepts `server` and `worker`.
- `kanthord serve` starts the server directly. `kanthord serve server` is the explicit form.
- `kanthord serve worker` starts a `worker` application.
- `kanthord` with no command prints the help and exits with a non-zero status, so no invocation starts an application by default.
- `serve` defaults its optional application operand to `server`.
- The `cli` application is no operand of `serve`, because it holds every command that is no `serve`.
- An application name is an operand and no top-level name, so an application collides with the group of a service never.
- A later application joins the operand set of `serve`. A later application that needs a process of its own contradicts the one-process rule of [architecture.md](architecture.md), so it is a change of that page and no ruling of this sibling.
- The `config` group holds `init`, `validate` and `show`, which the section below rules. `init` creates an absent file; no command edits an existing configuration file.
- The `config` group, `serve` and a local command of the group of a service need no running server.
- A command of the group of a service that names an operation reaches the server through the RESTful API, which [gateway-service.md](gateway-service.md) rules.
- Such a command opens no database of the server, and it needs no configuration file of the server.
- A local command of such a group opens no database either. Its command declaration names any file that it reads or writes.
- The CLI provides `kanthord jwt [username] [--name <display>] [--binding <worker binding>] [--config <path>]` to generate a JWT. Without `--binding` it generates a human JWT, and the optional positional `username` argument defaults to `KANTHORD_AUTH_USERNAME` when omitted. With `--binding` it generates a machine JWT for one new client identity of that worker binding, and it rejects a `username` argument. It reads the validated server configuration, derives its signing key from `masterKey`, and prints the token using the secret-display rule. It requires no running server, opens no database and writes no account, password, secret or client configuration. This is the only token issuance entry point. The Gateway Service sibling owns the claim validation and the token contract.
- The help of a command and the validation of its arguments need no running server.
- `--config` belongs to `config`, `serve`, and the local `jwt` command. Service commands reject that option, because they use the client configuration. `jwt` resolves the path through the same option, environment and default order as the server.
- `kanthord --help` lists the three global commands and the six groups, and it names nothing else. The help of a group lists the commands of that group alone.
- `commander` at 15.0.0 produces the help.

## The client configuration

- A command of the group of a service is a client of the RESTful API, so it needs an endpoint and a credential.
- The client configuration holds those two values. It is no configuration of the server, and the server reads it never.
- The client resolves each value in this order: the command-line option, the environment variable, the client configuration file, then the default of that value.
- This order governs a client value alone. The server keeps the rule of the precedence section, where the file is the only source of a value.
- `--endpoint` is the option of the endpoint, and it belongs to the group of a service.
- The client configuration file is `cli.yaml` of the configuration directory, and its default expansion is `$XDG_CONFIG_HOME/kanthord/cli.yaml`.
- [gateway-service.impl.md](gateway-service.impl.md) declares the fields of that file, their defaults and their environment variables.
- The operator supplies the file manually at mode `0600`. The CLI reads it and provides no command that writes or removes it.
- The CLI checks the mode of the file with `lstat` before it reads the file, and a wider mode and a symlink each stop the command.
- An absent file is no failure, because the option, the environment and the default remain.
- The audit set of the start holds no client configuration file, because the server reads that file never.
- A `worker` application resolves its endpoint and its machine JWT through the same order, and [gateway-service.impl.md](gateway-service.impl.md) declares those values.

## The operation and its two entry adapters

- An operation is the unit that a caller outside the process invokes, and [gateway-service.impl.md](gateway-service.impl.md) holds the registry that declares each one with its schema, its access policy, its timeout and its mutation flag.
- The owning service declares its operations, and the Gateway Service projects each one into a route and into the emitted OpenAPI document.
- An internal collaboration between two services is no operation. It stays a function of the owning service, and it takes the transaction of the operation as an explicit argument, which the transaction section rules.
- The registry gives one typed client interface for each service. A caller depends on that interface, and it imports no module of the target service.
- Two entry adapters implement that interface. The direct adapter runs inside the `server` application, and the HTTP adapter runs inside another application and calls the published route.
- Both adapters enter one invocation chain of the server, which holds the validation, the idempotency middleware, the access policy and then the handler. The direct adapter invokes no handler of its own.
- The composition root of an application builds every client once. `kanthord serve server` builds the direct adapter, and `kanthord serve worker` builds the HTTP adapter with one endpoint. No service and no worker instance selects a transport.
- The direct adapter parses its input with the schema of the operation, and it returns a value that the output schema admits, so no value crosses one adapter that the other adapter refuses.
- The contract holds three interaction forms: the unary form of an operation, the exact bytes of a platform delivery, and the long-lived stream of the MCP server. The schema rule covers the unary form.
- An operation names the authority that established the identity of its caller. The Gateway Service mints a human identity and a machine identity from a verified JWT, and the Worker Service vouches for a runtime identity. A value that no authority minted authorizes nothing on either adapter.
- A client interface returns a completed result, a declared failure of the operation, or an indeterminate result. An indeterminate result appears on either adapter, because one caller implementation runs in every application.
- A mutation carries an idempotency key on both adapters, and one logical invocation keeps its key across its retries.
- A waiting operation declares what a cancellation stops, and both adapters carry that cancellation.
- Both adapters carry the trace identity and the parent span of the caller.

## The CLI configuration commands

- `kanthord config init` builds the document in memory with every default and every generated secret.
- It generates `masterKey` from 32 bytes of `crypto.randomBytes`, encoded in base64.
- It validates the document before it writes it.
- The invocation authorizes the creation. It reads no confirmation and requires no terminal.
- It writes the validated bytes and prints the resolved destination after a successful write, without displaying the configuration or its generated secrets.
- The destination of `kanthord config init` is the path that the resolution order of the configuration file gives.
- The command creates the configuration directory with mode `0700` when that directory is absent.
- It writes a temporary file in the directory of the destination with mode `0600`, links that file to the destination, and unlinks the temporary file.
- A link fails when the destination exists, so the command overwrites no file and leaves no partial file.
- `kanthord config validate` loads the stored file with no environment binding and no command-line override, reports each invalid field, and writes nothing.
- `kanthord config show` prints the effective configuration with every sensitive field masked.
- The help output of `config` and of every command of that group prints the absolute path of the configuration file that this invocation resolves.
- That path is the path of the invocation and no path of a process, because a running server resolved its own path at its start and can hold another one.
- The help prints that path whether the file exists or not, and it prints no field and no value.
- A later change of the file is a hand edit by a human, and the CLI manages no edit.
- `kanthord config init` reaches no server and calls no route of the RESTful API, so it opens no second entry path into the server.

## Tests

- A test covers an absent secret field, and an attempted environment override of any field.
- A test covers a mode wider than `0600`, and a symlink at the path of the file.
- A test covers a data directory at `0755` and a database file at `0644`, and each one stops the start.
- A test covers a directory at the path of a database, and it stops the start.
- A test covers a symlink at an audited path of the file index, and it stops the start.
- A test covers a reopen whose replacement holds `0644`, and it asserts the stop and no record in that file.
- A test asserts that the logger writes through the descriptor that passed its validation.
- A test covers `config init` with redirected input and output, no prompt, no secret in the output, and an existing destination that remains unchanged.
- A test covers a failed write, and it asserts that no partial file remains.
- A test covers a top-level name outside the two sets, and it asserts a non-zero status.
- A test covers `kanthord` with no command, and it asserts the help and a non-zero status.
- A test covers `serve` with no operand, and it asserts that it selects the server.
- A test covers `--config` on the group of a service, and it asserts the rejection of that option.
- A test covers the help of a group of a service with no running server, and it asserts a successful exit.
- A test covers the help of the `config` group with an absent configuration file, and it asserts the resolved absolute path in the output.
- A test covers a client configuration file at `0644`, and it asserts that the command stops.
- A test covers the removed login and logout commands and asserts a non-zero exit without creating or changing client configuration.
- A test runs one operation through the direct adapter and through the HTTP adapter, and it asserts the same result, the same failure value and the same idempotent replay.
- A test covers a mutation whose answer the caller loses, and it asserts the indeterminate result.
- A test covers a caller that supplies an identity value that no authority minted, and it asserts the refusal.
- A test covers a parse error on a line that holds a secret, and it asserts that the diagnostic prints no value.
- A test covers a `file` destination that the server cannot open, and it asserts a non-zero status.
- A test covers the `stderr` destination, and it asserts that standard output receives no record of the log.
- A test asserts that the start of the server and the `config validate` command create no configuration file.
- A test asserts that a start creates no file outside the file index.
- A subprocess test covers both fatal events, a reason that is no `Error`, a reason that holds a secret, a failure before the logger exists, a failure during the start, a failure during the stop, and a diagnostic write that fails.
- Each of those cases asserts a non-zero status, no raw secret in the output, no invocation of the stop and no invocation of the release.
- A subprocess test runs the launcher under a version outside the range, and it asserts a non-zero status, one line on standard error, no application module loaded and no database opened.
- A test covers a second start against the same data directory, and it asserts a non-zero status and no change to either database file.
- A test compares the route set of the operation registry with the path set of the committed OpenAPI file, and it fails when the two differ.
- A test covers a database file that the server cannot lock at a later step of the start, and it asserts the release of every earlier resource.
- A test covers a listener that cannot bind, and it asserts that no credential reaches standard output.
- A test covers a signal that arrives during the start.
- A test covers cancellation before start, during start and while running, repeated stops, returned lifecycle errors, and cleanup after a failed start.
- A test covers parent-to-child context cancellation, an earlier deadline, and independent cancellation of a child.
- A test covers a stop with an active MCP stream, and it asserts that the stop of the admission waits for no connection.
- A test covers a start with redirected standard output, and it asserts successful readiness, no JWT in the output and the release of every resource on shutdown.
- A test covers consecutive starts against the same configuration and database, and it asserts no token issuance, continued validity of a locally generated human JWT, and no human account table or stored password.
- A test covers `jwt` without a running server, its configured signing key and lifetime, an explicit username, the default subject when the argument is omitted, invalid usernames, a display name, a machine JWT with a fresh client identity for each run, a `username` argument together with `--binding`, and its refusal to print a token to redirected output.
- A test asserts that generated identities carry the prefix of their entity kind and a canonical ULID portion, including `request_`, `project_` and `mission_`.
- A test covers identity validation with a bare ULID, a wrong entity prefix and a noncanonical ULID portion, and it asserts their rejection.
- A test asserts that every timestamp field of the emitted OpenAPI document composes the shared scalar.
- A conformance set covers the canonical form of a numeric-looking member name, a nested object, the order of an array, an invalid Unicode sequence and the serialization of a number.
- An integration test covers a binding submission that changes no configuration, and a completed idempotent replay.
- A test upgrades a preserved fixture of an earlier release that holds rows.
- A test restarts after a migration sequence that committed two services and failed on the third.
- A test covers a migration that fails in its second statement, and it asserts no row of its own and no partial schema.
- A test covers a recorded history that holds a gap, and one that holds a version above the binary.
- A test covers the AES-256-GCM round trip of a `credential` record, a ciphertext moved between two records, and a truncated ciphertext.
- A test covers the derivation of the cipher key, and it asserts that two labels produce two different keys.

## Application source layout

- The CLI application lives in `engine/src/apps/cli/`, with its entry in `index.ts` and its client configuration alongside it.
- The server application and its composition root live in `engine/src/apps/server/`, with its entry in `index.ts`.
- `engine/src/main.ts` installs the process-level fatal handlers and dispatches to the CLI application. Shared services and components live outside `src/apps/` and are composed by the applications.
- Tests sit beside their source as `*.test.ts`.
